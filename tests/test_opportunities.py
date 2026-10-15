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


def test_extra_roles_hidden_by_default_and_selectable_explicitly(api):
    """AE/SDR no salen en la vista general sin opt-in, pero elegirlos en el
    desplegable es el opt-in: no puede devolver 0 habiendo ofertas del rol."""
    client, _ = api
    text = 'Buscamos una profesional para nuestro equipo de ventas. Trabajo remoto. Tu misión es cerrar su inscripción.'
    add(text, 'Account Executive SaaS', identity='ae-direct')
    assert client.post('/v1/opportunities/search', json={}).json()['total'] == 0
    assert client.post('/v1/opportunities/search', json={'include_extra_roles': True, 'include_bilingual': True}).json()['total'] == 1
    chosen = client.post('/v1/opportunities/search', json={'role': 'account_executive', 'include_bilingual': True}).json()
    assert chosen['total'] == 1 and chosen['items'][0]['role'] == 'account_executive'
    assert chosen['selection_total'] == 0  # fuera del top de excelencia WDC


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


def test_explicitly_closed_offer_is_removed_without_deleting_evidence(api):
    from career.db import connect
    client, _ = api
    text = 'Buscamos una closer para nuestro equipo de ventas. Trabajo remoto.'
    assert add(text, identity='closing-status')
    assert client.post('/v1/opportunities/search', json={}).json()['total'] == 1
    assert not add(text + '\nEstado: Vacante cubierta.', identity='closing-status')
    assert client.post('/v1/opportunities/search', json={}).json()['total'] == 0
    with connect() as db:
        assert db.execute('SELECT count(*) FROM raw_items').fetchone()[0] == 2


@pytest.mark.parametrize('status', ['Vacante cerrada.', 'Proceso de selección cerrado.',
                                   'This position has been filled.', 'Applications are closed.'])
def test_closed_status_markers_are_not_opportunities(api, status):
    assert not add('Buscamos una closer para nuestro equipo de ventas. Trabajo remoto.\n' + status)


@pytest.mark.parametrize('text', ['La vacante no está cubierta.',
                                'Te encargarás del cierre de ventas.',
                                'Cuando la vacante esté cubierta avisaremos.',
                                'Las aplicaciones no están cerradas.'])
def test_closing_sales_and_unfilled_vacancies_remain_eligible(api, text):
    assert add('Buscamos una closer para nuestro equipo de ventas. Trabajo remoto.\n' + text)


@pytest.mark.parametrize('title', ['Prospector telefónico', 'Prospectora telefónica'])
def test_canonical_cold_caller_titles_reach_student_search(api, title):
    client, _ = api
    assert add('Buscamos una profesional para nuestro equipo de ventas. Trabajo remoto.',
               title=title, identity='canonical-caller')
    offers = client.post('/v1/opportunities/search', json={'role': 'cold_caller'}).json()
    assert offers['total'] == 1
    assert offers['items'][0]['role'] == 'cold_caller'
    assert offers['items'][0]['original_title'] == title


def test_cold_caller_presentation_uses_canonical_vocabulary(monkeypatch):
    from career.presentation import professional_role
    from career.vocabulary import ROLE_FAMILIES
    monkeypatch.setitem(ROLE_FAMILIES, 'cold_caller', [*ROLE_FAMILIES['cold_caller'], 'prospector de llamadas salientes'])
    assert professional_role('Prospector de llamadas salientes', '') == 'cold_caller'
    assert professional_role('Coordinación telefónica de soporte', '') is None


def test_variantes_con_barra_e_inmobiliarias_pliegan_en_account_executive():
    """Sesión 22 (evidencia del slug asesor-de-ventas): 17/48 anuncios comerciales reales
    quedaban sin familia por variantes no plegadas. La familia closer no se pliega:
    los títulos consultivos/admisiones ganan por orden de evaluación, y el AE liso
    ('asesor comercial' energía, seguros) sigue siendo account_executive."""
    from career.presentation import professional_role
    for title in ['Asesor/a de Ventas', 'ASESOR INMOBILIARIO', 'Asesor/a Inmobiliario/a',
                  'AGENTE INMOBILIARIO/A – CAPTACIÓN Y VENTAS', 'Vendedor/a',
                  'Asesor/a Comercial Energía | fijo + comisiones']:
        assert professional_role(title, 'Ventas y captación de inmuebles. Comisiones.') == 'account_executive', title
    # Cierre consultivo/admisiones con evidencia literal sigue siendo closer:
    assert professional_role('Asesor/a de Admisiones y Ventas', 'venta consultiva y cierre de matrículas') == 'closer'
    # Ambiguos honestos sin familia (no se inventa):
    assert professional_role('Asesor/a', 'gimnasio y fitness') is None
