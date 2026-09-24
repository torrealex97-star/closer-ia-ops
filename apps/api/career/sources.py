"""Source catalog and org-scoped, opt-in Apify connections. No paid runs in search."""
import hashlib
import ipaddress
import json
import math
import os
import re
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, SecretStr, field_validator

from .connectors import Candidate, ProviderError, REGISTRY, watchlist_connectors, GoogleCompaniesSerpApi
from .db import ROOT, connect, org, uid, now
from .pipeline import normalize_mapped
from .source_strategy import source_presets

APIFY_BASE = "https://api.apify.com/v2/"

router = APIRouter(prefix="/v1")
# These are discovery routes, not assertions that every site is scrapeable anonymously.
CATALOG = [
    ("jooble", "Jooble", "España", "https://es.jooble.org", "https://apify.com/store?search=jooble", "Búsqueda española aportada por WDC. Validar descripción, duplicados y scraper."),
    ("simplyhired", "SimplyHired", "España", "https://www.simplyhired.es", "https://apify.com/store?search=simplyhired", "Búsqueda de closer y ventas aportada por WDC. Validar cobertura del proveedor."),
    ("infojobs", "InfoJobs", "España", "https://www.infojobs.net", "https://apify.com/haketa/infojobs-scraper", "Portal español. Seleccionar teletrabajo o híbrido en el proveedor."),
    ("computrabajo", "Computrabajo", "LATAM", "https://www.computrabajo.com", "https://apify.com/haketa/computrabajo-scraper", "Portales por país. Activar descripción completa y modalidad."),
    ("workana", "Workana", "LATAM", "https://www.workana.com", "https://apify.com/automation-lab/workana-freelance-projects-scraper", "Proyectos freelance; revisar si presupuesto es por proyecto u hora."),
    ("getonbrd", "Get on Board", "LATAM", "https://www.getonbrd.com", "https://apify.com/scrapers_lat/getonbrd-scraper", "Empleo digital LATAM. Comprobar cobertura comercial del scraper."),
    ("linkedin", "LinkedIn Jobs", "España · LATAM · Europa", "https://www.linkedin.com/jobs", "https://apify.com/curious_coder/linkedin-jobs-scraper", "Ofertas públicas; búsquedas por términos, región y modalidad."),
    ("indeed", "Indeed", "España · LATAM · Europa", "https://www.indeed.com", "https://apify.com/store?search=indeed%20jobs", "Elegir dominio regional y proveedor con descripción completa."),
    ("infoempleo", "Infoempleo", "España", "https://www.infoempleo.com", "", "Páginas públicas: necesita validar extracción y paginación."),
    ("trabajos", "Trabajos.com", "España", "https://www.trabajos.com", "", "Portal generalista: configurar búsquedas de comercial remoto."),
    ("torre", "Torre", "LATAM", "https://torre.ai", "", "Empleo y talento: validar páginas y campos de cada búsqueda."),
    ("weremoto", "WeRemoto", "LATAM", "https://www.weremoto.com", "", "Bolsa remota hispana; extracción de páginas públicas por validar."),
    ("remotoco", "Remoto.co", "LATAM", "https://www.remoto.co", "", "Trabajo remoto LATAM; configurar enlaces concretos y validar vigencia."),
    ("laborum", "Laborum / Bumeran", "LATAM", "https://www.bumeran.com", "", "Portales regionales; se requiere proveedor compatible con el país."),
    ("elempleo", "El Empleo", "LATAM", "https://www.elempleo.com", "", "Ventas regionales; exigir evidencia de remoto o híbrido."),
    ("upwork", "Upwork", "Freelance", "https://www.upwork.com", "https://apify.com/store?search=upwork", "Proyectos de closer y setter; filtrar Spanish y requisitos del cliente."),
    ("freelancer", "Freelancer", "Freelance", "https://www.freelancer.es", "https://developers.freelancer.com", "API oficial disponible; importar su salida mediante dataset o adaptar proveedor."),
    ("malt", "Malt", "Freelance", "https://www.malt.es", "", "Muchas misiones requieren cuenta; solo contenido accesible autorizado."),
    ("eures", "EURES", "Europa", "https://eures.europa.eu", "", "Movilidad europea; español y trabajo a distancia deben constar en la oferta."),
    ("europe-language", "Europe Language Jobs", "Europa", "https://www.europelanguagejobs.com", "", "Búsquedas Spanish. Comprobar modalidad y residencia exigida."),
    ("jobsqd", "Jobsqd", "Europa", "https://www.jobsqd.com", "", "Empleo por idioma; abundan puestos presenciales, filtrar modalidad."),
    ("facebook", "Facebook · grupos y páginas", "Comunidades", "https://www.facebook.com", "https://apify.com/store?search=facebook%20posts", "Añadir URLs concretas. Grupos privados requieren acceso autorizado y proveedor compatible."),
    ("linkedin-posts", "LinkedIn · publicaciones", "Comunidades", "https://www.linkedin.com", "https://apify.com/store?search=linkedin%20posts", "Mapear texto y enlace del post; admitir solo contratación explícita."),
    ("skool", "Skool", "Comunidades", "https://www.skool.com", "https://apify.com/store?search=skool", "Comunidades concretas; el acceso de miembro no se presupone público."),
    ("telegram", "Telegram · canales públicos", "Comunidades", "https://telegram.org", "https://apify.com/store?search=telegram", "Canales públicos de empleo; mapear texto, fecha y permalink."),
    ("reddit", "Reddit", "Comunidades", "https://www.reddit.com", "https://apify.com/store?search=reddit", "Comunidades de trabajo remoto; evitar autopromoción y candidatos buscando empleo."),
    ("company", "Empresas · páginas de empleo / ATS", "Empresas", "https://apify.com/store", "https://apify.com/store?search=jobs%20ats", "Añadir webs de empresas, agencias, academias y sus bolsas ATS."),
    ("custom", "Otra web o comunidad", "Personalizada", "https://apify.com/store", "https://apify.com/store", "Cualquier proveedor que entregue registros estructurados. Viabilidad y acceso se validan por sitio."),
    ("jobgether", "Jobgether", "Internacional", "https://jobgether.com", "", "Remoto con filtro por país; HTML tras Cloudflare. Proveedor por validar."),
    ("tecnoempleo", "Tecnoempleo", "España", "https://www.tecnoempleo.com", "", "IT España; útil para SDR y AE de SaaS. Sin RSS localizado; HTML por validar."),
    ("talent", "Talent.com", "España · LATAM", "https://www.talent.com", "", "Agregador con penetración ES/LATAM; feed partner sin verificar."),
    ("milanuncios", "Milanuncios Empleo", "España", "https://www.milanuncios.com/empleo/", "", "Volumen de comercial autónomo; HTML con anti-bot por validar."),
    ("primer-empleo", "Primer Empleo", "España", "https://www.primerempleo.com", "", "Perfiles junior; HTML por validar."),
    ("jobfluent", "Jobfluent", "España", "https://www.jobfluent.com", "", "Startups, sobre todo Barcelona; HTML por validar."),
    ("welcomejungle", "Welcome to the Jungle ES", "España", "https://www.welcometothejungle.com/es", "", "Backend Algolia; requiere adaptador específico de su API interna."),
    ("closers-avenue", "ClosersAvenue", "España", "https://closersavenue.com", "", "Nicho closer comisión-pura España. Su bolsa interna devuelve 500 (2026-09-23): sin listado público extraíble; requiere Actor opt-in o acceso autorizado."),
    ("google", "Google dorks · SerpApi", "España · Europa", "https://www.google.com/search?q=site%3Alinkedin.com%2Fjobs%2Fview+%22closer+de+ventas%22", "https://serpapi.com/google-jobs-api", "Motor google_jobs de SerpApi (pendiente de conectar): cada dork del vocabulario WDC busca ofertas ya indexadas de LinkedIn/portales con los filtros exactos (site:, comillas, España). Requiere API key de SerpApi; el coste por búsqueda se controla con el presupuesto diario de ADR-009."),
    ("remotolist", "RemotoList", "España · LATAM", "https://remotolist.com", "", "Comunidad remota hispana con categoría de ventas; sin feed público localizado."),
    ("domestika", "Domestika Empleo", "España", "https://www.domestika.org", "", "Marginal para ventas; HTML por validar."),
]
CATALOG_BY_CODE = {r[0]: r for r in CATALOG}
DEFAULT_MAPPING = {"title": "title", "company": "companyName", "description": "description", "source_url": "url", "locations": "location", "published_at": "postedAt", "work_mode": "workMode"}


class ConnectionInput(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    source: str = Field(default="custom", max_length=60)
    actor_id: str = Field(default="", max_length=120, pattern=r"^[a-zA-Z0-9_~/-]*$")
    dataset_id: str = Field(default="", max_length=80, pattern=r"^[a-zA-Z0-9_-]*$")
    token: SecretStr | None = None
    clear_token: bool = False
    enabled: bool = True
    urls: list[str] = Field(default_factory=list, max_length=30)
    url_field: str = Field(default="startUrls", pattern=r"^[a-zA-Z][a-zA-Z0-9_]*$", max_length=80)
    url_format: str = Field(default="objects", pattern=r"^(objects|strings|single)$")
    actor_input: dict = Field(default_factory=dict)
    mapping: dict[str, str] = Field(default_factory=lambda: dict(DEFAULT_MAPPING))
    build: str = Field(default="latest", pattern=r"^[a-zA-Z0-9_.-]{1,80}$")
    auto_mapping: bool = False
    max_items: int = Field(default=100, ge=1, le=500)
    max_charge_usd: float = Field(default=1, ge=0.1, le=10)

    @field_validator("urls")
    @classmethod
    def public_urls(cls, values):
        for value in values:
            parsed = urlsplit(value)
            if len(value) > 2000 or parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
                raise ValueError("Introduce enlaces públicos HTTPS sin credenciales")
            host = parsed.hostname.lower()
            if host == "localhost" or host.endswith((".local", ".internal")) or "." not in host:
                raise ValueError("No se permiten direcciones locales")
            try:
                if not ipaddress.ip_address(host).is_global:
                    raise ValueError("No se permiten direcciones privadas")
            except ValueError as exc:
                if "No se permiten" in str(exc):
                    raise
            if re.search(r"(?:token|key|password|secret|auth)=", parsed.query, re.I):
                raise ValueError("No guardes claves en los enlaces")
        return values

    @field_validator("actor_input")
    @classmethod
    def safe_input(cls, value):
        text = json.dumps(value)
        if len(text) > 30000 or re.search(r'"[^" ]*(?:token|password|secret|cookie|authorization|api_key)[^" ]*"\s*:', text, re.I):
            raise ValueError("Input demasiado grande o con secretos: usa un Actor sin cookies y el campo de token")
        return value

    @field_validator("mapping")
    @classmethod
    def valid_mapping(cls, value):
        allowed = set(DEFAULT_MAPPING) | {"application_url", "expires_at", "salary_min", "salary_max", "salary_currency", "salary_period"}
        if set(value) - allowed or any(not re.fullmatch(r"[\w.-]{1,150}", v) for v in value.values()):
            raise ValueError("Mapeo de campos inválido")
        if not value.get("source_url") or not (value.get("title") or value.get("description")):
            raise ValueError("Mapea enlace y título o texto de la publicación")
        return value


def secret_path(organization, connection_id):
    base = Path(os.environ.get("CAREER_DB", str(ROOT / ".local/career.sqlite3"))).parent / "credentials"
    base.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(base, 0o700)
    name = hashlib.sha256((organization + ":" + connection_id).encode()).hexdigest()
    return base / name


def read_token(organization, connection_id):
    path = secret_path(organization, connection_id)
    return path.read_text() if path.exists() else ""


def get_connection(connection_id, organization):
    with connect() as db:
        row = db.execute("SELECT payload FROM source_connections WHERE id=? AND org_id=?", (connection_id, organization)).fetchone()
    if not row:
        raise HTTPException(404, "Conexión no encontrada")
    return json.loads(row["payload"])


def put_connection(value, organization):
    with connect() as db:
        db.execute("INSERT OR REPLACE INTO source_connections VALUES(?,?,?)", (value["id"], organization, json.dumps(value)))


def connections(organization):
    with connect() as db:
        rows = db.execute("SELECT payload FROM source_connections WHERE org_id=? ORDER BY rowid", (organization,)).fetchall()
    return [json.loads(r["payload"]) for r in rows]


def public_connection(value, organization):
    return {**value, "has_token": bool(connection_token(organization, value["id"]))}


@router.get("/source-connections")
def list_connections():
    return [public_connection(c, org()) for c in connections(org())]


@router.post("/source-connections")
def create_connection(body: ConnectionInput):
    if len(connections(org())) >= 40:
        raise HTTPException(422, "Máximo de 40 conexiones locales")
    return _save_connection("apify-" + uid(), body, new=True)


@router.patch("/source-connections/{connection_id}")
def save_connection(connection_id: str, body: ConnectionInput):
    return _save_connection(connection_id, body)


def _save_connection(connection_id, body, new=False):
    previous = {} if new else get_connection(connection_id, org())
    if previous.get("run_status") in {"STARTING", "READY", "RUNNING", "TIMING-OUT", "ABORTING", "UNKNOWN"}:
        raise HTTPException(409, "Comprueba la ejecución pendiente antes de modificar esta conexión")
    value = {**previous, **body.model_dump(exclude={"token", "clear_token"}), "id": connection_id}
    if previous.get("dataset_id") != body.dataset_id or previous.get("actor_id") != body.actor_id:
        for key in ["run_id", "run_status", "actual_cost_usd", "last_completed_at", "last_fingerprint"]:
            value.pop(key, None)
    if body.url_format == "single" and len(body.urls) > 1:
        raise HTTPException(422, "Este proveedor admite un solo enlace por conexión")
    if body.source not in CATALOG_BY_CODE:
        raise HTTPException(422, "Fuente no reconocida")
    if body.token and body.token.get_secret_value():
        token = body.token.get_secret_value().strip()
        if len(token) > 1000 or any(c.isspace() for c in token):
            raise HTTPException(422, "Token inválido")
        path = secret_path(org(), connection_id)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "w") as file:
            file.write(token)
        os.chmod(path, 0o600)
    elif body.clear_token:
        secret_path(org(), connection_id).unlink(missing_ok=True)
    put_connection(value, org())
    return public_connection(value, org())


def connection_token(organization, connection_id):
    return read_token(organization, connection_id) or read_token(organization, "account-apify")


async def apify_request(method, path, token, *, payload=None, params=None):
    # Fixed host, no redirects, secrets only in Authorization. No retry of billable POST.
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
            async with client.stream(method, APIFY_BASE + path,
                                     headers={"Authorization": "Bearer " + token}, json=payload, params=params) as response:
                if response.status_code >= 300:
                    raise ProviderError(f"Apify respondió {response.status_code}. Revisa token, ID y permisos en su consola.")
                data = bytearray()
                async for chunk in response.aiter_bytes():
                    data.extend(chunk)
                    if len(data) > 12_000_000:
                        raise ProviderError("Dataset demasiado grande; reduce el límite")
                return json.loads(data)
    except (httpx.HTTPError, ValueError) as exc:
        raise ProviderError("No se pudo confirmar la respuesta de Apify. Comprueba su consola antes de volver a ejecutar.") from exc


@router.post("/source-connections/{connection_id}/scrape")
async def scrape(connection_id: str):
    return await launch_scrape(connection_id, org())


@router.post("/google/run")
async def google_run():
    """Ejecuta los dorks WDC vía SerpApi engine=google_jobs bajo presupuesto."""
    return await launch_serpapi(org())


@router.post("/google/check")
def google_check():
    """Comprueba credencial y conexión; consume la búsqueda de prueba solo vía /integrations/serpapi/check."""
    organization = org()
    value = get_or_create_google_connection(organization)
    if not read_token(organization, "account-serpapi"):
        raise HTTPException(422, "Guarda tu clave de SerpApi en Integraciones antes de comprobar")
    value = get_connection(google_connection_id(organization), organization)
    state = "Sin ejecución" if not value.get("run_status") else value["run_status"]
    return {"connection": public_connection(value, organization),
            "message": f"Clave presente, conexión con {len(value.get('urls') or [])} dorks WDC. Estado: {state}."}


@router.post("/google/companies/run")
async def google_companies_run():
    """Vigilancia de empresas objetivo (canal LinkedIn): una búsqueda google_jobs por empresa,
    bajo el presupuesto SerpApi reservado; las que no caben quedan pendientes."""
    return await launch_serpapi_companies(org())


SERPAPI_COST_PER_SEARCH_USD = 0.025  # Starter plan: 25 USD / 1.000 búsquedas.


def google_connection_id(organization):
    """Single shared connection id for the google source (one per org)."""
    return "google-serpapi"


def google_dorks():
    """Dorks WDC de la fuente google, leídos de los presets sin tocar la BD."""
    return [row["dork"] for row in source_presets()["searches"]
            if row["source"] == "google" and row.get("dork")]


def company_watch_targets(organization):
    """Empresas objetivo que solo publican en LinkedIn (monitoring=linkedin_guest):
    una búsqueda google_jobs por empresa, en orden estable por prioridad y nombre."""
    with connect() as db:
        rows = db.execute("SELECT name FROM company_target WHERE enabled=1 AND monitoring='linkedin_guest' "
                          "ORDER BY priority ASC, name ASC").fetchall()
    return [(r["name"], r["name"]) for r in rows]


def google_company_dorks(companies):
    """[(search_name, display_name, dork)] con el patrón del usuario: "empresa" closer España.
    Las variantes de rol (setter/asesor comercial) vienen del vocabulario canónico; la frase
    exacta "<empresa>" ancla la búsqueda a la empresa objetivo."""
    from .vocabulary import ALIASES
    roles = [t for t in ALIASES['digital_sales'] if t in {'closer', 'setter', 'asesor comercial', 'sales advisor'}]
    pattern = '"{company}" ({roles}) España'
    return [(search, display, pattern.format(company=search, roles=' OR '.join(f'"{r}"' for r in roles)))
            for search, display in companies]


def get_or_create_google_connection(organization):
    """Idempotent connection for the google source: urls = WDC dorks.
    No actor, no dataset: its scrape endpoint runs SerpApi directly.
    Solo se crea al ejecutar o comprobar, nunca al registrar la fuente."""
    presets = [{"dork": d} for d in google_dorks()]
    if not presets:
        raise HTTPException(422, "No hay dorks WDC preparados para la fuente google")
    with connect() as db:
        row = db.execute("SELECT payload FROM source_connections WHERE id=? AND org_id=?",
                         (google_connection_id(organization), organization)).fetchone()
        if row:
            value = json.loads(row["payload"])
            # Presets changed: refresh dorks but keep run state and fingerprint.
            if value.get("urls") != [p["dork"] for p in presets]:
                value["urls"] = [p["dork"] for p in presets]
                value["max_items"] = len(presets) * 50
                put_connection(value, organization)
            return value
    value = {"id": google_connection_id(organization), "name": "Google Jobs · SerpApi (dorks WDC)",
             "source": "google", "actor_id": "", "dataset_id": "", "enabled": True,
             "urls": [p["dork"] for p in presets], "url_field": "q", "url_format": "strings",
             "actor_input": {}, "mapping": {}, "build": "latest", "auto_mapping": False,
             "max_items": len(presets) * 50, "max_charge_usd": round(len(presets) * SERPAPI_COST_PER_SEARCH_USD * 1.3, 2)}
    put_connection(value, organization)
    return value


async def launch_serpapi(organization, connection_id=None):
    """Run the WDC dorks through SerpApi engine=google_jobs under the daily budget.
    Reservation before I/O, same rules as Apify: one launch per day per source."""
    from .collection import euro_rate, reserve, record_launch
    from .connectors import read_serpapi_token
    connection_id = connection_id or google_connection_id(organization)
    value = get_or_create_google_connection(organization)
    if not value["enabled"]:
        raise HTTPException(409, "Conexión desactivada")
    if not read_serpapi_token():
        raise HTTPException(422, "Guarda tu clave de SerpApi en Integraciones antes de ejecutar los dorks")
    if value.get("run_status") in {"STARTING", "READY", "RUNNING", "TIMING-OUT", "ABORTING", "UNKNOWN"}:
        raise HTTPException(409, "Ya hay una ejecución pendiente. Comprueba su estado.")
    rate = await euro_rate()
    # Price model is known and fixed: one search per dork. No metadata call needed.
    minimum = value["max_charge_usd"]
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT payload FROM source_connections WHERE id=? AND org_id=?",
                         (connection_id, organization)).fetchone()
        if not row:
            raise HTTPException(404, "Conexión no encontrada")
        value = json.loads(row["payload"])
        if value.get("run_status") in {"STARTING", "READY", "RUNNING", "TIMING-OUT", "ABORTING", "UNKNOWN"}:
            raise HTTPException(409, "Ya hay una ejecución pendiente. Comprueba su estado.")
        reservation, cap = reserve(db, organization, connection_id, value["max_charge_usd"], rate, minimum)
        value.update(run_status="RUNNING", run_id=None, budget_reservation=reservation, dataset_id="serpapi-local")
        db.execute("UPDATE source_connections SET payload=? WHERE id=? AND org_id=?",
                   (json.dumps(value), connection_id, organization))
    from .catalog import collection_query
    query = collection_query().model_copy(update={"sources": ["google"]})
    run_id = uid()
    sources = [{"code": "google", "name": value["name"], "status": "queued", "fetched": 0, "accepted": 0, "cost": 0}]
    with connect() as db:
        db.execute("INSERT INTO search_runs VALUES(?,?,?,?,?,?,?,NULL)",
                   (run_id, organization, "serpapi-" + reservation, query.model_dump_json(), "queued", json.dumps(sources), now()))
    value["run_id"] = run_id
    record_launch(reservation, organization, run_id, "RUNNING")
    put_connection(value, organization)
    return {**public_connection(value, organization), "run_id": run_id,
            "message": f"Importación SerpApi encolada: {len(value['urls'])} dorks, tope {cap:.2f} USD. El presupuesto diario la limita; las búsquedas cacheadas de SerpApi no consumen crédito."}


def google_companies_connection_id(organization):
    """Conexión compartida de vigilancia de empresas objetivo (una por org)."""
    return "google-companies-serpapi"


def get_or_create_google_companies_connection(organization):
    """Conexión idempotente para google-companies: companies = linkedin_guest actuales.
    Igual que google: sin actor ni dataset; la ejecución llama a SerpApi directamente."""
    companies = company_watch_targets(organization)
    if not companies:
        raise HTTPException(422, "No hay empresas objetivo con canal LinkedIn para vigilar")
    with connect() as db:
        row = db.execute("SELECT payload FROM source_connections WHERE id=? AND org_id=?",
                         (google_companies_connection_id(organization), organization)).fetchone()
        if row:
            value = json.loads(row["payload"])
            if value.get("companies") != [name for name, _ in companies]:
                value["companies"] = [name for name, _ in companies]
                value["max_items"] = len(companies) * 50
                value["max_charge_usd"] = round(len(companies) * SERPAPI_COST_PER_SEARCH_USD * 1.3, 2)
                put_connection(value, organization)
            return value
    value = {"id": google_companies_connection_id(organization),
             "name": "Empresas objetivo · SerpApi (LinkedIn)", "source": "google-companies",
             "actor_id": "", "dataset_id": "", "enabled": True,
             "companies": [name for name, _ in companies], "urls": [], "url_field": "q",
             "url_format": "strings", "actor_input": {}, "mapping": {}, "build": "latest",
             "auto_mapping": False, "max_items": len(companies) * 50,
             "max_charge_usd": round(len(companies) * SERPAPI_COST_PER_SEARCH_USD * 1.3, 2)}
    put_connection(value, organization)
    return value


def google_companies_connector(organization):
    """Conector de vigilancia de empresas objetivo limitado por el cap presupuestado de la
    conexión. None si no hay conexión creada, está desactivada o no hay empresas. No crea
    filas: registrar la fuente no debe tener efectos secundarios."""
    with connect() as db:
        row = db.execute("SELECT payload FROM source_connections WHERE id=? AND org_id=?",
                         (google_companies_connection_id(organization), organization)).fetchone()
    if not row:
        return None
    value = json.loads(row["payload"])
    if not value.get("enabled") or not value.get("companies"):
        return None
    cap = value.get("last_budget_cap_usd") or value.get("max_charge_usd")
    total = len(value["companies"])
    # int() trunca por coma flotante (0.075/0.025 → 2); se corrige con margen mínimo.
    affordable = max(1, math.floor(float(cap) / SERPAPI_COST_PER_SEARCH_USD + 1e-9)) if cap else total
    return GoogleCompaniesSerpApi([(n, n) for n in value["companies"]][:max(1, min(total, affordable))])


async def launch_serpapi_companies(organization, connection_id=None):
    """Vigilancia de empresas objetivo: una búsqueda por empresa bajo presupuesto.
    Reserva antes de I/O; si el cap no cubre todas, se consultan las primeras N
    (por prioridad) y el resto queda explícito como pendiente. Nunca se lanza
    sin presupuesto para al menos una búsqueda."""
    from .collection import euro_rate, reserve, record_launch
    from .connectors import read_serpapi_token
    connection_id = connection_id or google_companies_connection_id(organization)
    value = get_or_create_google_companies_connection(organization)
    if not value["enabled"]:
        raise HTTPException(409, "Conexión desactivada")
    if not read_serpapi_token():
        raise HTTPException(422, "Guarda tu clave de SerpApi en Integraciones antes de vigilar empresas")
    if value.get("run_status") in {"STARTING", "READY", "RUNNING", "TIMING-OUT", "ABORTING", "UNKNOWN"}:
        raise HTTPException(409, "Ya hay una ejecución pendiente. Comprueba su estado.")
    rate = await euro_rate()
    total = len(value["companies"])
    maximum = round(total * SERPAPI_COST_PER_SEARCH_USD, 4)
    minimum = SERPAPI_COST_PER_SEARCH_USD
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT payload FROM source_connections WHERE id=? AND org_id=?",
                         (connection_id, organization)).fetchone()
        if not row:
            raise HTTPException(404, "Conexión no encontrada")
        value = json.loads(row["payload"])
        if value.get("run_status") in {"STARTING", "READY", "RUNNING", "TIMING-OUT", "ABORTING", "UNKNOWN"}:
            raise HTTPException(409, "Ya hay una ejecución pendiente. Comprueba su estado.")
        reservation, cap = reserve(db, organization, connection_id, maximum, rate, minimum)
        # int() trunca: 3*0.025=0.075 da 2.9999… por coma flotante y perdería una empresa pagada.
        affordable = max(1, math.floor(cap / SERPAPI_COST_PER_SEARCH_USD + 1e-9))
        value.update(run_status="RUNNING", run_id=None, budget_reservation=reservation, dataset_id="serpapi-local",
                     last_budget_cap_usd=cap)
        db.execute("UPDATE source_connections SET payload=? WHERE id=? AND org_id=?",
                   (json.dumps(value), connection_id, organization))
    from .catalog import collection_query
    query = collection_query().model_copy(update={"sources": ["google-companies"]})
    run_id = uid()
    sources = [{"code": "google-companies", "name": value["name"], "status": "queued", "fetched": 0, "accepted": 0, "cost": 0}]
    with connect() as db:
        db.execute("INSERT INTO search_runs VALUES(?,?,?,?,?,?,?,NULL)",
                   (run_id, organization, "serpapi-co-" + reservation, query.model_dump_json(), "queued", json.dumps(sources), now()))
    value["run_id"] = run_id
    record_launch(reservation, organization, run_id, "RUNNING")
    put_connection(value, organization)
    skipped = total - min(total, affordable)
    note = f" Vigilancia de {min(total, affordable)} de {total} empresas" if skipped > 0 else f" Vigilancia de {total} empresas"
    return {**public_connection(value, organization), "run_id": run_id,
            "message": f"Búsquedas encoladas.{note} ({skipped} pendientes por presupuesto)." if skipped > 0 else
                       f"Búsquedas encoladas.{note}, tope {cap:.2f} USD.",
            "pending_companies": skipped}


async def launch_scrape(connection_id, organization, allocation_cents=None):
    from .collection import budget_quote, reserve, record_launch
    initial = get_connection(connection_id, organization)
    if initial.get('run_status') in {'STARTING', 'READY', 'RUNNING', 'TIMING-OUT', 'ABORTING', 'UNKNOWN'}:
        raise HTTPException(409, 'Ya hay una ejecución pendiente. Comprueba su estado.')
    token = connection_token(organization, connection_id)
    if not token or not initial['actor_id'] or not initial['enabled']:
        raise HTTPException(422, 'Guarda un Actor, token y conexión activa antes de ejecutar')
    rate, minimum = await budget_quote(initial, token)
    # Reserve before network I/O to prevent duplicate launches from double clicks.
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT payload FROM source_connections WHERE id=? AND org_id=?", (connection_id, organization)).fetchone()
        if not row:
            raise HTTPException(404, "Conexión no encontrada")
        value = json.loads(row["payload"])
        if value != initial:
            raise HTTPException(409, 'La conexión cambió. Vuelve a comprobarla.')
        if value.get("run_status") in {"STARTING", "READY", "RUNNING", "TIMING-OUT", "ABORTING", "UNKNOWN"}:
            raise HTTPException(409, "Ya hay una ejecución pendiente. Comprueba su estado.")
        token = connection_token(organization, connection_id)
        if not token or not value["actor_id"] or not value["enabled"]:
            raise HTTPException(422, "Guarda un Actor, token y conexión activa antes de ejecutar")
        fingerprint = hashlib.sha256(json.dumps({k: value.get(k) for k in ["actor_id", "actor_input", "urls", "url_field", "url_format", "max_items", "build"]}, sort_keys=True).encode()).hexdigest()
        if value.get("last_fingerprint") == fingerprint and value.get("last_completed_at"):
            from datetime import datetime, timezone
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(value["last_completed_at"])).total_seconds()
            if age < 21600 and value.get("dataset_id"):
                return {**public_connection(value, organization), "message": "Reutilizamos la extracción de las últimas 6 horas. No se ha lanzado ni cobrado otro scraper."}
        reservation, cap = reserve(db, organization, connection_id, value['max_charge_usd'], rate, minimum, allocation_cents)
        value.update(run_status="STARTING", run_id=None, last_fingerprint=fingerprint, last_completed_at=None,
                     budget_reservation=reservation)
        db.execute("UPDATE source_connections SET payload=? WHERE id=? AND org_id=?", (json.dumps(value), connection_id, organization))
    payload = dict(value["actor_input"])
    urls = value["urls"]
    if urls:
        payload[value["url_field"]] = ([{"url": u} for u in urls] if value["url_format"] == "objects" else urls if value["url_format"] == "strings" else urls[0])
    try:
        data = await apify_request("POST", f'acts/{value["actor_id"].replace("/", "~")}/runs', token,
                                   payload=payload, params={"build": value.get("build", "latest"), "timeout": 90, "maxItems": value["max_items"], "maxTotalChargeUsd": cap})
        run = data["data"]
        value.update(run_id=run["id"], run_status=run["status"])
        record_launch(reservation, organization, run['id'], run['status'])
    except Exception:
        value["run_status"] = "UNKNOWN"
        record_launch(reservation, organization, None, 'UNKNOWN')
        put_connection(value, organization)
        raise HTTPException(502, "No se ha confirmado el lanzamiento. Revisa Apify; no se reintentará para evitar cobros duplicados.") from None
    put_connection(value, organization)
    return public_connection(value, organization)


@router.post("/source-connections/{connection_id}/check")
async def check(connection_id: str):
    return await check_connection(connection_id, org())


async def check_connection(connection_id, organization):
    value = get_connection(connection_id, organization)
    token = connection_token(organization, connection_id)
    original = json.dumps(value)
    def update_checked():
        nonlocal original
        with connect() as db:
            result = db.execute("UPDATE source_connections SET payload=? WHERE id=? AND org_id=? AND payload=?", (json.dumps(value), connection_id, organization, original))
            if not result.rowcount:
                raise HTTPException(409, "La conexión cambió durante la comprobación. Vuelve a comprobar.")
        original = json.dumps(value)
    try:
        if value.get("run_id"):
            run = (await apify_request("GET", f'actor-runs/{value["run_id"]}', token))["data"]
            from .collection import record_cost
            record_cost(organization, run)
            value["run_status"] = run["status"]
            value["actual_cost_usd"] = run.get("usageTotalUsd")
            if run["status"] == "SUCCEEDED":
                value["dataset_id"] = run["defaultDatasetId"]
                value["last_completed_at"] = value.get("last_completed_at") or now()
            update_checked()
            if run["status"] != "SUCCEEDED":
                return {"connection": public_connection(value, organization), "message": "Estado de Apify: " + run["status"]}
        if not value["dataset_id"]:
            raise ProviderError("Indica un dataset o ejecuta el Actor. Si el lanzamiento quedó incierto, compruébalo en Apify.")
        rows = await apify_request("GET", f'datasets/{value["dataset_id"]}/items', token, params={"limit": 5, "clean": "true"})
        if not isinstance(rows, list):
            raise ProviderError("Apify no devolvió una lista de publicaciones. Revisa el dataset.")
        if value.get("auto_mapping") and rows:
            from .integrations import infer_mapping
            value["mapping"] = infer_mapping([r for r in rows if isinstance(r, dict)])
        valid = sum(bool(normalize_mapped(r, value["mapping"])["source_url"]) for r in rows if isinstance(r, dict))
        if rows and not valid:
            raise ProviderError("Hay registros, pero el mapeo de enlace no coincide. Corrige source_url.")
        update_checked()
        return {"connection": public_connection(value, organization), "message": f"Dataset accesible: {len(rows)} registros de muestra, {valid} con enlace válido. Los filtros de búsqueda se aplican al importar."}
    except ProviderError as exc:
        raise HTTPException(422, str(exc)) from None
    except (KeyError, TypeError, ValueError):
        raise HTTPException(422, "Apify devolvió un formato inesperado. Revisa el estado en su consola.") from None


class ApifyDataset:
    provider = "apify_dataset_v1"

    def __init__(self, value, organization):
        self.value, self.organization = value, organization
        self.code, self.name = value["id"], value["name"]

    def normalize(self, row):
        item = normalize_mapped(row, self.value["mapping"])
        # Social posts have text, not a fabricated job title. Match explicit hiring in body.
        if not item["title"] and item["description"]:
            item["title"] = "Publicación de comunidad"
        return item

    async def batches(self, query):
        if not self.value["enabled"] or not self.value["dataset_id"]:
            raise ProviderError("Conexión sin dataset disponible")
        token = connection_token(self.organization, self.code)
        for offset in range(0, self.value["max_items"], 50):
            rows = await apify_request("GET", f'datasets/{self.value["dataset_id"]}/items', token,
                                        params={"offset": offset, "limit": min(50, self.value["max_items"] - offset), "clean": "true"})
            if not isinstance(rows, list):
                raise ProviderError("El dataset no contiene una lista de registros")
            batch = []
            for row in rows[:min(50, self.value["max_items"] - offset)]:
                if not isinstance(row, dict):
                    continue
                normalized = self.normalize(row)
                if normalized["source_url"]:
                    batch.append(Candidate(normalized["source_url"], row))
            yield batch
            if len(rows) < 50:
                break


def registry(organization):
    base = {**REGISTRY, **watchlist_connectors(organization),
            **{v["id"]: ApifyDataset(v, organization) for v in connections(organization) if v["enabled"] and v["dataset_id"]}}
    # SerpApi entra solo con clave guardada: nunca lanza búsquedas de pago sin credencial.
    # Sin conexión persistente aquí: registrar la fuente no debe crear filas como efecto lateral.
    if read_token(organization, "account-serpapi"):
        dorks = google_dorks()
        if dorks:
            base["google"] = _MultiDorkConnector(dorks)
        companies_connector = google_companies_connector(organization)
        if companies_connector:
            base["google-companies"] = companies_connector
    return base


class _MultiDorkConnector:
    """Ejecuta los dorks WDC en secuencia: un dork = una búsqueda de pago."""
    code = "google"
    name = "Google Jobs · SerpApi"
    provider = "serpapi_google_jobs_v1"

    def __init__(self, dorks):
        self.dorks = dorks

    async def batches(self, query):
        from .connectors import google_serpapi_connector
        for dork in self.dorks:
            connector = google_serpapi_connector(dork)
            async for batch in connector.batches(query):
                yield batch


def source_infos(organization):
    with connect() as db:
        saved_sources = {r[0] for r in db.execute('SELECT DISTINCT p.source FROM catalog_entries c JOIN jobs j ON j.org_id=c.org_id AND j.id=c.job_id JOIN job_postings p ON p.org_id=j.org_id AND p.id=j.posting_id WHERE c.org_id=? AND c.expires_at>?', (organization, now()))}
    public = [{"code": c.code, "name": c.name, "available": True,
               "category": ("España" if c.code.startswith("jobtoday") else "LATAM" if c.code == "getonbrd-public" else "Internacional"),
               "note": "API/feed público. Cobertura española variable; atribución y enlace original conservados.",
               "website": c.url if hasattr(c, "url") else "https://himalayas.app" if c.code == "himalayas" else "https://weworkremotely.com"} for c in REGISTRY.values()]
    public += [{"code": c.code, "name": c.name, "available": True, "category": "Empresas",
                "note": "Tablero ATS público de la empresa, según la watchlist. La oferta se publica primero aquí; el enlace y la atribución son de la empresa.",
                "website": c.url} for c in watchlist_connectors(organization).values()]
    public += [{"code": c[0], "name": c[1], "category": c[2], "website": c[3], "setup_url": c[4] or "https://apify.com/store?search=web%20scraper", "note": c[5], "available": False} for c in CATALOG]
    public += [{"code": v["id"], "name": v["name"], "category": "Mis conexiones", "available": (v["enabled"] and bool(v["dataset_id"] or v["actor_id"])) or v["id"] in saved_sources, "note": "Catálogo local · consulta sin lanzar un nuevo scraper"} for v in connections(organization)]
    from .source_strategy import strategy, discovery_url, suggested_searches
    for entry in public:
        if entry["category"] != "Mis conexiones":
            entry.update(strategy(entry["code"]))
            entry["suggested_searches"] = suggested_searches(entry["code"], organization)
            if not entry.get("setup_url") or entry["setup_url"] == "https://apify.com/store?search=web%20scraper":
                entry["setup_url"] = discovery_url(entry["name"])
            # Requisito de puesta en marcha: la web agrupa por esto, sin heurísticas locales.
            if entry["available"]:
                entry["requires"] = "none"          # API/feed público ya operativo
            elif entry.get("provider_candidates"):
                entry["requires"] = "apify"          # conectar con Actor de Apify (puede costar)
            else:
                entry["requires"] = "input"          # falta proveedor verificado: validar y dar inputs
    return public


class ResolveRequest(BaseModel):
    reviewed_apify_console: bool


@router.post("/source-connections/{connection_id}/resolve")
def resolve(connection_id: str, body: ResolveRequest):
    value = get_connection(connection_id, org())
    if not body.reviewed_apify_console or value.get("run_status") not in {"UNKNOWN", "STARTING"}:
        raise HTTPException(409, "Solo se desbloquean lanzamientos inciertos tras revisar la consola")
    value["run_status"] = "REVIEWED"
    with connect() as db:
        db.execute("UPDATE scrape_budget SET status='REVIEWED' WHERE org_id=? AND id=? AND status IN ('reserved','UNKNOWN')", (org(), value.get('budget_reservation', '')))
    put_connection(value, org())
    return public_connection(value, org())
