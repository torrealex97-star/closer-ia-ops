"""P01B WDCOpportunity: dominio versionado, elegibilidad separada, migración conservadora.

La copia de la BD real migra sin cambios en raw y cada job conserva posting/raw (aceptación
P01B). Sin claves de pago ni IA en este corte: todo determinista.
"""
import shutil
import sqlite3
from pathlib import Path

import pytest
import test_integrations as fixtures
from career.connectors import Candidate, Himalayas
from career.db import now
from career.models import SearchQuery
from career.pipeline import ingest

api = fixtures.api
vendor = fixtures.vendor


def add(description, title='Closer de ventas', identity='fixture', company='Empresa de prueba'):
    # https: safe_url del pipeline descarta enlaces http (decisión existente de seguridad).
    return ingest(Candidate(identity, {'guid': f'https://example.com/{identity}', 'title': title,
                  'companyName': company, 'description': description, 'pubDate': now(),
                  'locationRestrictions': ['Spain']}), Himalayas(), SearchQuery(), None, 'org-test')


def test_new_import_gets_draft_opportunity_version_1(api):
    client, _ = api
    assert add('Buscamos una closer para nuestro equipo de ventas. Trabajo remoto.') is True
    items = client.get('/v1/wdc/opportunities').json()['items']
    assert len(items) == 1
    opp = items[0]
    assert opp['editorial_status'] == 'draft'
    assert opp['opportunity_status'] == 'verifying'  # backfill conservador: nunca active automático
    assert opp['version'] == 1 and opp['current_version_id']
    payload = opp['version_payload']
    assert payload['headline'] == 'Closer de ventas'  # literal, sin LLM ni invención
    assert payload['application_type'] == 'external_platform'  # application_url observable
    assert payload['next_step']['enabled'] is False and payload['next_step']['disabled_reason']
    assert opp['connection_type'] == 'external_application'  # nunca direct_company sin evidencia
    assert opp['job_snapshot']['source_url']


def test_eligibility_backfill_is_separate_and_honest(api):
    client, _ = api
    add('Buscamos closer. Imprescindible residencia en España. Se requiere documentación para trabajar. Trabajo remoto.')
    items = client.get('/v1/wdc/opportunities').json()['items']
    eligibility = items[0]['eligibility']
    assert eligibility['residency_required'] is True
    assert eligibility['work_authorization_requirements']
    assert eligibility['employer_country'] == 'España'  # de locations literal
    assert eligibility['allowed_worker_countries'] == []  # vacío = desconocido, no worldwide
    assert eligibility['backfilled'] is True


def test_review_creates_immutable_version_and_moves_pointer(api):
    client, _ = api
    add('Buscamos una closer con experiencia consultiva. Remoto.')
    opp = client.get('/v1/wdc/opportunities').json()['items'][0]
    reviewed = client.post(f"/v1/wdc/opportunities/{opp['id']}/review", json={
        'editorial_status': 'needs_review',
        'version_payload': {**opp['version_payload'],
                            'short_summary': 'Closer remota para ventas consultivas.',
                            'compensation_summary': 'Fijo no publicado; preguntar por comisiones.'},
    })
    assert reviewed.status_code == 200
    updated = reviewed.json()
    assert updated['version'] == 2 and updated['editorial_status'] == 'needs_review'
    assert updated['version_payload']['short_summary'].startswith('Closer remota')
    # La versión 1 conserva su contenido original inmutable.
    assert opp['version_payload']['short_summary'] == ''


def test_publish_requires_application_type_and_open_opportunity(api):
    client, _ = api
    add('Buscamos una closer. Remoto.', identity='sin-canal')
    opp = client.get('/v1/wdc/opportunities').json()['items'][0]
    payload = {**opp['version_payload'], 'application_type': 'unknown'}
    blocked = client.post(f"/v1/wdc/opportunities/{opp['id']}/review",
                          json={'editorial_status': 'published', 'version_payload': payload})
    assert blocked.status_code == 422
    # Spec 17: el CTA no se habilita sin vigencia activa verificada (verifying no basta).
    cta = client.post(f"/v1/wdc/opportunities/{opp['id']}/review", json={
        'editorial_status': 'published',
        'version_payload': {**opp['version_payload'], 'application_type': 'external_platform',
                            'next_step': {**opp['version_payload']['next_step'], 'enabled': True}}})
    assert cta.status_code == 409
    ok = client.post(f"/v1/wdc/opportunities/{opp['id']}/review", json={
        'editorial_status': 'published',
        'version_payload': {**opp['version_payload'], 'application_type': 'external_platform'}})
    assert ok.status_code == 200


def test_student_view_serves_exact_dto_only_when_approved(api):
    client, _ = api
    add('Buscamos una closer. Trabajo remoto desde España.')
    opp = client.get('/v1/wdc/opportunities').json()['items'][0]
    draft = client.get(f"/v1/wdc/opportunities/{opp['id']}/student")
    assert draft.status_code == 409  # draft no genera vista de alumna
    client.post(f"/v1/wdc/opportunities/{opp['id']}/review", json={
        'editorial_status': 'published',
        'version_payload': {**opp['version_payload'], 'application_type': 'external_platform'}})
    view = client.get(f"/v1/wdc/opportunities/{opp['id']}/student").json()
    expected = {'id', 'version', 'headline', 'company_name', 'role', 'short_summary',
                'what_they_are_looking_for', 'what_you_would_do', 'compensation_summary',
                'location_summary', 'language_requirements', 'experience_summary',
                'why_it_may_be_interesting', 'published_at', 'published_relative',
                'opportunity_status', 'status_reason', 'last_verified_at', 'next_step',
                'connection_type', 'application_type', 'application_url', 'attribution'}
    assert set(view) == expected  # allowlist exacta de spec 17
    assert view['company_name'] == 'Empresa de prueba'
    assert view['published_relative']
    assert view['connection_type'] == 'external_application'
    assert not {'source', 'score', 'provider', 'cost'} & set(view)
    assert view['attribution'] and view['attribution'][0]['source'] == 'himalayas'  # código canónico


def test_review_names_unknown_fields_and_list_reports_filtered_total(api):
    """UI de revisión: el formulario nunca debe recibir un 422 anónimo, y el total
    del listado cuenta el filtro completo, no solo la página devuelta."""
    client, _ = api
    add('Buscamos una closer con encaje claro. Remoto.', identity='ui-total-1')
    add('Otra closer para cubrir el total filtrado.', identity='ui-total-2')
    items = client.get('/v1/wdc/opportunities').json()['items']
    assert len(items) == 2 and items[0]['version_payload']['headline']
    total_all = client.get('/v1/wdc/opportunities').json()['total']
    total_draft = client.get('/v1/wdc/opportunities', params={'editorial_status': 'draft'}).json()['total']
    assert total_all == total_draft == 2
    # Un campo inventado por el formulario se nombra exactamente, sin rutas anónimas.
    named = client.post(f"/v1/wdc/opportunities/{items[0]['id']}/review", json={
        'editorial_status': 'needs_review',
        'version_payload': {**items[0]['version_payload'], 'titulo_inventado': 'x'}})
    assert named.status_code == 422
    assert 'titulo_inventado' in named.json()['detail']


def test_opportunity_status_flows_from_verification_not_classification(api):
    client, _ = api
    add('Buscamos una closer. Remoto.', identity='verificar')
    opp = client.get('/v1/wdc/opportunities').json()['items'][0]
    assert opp['opportunity_status'] == 'verifying'


def test_opportunities_are_scoped_by_organization(api):
    client, _ = api
    add('Buscamos una closer. Remoto.', identity='mio')
    ingest(Candidate('ajena', {'guid': 'https://example.com/ajena', 'title': 'Setter remoto',
                   'companyName': 'Otra empresa', 'description': 'Buscamos setter. Remoto.',
                   'pubDate': now(), 'locationRestrictions': ['Spain']}),
           Himalayas(), SearchQuery(), None, 'other-org')
    items = client.get('/v1/wdc/opportunities').json()['items']
    assert [i['job_snapshot']['title'] for i in items] == ['Closer de ventas']
    import os
    con = sqlite3.connect(os.environ['CAREER_DB'])
    foreign_id = con.execute("SELECT id FROM opportunities WHERE org_id='other-org'").fetchone()[0]
    con.close()
    assert client.get(f'/v1/wdc/opportunities/{foreign_id}').status_code == 404


def test_migration_on_real_db_copy_preserves_raw_and_links_postings(tmp_path):
    """Aceptación P01B: migrar copia de la BD real; raw intacto; todo job conserva posting/raw."""
    real = Path('.local/career.sqlite3')
    if not real.exists():
        pytest.skip('BD real local no disponible en este entorno')
    copy = tmp_path / 'copy.sqlite3'
    shutil.copy(real, copy)
    con = sqlite3.connect(copy)
    raw_before = con.execute('SELECT count(*) FROM raw_items').fetchone()[0]
    postings_before = con.execute('SELECT count(*) FROM job_postings').fetchone()[0]
    jobs_before = con.execute('SELECT count(*) FROM jobs').fetchone()[0]
    con.close()
    from career.migrations import migrate
    con = sqlite3.connect(copy)
    con.execute('PRAGMA foreign_keys=ON')
    migrate(con)
    con.commit()
    assert con.execute('SELECT count(*) FROM raw_items').fetchone()[0] == raw_before
    assert con.execute('SELECT count(*) FROM job_postings').fetchone()[0] == postings_before
    assert con.execute('SELECT count(*) FROM opportunities').fetchone()[0] == jobs_before
    assert con.execute('''SELECT count(*) FROM jobs j LEFT JOIN job_postings p
        ON p.org_id=j.org_id AND p.id=j.posting_id WHERE p.id IS NULL''').fetchone()[0] == 0
    assert con.execute('''SELECT count(*) FROM opportunity_versions v
        JOIN opportunities o ON o.org_id=v.org_id AND o.id=v.opportunity_id
        WHERE v.version=1''').fetchone()[0] == jobs_before
    con.close()
