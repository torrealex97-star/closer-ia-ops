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
    assert sum(s["available"] for s in client.get("/v1/config").json()["sources"]) == 6


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


def test_spanish_bilingual_europe_and_work_mode(candidate):
    item = normalize('himalayas', candidate.payload)
    query = SearchQuery(role='sales', market='EU', require_spanish=True)
    item['locations'] = ['Berlin, Germany']
    item['title'] = 'Comercial digital'
    item['description'] = 'Buscamos experiencia en ventas para nuestro equipo. Trabajo híbrido.'
    item['work_mode'] = 'hybrid'
    assert match(item, query)
    assert match(item, query.model_copy(update={'work_mode': 'remote'})) is None
    item['description'] = 'English-speaking sales team. On-site only.'
    item['work_mode'] = 'onsite'
    assert match(item, query) is None
    item['description'] = 'Bilingual Spanish and English. Work from home.'
    item['work_mode'] = ''
    assert match(item, query)
    item['description'] = 'English only. Remote.'
    assert match(item, query) is None
    item['description'] = 'Remote. Spanish not required.'
    assert match(item, query) is None
    item['locations'] = ['United States']
    item['description'] = 'Spanish-speaking closer. Remote.'
    assert match(item, query) is None


def test_portuguese_is_not_spanish_and_sales_management_is_not_default(candidate):
    item = normalize('himalayas', candidate.payload)
    item['title'] = 'Executivo Comercial'
    item['description'] = 'Buscamos experiência com clientes e requisitos. Trabalho remoto.'
    assert match(item, SearchQuery(role='digital_sales', require_spanish=True)) is None
    item['title'] = 'Líder de Equipo de Ventas'
    item['description'] = 'Dirige nuestro equipo de ventas en remoto.'
    assert match(item, SearchQuery(role='digital_sales', require_spanish=True)) is None
    item['title'] = 'Coordinador de inteligencia comercial'
    assert match(item, SearchQuery(role='digital_sales', require_spanish=True)) is None


@pytest.mark.parametrize('title', ['Closer de Ventas', 'Closer digital', 'High Ticket Closer', 'Appoitment Setter', 'Appointment Setter', 'Setter', 'Comercial Digital', 'Cerrador', 'Cerradora', 'Venta de Alto Valor'])
def test_requested_aliases(candidate, title):
    item = normalize('himalayas', candidate.payload)
    item['title'] = title
    assert match(item, SearchQuery(role='sales', require_spanish=True))


def test_sources_secrets_isolation_and_availability(client, monkeypatch):
    body = {'name': 'InfoJobs prueba', 'source': 'infojobs', 'token': 'fake-unit-secret', 'actor_id': 'user/actor', 'dataset_id': 'unit-dataset', 'urls': ['https://www.infojobs.net/ofertas-trabajo/closer']}
    response = client.post('/v1/source-connections', json=body)
    assert response.status_code == 200, response.text
    value = response.json()
    assert value['has_token'] and 'fake-unit-secret' not in response.text and '"token"' not in response.text
    connection_id = value['id']
    with connect() as db:
        assert 'fake-unit-secret' not in db.execute('SELECT payload FROM source_connections').fetchone()[0]
    assert any(s['code'] == connection_id and s['available'] for s in client.get('/v1/config').json()['sources'])
    run = create(client, {'sources': [connection_id]}, 'configured-run-123')
    assert run['sources'][0]['name'] == 'InfoJobs prueba'
    from career.sources import secret_path
    assert secret_path('org-a', connection_id).stat().st_mode & 0o777 == 0o600
    monkeypatch.setenv('CAREER_ORG_ID', 'org-b')
    assert client.get('/v1/source-connections').json() == []
    assert client.patch('/v1/source-connections/' + connection_id, json=body).status_code == 404
    assert client.post('/v1/source-connections/' + connection_id + '/check', json={}).status_code == 404
    assert client.post('/v1/search-runs', json={'query': {'sources': [connection_id]}, 'idempotency_key': 'cross-org-test'}).status_code == 422


@pytest.mark.parametrize('patch', [
    {'urls': ['http://example.com']}, {'urls': ['https://127.0.0.1/private']},
    {'urls': ['https://example.com?token=secret']}, {'actor_input': {'cookies': 'secret'}},
    {'mapping': {'source_url': 'url', 'bogus': 'password'}}, {'max_items': 501},
])
def test_connection_invalid_input(client, patch):
    assert client.post('/v1/source-connections', json={'name': 'Bad', **patch}).status_code == 422


def test_apify_launch_check_import_and_no_paid_search(client, monkeypatch):
    from career import sources
    calls = []
    async def fake_request(method, path, token, **kwargs):
        calls.append((method, path, kwargs))
        assert token == 'fake-unit-secret'
        if method == 'POST':
            assert kwargs['payload']['startUrls'] == [{'url': 'https://example.com/jobs'}]
            assert kwargs['params']['maxTotalChargeUsd'] == 1
            return {'data': {'id': 'run-test', 'status': 'RUNNING'}}
        if path.startswith('actor-runs'):
            return {'data': {'status': 'SUCCEEDED', 'defaultDatasetId': 'dataset-test', 'usageTotalUsd': .01}}
        return [{'title': 'Closer digital', 'companyName': 'Test', 'description': 'Buscamos experiencia en ventas para nuestro equipo. Trabajo remoto con clientes.', 'url': 'https://example.com/job', 'location': 'Spain', 'postedAt': now(), 'workMode': 'remote'}]
    monkeypatch.setattr(sources, 'apify_request', fake_request)
    body = {'name': 'Apify fixture', 'token': 'fake-unit-secret', 'actor_id': 'user/actor', 'urls': ['https://example.com/jobs']}
    value = client.post('/v1/source-connections', json=body).json()
    path = '/v1/source-connections/' + value['id']
    assert client.post(path + '/scrape').status_code == 200
    assert client.post(path + '/scrape').status_code == 409
    assert client.patch(path, json=body).status_code == 409
    check = client.post(path + '/check')
    assert check.status_code == 200, check.text
    assert check.json()['connection']['dataset_id'] == 'dataset-test'
    run = create(client, {'sources': [value['id']], 'require_spanish': True})
    asyncio.run(execute(run['id'], 'org-a', SearchQuery(**run['query'])))
    result = load_run(run['id'], 'org-a')
    assert result['status'] == 'completed' and len(result['jobs']) == 1
    assert len([c for c in calls if c[0] == 'POST']) == 1  # searching only reads existing data
    assert client.patch(path, json={**body, 'token': '', 'dataset_id': 'dataset-test'}).json()['has_token']
    assert not client.patch(path, json={**body, 'token': '', 'clear_token': True}).json()['has_token']


def test_uncertain_scrape_is_not_retried(client, monkeypatch):
    from career import sources
    async def failed(*args, **kwargs):
        raise ProviderError('timeout')
    monkeypatch.setattr(sources, 'apify_request', failed)
    value = client.post('/v1/source-connections', json={'name': 'Uncertain', 'actor_id': 'user/actor', 'token': 'fake-unit-secret'}).json()
    path = '/v1/source-connections/' + value['id']
    assert client.post(path + '/scrape').status_code == 502
    assert client.post(path + '/scrape').status_code == 409
    assert client.post(path + '/resolve', json={'reviewed_apify_console': False}).status_code == 409
    assert client.post(path + '/resolve', json={'reviewed_apify_console': True}).status_code == 200


def test_new_public_connector_contracts(client, monkeypatch):
    from career.connectors import PublicJSON, GetOnBoard
    async def fake_fetch(url, params=None, ttl=900):
        if 'getonbrd' in url:
            return json.dumps({'data': [{'id': 'closer', 'attributes': {'title': 'Closer digital', 'description': 'Buscamos experiencia en ventas para el equipo.', 'remote_modality': 'hybrid', 'countries': ['Chile'], 'published_at': 1789684387}, 'links': {'public_url': 'https://www.getonbrd.com/jobs/test'}}], 'meta': {'total_pages': 1}})
        return json.dumps({'jobs': [{'id': 1, 'title': 'Closer', 'url': 'https://remotive.com/job/1', 'description': 'Spanish', 'candidate_required_location': 'Spain', 'publication_date': now()}]})
    monkeypatch.setattr(connectors, 'fetch', fake_fetch)
    async def collect(c):
        return [row async for batch in c.batches(SearchQuery()) for row in batch]
    rows = asyncio.run(collect(GetOnBoard()))
    item = normalize('getonbrd-public', rows[0].payload)
    assert item['work_mode'] == 'hybrid' and item['company'] == 'Empresa no indicada'
    rows = asyncio.run(collect(PublicJSON('remotive', 'Remotive', 'https://remotive.com/api/remote-jobs', 'jobs')))
    assert normalize('remotive', rows[0].payload)['work_mode'] == 'remote'
