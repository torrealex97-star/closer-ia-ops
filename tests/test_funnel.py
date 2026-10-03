"""Embudo diario por fuente (Bloque A del plan): revisadas → matching → elegibles → seleccionadas.

Las etapas reutilizan las puertas existentes (filtro común del catálogo + vista de alumna con
selección de excelencia); el snapshot solo se escribe al cerrar una recogida del propio día y es
idempotente. Una fuente que falla figura con su aviso sin ocultar a las demás.
"""
import test_integrations as fixtures
from career.connectors import Candidate, Himalayas
from career.db import now
from career.models import SearchQuery
from career.pipeline import ingest

api = fixtures.api
vendor = fixtures.vendor  # re-exportado: pytest resuelve fixtures en este namespace


def add(identity, title='Closer de ventas', company='Empresa de prueba'):
    description = ('Buscamos una closer para nuestro equipo de ventas. Trabajo remoto en España. '
                   'Salario: fijo + comisiones. CRM propio. Formación a cargo de la empresa.')
    return ingest(Candidate(identity, {'guid': f'https://example.com/{identity}', 'title': title,
                  'companyName': company, 'description': description, 'pubDate': now(),
                  'locationRestrictions': ['Spain']}), Himalayas(), SearchQuery(), None, 'org-test')


def test_funnel_counts_live_from_student_view(api):
    """Elegibles y seleccionadas del día se recomputan en vivo desde la misma vista de alumna."""
    client, _ = api
    for index in range(3):
        add(f'embudo-{index}', company=f'Empresa {index}')
    funnel = client.get('/v1/funnel').json()
    assert funnel['day']
    assert funnel['total']['elegibles'] == 3
    assert funnel['total']['seleccionadas'] == 3  # 3 empresas distintas: el top no recorta
    himalayas = next(row for row in funnel['rows'] if row['source'] == 'himalayas')
    assert himalayas['source_name'] == 'Himalayas'
    assert himalayas['elegibles'] == 3 and himalayas['seleccionadas'] == 3


def test_funnel_uses_fetched_from_daily_run_and_snapshot_is_idempotent(api):
    """Revisadas viene del run del día; el snapshot solo se escribe una vez por día."""
    client, _ = api
    add('embudo-uno')
    run = client.post('/v1/collection/refresh', json={}).json()['latest']
    assert run['day']
    from career import collection, funnel as funnel_module
    collection.progress(run['id'], 'org-test', 'himalayas', fetched=12, accepted=1)
    collection.progress(run['id'], 'org-test', 'himalayas', status='completed')
    assert funnel_module.save_snapshot('org-test', run['id']) is True
    assert funnel_module.save_snapshot('org-test', run['id']) is False  # idempotente por día
    funnel = client.get('/v1/funnel').json()
    himalayas = next(row for row in funnel['rows'] if row['source'] == 'himalayas')
    assert himalayas['revisadas'] == 12 and himalayas['elegibles'] == 1
    assert himalayas['matching'] == 1  # cota inferior servida = elegibles de esa fuente
    assert funnel['total']['revisadas'] == 12


def test_funnel_failed_source_visible_without_hiding_others(api):
    """Una fuente fallida lista su aviso y no oculta a las fuentes exitosas."""
    client, _ = api
    add('embudo-viva')
    run = client.post('/v1/collection/refresh', json={}).json()['latest']
    from career import collection
    collection.progress(run['id'], 'org-test', 'jobicy', status='failed',
                        warning='Extracción sin completar. Se importa únicamente el dataset anterior, si existe.')
    collection.progress(run['id'], 'org-test', 'himalayas', status='completed', fetched=4, accepted=1)
    rows = {row['source']: row for row in client.get('/v1/funnel').json()['rows']}
    assert rows['himalayas']['elegibles'] == 1 and rows['himalayas']['revisadas'] == 4
    assert 'dataset anterior' in rows['jobicy']['failure']


def test_funnel_empty_day_returns_zeros(api):
    """Sin catálogo ni run: día con todo a cero, nunca un error ni datos inventados."""
    client, _ = api
    funnel = client.get('/v1/funnel').json()
    assert funnel['total'] == {'source': 'total', 'source_name': 'Total', 'revisadas': 0,
                               'matching': 0, 'elegibles': 0, 'seleccionadas': 0, 'failure': None}
    assert funnel['rows'] == []
