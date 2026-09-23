"""Guided setup: public metadata discovery, server-owned plans, shared credentials."""
import asyncio
import json
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, SecretStr

from .connectors import ProviderError, fetch
from .db import connect, now, org, uid
from .sources import (CATALOG_BY_CODE, ConnectionInput, _save_connection, apify_request,
                      read_token, secret_path)
from .vocabulary import ALIASES as _VOCAB_ALIASES

router = APIRouter(prefix="/v1")
# Términos por defecto para inputs de Apify: la 'lista mínima' del vocabulario canónico
# (taxonomía WDC 2026-09-23). El asistente los envía completos; sin duplicar aquí.
_PREFERRED_INPUT_TERMS = [
    "closer", "closer de ventas", "high ticket closer", "sales closer",
    "cerrador de ventas", "setter", "appointment setter", "setter closer",
    "asesor comercial", "asesor de admisiones", "admissions advisor",
    "enrollment advisor", "student advisor", "sales advisor", "sales consultant",
    "account executive", "inside sales", "sdr",
    "business development representative", "consultor comercial",
    "ventas consultivas", "asesor educativo", "asesor de matricula",
    "patient advisor", "patient coordinator", "treatment coordinator",
]
_vocab = set(_VOCAB_ALIASES['digital_sales'])
KEYWORDS = [t for t in _PREFERRED_INPUT_TERMS if t in _vocab]
PREFERRED = {"infojobs": "haketa/infojobs-scraper", "computrabajo": "haketa/computrabajo-scraper", "linkedin": "curious_coder/linkedin-jobs-scraper", "workana": "automation-lab/workana-freelance-projects-scraper", "getonbrd": "scrapers_lat/getonbrd-scraper"}
FIELDS = {
    "title": ["title", "jobTitle", "position", "job_title"],
    "company": ["companyName", "company", "company.name", "company_name"],
    "description": ["description", "descriptionText", "jobDescription", "descriptionHtml", "text", "content"],
    "source_url": ["url", "jobUrl", "link", "postUrl", "job_url"],
    "locations": ["location", "country", "city", "locations", "jobLocation"],
    "published_at": ["publishedAt", "postedAt", "postedDate", "datePosted", "published_at", "timestamp"],
    "work_mode": ["teleworking", "workMode", "workplaceType", "workType", "remoteType"],
}


def setting(provider, organization):
    with connect() as db:
        row = db.execute("SELECT payload FROM integration_settings WHERE org_id=? AND provider=?", (organization, provider)).fetchone()
    return json.loads(row[0]) if row else {}


def save_setting(provider, value, organization):
    with connect() as db:
        db.execute("INSERT OR REPLACE INTO integration_settings VALUES(?,?,?)", (organization, provider, json.dumps(value)))


def save_secret(provider, token, clear, organization):
    import os
    path = secret_path(organization, "account-" + provider)
    if token and token.get_secret_value().strip():
        raw = token.get_secret_value().strip()
        if len(raw) > 1000 or any(c.isspace() for c in raw):
            raise HTTPException(422, "La clave contiene espacios o no tiene un formato válido")
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "w") as file:
            file.write(raw)
        os.chmod(path, 0o600)
    elif clear:
        path.unlink(missing_ok=True)


class AccountInput(BaseModel):
    token: SecretStr | None = None
    clear_token: bool = False


@router.get("/integrations/apify")
def apify_account():
    return {"has_token": bool(read_token(org(), "account-apify"))}


@router.post("/integrations/apify")
def save_apify(body: AccountInput):
    save_secret("apify", body.token, body.clear_token, org())
    return apify_account()


@router.post("/integrations/apify/check")
async def check_apify():
    token = read_token(org(), "account-apify")
    if not token:
        raise HTTPException(422, "Pega tu clave de Apify y guarda la conexión primero")
    try:
        data = await apify_request("GET", "users/me", token)
        if not isinstance(data.get("data"), dict) or not data["data"].get("id"):
            raise ProviderError("Apify no ha confirmado la cuenta")
        return {"message": "Cuenta verificada. No se ha ejecutado ningún scraper."}
    except ProviderError as exc:
        raise HTTPException(422, str(exc)) from None


@router.get("/integrations/serpapi")
def serpapi_account():
    return {"has_token": bool(read_token(org(), "account-serpapi"))}


@router.post("/integrations/serpapi")
def save_serpapi(body: AccountInput):
    save_secret("serpapi", body.token, body.clear_token, org())
    return serpapi_account()


@router.post("/integrations/serpapi/check")
async def check_serpapi():
    """Verifica la clave con una petición real de 1 búsqueda de Google (barata)."""
    token = read_token(org(), "account-serpapi")
    if not token:
        raise HTTPException(422, "Pega tu clave de SerpApi y guarda la conexión primero")
    from .connectors import fetch
    from urllib.parse import urlencode
    probe = urlencode({"engine": "google", "q": "serpapi", "api_key": token})
    try:
        data = json.loads(await fetch("https://serpapi.com/search?" + probe, ttl=0))
    except ProviderError as exc:
        raise HTTPException(422, "SerpApi no ha respondido: " + str(exc)) from None
    if "error" in data:
        raise HTTPException(422, "SerpApi rechazó la clave: " + str(data["error"]))
    if not isinstance(data.get("search_metadata", {}).get("id"), str):
        raise HTTPException(422, "SerpApi no ha confirmado la cuenta")
    return {"message": "Clave verificada con una búsqueda de prueba. Se ha consumido 1 crédito de tu cuenta."}


class PrepareSource(BaseModel):
    source: str = "custom"
    location: str = Field(default="Spain", max_length=100)
    urls: list[str] = Field(default_factory=list, max_length=10)
    keywords: list[str] = Field(default_factory=lambda: list(KEYWORDS), max_length=12)
    max_items: int = Field(default=25, ge=5, le=100)
    max_charge_usd: float = Field(default=1, ge=0.1, le=5)


class AcceptPlan(BaseModel):
    plan_id: str


def infer_mapping(rows):
    def present(row, path):
        value = row
        for part in path.split("."):
            value = value.get(part) if isinstance(value, dict) else None
        return isinstance(value, (str, list)) and bool(value)
    return {key: next((path for path in paths if any(present(row, path) for row in rows)), paths[0]) for key, paths in FIELDS.items()}


def infer_source(source, urls):
    if source != "custom" or not urls:
        return source
    host = urlsplit(urls[0]).hostname or ""
    for code, row in CATALOG_BY_CODE.items():
        domain = (urlsplit(row[3]).hostname or "").removeprefix("www.")
        if domain and domain != "apify.com" and (host == domain or host.endswith("." + domain)):
            return code
    return source


async def public_metadata(path, params=None):
    data = json.loads(await fetch("https://api.apify.com/v2/" + path, params, ttl=21600))
    if not isinstance(data, dict) or "data" not in data:
        raise ProviderError("No se pudo leer el catálogo de scrapers")
    return data["data"]


def prepare_input(schema, body):
    props = schema.get("properties", {})
    safe_defaults = {"proxyConfiguration", "withDetails", "includeDetails"}
    result = {key: value["default"] for key, value in props.items() if key in safe_defaults and "default" in value and not value.get("isSecret")}
    url_key = next((k for k in ["startUrls", "urls", "searchUrls", "searchUrl", "startUrl", "target_urls", "targetUrls", "rawUrl"] if k in props), None)
    keyword_key = next((k for k in ["keywords", "searchQueries", "searchTerm", "searchQuery", "query", "keyword", "titles", "queries", "searches", "searchTerms", "titleSearch", "jobKeywords", "position"] if k in props), None)
    mode = "objects"
    if body.urls:
        if not url_key:
            raise ValueError("El scraper no admite enlaces en un formato compatible")
        spec = props[url_key]
        mode = "single" if spec.get("type") == "string" else "objects" if spec.get("editor") == "requestListSources" or spec.get("items", {}).get("type") == "object" else "strings"
        if mode == "single" and len(body.urls) > 1:
            raise ValueError("Este scraper admite un solo enlace por conexión")
        result[url_key] = body.urls[0] if mode == "single" else [{"url": u} for u in body.urls] if mode == "objects" else body.urls
    elif keyword_key:
        spec = props[keyword_key]
        # Do not concatenate unrelated keywords into a single AND query.
        if spec.get("type") != "array" and len(body.keywords) > 1:
            raise ValueError("Este scraper acepta un solo término. Elige una palabra clave o pega enlaces de búsquedas filtradas; no descartaremos los demás términos en silencio.")
        result[keyword_key] = body.keywords if spec.get("type") == "array" else body.keywords[0]
    else:
        raise ValueError("Pega un enlace de búsqueda para preparar esta fuente")
    limit_key = next((k for k in ["maxItems", "maxJobs", "count", "limit", "results_wanted", "maxResults", "max_items", "maxRows", "maxPosts", "maxPostsCount", "resultsLimit", "resultsCount", "limitPerSource", "maxItemsPerSearch"] if k in props), None)
    if not limit_key:
        raise ValueError("No se pudo verificar un límite de resultados para este scraper")
    partitions = len(body.urls) if body.urls else len(body.keywords) if props.get(keyword_key, {}).get('type') == 'array' else 1
    if limit_key in {'limitPerSource', 'maxItemsPerSearch'} and partitions > body.max_items:
        raise ValueError("Demasiadas búsquedas para el límite total. Reduce términos o enlaces.")
    result[limit_key] = max(1, body.max_items // partitions) if limit_key in {'limitPerSource', 'maxItemsPerSearch'} else body.max_items
    if result[limit_key] < props[limit_key].get('minimum', 0):
        raise ValueError("El límite mínimo del proveedor supera el presupuesto de registros por búsqueda. Reduce términos o enlaces.")
    # Avoid optional detail enrichment, comments, profiles and model calls.
    for key in ['scrapeComments', 'includeComments', 'scrapeReactions', 'includeMedia', 'includeMediaLinks',
                'scrapeCompany', 'companyProfile', 'enrichCompany', 'includeCompanyDetails',
                'withAiSummary', 'withAiSkills', 'withAiTranslate', 'aiAnalysis',
                'sentiment_analysis', 'content_analysis', 'includeOwnerDetails']:
        if props.get(key, {}).get('type') == 'boolean':
            result[key] = False
    # Location text is only sent to a declared string field; enums must match.
    location_key = next((k for k in ['location', 'country', 'locations', 'countries', 'locationSearch'] if props.get(k, {}).get('type') in {'string', 'array'}), None)
    if location_key and body.location.strip() and not body.urls:
        array_location = props[location_key].get('type') == 'array'
        options = props[location_key].get('items', {}).get('enum') if array_location else props[location_key].get('enum')
        choices = [body.location.strip()]
        if body.location.strip().lower() in {'spain', 'espana', 'españa', 'es'}:
            choices = ['Spain', 'España', 'ES', 'es', 'spain']
        chosen = next((v for v in choices if not options or v in options), None)
        if chosen is None:
            raise ValueError("El proveedor exige otro formato de ubicación. Usa una URL filtrada del sitio.")
        result[location_key] = [chosen] if array_location else chosen
    if "onlyTeleworking" in props:
        result["onlyTeleworking"] = True
    missing = [k for k in schema.get("required", []) if k not in result or result[k] in [None, "", []]]
    if missing:
        raise ValueError("El proveedor necesita datos adicionales: " + ", ".join(missing))
    return result, url_key or "startUrls", mode


@router.post("/source-assistant/prepare")
async def prepare(body: PrepareSource):
    try:
        ConnectionInput.public_urls(body.urls)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None
    if not body.keywords or any(not k.strip() or len(k) > 100 for k in body.keywords):
        raise HTTPException(422, "Añade al menos una palabra clave válida")
    source = infer_source(body.source, body.urls)
    if source not in CATALOG_BY_CODE:
        raise HTTPException(422, "Elige una fuente del catálogo")
    query = (CATALOG_BY_CODE[source][1].split(" · ")[0] if source != "custom" else (urlsplit(body.urls[0]).hostname if body.urls else "jobs")) + " jobs scraper"
    from .source_strategy import audit, actor_matches
    verified = [c['actor'] for c in audit().get(source, {}).get('candidates', [])]
    candidates = list(dict.fromkeys(([PREFERRED[source]] if source in PREFERRED else []) + verified))
    if source == 'facebook' and any('/groups/' in url for url in body.urls):
        candidates.insert(0, 'apify/facebook-groups-scraper')
    try:
        store = await public_metadata("store", {"search": query, "limit": 5})
        for item in store.get("items", []):
            actor = f'{item.get("username", "")}/{item.get("name", "")}'
            if actor_matches(source, actor) and actor not in candidates and item.get("notice", "NONE") not in {"DEPRECATED", "UNDER_MAINTENANCE"}:
                candidates.append(actor)
    except (ProviderError, ValueError):
        if not candidates:
            raise HTTPException(422, "El catálogo no responde. Prueba más tarde o usa la conexión avanzada.") from None

    preparation_errors = []

    async def inspect(actor):
        if source == 'facebook' and any('/groups/' in url for url in body.urls) and 'groups' not in actor:
            return None
        if not re.fullmatch(r"[\w-]+/[\w-]+", actor):
            return None
        try:
            metadata, build = await asyncio.gather(public_metadata("acts/" + actor.replace("/", "~")), public_metadata("acts/" + actor.replace("/", "~") + "/builds/default"))
            if metadata.get("isDeprecated") or build.get("status") != "SUCCEEDED":
                return None
            schema = build.get("inputSchema") or build.get("actorDefinition", {}).get("input", {})
            schema = json.loads(schema) if isinstance(schema, str) else schema
            actor_input, url_key, mode = prepare_input(schema, body)
            if actor == 'apify/facebook-groups-scraper':
                actor_input['onlyPostsNewerThan'] = '10 days'
                actor_input['viewOption'] = 'CHRONOLOGICAL'
                actor_input['resultsLimit'] = max(1, body.max_items // max(1, len(body.urls)))
            ConnectionInput.safe_input(actor_input)
            pricing = [p for p in metadata.get("pricingInfos", []) if p.get("startedAt", "") <= now()]
            pricing = sorted(pricing, key=lambda p: p.get("startedAt", ""))
            price = pricing[-1] if pricing else {}
            if price.get("pricingModel") not in {"PAY_PER_EVENT", "PRICE_PER_DATASET_ITEM"}:
                return None  # No rental/subscription or open-ended compute in the guided path.
            mapping = dict((key, paths[0]) for key, paths in FIELDS.items())
            if actor == "haketa/infojobs-scraper":
                mapping.update(company="company", locations="city", published_at="publishedAt", work_mode="teleworking")
            value = ConnectionInput(name=CATALOG_BY_CODE[source][1], source=source, actor_id=actor, urls=body.urls, url_field=url_key, url_format=mode, actor_input=actor_input, mapping=mapping, max_items=body.max_items, max_charge_usd=body.max_charge_usd, auto_mapping=True, build=build["buildNumber"])
            return {"connection": value.model_dump(exclude={"token"}), "actor_title": metadata.get("title", actor), "pricing_model": price.get("pricingModel"), "pricing": price, "build": build["buildNumber"], "actor_url": "https://apify.com/" + actor, "message": "Configuración preparada a partir del esquema del proveedor. Se comprobará la salida al terminar la primera extracción.",
                    "filters_applied": (["Enlaces de búsqueda: se usarán los filtros incluidos en las URLs"] if body.urls else ["Palabras clave: " + ", ".join(body.keywords)]) + (["Ubicación: " + str(actor_input[k]) for k in ['location', 'country', 'locations', 'countries', 'locationSearch'] if k in actor_input] if not body.urls else []) + (["Solo teletrabajo o híbrido"] if actor_input.get('onlyTeleworking') else []),
                    "filters_pending": (["Facebook público: búsqueda por keyword limitada por el proveedor; se leen publicaciones recientes del grupo y se filtran localmente"] if actor == 'apify/facebook-groups-scraper' else []) + ["Español, perfil y vigencia se validan también al importar"] + (["Modalidad sin filtro verificado en origen: utiliza una URL filtrada para reducir descartes"] if not actor_input.get('onlyTeleworking') else []) + (["Ubicación no aplicada en origen: utiliza una URL con país o ciudad"] if not body.urls and not any(k in actor_input for k in ['location', 'country', 'locations', 'countries', 'locationSearch']) else []),
                    "prepared_input": actor_input}
        except ValueError as exc:
            preparation_errors.append(str(exc))
            return None
        except (ProviderError, KeyError, TypeError):
            return None
    plan = await inspect(candidates[0]) if candidates else None
    if not plan:
        inspected = await asyncio.gather(*(inspect(actor) for actor in candidates[1:3]))
        plan = next((value for value in inspected if value), None)
    if not plan:
        raise HTTPException(422, preparation_errors[0] if preparation_errors else "No encontramos un scraper compatible con límites verificables para estos enlaces. Prueba un enlace de búsqueda más específico; la conexión avanzada sigue disponible.")
    plan_id = uid()
    plan.update(id=plan_id, expires_at=(datetime.now(timezone.utc) + timedelta(minutes=30)).isoformat())
    with connect() as db:
        db.execute("INSERT INTO integration_plans VALUES(?,?,?)", (plan_id, org(), json.dumps(plan)))
    return plan


@router.post("/source-assistant/connect")
def accept(body: AcceptPlan):
    with connect() as db:
        row = db.execute("SELECT payload FROM integration_plans WHERE id=? AND org_id=?", (body.plan_id, org())).fetchone()
    if not row:
        raise HTTPException(404, "Preparación no encontrada")
    plan = json.loads(row[0])
    if plan["expires_at"] < now():
        raise HTTPException(409, "La preparación ha caducado. Pulsa Preparar de nuevo.")
    connection_id = "apify-" + plan["id"]
    from .sources import connections, public_connection
    existing = next((c for c in connections(org()) if c["id"] == connection_id), None)
    if existing:
        return public_connection(existing, org())
    if len(connections(org())) >= 40:
        raise HTTPException(422, "Máximo de 40 conexiones")
    return _save_connection(connection_id, ConnectionInput(**plan["connection"]), new=True)
