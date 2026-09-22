"""Catalog/scheduler/budget integration against SQLite and the local HTTP vendor."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

import test_integrations as fixtures

from career import collection
from career.catalog import prune
from career.connectors import Candidate, Himalayas
from career.db import connect, load_run, now
from career.models import SearchQuery
from career.pipeline import ingest
from career.worker import execute


api = fixtures.api
vendor = fixtures.vendor
prepare_connected = fixtures.prepare_connected

def search(client, source, key):
    query = SearchQuery(role='digital_sales', require_spanish=True, sources=[source])
    response = client.post('/v1/search-runs', json={'query': query.model_dump(), 'idempotency_key': key})
    assert response.status_code == 202, response.text
    run = response.json()
    asyncio.run(execute(run['id'], 'org-test', query))
    return load_run(run['id'], 'org-test')


def test_daily_http_collection_then_search_never_contacts_vendor(api, monkeypatch):
    client, state = api
    connection = prepare_connected(api)
    monkeypatch.setattr(collection, 'REGISTRY', {})
    first = client.post('/v1/collection/refresh').json()['latest']
    assert client.post('/v1/collection/refresh').json()['latest']['id'] == first['id']
    asyncio.run(collection.collect(first['id'], 'org-test'))
    summary = client.get('/v1/collection').json()
    assert summary['catalog_total'] == 1
    assert summary['latest']['status'] == 'completed'
    assert 0 < summary['reserved_eur'] <= 1
    before = len(state['calls'])
    result = search(client, connection['id'], 'catalog-search-one')
    assert len(result['jobs']) == 1
    assert result['jobs'][0]['first_seen_at'] and result['jobs'][0]['catalog_expires_at']
    search(client, connection['id'], 'catalog-search-two')
    assert len(state['calls']) == before
    # Replay after a restart: terminal source and daily reservation prevent another POST.
    asyncio.run(collection.collect(first['id'], 'org-test'))
    assert len([c for c in state['calls'] if c[0] == 'POST' and c[1].split('?')[0].endswith('/runs')]) == 1
    cap = float(next(c[1].split('maxTotalChargeUsd=')[1] for c in state['calls'] if c[0] == 'POST' and 'maxTotalChargeUsd=' in c[1]))
    assert cap <= 1.15 / 1.30


def test_expiry_hides_history_exports_and_prevents_rediscovery(api):
    client, _ = api
    candidate = Candidate('stable-job', {'guid': 'https://example.com/closer', 'title': 'Closer de ventas', 'companyName': 'Example',
                        'description': 'Buscamos closer de ventas para el equipo. Trabajo remoto en español.', 'pubDate': now()})
    assert ingest(candidate, Himalayas(), SearchQuery(), None, 'org-test')
    run = search(client, 'himalayas', 'expiry-search-before')
    job = run['jobs'][0]
    with connect() as db:
        expired = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
        first_seen = (datetime.now(timezone.utc) - timedelta(days=10, seconds=1)).isoformat()
        db.execute('UPDATE catalog_entries SET first_seen_at=?,expires_at=?', (first_seen, expired))
        raw_before = [tuple(row) for row in db.execute('SELECT * FROM raw_items')]
    assert client.get('/v1/search-runs/' + run['id']).json()['jobs'] == []
    assert client.post('/v1/exports', json={'run_id': run['id'], 'job_ids': [job['id']], 'format': 'json'}).status_code == 422
    prune('org-test')
    assert ingest(candidate, Himalayas(), SearchQuery(), None, 'org-test')
    assert search(client, 'himalayas', 'expiry-search-after')['jobs'] == []
    with connect() as db:
        assert db.execute('SELECT first_seen_at FROM catalog_entries').fetchone()[0] == first_seen
        assert [tuple(row) for row in db.execute('SELECT * FROM raw_items')] == raw_before
        assert db.execute('SELECT count(*) FROM search_results').fetchone()[0] == 0


def test_budget_atomic_global_manual_and_unknown_carry(api, monkeypatch):
    client, _ = api
    def reserve_one(code):
        try:
            with connect() as db:
                db.execute('BEGIN IMMEDIATE')
                reservation, cap = collection.reserve(db, 'org-test', code, 1, 1.30, 0)
            collection.record_launch(reservation, 'org-test', code, 'SUCCEEDED')
            return cap
        except HTTPException:
            return 0
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sum(pool.map(reserve_one, ['a', 'b'])) <= 1
    assert client.get('/v1/collection').json()['reserved_eur'] <= 1
    # An uncertain paid attempt remains blocking even after local midnight/restart.
    with connect() as db:
        db.execute("UPDATE scrape_budget SET status='UNKNOWN'")
    monkeypatch.setattr(collection, 'day_key', lambda: '2099-01-01')
    with connect() as db, pytest.raises(HTTPException):
        db.execute('BEGIN IMMEDIATE')
        collection.reserve(db, 'org-test', 'next-day', 1, 1.30, 0)


def test_pause_settings_and_org_isolation(api, monkeypatch):
    client, _ = api
    assert client.put('/v1/collection/settings', json={'enabled': False, 'daily_budget_eur': 2, 'hour': 9}).status_code == 200
    assert client.put('/v1/collection/settings', json={'daily_budget_eur': 3}).status_code == 422
    client.post('/v1/collection/refresh')
    monkeypatch.setenv('CAREER_ORG_ID', 'another-org')
    other = client.get('/v1/collection').json()
    assert other['latest'] is None and other['catalog_total'] == 0 and other['reserved_eur'] == 0
    assert other['settings']['daily_budget_eur'] == 1 and other['settings']['enabled']


def test_unverified_price_or_fx_never_launches(api, monkeypatch):
    client, state = api
    connection = prepare_connected(api)
    async def no_rate():
        raise ValueError('unavailable')
    monkeypatch.setattr(collection, 'euro_rate', no_rate)
    result = client.post('/v1/source-connections/' + connection['id'] + '/scrape')
    assert result.status_code == 422
    assert not any(c[0] == 'POST' and '/runs' in c[1] for c in state['calls'])
    assert client.get('/v1/collection').json()['reserved_eur'] == 0


def test_new_expired_version_invalidates_catalog(api):
    client, _ = api
    payload = {'guid': 'https://example.com/stable', 'title': 'Closer de ventas', 'companyName': 'Example',
               'description': 'Trabajo remoto en español. Ventas para nuestro equipo.', 'pubDate': now()}
    ingest(Candidate('stable', payload), Himalayas(), SearchQuery(), None, 'org-test')
    assert len(search(client, 'himalayas', 'version-before')['jobs']) == 1
    payload['expiryDate'] = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    assert not ingest(Candidate('stable', payload), Himalayas(), SearchQuery(), None, 'org-test')
    assert not search(client, 'himalayas', 'version-after')['jobs']


def test_collection_failure_does_not_hide_successful_source(api, monkeypatch):
    client, _ = api
    class Good:
        code, name, provider = 'himalayas', 'Fixture', 'fixture'
        async def batches(self, query):
            yield [Candidate('good', {'guid': 'https://example.com/good', 'title': 'Closer de ventas',
                                    'description': 'Ventas en español para nuestro equipo.', 'pubDate': now()})]
    class Bad(Good):
        code = 'broken'
        async def batches(self, query):
            raise ValueError('fixture failure')
            yield []
    monkeypatch.setattr(collection, 'REGISTRY', {'himalayas': Good(), 'broken': Bad()})
    run = client.post('/v1/collection/refresh').json()['latest']
    asyncio.run(collection.collect(run['id'], 'org-test'))
    result = client.get('/v1/collection').json()
    assert result['latest']['status'] == 'partial' and result['catalog_total'] == 1
    assert result['reserved_eur'] == 0


def test_same_url_across_connections_keeps_original_expiry(api):
    client, _ = api
    payload = {'guid': 'https://example.com/shared', 'title': 'Closer de ventas', 'companyName': 'Example',
               'description': 'Trabajo remoto en español. Ventas para nuestro equipo.', 'pubDate': now()}
    ingest(Candidate('original', payload), Himalayas(), SearchQuery(), None, 'org-test')
    with connect() as db:
        first_seen = (datetime.now(timezone.utc) - timedelta(days=11)).isoformat()
        expiry = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        db.execute('UPDATE catalog_entries SET first_seen_at=?,expires_at=?', (first_seen, expiry))
    class Another(Himalayas):
        code = 'another-connection'
        def normalize(self, row):
            from career.pipeline import normalize
            return normalize('himalayas', row)
    ingest(Candidate('same-url-new-id', payload), Another(), SearchQuery(), None, 'org-test')
    with connect() as db:
        assert {r[0] for r in db.execute('SELECT first_seen_at FROM catalog_entries')} == {first_seen}
    assert client.get('/v1/collection').json()['catalog_total'] == 0


def test_public_sources_still_import_when_apify_budget_is_exhausted(api, monkeypatch):
    client, state = api
    prepare_connected(api)
    class Public:
        code, name, provider = 'himalayas', 'Public API fixture', 'public'
        async def batches(self, query):
            yield [Candidate('public-budget', {'guid': 'https://example.com/public-budget', 'title': 'Closer de ventas',
                        'description': 'Buscamos ventas para nuestro equipo en español.', 'pubDate': now()})]
    monkeypatch.setattr(collection, 'REGISTRY', {'himalayas': Public()})
    with connect() as db:
        db.execute('BEGIN IMMEDIATE')
        reservation, _ = collection.reserve(db, 'org-test', 'already-spent', 1, 1.30, 0)
    collection.record_launch(reservation, 'org-test', 'earlier-run', 'SUCCEEDED')
    run = client.post('/v1/collection/refresh').json()['latest']
    asyncio.run(collection.collect(run['id'], 'org-test'))
    result = client.get('/v1/collection').json()
    assert result['catalog_total'] == 1 and result['latest']['status'] == 'partial'
    assert result['latest']['sources'][0]['accepted'] == 1
    assert 'Presupuesto' in result['latest']['sources'][1]['warning']
    assert not any(c[0] == 'POST' and '/runs' in c[1] for c in state['calls'])
