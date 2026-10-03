"""Clasificación LLM de oportunidades (ADR-007): opt-in, acotada y con evidencia literal.

Cubre el ciclo completo con el servidor HTTP de contrato (sin llamadas reales a proveedores),
el modo sin clave (ERROR accionable, cola congelada) y la integración con la vista de alumna.
"""
import asyncio
import json

from career.classification import (INSTRUCTIONS, RoleClassification, enqueue_classification,
                                   llm_role_for, process_one, trigger_massive_classification)
from career import collection
from career.connectors import Candidate, Himalayas
from career.db import connect, now
from career.models import SearchQuery
from career.pipeline import ingest

import test_integrations as fixtures

api = fixtures.api
vendor = fixtures.vendor


def add(job_id, title, description='Buscamos comercial para nuestro equipo. Trabajo remoto en España. Formación a cargo de la empresa. CRM propio.',
        identity=None):
    """Ingresa la oferta y devuelve su id real de jobs (no el external_id de la fuente)."""
    ok = ingest(Candidate(identity or job_id, {'guid': f'https://example.com/{job_id}', 'title': title,
                  'companyName': 'Empresa de prueba', 'description': description, 'pubDate': now(),
                  'locationRestrictions': ['Spain']}), Himalayas(), SearchQuery(), None, 'org-test')
    if not ok:
        return None
    with connect() as db:
        return db.execute('''SELECT j.id FROM jobs j JOIN job_postings p ON p.org_id=j.org_id AND j.posting_id=p.id
            WHERE p.external_id=? AND p.org_id='org-test' ''', (identity or job_id,)).fetchone()[0]


def enable(api, provider='groq', model='openai/gpt-oss-20b', daily_limit=10):
    client, _ = api
    client.post('/v1/integrations/ai', json={'provider': provider, 'model': model, 'enabled': True,
                                             'token': 'fake-classification-secret', 'daily_limit': daily_limit})
    return client.put('/v1/ai/classification', json={'enabled': True, 'provider': provider,
                                                     'model': model, 'daily_limit': daily_limit})


def test_deterministic_first_new_vocabulary_not_lost(api):
    """Sin IA: el vocabulario canónico clasifica los títulos que conoce."""
    job = add('canonical', 'Admissions Advisor', 'Cierre de matrículas para formación online. CRM.')
    assert job
    enable(api)
    # El determinista la clasifica: no entra en cola IA (no es ambigua).
    queued = enqueue_classification([job], None, 'org-test')
    assert queued == {'queued': 0, 'already_classified': 1}


def test_unknown_title_enters_queue_and_completes_with_evidence(api):
    """Título nuevo sin término del vocabulario: entra en cola y la IA lo resuelve."""
    client, state = api
    job = add('nuevo-titulo', 'Customer Success Architect', 'Buscamos comercial para nuestro equipo: acompañarás a clientes de la academia y venderás su continuación. Formación a cargo de la empresa. CRM propio.')
    assert job
    enable(api)
    result = client.post('/v1/ai/classify', json={'job_ids': [job]}).json()
    assert result['queued'] == 1 and result['already_classified'] == 0
    assert asyncio.run(process_one())
    detail = client.get('/v1/ai/classifications/' + job).json()
    assert detail['status'] == 'completed'
    assert detail['result']['role_family'] in {'closer', 'setter', 'cold_caller', 'account_executive', 'sdr', 'not_sales', 'uncertain'}
    # Una sola llamada HTTP al proveedor, sin reintentos.
    posts = [c for c in state['calls'] if c[0] == 'POST' and c[1].endswith('/chat/completions')]
    assert len(posts) == 1 and posts[0][2] == 'Bearer fake-classification-secret'
    schema = posts[0][3]['response_format']['json_schema']['schema']
    assert schema['additionalProperties'] is False
    # Re-clasificar el mismo contenido no vuelve a llamar al proveedor (caché por input_hash).
    assert client.post('/v1/ai/classify', json={'job_ids': [job]}).json()['queued'] == 0
    assert asyncio.run(process_one()) is False
    assert len([c for c in state['calls'] if c[0] == 'POST' and c[1].endswith('/chat/completions')]) == 1


def test_without_key_queue_is_frozen_with_actionable_error(api):
    """Modo sin clave: nada se encola, nada se gasta y el error es accionable."""
    client, state = api
    job = add('sin-clave', 'Growth Partner', 'Buscamos comercial para nuestro equipo: venta de programas de la academia. Formación incluida. CRM.')
    assert job
    # Habilitada pero SIN clave de proveedor: el error exige conectar, no se encola nada.
    client.put('/v1/ai/classification', json={'enabled': True, 'provider': 'groq', 'model': 'openai/gpt-oss-20b'})
    response = client.post('/v1/ai/classify', json={'job_ids': [job]})
    assert response.status_code == 422
    assert 'clave' in response.text.lower() and 'Fuentes' in response.text
    with connect() as db:
        assert db.execute("SELECT count(*) FROM job_classifications").fetchone()[0] == 0
    with connect() as db:
        assert db.execute("SELECT count(*) FROM job_classifications").fetchone()[0] == 0
    # Aunque la clasificación esté habilitada, sin enabled el worker no llama al proveedor.
    enable(api)
    assert client.post('/v1/ai/classify', json={'job_ids': [job]}).json()['queued'] == 1
    client.put('/v1/ai/classification', json={'enabled': False})
    assert asyncio.run(process_one())
    with connect() as db:
        row = db.execute('SELECT status,payload FROM job_classifications WHERE job_id=?', (job,)).fetchone()
    assert row['status'] == 'failed'
    assert 'desactivó' in json.loads(row['payload'])['error']


def test_hallucinated_evidence_is_needs_review(api):
    """Una cita que no existe en la oferta nunca se publica como clasificación válida."""
    client, state = api
    state['mode'] = 'hallucinated'
    job = add('alucinada', 'Revenue Officer', 'Buscamos comercial para nuestro equipo. Trabajo remoto. Formación incluida. CRM.')
    assert job
    enable(api)
    client.post('/v1/ai/classify', json={'job_ids': [job]})
    assert asyncio.run(process_one())
    detail = client.get('/v1/ai/classifications/' + job).json()
    assert detail['status'] == 'failed'
    assert 'respaldo literal' in detail['error']
    assert llm_role_for(job, 'org-test') is None


def test_llm_result_reaches_student_view_with_attribution(api):
    """La oferta sin término del vocabulario aparece en la vista con atribución de IA."""
    client, state = api
    job = add('ia-visible', 'Revenue Officer', 'Buscamos comercial para nuestro equipo: venderás la continuación del programa a clientes de la academia. Formación incluida. CRM propio.')
    assert job
    enable(api)
    client.post('/v1/ai/classify', json={'job_ids': [job]})
    assert asyncio.run(process_one())
    result = client.post('/v1/opportunities/search', json={}).json()
    offer = next((i for i in result['items'] if i['original_title'] == 'Revenue Officer'), None)
    assert offer is not None
    assert 'IA' in offer['role_label']
    assert 'Clasificación IA' in offer['description']


def test_classification_not_shown_without_completed_result(api):
    """Sin clasificación completada, la oferta no aparece (el determinista manda)."""
    client, _ = api
    assert add('sin-ia', 'Revenue Officer', 'Buscamos comercial para nuestro equipo: venta de la continuación del programa. Formación incluida. CRM.')
    result = client.post('/v1/opportunities/search', json={}).json()
    assert not any(i['original_title'] == 'Revenue Officer' for i in result['items'])


def test_daily_limit_blocks_new_enqueues(api):
    client, _ = api
    enable(api, daily_limit=2)
    jobs = [add(f'limite-{index}', f'Titulo Ambiguo {index}', 'Buscamos comercial para nuestro equipo: venta del programa de la academia. Formación incluida. CRM.') for index in range(3)]
    assert all(jobs)
    client.post('/v1/ai/classify', json={'job_ids': jobs})
    with connect() as db:
        queued = db.execute("SELECT count(*) FROM job_classifications WHERE status='queued'").fetchone()[0]
    assert queued == 2  # el límite diario acota la cola, nunca se pasa


def test_retry_failed_requeues_without_touching_cache_of_others(api):
    """El reintento manual re-encola una fila failed (p. ej. 429 transitorio) y solo esa:
    la caché por contenido sigue protegiendo completadas y la cola ambigua."""
    client, _ = api
    enable(api)
    job = add('retry-1', 'Titulo Ambiguo Reintentable', 'Buscamos comercial para nuestro equipo: venta del programa de la academia. Formación incluida. CRM.')
    client.post('/v1/ai/classify', json={'job_ids': [job]})
    with connect() as db:
        row = db.execute("SELECT id,status FROM job_classifications WHERE job_id=?", (job,)).fetchone()
        db.execute("UPDATE job_classifications SET status='failed', payload=json_set(payload,'$.error','Groq respondió 429. Revisa clave, cuota y acceso al modelo. No se ha reintentado automáticamente.') WHERE id=?", (row['id'],))
    first = client.post('/v1/ai/classify', json={'job_ids': [job]}).json()
    assert first['queued'] == 0  # sin retry_failed la caché lo bloquea
    second = client.post('/v1/ai/classify', json={'job_ids': [job], 'retry_failed': True}).json()
    assert second['queued'] == 1  # reintento manual explícito re-encola la failed
    with connect() as db:
        rows = db.execute("SELECT status FROM job_classifications WHERE job_id=?", (job,)).fetchall()
    assert len(rows) == 1  # la misma fila se reactiva: nunca un duplicado por (org, job, hash)


def test_status_endpoint_and_role_schema(api):
    client, _ = api
    status = client.get('/v1/ai/classification').json()
    assert set(status) >= {'enabled', 'has_token', 'provider', 'model', 'daily_limit', 'used_today'}
    assert client.put('/v1/ai/classification', json={'enabled': True}).json()['enabled'] is True


def test_massive_dispatch_after_collection_respects_config_limits(api, monkeypatch):
    """El gancho post-recogida encola solo lo ambiguo, bajo límite diario y opt-in."""
    client, _ = api
    # Opt-in desactivado y motor apagado: no encola nada aunque haya ambiguas.
    add('masiva-1', 'Revenue Officer', 'Buscamos comercial para nuestro equipo: venta del programa de la academia. Formación incluida. CRM.')
    add('masiva-2', 'Growth Partner', 'Buscamos comercial para nuestro equipo: venta del programa de la academia. Formación incluida. CRM.')
    add('masiva-det', 'Admissions Advisor', 'Cierre de matrículas para formación online. CRM.')
    assert trigger_massive_classification('org-test') == 0
    enable(api, daily_limit=1)
    client.put('/v1/ai/classification', json={'enabled': True, 'massive_after_collection': True, 'daily_limit': 1})
    # Límite 1: solo la primera ambigua entra; el determinista (Admissions) no se toca.
    assert trigger_massive_classification('org-test') == 1
    with connect() as db:
        statuses = dict(db.execute('SELECT status, count(*) FROM job_classifications GROUP BY status').fetchall())
    assert statuses.get('queued') == 1
    # Sin clave guardada (caso BD real del operador): skip silencioso, cero filas nuevas.
    client.put('/v1/ai/classification', json={'enabled': True, 'massive_after_collection': True, 'daily_limit': 5})
    # El fixture guarda clave con enable(); simulamos org sin clave:
    from career.integrations import save_setting
    save_setting('classification', {'enabled': True, 'massive_after_collection': True, 'provider': 'groq', 'daily_limit': 5}, 'org-nokey')
    assert trigger_massive_classification('org-nokey') == 0
    with connect() as db:
        total = db.execute("SELECT count(*) FROM job_classifications WHERE org_id='org-nokey'").fetchone()[0]
    assert total == 0


def test_massive_dispatch_hook_runs_after_collect(api, monkeypatch):
    """El fin de collect() llena la cola de clasificación si el opt-in está activo."""
    client, _ = api
    enable(api, daily_limit=5)
    client.put('/v1/ai/classification', json={'enabled': True, 'massive_after_collection': True, 'daily_limit': 5})
    class Ambiguous:
        code, name, provider = 'himalayas', 'Fixture ambigua', 'fixture'
        async def batches(self, query):
            yield [Candidate('ambigua-post', {'guid': 'https://example.com/ambigua', 'title': 'Revenue Officer',
                    'description': 'Buscamos comercial para nuestro equipo: venta del programa de la academia. Formación incluida. CRM. Trabajo remoto en España.',
                    'pubDate': now()})]
    monkeypatch.setattr(collection, 'REGISTRY', {'himalayas': Ambiguous()})
    run = client.post('/v1/collection/refresh').json()['latest']
    asyncio.run(collection.collect(run['id'], 'org-test'))
    with connect() as db:
        queued = db.execute("SELECT count(*) FROM job_classifications WHERE status='queued' AND job_id IN (SELECT id FROM jobs)").fetchone()[0]
    assert queued == 1  # la oferta ambigua importada por la recogida entró en cola sola
    # Y el ciclo completo: el worker la procesa con el servidor de contrato (sin clave real).
    assert asyncio.run(process_one())


def test_classifications_listing_shows_state_result_and_evidence(api):
    """El listado admin expone estado, familia y evidencia sin contenido crudo del proveedor."""
    client, _ = api
    job = add('listado', 'Revenue Officer', 'Buscamos comercial para nuestro equipo: venta del programa de la academia. Formación incluida. CRM.')
    assert job
    # Sin clasificaciones, lista vacía (no 404): la vista arranca vacía.
    assert client.get('/v1/ai/classifications').json() == []
    enable(api)
    client.post('/v1/ai/classify', json={'job_ids': [job]})
    assert asyncio.run(process_one())
    items = client.get('/v1/ai/classifications').json()
    assert len(items) == 1
    item = items[0]
    assert item['job_id'] == job and item['status'] == 'completed'
    assert item['title'] == 'Revenue Officer' and item['company'] == 'Empresa de prueba'
    assert item['result']['role_family'] in {'closer', 'setter', 'cold_caller', 'account_executive', 'sdr', 'not_sales', 'uncertain'}
    assert item['result']['evidence'] == 'comercial'
    assert 'content' not in item and 'raw_output' not in item  # sin crudo del proveedor
    # Fallo visible con su error, nunca oculto.
    failed = add('listado-fallo', 'Revenue Officer II', 'Buscamos comercial para nuestro equipo: venta del programa de la academia. Formación incluida. CRM.')
    client.post('/v1/ai/classify', json={'job_ids': [failed]})
    client.put('/v1/ai/classification', json={'enabled': False})
    assert asyncio.run(process_one())
    items = client.get('/v1/ai/classifications').json()
    failed_item = next(i for i in items if i['job_id'] == failed)
    assert failed_item['status'] == 'failed' and 'desactivó' in failed_item['error']


def test_schema_contract_is_strict_and_evidence_bounded():
    schema = RoleClassification.model_json_schema()
    assert schema['additionalProperties'] is False
    families = schema['properties']['role_family']['enum']
    assert set(families) == {'closer', 'setter', 'cold_caller', 'account_executive', 'sdr', 'not_sales', 'uncertain'}
    assert 'evidence' in INSTRUCTIONS.lower() or 'cita' in INSTRUCTIONS.lower()
