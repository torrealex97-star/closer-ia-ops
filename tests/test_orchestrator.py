"""ADR-009: orquestador cost-aware / quality-aware.

Demuestra el contrato de escalada: FREE FIRST -> MEASURE QUALITY -> STOP IF GOOD ENOUGH
-> ESCALATE ONLY THE GAP, con presupuesto tope y objetivo configurable sin tocar código.
"""
import asyncio
import json

from career.connectors import Himalayas, ProviderError, WeWorkRemotely
from career.db import connect, now
from career.models import SearchQuery
from career.orchestrator import (SearchGoal, SourceStat, dynamic_priority,
                                 execute_layered, get_goal)
from career.pipeline import ingest

# Fixture client: BD aislada por test + TestClient autenticado (definida en test_engine).
from tests.test_engine import client as client_fixture, candidate  # noqa: F401


client = client_fixture  # pytest resuelve 'client' como fixture al inyectarlo en cada test


def paid_candidate(company="Agencia Uno"):
    """Candidato con la forma que Himalayas normaliza (guid/applicationLink/pubDate)."""
    from career.connectors import Candidate
    slug = company.lower().replace(" ", "-")
    return Candidate("stable-paid-" + slug, {
        "guid": "https://example.com/jobs/" + slug, "title": "Closer digital",
        "companyName": company,
        "description": "Buscamos closer de ventas para el equipo. Trabajo remoto en español.",
        "locationRestrictions": [], "pubDate": now(),
        "applicationLink": "https://example.com/apply/" + slug,
    })


class PaidConnector(Himalayas):
    code = "paid-low"
    name = "Fuente de pago"
    provider = "apify"
    url = "https://example.com/paid"

    def normalize(self, row):
        """Un conector Apify real mapea su payload; aquí, el formato Himalayas de partida."""
        from career.pipeline import normalize
        return normalize("himalayas", row)

    def __init__(self, jobs):
        self.jobs = jobs
        self.calls = 0

    async def batches(self, query):
        self.calls += 1
        yield list(self.jobs)


def make_goal(target=10, budget=2.0, companies=0) -> SearchGoal:
    # 0.5: los fixtures de test scorean 0.5-0.7 (sin ubicación estructurada); el gate exige score >= umbral.
    return SearchGoal(daily_high_quality_target=target, minimum_qualified=target,
                      minimum_unique_companies=companies, max_daily_paid_budget=budget,
                      minimum_quality_score=0.5)


def seed_jobs(client, goal, count, org="org-a", company="Agencia Uno"):
    """Inserta ofertas cualificadas vigentes directamente en el run actual."""
    run = client.post("/v1/search-runs", json={"query": {"sources": ["himalayas"]}, "idempotency_key": "seed-" + str(count) + company}).json()
    for index in range(count):
        ingest(paid_candidate(f"{company}-{index}" if count > 1 or company != "Agencia Uno" else company),
               Himalayas(), SearchQuery(), run["id"], org)
    return run


def layered_registry(free_jobs, paid_connector=None):
    class Free(Himalayas):
        code = "himalayas"
        name = "Himalayas"
        async def batches(self, query):
            yield list(free_jobs)
    registry = {"himalayas": Free()}
    if paid_connector is not None:
        registry["paid-low"] = paid_connector
    return registry


def test_free_layer_reaching_goal_never_calls_paid_providers(client):
    """1. Si FREE encuentra >= 10 válidas, no se llama a ningún proveedor de pago."""
    goal = make_goal(target=2)  # objetivo pequeño de test: 2 buenas cierran el día
    paid = PaidConnector([paid_candidate("Pago A"), paid_candidate("Pago B")])
    free_jobs = [paid_candidate(f"Gratis {i}") for i in range(3)]
    with connect() as db:
        db.execute("INSERT INTO search_runs VALUES(?,?,?,'queued',?,?,?,NULL)",
                   ('run-free', 'org-a', 'key-free', '{}', json.dumps([
                       {"code": "himalayas", "name": "Himalayas"},
                       {"code": "paid-low", "name": "Fuente de pago"}]), now()))
    result = asyncio.run(execute_layered('run-free', 'org-a',
                                         SearchQuery(sources=["himalayas", "paid-low"]),
                                         layered_registry(free_jobs, paid), goal=goal))
    tiers_attempted = [layer.tier for layer in result["layers"] if layer.attempted]
    assert tiers_attempted == ["free"]
    assert paid.calls == 0
    assert result["layers"][0].stop is True
    assert len(result["qualified"]) == 3


def test_gap_scaling_calls_only_what_is_needed(client):
    """2. Si FREE encuentra 8 de 10, se escala la capa siguiente solo para completar el gap."""
    goal = make_goal(target=10)
    paid = PaidConnector([paid_candidate(f"Pago {i}") for i in range(2)])
    free_jobs = [paid_candidate(f"Gratis {i}") for i in range(8)]
    with connect() as db:
        db.execute("INSERT INTO search_runs VALUES(?,?,?,'queued',?,?,?,NULL)",
                   ('run-gap', 'org-a', 'key-gap', '{}', json.dumps([
                       {"code": "himalayas", "name": "Himalayas"},
                       {"code": "paid-low", "name": "Fuente de pago"}]), now()))
    result = asyncio.run(execute_layered('run-gap', 'org-a',
                                         SearchQuery(sources=["himalayas", "paid-low"]),
                                         layered_registry(free_jobs, paid), goal=goal))
    assert [layer.tier for layer in result["layers"] if layer.attempted] == ["free", "low"]
    assert paid.calls == 1
    assert result["layers"][0].stop is False
    assert result["layers"][1].stop is True
    assert len(result["qualified"]) == 10
    assert "Faltan 2" in result["layers"][0].gap_description


def test_expensive_low_yield_source_loses_priority(client):
    """3. Una fuente cara con mal yield pierde prioridad frente a alternativas."""
    bad_paid = SourceStat(source="provider-x", tier="high", candidates_found=500,
                          qualified_jobs=7, high_quality_jobs=2, cost_eur=40.0)
    good_free = SourceStat(source="himalayas", tier="free", candidates_found=1000,
                           qualified_jobs=80, high_quality_jobs=24, cost_eur=0.0)
    ordered = dynamic_priority([bad_paid, good_free])
    assert ordered[0].source == "himalayas"
    # La fuente gratuita con 8% de yield supera a la cara con 1.4% y coste 40 €.
    assert 80 / 1000 > 7 / 500
    assert ordered[0].cost_eur == 0 and ordered[-1].cost_eur == 40.0


def test_free_high_yield_source_wins_priority(client):
    """4. Una fuente gratuita con buen yield gana la prioridad."""
    stats = [
        SourceStat(source="provider-x", tier="medium", candidates_found=200, qualified_jobs=10,
                   cost_eur=5.0, quality_yield=0.05),
        SourceStat(source="himalayas", tier="free", candidates_found=200, qualified_jobs=60,
                   cost_eur=0.0, quality_yield=0.30),
    ]
    ordered = dynamic_priority(stats)
    assert ordered[0].source == "himalayas"


def test_source_failure_does_not_stop_the_search(client):
    """5. El fallo de una fuente no detiene la búsqueda ni descarta lo ya obtenido."""
    class Broken(WeWorkRemotely):
        code = "weworkremotely"
        name = "We Work Remotely"
        async def batches(self, query):
            raise ProviderError("fuente caida")
            yield []
    registry = {"himalayas": Himalayas(), "weworkremotely": Broken()}
    # himalayas real fallaría por red; se sustituye el fetch para que devuelva una oferta válida.
    import career.connectors as connectors
    payload = paid_candidate("Unica Viva").payload
    async def fake_fetch(url, params=None, ttl=900):
        return json.dumps({"jobs": [payload]})
    connectors_fetch = connectors.fetch
    connectors.fetch = fake_fetch
    try:
        with connect() as db:
            db.execute("INSERT INTO search_runs VALUES(?,?,?,'queued',?,?,?,NULL)",
                       ('run-fail', 'org-a', 'key-fail', '{}', json.dumps([
                           {"code": "himalayas", "name": "Himalayas"},
                           {"code": "weworkremotely", "name": "We Work Remotely"}]), now()))
        result = asyncio.run(execute_layered('run-fail', 'org-a',
                                             SearchQuery(sources=["himalayas", "weworkremotely"]),
                                             registry, goal=make_goal(target=1)))
    finally:
        connectors.fetch = connectors_fetch
    assert result["layers"][0].attempted is True
    failed = [s for s in result["layers"][0].sources if s.source == "weworkremotely"]
    assert failed and failed[0].failure is True
    # El resto de fuentes sigue aportando resultados pese al fallo.
    assert len(result["qualified"]) == 1


def test_configured_budget_is_never_exceeded(client):
    """6. Nunca se supera el presupuesto configurado: sin margen, no se escala a capas de pago."""
    goal = make_goal(target=10, budget=0.0)  # presupuesto agotado de antemano
    paid = PaidConnector([paid_candidate(f"Pago {i}") for i in range(5)])
    free_jobs = [paid_candidate(f"Gratis {i}") for i in range(3)]
    with connect() as db:
        db.execute("INSERT INTO search_runs VALUES(?,?,?,'queued',?,?,?,NULL)",
                   ('run-budget', 'org-a', 'key-budget', '{}', json.dumps([
                       {"code": "himalayas", "name": "Himalayas"},
                       {"code": "paid-low", "name": "Fuente de pago"}]), now()))
    result = asyncio.run(execute_layered('run-budget', 'org-a',
                                         SearchQuery(sources=["himalayas", "paid-low"]),
                                         layered_registry(free_jobs, paid), goal=goal))
    assert paid.calls == 0
    skipped = [layer for layer in result["layers"] if not layer.attempted]
    assert skipped and "Presupuesto" in (skipped[0].gap_description or "")
    spent_before = 0.0
    def spend(org):
        return spent_before + 999.0
    with connect() as db:
        db.execute("UPDATE search_runs SET status='queued' WHERE id='run-budget'")
    result = asyncio.run(execute_layered('run-budget', 'org-a',
                                         SearchQuery(sources=["himalayas", "paid-low"]),
                                         layered_registry(free_jobs, paid), goal=goal, spend=spend))
    assert paid.calls == 0  # sigue sin llamar: el tope manda sobre el objetivo


def test_goal_is_configurable_without_code_changes(client):
    """7. El objetivo puede cambiar de 10 a otro número sin cambiar código (API + persistencia)."""
    response = client.get("/v1/search-goal")
    assert response.status_code == 200 and response.json()["daily_high_quality_target"] == 10
    saved = client.put("/v1/search-goal", json={"daily_high_quality_target": 3,
                                                "minimum_qualified": 5, "minimum_unique_companies": 2,
                                                "maximum_offer_age_hours": 48, "minimum_quality_score": 0.7,
                                                "minimum_application_ratio": 0.8,
                                                "max_daily_paid_budget": 1.5, "prefer_free_sources": True})
    assert saved.status_code == 200 and saved.json()["daily_high_quality_target"] == 3
    stored = get_goal("org-a")
    assert stored.daily_high_quality_target == 3 and stored.minimum_qualified == 5
    paid = PaidConnector([paid_candidate("Pago A"), paid_candidate("Pago B")])
    free_jobs = [paid_candidate(f"Gratis {i}") for i in range(4)]
    with connect() as db:
        db.execute("INSERT INTO search_runs VALUES(?,?,?,'queued',?,?,?,NULL)",
                   ('run-goal', 'org-a', 'key-goal', '{}', json.dumps([
                       {"code": "himalayas", "name": "Himalayas"},
                       {"code": "paid-low", "name": "Fuente de pago"}]), now()))
    result = asyncio.run(execute_layered('run-goal', 'org-a',
                                         SearchQuery(sources=["himalayas", "paid-low"]),
                                         layered_registry(free_jobs, paid), goal=None))
    # Con objetivo 3, FREE (4 cualificadas) alcanza el objetivo y no se escala a pago.
    assert [layer.tier for layer in result["layers"] if layer.attempted] == ["free"]
    assert paid.calls == 0
    client.put("/v1/search-goal", json={"daily_high_quality_target": 10})  # restaurar default
