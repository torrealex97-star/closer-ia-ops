import asyncio
import io
import json
import sqlite3
from datetime import datetime, timedelta, timezone
import pytest
from fastapi.testclient import TestClient
from openpyxl import load_workbook
from career import connectors
from career.connectors import Candidate, Himalayas, WeWorkRemotely, ProviderError
from career.db import connect, load_run, now
from career.main import app
from career.models import SearchQuery
from career.pipeline import ingest, match, normalize, plain, safe_url
from career.worker import execute


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("CAREER_DB", str(tmp_path / "test.sqlite3"))
    monkeypatch.setenv("CAREER_LOCAL_TOKEN", "test-token")
    monkeypatch.setenv("CAREER_ORG_ID", "org-a")
    with TestClient(app, headers={"Authorization": "Bearer test-token"}) as c:
        yield c


@pytest.fixture
def candidate():
    return Candidate("https://himalayas.app/companies/example/jobs/closer", {
        "guid": "https://himalayas.app/companies/example/jobs/closer", "title": "Sales Closer",
        "companyName": "Example Company", "description": "<p>Spanish-speaking closer. Base plus commission.</p>",
        "locationRestrictions": ["Spain"], "pubDate": now(), "minSalary": 36000,
        "maxSalary": 48000, "currency": "EUR", "salaryPeriod": "annual",
        "applicationLink": "https://example.com/apply",
    })


def create(client, query=None, key="test-request-001"):
    response = client.post("/v1/search-runs", json={"query": query or {}, "idempotency_key": key})
    assert response.status_code == 202, response.text
    return response.json()


def test_auth_and_empty_state(client):
    assert client.get("/v1/config", headers={"Authorization": ""}).status_code == 401
    assert client.get("/v1/search-runs").json() == []
    assert client.get("/v1/config").json()["mode"] == "local"
    assert sum(s["available"] for s in client.get("/v1/config").json()["sources"]) == 2


def test_idempotency_and_conflicting_replay(client):
    first = create(client)
    assert create(client)["id"] == first["id"]
    response = client.post("/v1/search-runs", json={"query": {"role": "setter"}, "idempotency_key": "test-request-001"})
    assert response.status_code == 409


def test_raw_is_immutable_and_retry_does_not_duplicate(client, candidate):
    run = create(client)
    for _ in range(2):
        assert ingest(candidate, Himalayas(), SearchQuery(), run["id"], "org-a")
    with connect() as db:
        for table in ["raw_items", "job_postings", "jobs", "search_results"]:
            assert db.execute(f"SELECT count(*) FROM {table}").fetchone()[0] == 1
        with pytest.raises(sqlite3.IntegrityError):
            db.execute("UPDATE raw_items SET payload='{}'")
        with pytest.raises(sqlite3.IntegrityError):
            db.execute("DELETE FROM raw_items")
    assert len(load_run(run["id"], "org-a")["jobs"]) == 1


def test_cross_org_reads_writes_exports_are_denied(client, candidate, monkeypatch):
    run = create(client)
    ingest(candidate, Himalayas(), SearchQuery(), run["id"], "org-a")
    job = load_run(run["id"], "org-a")["jobs"][0]
    monkeypatch.setenv("CAREER_ORG_ID", "org-b")
    assert client.get(f'/v1/search-runs/{run["id"]}').status_code == 404
    assert client.patch(f'/v1/jobs/{job["id"]}/star', json={"starred": True}).status_code == 404
    assert client.post("/v1/exports", json={"run_id": run["id"], "job_ids": [job["id"]], "format": "json"}).status_code == 404
    assert client.get("/v1/search-runs").json() == []
    with connect() as db:
        with pytest.raises(sqlite3.IntegrityError):
            db.execute("INSERT INTO search_results VALUES(?,?,?,?)", ("org-b", run["id"], job["id"], "{}"))


def test_strict_filters_do_not_invent_eligibility(candidate):
    item = normalize("himalayas", candidate.payload)
    assert match(item, SearchQuery(role="closer", market="ES", salary_min=2000, salary_mode="strict"))
    assert match(item, SearchQuery(market="US")) is None
    assert match(item, SearchQuery(salary_min=4000, salary_mode="strict")) is None
    item["salary_currency"] = "USD"
    assert match(item, SearchQuery(salary_min=2000, salary_mode="strict")) is None
    item["locations"] = []
    assert match(item, SearchQuery(market="ES", include_unknown=False)) is None
    assert match(item, SearchQuery(market="ES", include_unknown=True))[2]
    item["published_at"] = (datetime.now(timezone.utc) - timedelta(days=100)).isoformat()
    assert match(item, SearchQuery()) is None


def test_expired_and_misleading_sdr_substring(candidate):
    item = normalize("himalayas", candidate.payload)
    item["expires_at"] = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    assert match(item, SearchQuery()) is None
    item["expires_at"] = None
    item["title"] = "Cloud specialist"
    item["description"] = "AWS SDK and sdrandom"
    assert match(item, SearchQuery(role="sdr")) is None


def test_safe_rendering():
    assert safe_url("javascript:alert(1)") == ""
    assert safe_url("https://user:secret@example.com") == ""
    assert plain("<script>bad()</script><p>Good &amp; safe</p>") == "Good & safe"


def test_sales_team_mention_does_not_turn_engineer_into_sales_job(candidate):
    item = normalize("himalayas", candidate.payload)
    item["title"] = "Software Engineer"
    item["description"] = "Work with sales and account executives. Take a closer look at our company."
    assert match(item, SearchQuery(role="sales")) is None
    item["description"] = "We are hiring a high ticket closer to join our sales team."
    assert match(item, SearchQuery(role="closer"))


def test_partial_failure_and_progressive_results(client, candidate):
    run = create(client)
    class Good(Himalayas):
        async def batches(self, query):
            yield [candidate]
    class Bad(WeWorkRemotely):
        async def batches(self, query):
            await asyncio.sleep(.02)
            assert len(load_run(run["id"], "org-a")["jobs"]) == 1
            raise ProviderError("Prueba: fuente caída")
            yield []
    asyncio.run(execute(run["id"], "org-a", SearchQuery(), {"himalayas": Good(), "weworkremotely": Bad()}))
    result = load_run(run["id"], "org-a")
    assert result["status"] == "partial"
    assert len(result["jobs"]) == 1
    assert result["sources"][1]["status"] == "failed"


def test_exports_selected_only_and_formula_safe(client, candidate):
    run = create(client)
    candidate.payload["companyName"] = "=HYPERLINK(\"https://example.com\")"
    ingest(candidate, Himalayas(), SearchQuery(), run["id"], "org-a")
    job = load_run(run["id"], "org-a")["jobs"][0]
    body = {"run_id": run["id"], "job_ids": [job["id"]]}
    data = client.post("/v1/exports", json={**body, "format": "json"}).json()
    assert len(data) == 1 and data[0]["source_url"] == candidate.external_id
    csv = client.post("/v1/exports", json={**body, "format": "csv"})
    assert "'=HYPERLINK" in csv.text
    xlsx = client.post("/v1/exports", json={**body, "format": "xlsx"})
    workbook = load_workbook(io.BytesIO(xlsx.content))
    assert workbook.active.max_row == 2
    assert workbook.active["B2"].data_type == "s"
    assert client.post("/v1/exports", json={**body, "job_ids": ["nonexistent"], "format": "csv"}).status_code == 422


def test_saved_search_and_cancellation_persist(client):
    saved = client.post("/v1/saved-searches", json={"name": "Closers ES", "query": {"role": "closer", "market": "ES"}})
    assert saved.status_code == 200
    assert client.get("/v1/saved-searches").json()[0]["query"]["market"] == "ES"
    run = create(client)
    assert client.post(f'/v1/search-runs/{run["id"]}/cancel').json()["status"] == "cancelled"
    assert load_run(run["id"], "org-a")["status"] == "cancelled"


def test_provider_contracts(client, candidate, monkeypatch):
    async def fake_fetch(url, params=None):
        if "himalayas" in url:
            return json.dumps({"jobs": [candidate.payload]})
        return '<rss><channel><item><title>Company: Sales Closer</title><link>https://example.com/job</link><region>Anywhere in the World</region><description>Sales position</description></item></channel></rss>'
    monkeypatch.setattr(connectors, "fetch", fake_fetch)
    async def collect(connector):
        return [row async for batch in connector.batches(SearchQuery()) for row in batch]
    himalayas = asyncio.run(collect(Himalayas()))
    assert len(himalayas) == 1
    wwr = asyncio.run(collect(WeWorkRemotely()))
    normalized = normalize("weworkremotely", wwr[0].payload)
    assert normalized["company"] == "Company"
    assert normalized["locations"] == ["Anywhere in the World"]
