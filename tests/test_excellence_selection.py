"""Selección de excelencia (SPEC-002): el top del día para la alumna.

El catálogo puede traer cientos de elegibles; la vista de alumna ordena por
España primero, score del pipeline, compensación publicada y frescura, y marca
las 10-20 primeras con máximo dos plazas por empresa. Nunca se rellena la lista
con relleno: con menos empresas distintas, la selección es más corta ese día.
"""
import test_integrations as fixtures
from career.connectors import Candidate, Himalayas
from career.db import now
from career.models import SearchQuery
from career.pipeline import ingest

api = fixtures.api
vendor = fixtures.vendor


def days_ago(days):
    """Fecha relativa: el test no puede usar una fecha fija porque el filtro de
    frescura (10 días) la dejaría fuera del catálogo al envejecer el calendario."""
    from datetime import datetime, timedelta, timezone
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


def add(identity, title='Closer de ventas', company='Empresa de prueba', published=None, spain=True):
    description = ('Buscamos una closer para nuestro equipo de ventas. Trabajo remoto en España. '
                   'Salario: fijo + comisiones. CRM propio. Formación a cargo de la empresa.')
    locations = ['Spain'] if spain else ['Germany']
    return ingest(Candidate(identity, {'guid': f'https://example.com/{identity}', 'title': title,
                  'companyName': company, 'description': description, 'pubDate': published or now(),
                  'locationRestrictions': locations}), Himalayas(), SearchQuery(), None, 'org-test')


def test_selection_marks_top_and_keeps_rest_visible(api):
    client, _ = api
    for index in range(25):
        add(f'oferta-{index}', company=f'Empresa {index}')
    result = client.post('/v1/opportunities/search', json={}).json()
    assert result['total'] == 25 and result['selection_total'] == 20
    selected = [item for item in result['items'] if item['is_selected']]
    assert len(selected) == 20
    # Ranks 1..20 únicos y solo en las seleccionadas; el resto sigue visible.
    assert [item['excellence_rank'] for item in selected] == list(range(1, 21))
    assert all(item['excellence_rank'] is None for item in result['items'] if not item['is_selected'])


def test_selection_respects_role_and_market_filters(api):
    client, _ = api
    for index in range(8):
        add(f'setter-{index}', title='Appointment Setter', company=f'Setter Co {index}')
    result = client.post('/v1/opportunities/search', json={'role': 'setter'}).json()
    assert result['selection_total'] == 8
    assert all(item['role'] == 'setter' for item in result['items'] if item['is_selected'])


def test_selection_cap_two_per_company_no_padding(api):
    client, _ = api
    # 12 empresas con 3 ofertas cada una: el tope de 2 por empresa da 24, no 20.
    # Con 5 empresas de 2 y 2 sueltas: la selección no se rellena por encima de lo real.
    for company_index in range(5):
        for offer_index in range(2):
            add(f'co{company_index}-{offer_index}', company=f'Grupo {company_index}')
    result = client.post('/v1/opportunities/search', json={}).json()
    assert result['selection_total'] == 10
    counts = {}
    for item in result['items']:
        if item['is_selected']:
            counts[item['company']] = counts.get(item['company'], 0) + 1
    assert max(counts.values()) == 2


def test_selection_prefers_spain_score_and_compensation(api):
    client, _ = api
    # Alemania publicada ahora con compensación; España publicada hace 9 días (dentro de la
    # ventana de 10 días con margen, sea cual sea la fecha de ejecución) sin importe.
    add('de-nueva', company='Alemana S.L.', spain=False)
    add('es-vieja', company='Española S.L.', published=days_ago(9))
    result = client.post('/v1/opportunities/search', json={}).json()['items']
    assert result[0]['company'] == 'Española S.L.'  # España primero, como antes
    assert result[0]['is_selected'] is True and result[0]['excellence_rank'] == 1


def test_selection_total_is_zero_when_nothing_matches(api):
    client, _ = api
    result = client.post('/v1/opportunities/search', json={}).json()
    assert result['total'] == 0 and result['selection_total'] == 0
