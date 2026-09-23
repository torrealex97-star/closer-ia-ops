"""Search orchestrator cost-aware / quality-aware (ADR-009).

Principio: obtener la calidad objetivo al menor coste posible, no maximizar resultados.
FREE FIRST -> MEASURE QUALITY -> STOP IF GOOD ENOUGH -> ESCALATE ONLY THE GAP.
"""
import asyncio
import json
import logging
from collections import Counter
from datetime import datetime, timezone

from pydantic import BaseModel, Field

from .db import connect, now
from .models import SearchQuery

logger = logging.getLogger("career.orchestrator")

TIERS = ["free", "low", "medium", "high", "premium"]
GOAL_PROVIDER = "search-tier-goal"


class SearchGoal(BaseModel):
    """Objetivo diario configurable sin tocar codigo: se persiste en integration_settings."""
    daily_high_quality_target: int = Field(default=10, ge=1, le=100)
    minimum_qualified: int = Field(default=15, ge=1, le=500)
    minimum_unique_companies: int = Field(default=5, ge=0, le=50)
    maximum_offer_age_hours: int = Field(default=72, ge=1, le=720)
    minimum_quality_score: float = Field(default=0.80, ge=0.0, le=1.0)
    minimum_application_ratio: float = Field(default=0.90, ge=0.0, le=1.0)
    max_daily_paid_budget: float = Field(default=2.0, ge=0.0, le=50.0)
    prefer_free_sources: bool = True


class SourceStat(BaseModel):
    """Aprendizaje por fuente: rendimiento y coste real, base de la prioridad dinamica."""
    source: str
    tier: str
    candidates_found: int = 0
    qualified_jobs: int = 0
    high_quality_jobs: int = 0
    cost_eur: float = 0.0
    quality_yield: float = 0.0
    duplicate_ratio: float = 0.0
    failure: bool = False
    cost_per_qualified: float | None = None
    cost_per_high_quality: float | None = None


class LayerResult(BaseModel):
    tier: str
    attempted: bool
    sources: list[SourceStat]
    stop: bool = False
    gap_description: str | None = None


def get_goal(organization: str) -> SearchGoal:
    with connect() as db:
        row = db.execute(
            "SELECT payload FROM integration_settings WHERE org_id=? AND provider=?",
            (organization, GOAL_PROVIDER),
        ).fetchone()
    return SearchGoal.model_validate_json(row[0]) if row else SearchGoal()


def save_goal(value: SearchGoal, organization: str) -> SearchGoal:
    with connect() as db:
        db.execute("INSERT OR REPLACE INTO integration_settings VALUES(?,?,?)",
                   (organization, GOAL_PROVIDER, value.model_dump_json()))
    return value


def gate(job: dict, goal: SearchGoal) -> bool:
    """Quality Gate determinista: cuenta para el objetivo solo si supera todos los controles."""
    from .presentation import explicitly_closed
    if explicitly_closed(str(job.get("title") or ""), str(job.get("description") or "")):
        return False
    if float(job.get("score") or 0) / 100 < goal.minimum_quality_score:
        return False
    published = job.get("published_at") or job.get("captured_at")
    if not published:
        return False
    try:
        age_h = (datetime.now(timezone.utc) - datetime.fromisoformat(str(published))).total_seconds() / 3600
    except (ValueError, TypeError):
        return False
    if age_h > goal.maximum_offer_age_hours or age_h < -1:
        return False
    return bool(job.get("application_url") or job.get("source_url"))


def passes_goal(qualified: list[dict], goal: SearchGoal) -> bool:
    """Objetivo alcanzado: alta calidad + diversidad minima como senal, no como cuota."""
    if len(qualified) < goal.daily_high_quality_target:
        return False
    if goal.minimum_unique_companies:
        companies = {str(j.get("company") or "").lower() for j in qualified}
        if len(companies) < min(goal.minimum_unique_companies, len(qualified)):
            return False
    return True


def describe_gap(qualified: list[dict], goal: SearchGoal) -> str:
    """Gap en terminos de negocio: cuantas faltan y de que tipo, para escalado especifico."""
    missing = goal.daily_high_quality_target - len(qualified)
    parts = [f"Faltan {missing} oportunidades de alta calidad"]
    if goal.minimum_unique_companies:
        companies = {str(j.get("company") or "").lower() for j in qualified}
        if len(companies) < min(goal.minimum_unique_companies, len(qualified)):
            parts.append(f"y {goal.minimum_unique_companies - len(companies)} empresas unicas")
    return "; ".join(parts)


def spent_today_eur(organization: str) -> float:
    from .collection import day_key
    with connect() as db:
        row = db.execute(
            "SELECT coalesce(sum(reserved_cents),0) FROM scrape_budget WHERE org_id=? AND (day=? OR finished_day=?)",
            (organization, day_key(), day_key()),
        ).fetchone()
    return row[0] / 100


def source_tiers(registry: dict, organization: str) -> dict[str, list[str]]:
    """Agrupa codigos de fuente por cost_tier. FREE por defecto; la configuracion manda."""
    configured = {}
    with connect() as db:
        rows = db.execute("SELECT payload FROM integration_settings WHERE provider='source-tier'").fetchall()
    for row in rows:
        value = json.loads(row["payload"])
        configured[value.get("code")] = value.get("tier", "free")
    tiers: dict[str, list[str]] = {t: [] for t in TIERS}
    for code, connector in registry.items():
        tier = configured.get(code)
        if tier is None:
            tier = "low" if getattr(connector, "provider", "") == "apify" else "free"
        if tier == "free" and getattr(connector, "provider", "") == "serpapi_google_jobs_v1":
            tier = "low"  # SerpApi cobra por búsqueda: nunca capa FREE aunque su ejecución sea local.
        tiers[tier].append(code)
    return {t: sorted(set(codes)) for t, codes in tiers.items() if codes}


def layer_stats(run_id, organization, tier, codes, stats):
    """Agrega fetched/accepted/failure de las fuentes recien ejecutadas en SourceStat."""
    with connect() as db:
        row = db.execute("SELECT sources FROM search_runs WHERE id=? AND org_id=?", (run_id, organization)).fetchone()
    progress = {s["code"]: s for s in json.loads(row["sources"])} if row else {}
    for code in codes:
        state = progress.get(code, {})
        prior = stats.get(code)
        stat = prior or SourceStat(source=code, tier=tier)
        stat.candidates_found += state.get("fetched") or 0
        stat.qualified_jobs += state.get("accepted") or 0
        stat.failure = stat.failure or state.get("status") == "failed"
        if not stat.failure and stat.candidates_found:
            stat.quality_yield = round(stat.qualified_jobs / stat.candidates_found, 4)
        stats[code] = stat
    return stats


def count_qualified(organization: str, run_id: str, goal: SearchGoal) -> list[dict]:
    """Cuenta sobre resultados reales del run vigentes, no sobre candidatos brutos."""
    with connect() as db:
        rows = db.execute(
            """SELECT r.payload FROM search_results r
               JOIN catalog_entries c ON c.org_id=r.org_id AND c.job_id=r.job_id
               WHERE r.run_id=? AND r.org_id=? AND c.expires_at>?""",
            (run_id, organization, now()),
        ).fetchall()
    qualified = []
    for row in rows:
        job = json.loads(row["payload"])
        if gate(job, goal):
            qualified.append(job)
    return qualified


async def execute_layered(run_id, organization, query: SearchQuery, registry: dict,
                          goal: SearchGoal | None = None, spend=None) -> dict:
    """Ejecucion por capas FREE->premium con parada temprana por calidad y tope de presupuesto.

    selection: si query.sources es explicita (no vacia) se respeta; None = todas las del registry.
    """
    goal = goal or get_goal(organization)
    if spend is None:
        spend = spent_today_eur
    tiers = source_tiers(registry, organization)
    selection = set(query.sources) if getattr(query, "sources", None) else set(registry)
    stats: dict[str, SourceStat] = {}
    layers: list[LayerResult] = []
    qualified: list[dict] = []
    with connect() as db:
        db.execute("UPDATE search_runs SET status='running' WHERE id=? AND org_id=?", (run_id, organization))
    for tier in TIERS:
        codes = [c for c in tiers.get(tier, []) if c in selection]
        connectors = [registry[c] for c in codes if c in registry]
        if not connectors:
            continue
        if tier != "free":
            remaining = goal.max_daily_paid_budget - spend(organization)
            if remaining <= 0:
                layers.append(LayerResult(tier=tier, attempted=False, sources=[],
                                          gap_description="Presupuesto de pago agotado; no se escala"))
                continue
        from .worker import run_source
        await asyncio.gather(*(run_source(c, query, run_id, organization) for c in connectors))
        layer_stats(run_id, organization, tier, codes, stats)
        qualified = count_qualified(organization, run_id, goal)
        stop = passes_goal(qualified, goal)
        high_by_name = Counter(str(j.get("source") or "") for j in qualified)
        for code in codes:
            stat = stats.get(code)
            if stat:
                name = getattr(registry.get(code), "name", code)
                stat.high_quality_jobs = high_by_name.get(name, 0)
                if stat.cost_eur > 0:
                    stat.cost_per_qualified = round(stat.cost_eur / max(1, stat.qualified_jobs), 4)
                    stat.cost_per_high_quality = round(stat.cost_eur / max(1, stat.high_quality_jobs), 4)
        layers.append(LayerResult(tier=tier, attempted=True,
                                  sources=[stats[c] for c in codes if c in stats],
                                  stop=stop,
                                  gap_description=None if stop else describe_gap(qualified, goal)))
        if stop:
            break
    with connect() as db:
        db.execute("UPDATE search_runs SET status='completed',completed_at=? WHERE id=? AND org_id=? AND status='running'",
                   (now(), run_id, organization))
    return {"layers": layers, "stats": list(stats.values()), "qualified": qualified}


def dynamic_priority(stats: list[SourceStat]) -> list[SourceStat]:
    """score = yield*2 - coste - duplicados - fallo. Ordena que fuente consultar primero la proxima vez."""
    def score(stat: SourceStat) -> float:
        yield_value = stat.quality_yield
        if not yield_value and stat.candidates_found and stat.qualified_jobs:
            yield_value = stat.qualified_jobs / stat.candidates_found
        value = yield_value * 2 - stat.duplicate_ratio - (1.0 if stat.failure else 0.0)
        if stat.cost_eur > 0:
            value -= min(2.0, stat.cost_eur)
        if stat.cost_per_qualified is not None and stat.cost_per_qualified > 1.0:
            value -= 1.0
        return value

    return sorted(stats, key=score, reverse=True)


def save_source_stats(organization: str, stats: list[SourceStat]) -> None:
    """Persiste el aprendizaje por fuente (tabla source_stats, migracion 6)."""
    with connect() as db:
        for stat in stats:
            db.execute(
                "INSERT OR REPLACE INTO source_stats VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                (organization, stat.source, now(), stat.candidates_found, stat.qualified_jobs,
                 stat.high_quality_jobs, stat.cost_eur, stat.quality_yield, stat.duplicate_ratio,
                 int(stat.failure), stat.cost_per_qualified, stat.cost_per_high_quality),
            )
