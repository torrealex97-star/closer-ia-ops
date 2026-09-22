"""Source catalog and org-scoped, opt-in Apify connections. No paid runs in search."""
import hashlib
import ipaddress
import json
import os
import re
from pathlib import Path
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, SecretStr, field_validator

from .connectors import Candidate, ProviderError, REGISTRY
from .db import ROOT, connect, org, uid
from .pipeline import normalize_mapped

router = APIRouter(prefix="/v1")
# These are discovery routes, not assertions that every site is scrapeable anonymously.
CATALOG = [
    ("infojobs", "InfoJobs", "España", "https://www.infojobs.net", "https://apify.com/haketa/infojobs-scraper", "Portal español. Seleccionar teletrabajo o híbrido en el proveedor."),
    ("computrabajo", "Computrabajo", "LATAM", "https://www.computrabajo.com", "https://apify.com/haketa/computrabajo-scraper", "Portales por país. Activar descripción completa y modalidad."),
    ("workana", "Workana", "LATAM", "https://www.workana.com", "https://apify.com/automation-lab/workana-freelance-projects-scraper", "Proyectos freelance; revisar si presupuesto es por proyecto u hora."),
    ("getonbrd", "Get on Board", "LATAM", "https://www.getonbrd.com", "https://apify.com/scrapers_lat/getonbrd-scraper", "Empleo digital LATAM. Comprobar cobertura comercial del scraper."),
    ("linkedin", "LinkedIn Jobs", "España · LATAM · Europa", "https://www.linkedin.com/jobs", "https://apify.com/curious_coder/linkedin-jobs-scraper", "Ofertas públicas; búsquedas por términos, región y modalidad."),
    ("indeed", "Indeed", "España · LATAM · Europa", "https://www.indeed.com", "https://apify.com/store?search=indeed%20jobs", "Elegir dominio regional y proveedor con descripción completa."),
    ("infoempleo", "Infoempleo", "España", "https://www.infoempleo.com", "", "Páginas públicas: necesita validar extracción y paginación."),
    ("jobtoday", "JOB TODAY", "España", "https://jobtoday.com/es", "", "Comercial y ventas: descartar puestos exclusivamente presenciales."),
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
    return {**value, "has_token": bool(read_token(organization, value["id"]))}


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


async def apify_request(method, path, token, *, payload=None, params=None):
    # Fixed host, no redirects, secrets only in Authorization. No retry of billable POST.
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
            async with client.stream(method, "https://api.apify.com/v2/" + path,
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
    organization = org()
    # Reserve before network I/O to prevent duplicate launches from double clicks.
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT payload FROM source_connections WHERE id=? AND org_id=?", (connection_id, organization)).fetchone()
        if not row:
            raise HTTPException(404, "Conexión no encontrada")
        value = json.loads(row["payload"])
        if value.get("run_status") in {"STARTING", "READY", "RUNNING", "TIMING-OUT", "ABORTING", "UNKNOWN"}:
            raise HTTPException(409, "Ya hay una ejecución pendiente. Comprueba su estado.")
        token = read_token(organization, connection_id)
        if not token or not value["actor_id"] or not value["enabled"]:
            raise HTTPException(422, "Guarda un Actor, token y conexión activa antes de ejecutar")
        value.update(run_status="STARTING", run_id=None)
        db.execute("UPDATE source_connections SET payload=? WHERE id=? AND org_id=?", (json.dumps(value), connection_id, organization))
    payload = dict(value["actor_input"])
    urls = value["urls"]
    if urls:
        payload[value["url_field"]] = ([{"url": u} for u in urls] if value["url_format"] == "objects" else urls if value["url_format"] == "strings" else urls[0])
    try:
        data = await apify_request("POST", f'acts/{value["actor_id"].replace("/", "~")}/runs', token,
                                   payload=payload, params={"timeout": 90, "maxItems": value["max_items"], "maxTotalChargeUsd": value["max_charge_usd"]})
        run = data["data"]
        value.update(run_id=run["id"], run_status=run["status"])
    except Exception:
        value["run_status"] = "UNKNOWN"
        put_connection(value, organization)
        raise HTTPException(502, "No se ha confirmado el lanzamiento. Revisa Apify; no se reintentará para evitar cobros duplicados.") from None
    put_connection(value, organization)
    return public_connection(value, organization)


@router.post("/source-connections/{connection_id}/check")
async def check(connection_id: str):
    value = get_connection(connection_id, org())
    token = read_token(org(), connection_id)
    try:
        if value.get("run_id"):
            run = (await apify_request("GET", f'actor-runs/{value["run_id"]}', token))["data"]
            value["run_status"] = run["status"]
            value["actual_cost_usd"] = run.get("usageTotalUsd")
            if run["status"] == "SUCCEEDED":
                value["dataset_id"] = run["defaultDatasetId"]
            put_connection(value, org())
            if run["status"] != "SUCCEEDED":
                return {"connection": public_connection(value, org()), "message": "Estado de Apify: " + run["status"]}
        if not value["dataset_id"]:
            raise ProviderError("Indica un dataset o ejecuta el Actor. Si el lanzamiento quedó incierto, compruébalo en Apify.")
        rows = await apify_request("GET", f'datasets/{value["dataset_id"]}/items', token, params={"limit": 5, "clean": "true"})
        valid = sum(bool(normalize_mapped(r, value["mapping"])["source_url"]) for r in rows if isinstance(r, dict))
        if rows and not valid:
            raise ProviderError("Hay registros, pero el mapeo de enlace no coincide. Corrige source_url.")
        return {"connection": public_connection(value, org()), "message": f"Dataset accesible: {len(rows)} registros de muestra, {valid} con enlace válido. Los filtros de búsqueda se aplican al importar."}
    except ProviderError as exc:
        raise HTTPException(422, str(exc)) from None


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
        token = read_token(self.organization, self.code)
        for offset in range(0, self.value["max_items"], 50):
            rows = await apify_request("GET", f'datasets/{self.value["dataset_id"]}/items', token,
                                        params={"offset": offset, "limit": min(50, self.value["max_items"] - offset), "clean": "true"})
            if not isinstance(rows, list):
                raise ProviderError("El dataset no contiene una lista de registros")
            batch = []
            for row in rows:
                if not isinstance(row, dict):
                    continue
                normalized = self.normalize(row)
                if normalized["source_url"]:
                    batch.append(Candidate(normalized["source_url"], row))
            yield batch
            if len(rows) < 50:
                break


def registry(organization):
    return {**REGISTRY, **{v["id"]: ApifyDataset(v, organization) for v in connections(organization) if v["enabled"] and v["dataset_id"]}}


def source_infos(organization):
    public = [{"code": c.code, "name": c.name, "available": True,
               "category": "LATAM" if c.code == "getonbrd-public" else "Internacional", "note": "API/feed público. Cobertura española variable; atribución y enlace original conservados.",
               "website": c.url if hasattr(c, "url") else "https://himalayas.app" if c.code == "himalayas" else "https://weworkremotely.com"} for c in REGISTRY.values()]
    public += [{"code": c[0], "name": c[1], "category": c[2], "website": c[3], "setup_url": c[4] or "https://apify.com/store?search=web%20scraper", "note": c[5], "available": False} for c in CATALOG]
    public += [{"code": v["id"], "name": v["name"], "category": "Mis conexiones", "available": v["enabled"] and bool(v["dataset_id"]), "note": "Dataset Apify · consulta sin lanzar un nuevo scraper"} for v in connections(organization)]
    return public


class ResolveRequest(BaseModel):
    reviewed_apify_console: bool


@router.post("/source-connections/{connection_id}/resolve")
def resolve(connection_id: str, body: ResolveRequest):
    value = get_connection(connection_id, org())
    if not body.reviewed_apify_console or value.get("run_status") not in {"UNKNOWN", "STARTING"}:
        raise HTTPException(409, "Solo se desbloquean lanzamientos inciertos tras revisar la consola")
    value["run_status"] = "REVIEWED"
    put_connection(value, org())
    return public_connection(value, org())
