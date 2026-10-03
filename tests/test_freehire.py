"""FreeHireConnector: capa FREE de SPEC-002. API pública keyless de freehire.me.

El payload del test reproduce el esquema real capturado en vivo el 2026-09-29
(https://freehire.me/api/v1/jobs/search?category=sales...), recortado a los campos
que consume el pipeline. Verifica búsqueda paginada, filtro de vigencia declarada
y normalización sin inventar datos.
"""
import asyncio
import json

import pytest

import career.connectors as connectors
from career.connectors import FreeHire, ProviderError
from career.models import SearchQuery
from career.pipeline import normalize


def live_row(slug="closer-remoto-acme-1a2b", url="https://boards.greenhouse.io/acme/jobs/42",
             title="Closer de ventas", company="Acme", work_mode="remote", reality="fresh",
             countries=("ES",), cities=("Madrid",), posted="2026-09-28T09:12:00Z",
             salary_min=1200, salary_max=2400, description="Buscamos closer para el equipo comercial. Salario: fijo 1.200 € + comisiones."):
    return {
        "public_slug": slug, "source": "greenhouse", "external_id": "42", "url": url,
        "title": title, "company": company, "company_slug": "acme",
        "location": "Madrid, Spain", "description": description,
        "countries": list(countries), "regions": ["eu"], "work_mode": work_mode,
        "cities": list(cities), "posted_at": posted, "created_at": posted,
        "closed_at": None,
        "enrichment": {"salary_min": salary_min, "salary_max": salary_max,
                       "salary_currency": "EUR", "salary_period": "month",
                       "posting_language": "es"},
        "reality": {"class": reality, "age_days": 1, "repost_count": 0, "fake_freshness": False},
    }


async def run_batches(connector, query=None):
    query = query or SearchQuery()
    return [row async for batch in connector.batches(query) for row in batch]


def test_freehire_search_contract_and_pagination(monkeypatch):
    """Una página completa encadena la segunda; el total manda sobre el límite local."""
    calls = []

    async def fake_fetch(url, params=None, ttl=900, user_agent=None):
        calls.append((url, dict(params or {})))
        offset = int(params["offset"])
        if offset == 0:
            return json.dumps({"data": [live_row(slug="closer-remoto-acme-1a2b")] * 100,
                               "meta": {"total": 120, "limit": 100, "offset": 0}})
        return json.dumps({"data": [live_row(slug="closer-segunda-zz9", title="Setter bilingüe")],
                           "meta": {"total": 120, "limit": 100, "offset": 100}})

    monkeypatch.setattr(connectors, "fetch", fake_fetch)
    rows = asyncio.run(run_batches(FreeHire()))
    assert len(rows) == 101
    assert calls[0][0].startswith("https://freehire.me/api/v1/jobs/search")
    assert calls[0][1]["category"] == "sales" and calls[0][1]["limit"] == "100"
    assert calls[0][1]["sort"] == "posted_at" and calls[0][1]["order"] == "desc"
    assert calls[1][1]["offset"] == "100"
    assert rows[0].external_id == "closer-remoto-acme-1a2b"


@pytest.mark.parametrize("market,params", [
    ("ES", {"countries": "ES"}),
    ("EU", {"regions": "eu"}),
    ("LATAM", {"regions": "latam"}),
])
def test_freehire_market_mapping(market, params, monkeypatch):
    seen = {}

    async def fake_fetch(url, params=None, ttl=900, user_agent=None):
        seen.update(params or {})
        return json.dumps({"data": [live_row()], "meta": {"total": 1, "limit": 100, "offset": 0}})

    monkeypatch.setattr(connectors, "fetch", fake_fetch)
    asyncio.run(run_batches(FreeHire(), SearchQuery(market=market)))
    for key, value in params.items():
        assert seen[key] == value


def test_freehire_excludes_declared_stale_reality(monkeypatch):
    """stale y likely-evergreen no entran: no se presentan como nuevas fichas repintadas."""
    pages = [live_row(slug="fresca", reality="fresh"),
             live_row(slug="vieja", reality="stale"),
             live_row(slug="siempre", reality="likely-evergreen"),
             live_row(slug="sin-senal", reality=None)]

    async def fake_fetch(url, params=None, ttl=900, user_agent=None):
        return json.dumps({"data": pages, "meta": {"total": 4, "limit": 100, "offset": 0}})

    monkeypatch.setattr(connectors, "fetch", fake_fetch)
    rows = asyncio.run(run_batches(FreeHire()))
    assert [row.external_id for row in rows] == ["fresca", "sin-senal"]


def test_freehire_normalization_matches_live_schema():
    item = normalize("freehire", live_row())
    assert item["title"] == "Closer de ventas" and item["company"] == "Acme"
    assert item["source_url"] == "https://boards.greenhouse.io/acme/jobs/42"
    assert item["application_url"] == item["source_url"]
    assert item["locations"][0] == "España" and "Madrid" in item["locations"]
    assert item["work_mode"] == "remote"
    assert item["published_at"] == "2026-09-28T09:12:00+00:00"
    assert item["salary_min"] == 1200 and item["salary_max"] == 2400
    assert item["salary_currency"] == "EUR" and item["salary_period"] == "monthly"


def test_freehire_normalization_without_optional_fields():
    """Sin ciudades ni país declarado, se usa su location; sin salary, todo nulo."""
    row = live_row(countries=[], cities=[], url="https://acme.com/careers/remote-eu",
                   salary_min=None, salary_max=None)
    row["enrichment"] = {"posting_language": "en"}
    row["reality"] = {"class": "fresh"}
    item = normalize("freehire", row)
    assert item["locations"] == ["Madrid, Spain"]
    assert item["salary_min"] is None and item["salary_period"] is None
    assert item["work_mode"] == "remote"


def test_freehire_registry_entry():
    assert connectors.REGISTRY["freehire"].code == "freehire"
    assert connectors.REGISTRY["freehire"].name == "FreeHire"
    assert connectors.REGISTRY["freehire"].provider == "official_json_v1"


def test_freehire_provider_error_on_schema_change(monkeypatch):
    async def fake_fetch(url, params=None, ttl=900, user_agent=None):
        return json.dumps({"error": "boom"})

    monkeypatch.setattr(connectors, "fetch", fake_fetch)
    try:
        asyncio.run(run_batches(FreeHire()))
    except ProviderError:
        pass
    else:
        raise AssertionError("El cambio de formato debe elevar ProviderError")
