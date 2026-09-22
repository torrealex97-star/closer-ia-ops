import asyncio
import hashlib
import json
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


async def fetch(url: str, params: dict | None = None, ttl: int = 900) -> str:
    key = hashlib.sha256((url + json.dumps(params, sort_keys=True)).encode()).hexdigest()
    with connect() as db:
        cached = db.execute("SELECT payload FROM provider_cache WHERE key=? AND expires_at>?", (key, time.time())).fetchone()
    if cached:
        return cached["payload"]
    async with httpx.AsyncClient(timeout=18, follow_redirects=False, headers={"User-Agent": USER_AGENT}) as client:
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


class WeWorkRemotely:
    code = "weworkremotely"
    name = "We Work Remotely"
    provider = "official_rss_v1"

    async def batches(self, query: SearchQuery) -> AsyncIterator[list[Candidate]]:
        text = await fetch("https://weworkremotely.com/remote-jobs.rss")
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


REGISTRY = {c.code: c for c in [Himalayas(), WeWorkRemotely()]}


class PublicJSON:
    provider = "official_json_v1"

    def __init__(self, code, name, url, key=None, ttl=3600):
        self.code, self.name, self.url, self.key, self.ttl = code, name, url, key, ttl

    async def batches(self, query):
        data = json.loads(await fetch(self.url, ttl=self.ttl))
        rows = data.get(self.key) if self.key and isinstance(data, dict) else data
        if not isinstance(rows, list):
            raise ProviderError("El proveedor ha cambiado su formato JSON")
        batch = []
        for row in rows[:1500]:
            if not isinstance(row, dict):
                continue
            external_id = row.get("id") or row.get("slug")
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
]:
    REGISTRY[connector.code] = connector


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
