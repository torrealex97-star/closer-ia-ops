"""Real HTTP contract server + real SQLite + application API/worker, no vendor calls."""
import asyncio
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest
from fastapi.testclient import TestClient

from career import ai, integrations, sources, connectors, llm, collection
from career.db import connect, initialize, load_run, now
from career.main import app
from career.models import SearchQuery
from career.worker import execute


@pytest.fixture
def vendor():
    state = {'calls': [], 'mode': 'ok', 'input': None}
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def handle_request(self):
            body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
            body = json.loads(body) if body else None
            state['calls'].append((self.command, self.path, self.headers.get('Authorization'), body))
            status = 200
            path = self.path.split('?')[0]
            if path.endswith('/users/me'):
                status = 401 if state['mode'] == 'unauthorized' else 200
                result = {'data': {'id': 'fixture-user'}}
            elif path.endswith('/store'):
                result = {'data': {'items': [{'username': 'haketa', 'name': 'infojobs-scraper'}]}}
            elif path.endswith('/builds/default'):
                result = {'data': {'status': 'SUCCEEDED', 'buildNumber': '0.1.1', 'inputSchema': {'type': 'object', 'properties': {'startUrls': {'type': 'array', 'editor': 'requestListSources'}, 'keywords': {'type': 'array'}, 'maxItems': {'type': 'integer'}, 'onlyTeleworking': {'type': 'boolean'}}}}}
            elif '/acts/' in path and not path.endswith('/runs'):
                result = {'data': {'title': 'Fixture InfoJobs', 'pricingInfos': [{'startedAt': '2025-01-01', 'pricingModel': 'PAY_PER_EVENT'}]}}
            elif path.endswith('/runs') and self.command == 'POST':
                state['input'] = body
                result = {'data': {'id': 'fixture-run', 'status': 'RUNNING'}}
            elif '/actor-runs/' in path:
                result = {'data': {'id': 'fixture-run', 'status': 'SUCCEEDED', 'defaultDatasetId': 'fixture-data', 'usageTotalUsd': .03}}
            elif '/datasets/' in path:
                result = {'unexpected': True} if state['mode'] == 'malformed' else [{'title': 'Closer de ventas', 'company': 'Fixture Company', 'description': 'Buscamos experiencia en ventas para nuestro equipo. Trabajo remoto. Comisiones publicadas.', 'url': 'https://example.com/jobs/closer', 'city': 'Madrid', 'publishedAt': now(), 'teleworking': 'Teletrabajo'}]
            elif '/models/' in path:
                status = 401 if state['mode'] == 'unauthorized' else 200
                result = {'id': path.split('/models/', 1)[1]}
            elif path.endswith('/responses') or path.endswith('/chat/completions'):
                output = {'summary': 'Oferta de cierre comercial remoto.', 'fit': 'alineada', 'confidence': 'media', 'requirements': ['Experiencia en ventas'], 'questions': ['Confirmar fijo y comisiones'], 'evidence': 'Trabajo remoto.'}
                if state['mode'] == 'hallucinated':
                    output['evidence'] = 'Salario garantizado 100.000 EUR'
                result = {'id': 'response-fixture', 'status': 'completed', 'usage': {'input_tokens': 400, 'output_tokens': 90}, 'output': [{'content': [{'type': 'output_text', 'text': json.dumps(output)}]}]}
                if path.endswith('/chat/completions'):
                    result = {'id': 'groq-fixture', 'usage': {'prompt_tokens': 400, 'completion_tokens': 90}, 'choices': [{'finish_reason': 'length' if state['mode'] == 'truncated' else 'stop', 'message': {'content': json.dumps(output)}}]}
                if state['mode'] == 'rate_limit':
                    status, result = 429, {'error': {'message': 'Do not echo provider errors containing secrets'}}
            else:
                status, result = 404, {}
            data = json.dumps(result).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        do_GET = handle_request
        do_POST = handle_request
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f'http://127.0.0.1:{server.server_port}/v2/', state
    server.shutdown()
    server.server_close()
    thread.join()


@pytest.fixture
def api(tmp_path, monkeypatch, vendor):
    base, state = vendor
    monkeypatch.setenv('CAREER_DB', str(tmp_path / 'integration.sqlite3'))
    monkeypatch.setenv('CAREER_LOCAL_TOKEN', 'local-fixture-token')
    monkeypatch.setenv('CAREER_ORG_ID', 'org-test')
    monkeypatch.setattr(sources, 'APIFY_BASE', base)
    monkeypatch.setattr(llm, 'OPENAI_BASE', base)
    monkeypatch.setattr(llm, 'GROQ_BASE', base)
    async def rate():
        return 1.15
    monkeypatch.setattr(collection, 'euro_rate', rate)
    original_fetch = connectors.fetch
    async def local_metadata(path, params=None):
        # Uses the real bounded HTTP fetcher and SQLite metadata cache.
        return json.loads(await original_fetch(base + path, params, ttl=21600))['data']
    monkeypatch.setattr(integrations, 'public_metadata', local_metadata)
    with TestClient(app, headers={'Authorization': 'Bearer local-fixture-token'}) as client:
        yield client, state


def prepare_connected(api):
    client, state = api
    response = client.post('/v1/integrations/apify', json={'token': 'fake-apify-secret'})
    assert response.status_code == 200 and 'fake-apify-secret' not in response.text
    assert client.post('/v1/integrations/apify/check').status_code == 200
    prepared = client.post('/v1/source-assistant/prepare', json={'source': 'infojobs', 'urls': ['https://www.infojobs.net/ofertas-trabajo/closer']})
    assert prepared.status_code == 200, prepared.text
    plan = prepared.json()
    connection = client.post('/v1/source-assistant/connect', json={'plan_id': plan['id']}).json()
    assert client.post('/v1/source-assistant/connect', json={'plan_id': plan['id']}).json()['id'] == connection['id']
    assert len(client.get('/v1/source-connections').json()) == 1
    return connection


def imported_job(api):
    client, state = api
    connection = prepare_connected(api)
    path = '/v1/source-connections/' + connection['id']
    assert client.post(path + '/scrape').status_code == 200
    check = client.post(path + '/check')
    assert check.status_code == 200, check.text
    query = {'role': 'digital_sales', 'require_spanish': True, 'sources': [connection['id']]}
    run = client.post('/v1/search-runs', json={'query': query, 'idempotency_key': 'integration-full-flow'}).json()
    asyncio.run(execute(run['id'], 'org-test', SearchQuery(**query), sources.registry('org-test')))
    result = load_run(run['id'], 'org-test')
    assert result['status'] == 'completed' and len(result['jobs']) == 1
    return run['id'], result['jobs'][0]['id'], connection


def test_guided_flow_real_http_queue_database_and_reuse(api):
    client, state = api
    run_id, job_id, connection = imported_job(api)
    assert state['input']['onlyTeleworking'] is True
    assert state['input']['maxItems'] == 25
    posts = [c for c in state['calls'] if c[0] == 'POST' and '/runs?' in c[1]]
    assert len(posts) == 1
    assert 'build=0.1.1' in posts[0][1] and posts[0][2] == 'Bearer fake-apify-secret'
    response = client.post('/v1/source-connections/' + connection['id'] + '/scrape')
    assert 'Reutilizamos' in response.json()['message']
    assert len([c for c in state['calls'] if c[0] == 'POST' and '/runs?' in c[1]]) == 1
    with connect() as db:
        assert db.execute('SELECT count(*) FROM raw_items').fetchone()[0] == 1
        assert db.execute('SELECT count(*) FROM source_connections').fetchone()[0] == 1
        assert db.execute('SELECT max(version) FROM schema_version').fetchone()[0] == 10
    initialize()  # migration repeat preserves data
    assert client.get('/v1/search-runs/' + run_id).json()['jobs'][0]['id'] == job_id


def test_missing_credentials_and_provider_errors_are_actionable(api):
    client, state = api
    assert client.post('/v1/integrations/apify/check').status_code == 422
    assert client.post('/v1/integrations/ai/check').status_code == 422
    client.post('/v1/integrations/apify', json={'token': 'bad-fixture-key'})
    state['mode'] = 'unauthorized'
    response = client.post('/v1/integrations/apify/check')
    assert response.status_code == 422 and '401' in response.text and 'bad-fixture-key' not in response.text
    assert client.post('/v1/source-assistant/prepare', json={'urls': ['https://127.0.0.1/private']}).status_code == 422


def test_dataset_edit_cannot_restore_previous_dataset_and_bad_contract_is_422(api):
    client, state = api
    _, _, c = imported_job(api)
    body = {k: v for k, v in c.items() if k not in ['id', 'has_token']}
    body['dataset_id'] = 'replacement-data'
    response = client.patch('/v1/source-connections/' + c['id'], json=body)
    assert response.status_code == 200 and not response.json().get('run_id')
    state['mode'] = 'malformed'
    assert client.post('/v1/source-connections/' + c['id'] + '/check').status_code == 422
    assert 'fixture-data' not in client.get('/v1/source-connections').text


def test_ai_real_http_persistence_cache_budget_and_isolation(api, monkeypatch):
    client, state = api
    run_id, job_id, _ = imported_job(api)
    assert client.post('/v1/integrations/ai', json={'provider': 'openai', 'model': 'gpt-4.1-mini', 'enabled': True, 'token': 'fake-ai-secret', 'daily_limit': 1}).status_code == 200
    assert client.post('/v1/integrations/ai/check').status_code == 200
    body = {'run_id': run_id, 'job_id': job_id}
    first = client.post('/v1/ai/analyses', json=body)
    assert first.status_code == 202, first.text
    assert client.post('/v1/ai/analyses', json=body).json()['id'] == first.json()['id']
    assert asyncio.run(ai.process_one())
    result = client.get('/v1/ai/analyses/' + first.json()['id']).json()
    assert result['status'] == 'completed' and result['usage']['output_tokens'] == 90
    assert 'fake-ai-secret' not in json.dumps(result)
    assert client.get('/v1/ai/jobs/' + job_id).json()['id'] == first.json()['id']
    assert client.post('/v1/ai/analyses', json=body).json()['status'] == 'completed'
    posts = [c for c in state['calls'] if c[0] == 'POST' and c[1].endswith('/responses')]
    assert len(posts) == 1 and posts[0][2] == 'Bearer fake-ai-secret'
    assert posts[0][3]['store'] is False and posts[0][3]['max_output_tokens'] == 600
    assert len(posts[0][3]['input']) <= 6000
    client.post('/v1/integrations/ai', json={'provider': 'openai', 'model': 'gpt-4o-mini', 'enabled': True, 'daily_limit': 1})
    assert client.post('/v1/ai/analyses', json=body).status_code == 429
    monkeypatch.setenv('CAREER_ORG_ID', 'other-org')
    assert client.get('/v1/ai/analyses/' + result['id']).status_code == 404
    assert client.get('/v1/ai/analyses').json() == []
    assert not client.get('/v1/integrations/ai').json()['has_token']
    assert client.post('/v1/ai/analyses', json=body).status_code == 404


@pytest.mark.parametrize('failure', ['hallucinated', 'rate_limit'])
def test_ai_rejects_unbacked_output_and_never_retries_paid_call(api, failure):
    client, state = api
    run_id, job_id, _ = imported_job(api)
    client.post('/v1/integrations/ai', json={'provider': 'openai', 'model': 'gpt-4.1-mini', 'enabled': True, 'token': 'fake-ai-secret'})
    body = {'run_id': run_id, 'job_id': job_id}
    record = client.post('/v1/ai/analyses', json=body).json()
    state['mode'] = failure
    asyncio.run(ai.process_one())
    result = client.get('/v1/ai/analyses/' + record['id']).json()
    assert result['status'] == 'failed' and not result['result']
    client.post('/v1/ai/analyses', json=body)
    assert not asyncio.run(ai.process_one())
    assert len([c for c in state['calls'] if c[0] == 'POST' and c[1].endswith('/responses')]) == 1
    if failure == 'hallucinated':
        with connect() as db:
            payload = json.loads(db.execute('SELECT payload FROM ai_generations').fetchone()[0])
            assert payload['raw_output'] and payload['usage']['output_tokens'] == 90


def test_groq_default_real_http_and_provider_secrets_are_isolated(api):
    client, state = api
    assert client.get('/v1/integrations/ai').json()['provider'] == 'groq'
    run_id, job_id, _ = imported_job(api)
    client.post('/v1/integrations/ai', json={'provider': 'openai', 'model': 'gpt-4.1-mini', 'token': 'openai-only-secret', 'enabled': True})
    assert not client.get('/v1/integrations/ai?provider=groq').json()['has_token']
    invalid = client.post('/v1/integrations/ai', json={'provider': 'groq', 'model': 'gpt-4.1-mini', 'token': 'never-echo-secret'})
    assert invalid.status_code == 422 and 'never-echo-secret' not in invalid.text
    config = client.post('/v1/integrations/ai', json={'token': 'groq-only-secret', 'enabled': True})
    assert config.status_code == 200 and config.json()['provider'] == 'groq'
    assert 'groq-only-secret' not in config.text
    assert client.post('/v1/integrations/ai/check').status_code == 200
    body = {'run_id': run_id, 'job_id': job_id}
    record = client.post('/v1/ai/analyses', json=body).json()
    assert asyncio.run(ai.process_one())
    result = client.get('/v1/ai/analyses/' + record['id']).json()
    assert result['provider'] == 'groq' and result['status'] == 'completed'
    assert result['usage']['output_tokens'] == 90 and result['latency_ms'] >= 0
    calls = [c for c in state['calls'] if c[1].endswith('/chat/completions')]
    assert len(calls) == 1 and calls[0][2] == 'Bearer groq-only-secret'
    assert calls[0][3]['response_format']['json_schema']['strict'] is True
    assert calls[0][3]['max_completion_tokens'] == 900
    assert client.post('/v1/ai/analyses', json=body).json()['id'] == record['id']
    client.post('/v1/integrations/ai', json={'provider': 'openai', 'model': 'gpt-4.1-mini', 'enabled': True})
    other = client.post('/v1/ai/analyses', json=body).json()
    assert other['id'] != record['id']
    assert asyncio.run(ai.process_one())
    assert [c for c in state['calls'] if c[1].endswith('/responses')][-1][2] == 'Bearer openai-only-secret'
    client.post('/v1/integrations/ai', json={'provider': 'groq', 'clear_token': True})
    assert client.get('/v1/integrations/ai?provider=openai').json()['has_token']
    assert not client.get('/v1/integrations/ai').json()['has_token']


@pytest.mark.parametrize('failure', ['truncated', 'hallucinated', 'rate_limit'])
def test_groq_failure_is_persisted_without_retry(api, failure):
    client, state = api
    run_id, job_id, _ = imported_job(api)
    client.post('/v1/integrations/ai', json={'token': 'groq-fixture', 'enabled': True})
    record = client.post('/v1/ai/analyses', json={'run_id': run_id, 'job_id': job_id}).json()
    state['mode'] = failure
    assert asyncio.run(ai.process_one())
    result = client.get('/v1/ai/analyses/' + record['id']).json()
    assert result['status'] == 'failed' and result['result'] is None
    assert result['error_code'] == ('rate_limited' if failure == 'rate_limit' else 'invalid_output')
    assert not asyncio.run(ai.process_one())
    assert len([c for c in state['calls'] if c[1].endswith('/chat/completions')]) == 1


def test_migration_backfills_legacy_provider_without_rewriting_raw(api):
    client, _ = api
    run_id, job_id, _ = imported_job(api)
    client.post('/v1/integrations/ai', json={'provider': 'openai', 'model': 'gpt-4.1-mini', 'enabled': True, 'token': 'legacy-secret'})
    record = client.post('/v1/ai/analyses', json={'run_id': run_id, 'job_id': job_id}).json()
    with connect() as db:
        db.execute("UPDATE ai_generations SET payload=json_remove(payload, '$.provider')")
        db.execute('DELETE FROM schema_version WHERE version=3')
        raws = [tuple(row) for row in db.execute('SELECT * FROM raw_items')]
    initialize()
    initialize()
    assert client.get('/v1/ai/analyses/' + record['id']).json()['provider'] == 'openai'
    with connect() as db:
        assert [tuple(row) for row in db.execute('SELECT * FROM raw_items')] == raws
