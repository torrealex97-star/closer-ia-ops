import asyncio
import hashlib
import json
import re
import time
from dataclasses import dataclass
from typing import AsyncIterator
import httpx
from defusedxml import ElementTree
from .db import connect
from .models import SearchQuery

USER_AGENT = "CareerPlatform/0.1 (local opportunity research; attributed results)"


class ProviderError(Exception):
    pass


async def fetch(url: str, params: dict | None = None, ttl: int = 900, user_agent: str | None = None) -> str:
    key = hashlib.sha256((url + json.dumps(params, sort_keys=True)).encode()).hexdigest()
    with connect() as db:
        cached = db.execute("SELECT payload FROM provider_cache WHERE key=? AND expires_at>?", (key, time.time())).fetchone()
    if cached:
        return cached["payload"]
    headers = {"User-Agent": user_agent or USER_AGENT}
    async with httpx.AsyncClient(timeout=18, follow_redirects=False, headers=headers) as client:
        for attempt in range(2):
            try:
                async with client.stream("GET", url, params=params) as response:
                    if response.status_code == 429 or response.status_code >= 500:
                        if attempt == 0:
                            await asyncio.sleep(1)
                            continue
                    response.raise_for_status()
                    chunks = bytearray()
                    async for chunk in response.aiter_bytes():
                        chunks.extend(chunk)
                        if len(chunks) > 12_000_000:
                            raise ProviderError("Respuesta demasiado grande")
                    payload = chunks.decode("utf-8")
                with connect() as db:
                    db.execute("INSERT OR REPLACE INTO provider_cache VALUES(?,?,?)", (key, payload, time.time() + ttl))
                return payload
            except (httpx.HTTPError, UnicodeError) as error:
                if attempt == 1:
                    raise ProviderError("La fuente no responde o ha limitado las consultas. Reintenta más tarde.") from error
                await asyncio.sleep(1)
    raise ProviderError("Fuente no disponible")


@dataclass(frozen=True)
class Candidate:
    external_id: str
    payload: dict


class Himalayas:
    code = "himalayas"
    name = "Himalayas"
    provider = "official_json_v1"

    async def batches(self, query: SearchQuery) -> AsyncIterator[list[Candidate]]:
        terms = {
            "digital_sales": ["closer", "setter", "cold caller", "comercial", "cerrador", "venta de alto valor"],
            "cold_caller": ["cold caller", "cold calling", "llamadas en frio"],
            "closer": ["closer", "cerrador", "venta de alto valor"],
            "setter": ["appointment setter", "appointment setting"],
            "sdr": ["sales development", "business development representative"],
            "account_executive": ["account executive"],
            "sales": ["closer", "setter", "comercial digital", "ventas"],
            "custom": [query.keywords],
        }[query.role]
        seen = set()
        # Country-targeted queries run before the global pool so busy global
        # results cannot exhaust Spain's coverage. Shared dedupe is not pagination.
        markets = ['ES', None] if query.market == 'any' else [query.market if query.market in {'ES', 'US'} else None]
        for country in markets:
            for term in terms:
                for page in range(1, 4):
                    params = {"q": term, "sort": "recent", "page": page}
                    if country:
                        params["country"] = country
                    data = json.loads(await fetch("https://himalayas.app/jobs/api/search", params))
                    if not isinstance(data, dict) or not isinstance(data.get("jobs"), list):
                        raise ProviderError("El formato de Himalayas ha cambiado")
                    batch = []
                    for row in data["jobs"]:
                        if not isinstance(row, dict) or not row.get("guid"):
                            continue
                        external_id = str(row["guid"])
                        if external_id not in seen:
                            seen.add(external_id)
                            batch.append(Candidate(external_id, row))
                    if batch:
                        yield batch
                    if not data["jobs"]:
                        break


class RssJobs:
    """Category feed of a remote-job board. No upstream filters exist to invent."""
    provider = "official_rss_v1"

    def __init__(self, code, name, url):
        self.code, self.name, self.url = code, name, url

    async def batches(self, query) -> AsyncIterator[list[Candidate]]:
        text = await fetch(self.url)
        root = ElementTree.fromstring(text)
        if root.tag != "rss":
            raise ProviderError("El formato RSS ha cambiado")
        rows = []
        for item in root.findall("./channel/item")[:300]:
            row = {child.tag.split("}")[-1]: child.text or "" for child in item}
            if row.get("link"):
                rows.append(Candidate(row.get("guid") or row["link"], row))
        for i in range(0, len(rows), 50):
            yield rows[i:i + 50]


class WeWorkRemotely(RssJobs):
    def __init__(self):
        super().__init__("weworkremotely", "We Work Remotely", "https://weworkremotely.com/categories/remote-sales-and-marketing-jobs.rss")


class JobToday:
    """Listados públicos de jobtoday.com/es. El HTML Next.js embebe un JSON completo
    (__NEXT_DATA__ -> props.pageProps.feed.sections[].items[].payload) verificado 2026-09-23.
    Solo se lee esa estructura embebida; sin endpoints privados ni scraping de detalle."""
    provider = "embedded_next_json_v1"
    BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36"

    def __init__(self, code, name, slug):
        self.code, self.name, self.slug = code, name, slug
        self.url = f"https://jobtoday.com/es/trabajos-{slug}"

    async def batches(self, query):
        # El endpoint solo responde estable a User-Agent de navegador (verificado: CareerPlatform UA recibe anti-bot).
        cached = await fetch(self.url, ttl=3600, user_agent=self.BROWSER_UA)
        match = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', cached, re.S)
        if not match:
            raise ProviderError("JobToday no incluye su listado embebido; formato cambiado")
        try:
            data = json.loads(match.group(1))
            sections = data["props"]["pageProps"]["feed"]["sections"]
        except (ValueError, KeyError, TypeError):
            raise ProviderError("La estructura embebida de JobToday ha cambiado") from None
        rows = [it["payload"] for section in sections for it in (section.get("items") or [])
                if isinstance(it, dict) and isinstance(it.get("payload"), dict)]
        batch = []
        for row in rows[:300]:
            external_id = row.get("key") or row.get("canonicalUrl")
            if not external_id:
                continue
            batch.append(Candidate(str(external_id), row))
        if batch:
            yield batch


class Jobicy:
    code = "jobicy"
    name = "Jobicy"
    provider = "official_json_v2"
    INDUSTRY_SLUG = "seller"

    async def batches(self, query: SearchQuery) -> AsyncIterator[list[Candidate]]:
        # 'seller' es el slug de la industria Sales en su endpoint /get=industries.
        data = json.loads(await fetch("https://jobicy.com/api/v2/remote-jobs", params={"count": "50", "industry": self.INDUSTRY_SLUG}, ttl=3600))
        if not isinstance(data, dict) or not isinstance(data.get("jobs"), list):
            raise ProviderError("El formato de Jobicy ha cambiado")
        batch = []
        for row in data["jobs"][:300]:
            if isinstance(row, dict) and row.get("id") and row.get("url"):
                batch.append(Candidate(str(row["id"]), row))
        if batch:
            yield batch


class AtsCompany:
    """Public ATS endpoint of one company. Ingests only its explicit feeds; never guesses slugs.

    The provider records the verified job board so a wrong URL pattern can never become
    a fabricated application link.
    """
    provider = "official_ats_v1"
    URLS = {
        "greenhouse": "https://boards-api.greenhouse.io/v1/boards/{slug}/jobs",
        "ashby": "https://api.ashbyhq.com/posting-api/job-board/{slug}",
        "recruitee": "https://{slug}.recruitee.com/api/offers/",
        "lever": "https://api.lever.co/v0/postings/{slug}?mode=json",
        "smartrecruiters": "https://api.smartrecruiters.com/v1/companies/{slug}/postings",
        "teamtailor": "https://{slug}.teamtailor.com/jobs.rss",
    }
    # Dominios propios de Teamtailor verificados (careers.empresa.com/jobs.rss). Nunca se adivinan:
    # solo hosts comprobados con feed 200 y payload RSS válido.
    CUSTOM_HOSTS = {
        "monestcapital": "https://careers.monestcapital.com/jobs.rss",  # Monest Capital / Inversor PRO, verificado 2026-09-23.
    }
    KEY = {"greenhouse": "jobs", "ashby": "jobs", "recruitee": "offers", "lever": None, "smartrecruiters": "content", "teamtailor": None}

    def __init__(self, ats, slug, code=None, company_name=""):
        self.ats, self.slug = ats, slug
        self.code = code or f"ats-{ats}-{slug}"
        self.name = f"{slug.capitalize()} · {ats.capitalize()}"
        self.company_name = company_name
        self.url = self.CUSTOM_HOSTS.get(slug) or self.URLS[ats].format(slug=slug)
        self.key = self.KEY[ats]
        if ats not in self.URLS:
            raise ValueError("ATS no soportado")

    async def batches(self, query):
        text = await fetch(self.url, ttl=3600)
        if self.ats == "personio":
            root = ElementTree.fromstring(text)
            rows = [dict((child.tag, child.text or "") for child in pos) for pos in root.findall(".//position")]
        elif self.ats == "teamtailor":
            # Feed RSS público de Teamtailor (formato verificado con producthackers 2026-09-23).
            root = ElementTree.fromstring(text)
            rows = []
            for item in root.findall("./channel/item")[:500]:
                row = {}
                for child in item:
                    tag = child.tag.split("}")[-1]
                    row[tag] = child.text or ""
                # Ubicaciones en el namespace tt (tt:location/tt:name).
                locations = [el.text for el in item.iter() if el.tag.split("}")[-1] == "name" and el.text]
                row["locations"] = locations
                rows.append(row)
        else:
            data = json.loads(text)
            rows = data.get(self.key) if self.key and isinstance(data, dict) else data
        if not isinstance(rows, list):
            raise ProviderError("El ATS ha cambiado su formato")
        batch = []
        for row in rows[:500]:
            if not isinstance(row, dict):
                continue
            if self.company_name:
                row["company_name"] = self.company_name
            external_id = row.get("id") or row.get("slug") or row.get("guid") or row.get("jobUrl")
            if external_id:
                batch.append(Candidate(str(external_id), row))
        if batch:
            yield batch


def watchlist_connectors(organization=None):
    """AtsCompany per enabled watchlist target. One connector per company.
    Unknown hosts stay unknown: no fabricated board URLs. Defaults are pre-verified slugs."""
    import re
    connectors = {}
    targets = []
    try:
        from .db import connect
        from .db import org as current_org
        with connect() as db:
            rows = db.execute("""SELECT t.ats,t.slug,t.company_name FROM company_watchlist w
                JOIN watchlist_targets t ON t.watchlist_id=w.id WHERE w.enabled=1 AND w.org_id=?""",
                              (organization or current_org(),)).fetchall()
            targets = [(r["ats"], r["slug"], r["company_name"]) for r in rows]
    except Exception:
        targets = []
    if not targets:
        # Migración 5 siembra estos mismos; es el fallback para bases sin la tabla.
        targets = [("greenhouse", "stripe", ""), ("greenhouse", "typeform", ""), ("greenhouse", "wallapop", ""),
                   ("ashby", "pennylane", ""), ("recruitee", "livestorm", ""), ("greenhouse", "cabify", "")]
    for ats, slug, company_name in targets:
        if ats not in AtsCompany.URLS or not re.fullmatch(r"[a-z0-9-]+", slug):
            continue
        conn = AtsCompany(ats, slug, company_name=company_name)
        connectors[conn.code] = conn
    return connectors


REGISTRY = {c.code: c for c in [Himalayas(), WeWorkRemotely(), Jobicy()]}


class PublicJSON:
    provider = "official_json_v1"

    def __init__(self, code, name, url, key=None, ttl=3600, id_field=None):
        self.code, self.name, self.url, self.key, self.ttl = code, name, url, key, ttl
        self.id_field = id_field

    async def batches(self, query):
        data = json.loads(await fetch(self.url, params={"category": "sales"} if self.code == "remotive" else None, ttl=self.ttl))
        rows = data.get(self.key) if self.key and isinstance(data, dict) else data
        if not isinstance(rows, list):
            raise ProviderError("El proveedor ha cambiado su formato JSON")
        batch = []
        for row in rows[:1500]:
            if not isinstance(row, dict):
                continue
            external_id = row.get("id") or row.get("slug") or (row.get(self.id_field) if self.id_field else None)
            if external_id:
                batch.append(Candidate(str(external_id), row))
            if len(batch) == 50:
                yield batch
                batch = []
        if batch:
            yield batch


for connector in [
    PublicJSON("remotive", "Remotive", "https://remotive.com/api/remote-jobs", "jobs", 21600),
    PublicJSON("remoteok", "Remote OK", "https://remoteok.com/api"),
    PublicJSON("arbeitnow", "Arbeitnow", "https://www.arbeitnow.com/api/job-board-api", "data"),
    # Boards requested by WDC with a public feed verified on 2026-09-23.
    # Remote Work Hub is excluded on purpose: its /rss only publishes blog posts.
    PublicJSON("workingnomads", "Working Nomads", "https://www.workingnomads.com/api/exposed_jobs/", ttl=3600, id_field="url"),
    RssJobs("virtualvocations", "Virtual Vocations", "https://www.virtualvocations.com/rss"),
    RssJobs("remotejobs", "Remote.jobs", "https://remote.jobs/feed/"),
    # Sales industry feed ('seller' slug) verified 2026-09-23. Attribution required by source.
    RssJobs("remotefirstjobs", "Remote First Jobs", "https://remotefirstjobs.com/rss/jobs/sales.rss"),
    RssJobs("jobspresso", "Jobspresso", "https://www.jobspresso.co/?feed=job_feed"),
    # Bolsa remota hispana: anuncios redactados en español, verificado 2026-09-23.
    RssJobs("remotojob", "RemotoJOB", "https://remotojob.com/feed/"),
    JobToday("jobtoday", "JobToday España", "closer-venta"),
    # 'setter' responde 410 Gone (verificado 2026-09-23); 'telemarketing' cubre televenta España.
    JobToday("jobtoday-telemarketing", "JobToday Telemarketing", "telemarketing"),
    JobToday("jobtoday-remoto", "JobToday Comercial remoto", "ventas-remoto"),
]:
    REGISTRY[connector.code] = connector


class GoogleSerpApi:
    """SerpApi motor google_jobs: un dork del vocabulario WDC por búsqueda.
    SerpApi cobra por búsqueda (API de pago), así que cada llamada es deliberada:
    un preset por petición, sin paginación que multiplique el gasto."""
    provider = "serpapi_google_jobs_v1"

    def batches(self, query) -> AsyncIterator[list[Candidate]]:
        raise ProviderError("GoogleSerpApi es una fuente parametrizada; usa google_serpapi_connector()")


def google_serpapi_connector(dork: str, gl: str = "es", hl: str = "es"):
    """Connector for one WDC preset dork. Token resolved at call time so tests
    can monkeypatch fetch without credentials on disk."""

    class _One(GoogleSerpApi):
        code = "google"
        name = "Google Jobs (SerpApi)"

        async def batches(self, query):
            token = read_serpapi_token()
            if not token:
                raise ProviderError("Guarda tu clave de SerpApi en Integraciones antes de ejecutar los dorks")
            params = {"engine": "google_jobs", "q": dork, "gl": gl, "hl": hl, "api_key": token}
            data = json.loads(await fetch("https://serpapi.com/search.json", params, ttl=0))
            if not isinstance(data, dict):
                raise ProviderError("SerpApi ha cambiado su formato de respuesta")
            if data.get("error"):
                raise ProviderError(f"SerpApi: {data['error']}")
            rows = data.get("jobs_results")
            if not isinstance(rows, list):
                raise ProviderError("SerpApi no devolvió jobs_results")
            batch = []
            for row in rows[:50]:
                if not isinstance(row, dict):
                    continue
                job_id = row.get("job_id") or row.get("link")
                if job_id:
                    batch.append(Candidate(str(job_id), row))
            yield batch

    return _One()


def read_serpapi_token():
    from .db import org as current_org
    from .sources import read_token
    return read_token(current_org(), "account-serpapi")


class GetOnBoard:
    code = "getonbrd-public"
    name = "Get on Board"
    provider = "official_json_v0"
    url = "https://www.getonbrd.com"

    async def batches(self, query):
        for page in range(1, 4):
            data = json.loads(await fetch("https://www.getonbrd.com/api/v0/categories/sales/jobs", {"per_page": 100, "page": page}, ttl=3600))
            if not isinstance(data, dict) or not isinstance(data.get("data"), list):
                raise ProviderError("Get on Board ha cambiado su formato")
            yield [Candidate(str(row["id"]), row) for row in data["data"] if isinstance(row, dict) and row.get("id")]
            if page >= data.get("meta", {}).get("total_pages", 1):
                break


REGISTRY[GetOnBoard.code] = GetOnBoard()
