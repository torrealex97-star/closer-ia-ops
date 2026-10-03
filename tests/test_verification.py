"""P01B verificación real de vigencia: verification_events con TTL por tipo de fuente.

HTTP 200 solo no basta: el cuerpo debe corroborar el anuncio (título o empresa).
Sin llamadas externas: la comprobación HTTP va contra el servidor fixture local.
"""
import json
import sqlite3
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

import test_integrations as fixtures
from career.connectors import Candidate, Himalayas
from career.db import now
from career.models import SearchQuery
from career.pipeline import ingest

api = fixtures.api
vendor = fixtures.vendor  # re-exportado: pytest resuelve fixtures en este namespace


def add(description, title='Closer de ventas', identity='fixture', company='Empresa de prueba'):
    return ingest(Candidate(identity, {'guid': f'https://example.com/{identity}', 'title': title,
                                       'companyName': company, 'description': description,
                                       'pubDate': now(), 'locationRestrictions': ['Spain']}),
                  Himalayas(), SearchQuery(), None, 'org-test')


@pytest.fixture
def job_server():
    """Mini servidor HTTP local con tres páginas reales para verificar contra él."""
    state = {'requests': []}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            state['requests'].append(self.path)
            pages = {
                '/viva': (200, '<html><title>Closer de ventas en Empresa de prueba</title>'
                                '<body><h1>Closer de ventas</h1><p>empresa de prueba busca closer</p></body></html>'),
                '/muerta': (404, '<html><body>not found</body></html>'),
                '/fantasma': (200, '<html><body>Esta página ya no existe. Visita nuestra home.</body></html>'),
            }
            status, body = pages.get(self.path, (404, 'not found'))
            data = body.encode()
            self.send_response(status)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f'http://127.0.0.1:{server.server_port}', state
    server.shutdown()
    server.server_close()
    thread.join()


def _verify(client, opp_id, url):
    return client.post(f'/v1/wdc/opportunities/{opp_id}/verify', json={'url': url})


def test_open_verification_writes_event_with_ttl_by_source_and_enables_cta(api, job_server):
    client, _ = api
    base, state = job_server
    add('Buscamos una closer. Remoto.')
    opp = client.get('/v1/wdc/opportunities').json()['items'][0]
    outcome = _verify(client, opp['id'], base + '/viva')
    assert outcome.status_code == 200, outcome.text
    data = outcome.json()
    assert data['result'] == 'open' and data['reason_code'] == 'content_matches'
    assert data['opportunity_status'] == 'active' and data['next_step_enabled'] is True
    assert data['evidence_raw_id'] and data['valid_until']

    with sqlite3.connect(__import__('os').environ['CAREER_DB']) as con:  # noqa: SIM115 contexto manual
        con.row_factory = sqlite3.Row
        event = con.execute('SELECT * FROM verification_events ORDER BY checked_at DESC LIMIT 1').fetchone()
        assert event['result'] == 'open' and event['method'] == 'http_status_content_v1'
        assert event['valid_until'] == data['valid_until']
        raw = con.execute('SELECT * FROM raw_items WHERE id=?', (event['evidence_raw_id'],)).fetchone()
        assert raw and raw['source'] == 'verification'  # evidencia raw inmutable
        assert con.execute('SELECT count(*) FROM verification_events').fetchone()[0] == 1

    # TTL por tipo de fuente: himalayas es agregador → 48 h.
    from career.domain import ttl_hours_for_source
    assert ttl_hours_for_source('himalayas') == 48  # noqa: F401 (uso documental del mapeo)
    assert ttl_hours_for_source('ats-greenhouse-acme') == 72
    assert ttl_hours_for_source('google') == 24
    assert ttl_hours_for_source('fuente-rara') == 24  # desconocida = conservador

    # CTA derivado: la versión vigente queda con next_step.enabled=True tras active.
    refreshed = client.get(f"/v1/wdc/opportunities/{opp['id']}").json()
    assert refreshed['version_payload']['next_step']['enabled'] is True
    assert refreshed['opportunity_status'] == 'active'
    assert len(state['requests']) == 1  # una sola petición: acotada, sin reintentos


def test_verify_open_then_publish_passes_cta_guard(api, job_server):
    client, _ = api
    base, _ = job_server
    add('Buscamos una closer. Remoto.', identity='pub-verify')
    opp = client.get('/v1/wdc/opportunities').json()['items'][0]
    assert _verify(client, opp['id'], base + '/viva').json()['opportunity_status'] == 'active'
    published = client.post(f"/v1/wdc/opportunities/{opp['id']}/review", json={
        'editorial_status': 'published',
        'version_payload': {**opp['version_payload'], 'application_type': 'external_platform',
                            'next_step': {**opp['version_payload']['next_step'], 'enabled': True}}})
    assert published.status_code == 200, published.text


def test_http_200_without_corroborating_content_is_unknown_not_open(api, job_server):
    client, _ = api
    base, _ = job_server
    add('Buscamos una closer. Remoto.', identity='fantasma')
    opp = client.get('/v1/wdc/opportunities').json()['items'][0]
    outcome = _verify(client, opp['id'], base + '/fantasma')
    data = outcome.json()
    assert data['result'] == 'unknown' and data['reason_code'] == 'content_not_corroborated'
    assert data['opportunity_status'] == 'verifying'
    assert data['next_step_enabled'] is False
    with sqlite3.connect(__import__('os').environ['CAREER_DB']) as con:
        con.row_factory = sqlite3.Row
        event = con.execute('SELECT result, reason_code, valid_until FROM verification_events '
                            'ORDER BY checked_at DESC LIMIT 1').fetchone()
    assert event['result'] == 'unknown' and event['reason_code'] == 'content_not_corroborated'
    assert event['valid_until'] is None  # unknown no fabrica vigencia


def test_closed_verification_blocks_publish_with_explicit_evidence(api, job_server):
    client, _ = api
    base, _ = job_server
    add('Buscamos una closer. Remoto.', identity='cerrada')
    opp = client.get('/v1/wdc/opportunities').json()['items'][0]
    data = _verify(client, opp['id'], base + '/muerta').json()
    assert data['result'] == 'closed' and data['reason_code'] == 'job_not_found'
    assert data['opportunity_status'] == 'closed'
    blocked = client.post(f"/v1/wdc/opportunities/{opp['id']}/review", json={
        'editorial_status': 'published',
        'version_payload': {**opp['version_payload'], 'application_type': 'external_platform',
                            'next_step': {**opp['version_payload']['next_step'], 'enabled': True}}})
    assert blocked.status_code == 409  # no se publica una oportunidad cerrada


def test_network_failure_is_unknown_never_active(api, job_server, monkeypatch):
    client, _ = api
    base, _ = job_server
    add('Buscamos una closer. Remoto.', identity='red')
    opp = client.get('/v1/wdc/opportunities').json()['items'][0]
    import career.domain as domain
    def dead_get(*args, **kwargs):
        raise ConnectionError('sin red')
    monkeypatch.setattr(domain.httpx, 'get', dead_get)
    data = _verify(client, opp['id'], base + '/viva').json()
    assert data['result'] == 'unknown' and data['reason_code'] == 'network_unreachable'
    assert data['opportunity_status'] == 'verifying'


def test_verify_without_url_is_409_not_invented(api):
    """Una oportunidad sin ninguna URL (ni candidatura ni anuncio) no se verifica:
    409 explícito en vez de inventar un objetivo de comprobación."""
    client, _ = api
    from career.db import connect, now, uid
    from career.domain import backfill_opportunity
    with connect() as db:
        payload = json.dumps({'title': 'Closer sin enlace', 'company': 'Empresa de prueba',
                              'description': 'Buscamos closer.', 'source_url': '',
                              'application_url': '', 'locations': []})
        raw_id, posting_id, job_id = uid(), uid(), uid()
        db.execute("INSERT INTO raw_items VALUES(?,?,?,?,?,?,?,?)",
                   (raw_id, 'org-test', 'manual', 'manual_v1', 'sin-url', 'hash-sin-url', payload, now()))
        db.execute("INSERT INTO job_postings VALUES(?,?,?,?,?,?)",
                   (posting_id, 'org-test', raw_id, 'manual', 'sin-url', payload))
        db.execute("INSERT INTO jobs VALUES(?,?,?,0)", (job_id, 'org-test', posting_id))
        backfill_opportunity(db, 'org-test', job_id, json.loads(payload))
    opp = client.get('/v1/wdc/opportunities').json()['items'][0]
    response = client.post(f"/v1/wdc/opportunities/{opp['id']}/verify", json={})
    assert response.status_code == 409
    assert 'URL' in response.json()['detail']


def test_aggregator_ttl_is_48_hours_in_event(api, job_server):
    """El TTL queda plasmado en el evento: himalayas es agregador → vigencia 48 h."""
    client, _ = api
    ingest(Candidate('ttl-agregador', {'guid': 'https://example.com/desc', 'title': 'Closer de ventas',
                                       'companyName': 'Empresa de prueba',
                                       'description': 'Buscamos closer. Remoto.', 'pubDate': now(),
                                       'locationRestrictions': ['Spain']}),
           Himalayas(), SearchQuery(), None, 'org-test')
    opp = client.get('/v1/wdc/opportunities').json()['items'][0]
    data = _verify(client, opp['id'], job_server[0] + '/viva').json()
    from datetime import datetime, timezone
    remaining = datetime.fromisoformat(data['valid_until']) - datetime.now(timezone.utc)
    assert 47.9 <= remaining.total_seconds() / 3600 <= 48.01
