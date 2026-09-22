import pytest
import test_integrations as fixtures
from career.connectors import Candidate, Himalayas
from career.db import now
from career.models import SearchQuery
from career.pipeline import ingest
from career.presentation import language_evidence

api = fixtures.api
vendor = fixtures.vendor


def add(description, title='Closer de ventas', identity='fixture'):
    return ingest(Candidate(identity, {'guid': f'https://example.com/{identity}', 'title': title,
                  'companyName': 'Empresa de prueba', 'description': description, 'pubDate': now(),
                  'locationRestrictions': ['Spain']}), Himalayas(), SearchQuery(), None, 'org-test')


@pytest.mark.parametrize('text', [
    'English only. Spanish is a bonus. We are hiring an appointment setter.',
    'The selected candidate will be speaking strictly in English during their whole shift. Secondary Spanish fluency.',
    'English remains the primary working language. Spanish preferred.',
    'Experiência com clientes e requisitos. Trabalho remoto. Procuramos vendas.',
])
def test_english_only_and_optional_spanish_are_not_eligible(text):
    assert not language_evidence(text)['eligible']


def test_student_defaults_spanish_and_bilingual_requires_opt_in(api):
    client, _ = api
    add('Buscamos una closer para nuestro equipo de ventas. Trabajo remoto. Salario base de 600 USD + comisiones. Jornada: tiempo completo.')
    add('We are hiring an experienced closer. Fluency in English and Spanish is required. Work from home.', identity='bilingual')
    add('We are hiring a closer. Strictly in English during the whole shift. Secondary Spanish fluency.', identity='english-only')
    result = client.post('/v1/opportunities/search', json={}).json()
    assert result['total'] == 1
    offer = result['items'][0]
    assert '600 USD' in offer['compensation'] and 'mes' not in offer['compensation']
    assert 'variable' in offer['compensation_note']
    assert offer['language'] == 'Anuncio en español'
    assert not {'raw_id', 'provider', 'score', 'cost', 'actor_id'} & set(offer)
    expanded = client.post('/v1/opportunities/search', json={'include_bilingual': True}).json()
    assert expanded['total'] == 2
    assert any(o['language'] == 'Español e inglés requeridos' for o in expanded['items'])


def test_three_roles_and_closing_evidence_for_commercial(api):
    client, _ = api
    text = 'Buscamos una profesional para nuestro equipo de ventas. Trabajo remoto. Tu misión es cerrar su inscripción.'
    add(text, 'Asesor comercial educativo', 'closer')
    add('Buscamos una setter para nuestro equipo de ventas. Trabajo remoto.', 'Appointment Setter', 'setter')
    add('Buscamos una profesional de llamadas en frío para nuestro equipo de ventas. Trabajo remoto.', 'Cold Caller', 'caller')
    for role in ['closer', 'setter', 'cold_caller']:
        result = client.post('/v1/opportunities/search', json={'role': role}).json()
        assert result['total'] == 1 and result['items'][0]['role'] == role
    assert client.post('/v1/opportunities/search', json={'role': 'sales'}).status_code == 422


def test_student_bookmarks_and_org_scope(api, monkeypatch):
    client, _ = api
    add('Buscamos una closer para nuestro equipo de ventas. Trabajo remoto.')
    offer = client.post('/v1/opportunities/search', json={}).json()['items'][0]
    assert offer['compensation'] == 'Importe no publicado'
    assert client.post('/v1/opportunities/search', json={'starred_only': True}).json()['total'] == 0
    assert client.patch('/v1/jobs/' + offer['id'] + '/star', json={'starred': True}).status_code == 200
    assert client.post('/v1/opportunities/search', json={'starred_only': True}).json()['total'] == 1
    monkeypatch.setenv('CAREER_ORG_ID', 'another-org')
    assert client.post('/v1/opportunities/search', json={}).json()['total'] == 0


def test_all_sources_and_profiles_spain_priority_and_location_filter(api):
    from career.pipeline import normalize
    client, _ = api
    text = 'Buscamos una profesional para nuestro equipo de ventas. Trabajo remoto.'
    for identity, country, title, code in [
        ('mexico', 'Mexico', 'Closer de ventas', 'himalayas'),
        ('spain', 'Spain', 'Closer de ventas', 'apify-fixture'),
        ('setter', 'Spain', 'Appointment Setter', 'himalayas'),
        ('europe', 'Europa', 'Cold Caller', 'himalayas'),
    ]:
        class Source:
            name, provider = 'Fuente de prueba', 'fixture'
            def normalize(self, row):
                return normalize('himalayas', row)
        source = Source()
        source.code = code
        assert ingest(Candidate(identity, {'guid': f'https://example.com/{identity}',
            'title': title, 'companyName': identity, 'description': text,
            'pubDate': now(), 'locationRestrictions': [country]}), source,
            SearchQuery(), None, 'org-test')
    all_offers = client.post('/v1/opportunities/search', json={}).json()['items']
    assert len(all_offers) == 4
    assert {o['company'] for o in all_offers[:2]} == {'spain', 'setter'}
    spanish = client.post('/v1/opportunities/search', json={'market': 'ES'}).json()['items']
    assert {o['company'] for o in spanish} == {'spain', 'setter', 'europe'}
    assert {o['role'] for o in spanish} == {'closer', 'setter', 'cold_caller'}


def test_spain_queries_first_and_duplicate_page_does_not_stop_pagination(monkeypatch):
    import asyncio
    import json
    calls = []
    async def fetch(url, params):
        calls.append(params.copy())
        # Page one/two overlap across queries; page three still adds a new listing.
        identity = 'third' if params['page'] == 3 else 'shared'
        return json.dumps({'jobs': [{'guid': 'https://example.com/' + identity}]})
    monkeypatch.setattr('career.connectors.fetch', fetch)
    async def collect():
        return [candidate.external_id async for batch in Himalayas().batches(SearchQuery(role='digital_sales')) for candidate in batch]
    assert set(asyncio.run(collect())) == {'https://example.com/shared', 'https://example.com/third'}
    assert calls[0]['country'] == 'ES'
    assert any(c['page'] == 3 and 'country' not in c for c in calls)
