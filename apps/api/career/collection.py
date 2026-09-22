"""Daily durable collection, independent of interactive catalog searches."""
import asyncio
import json
import logging
import math
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from defusedxml import ElementTree

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .catalog import catalog_counts, prune, collection_query
from .connectors import REGISTRY, fetch
from .db import connect, now, org, uid
from .models import SourceProgress
from .pipeline import ingest

router = APIRouter(prefix='/v1')
MADRID = ZoneInfo('Europe/Madrid')
logger = logging.getLogger('career.collection')


class CollectionSettings(BaseModel):
    enabled: bool = True
    daily_budget_eur: int = Field(default=1, ge=1, le=2)
    hour: int = Field(default=8, ge=0, le=23)


class CollectionRun(BaseModel):
    id: str
    day: str
    status: str
    created_at: str
    completed_at: str | None = None
    sources: list[SourceProgress]


class CollectionStatus(BaseModel):
    settings: CollectionSettings
    timezone: str = 'Europe/Madrid'
    retention_days: int = 10
    catalog_total: int
    added_last_24h: int
    reserved_eur: float
    actual_usd: float
    uncertain_runs: int
    latest: CollectionRun | None = None


def day_key():
    return datetime.now(MADRID).date().isoformat()


def settings(organization, db=None):
    if db is None:
        with connect() as db:
            return settings(organization, db)
    row = db.execute("SELECT payload FROM integration_settings WHERE org_id=? AND provider='daily-collection'", (organization,)).fetchone()
    return CollectionSettings.model_validate_json(row['payload']) if row else CollectionSettings()


@router.put('/collection/settings', response_model=CollectionStatus)
def save_settings(body: CollectionSettings):
    with connect() as db:
        db.execute("INSERT OR REPLACE INTO integration_settings VALUES(?,'daily-collection',?)", (org(), body.model_dump_json()))
    return status()


@router.get('/collection', response_model=CollectionStatus)
def status():
    organization = org()
    counts = catalog_counts(organization)
    with connect() as db:
        latest = db.execute('SELECT * FROM collection_runs WHERE org_id=? ORDER BY created_at DESC LIMIT 1', (organization,)).fetchone()
        costs = db.execute('SELECT coalesce(sum(reserved_cents),0) AS reserved,coalesce(sum(actual_usd),0) AS actual '
                           'FROM scrape_budget WHERE org_id=? AND (day=? OR finished_day=?)', (organization, day_key(), day_key())).fetchone()
        uncertain = db.execute("SELECT count(*) FROM scrape_budget WHERE org_id=? AND status IN ('reserved','UNKNOWN')", (organization,)).fetchone()[0]
    latest_run = None
    if latest:
        source_states = json.loads(latest['sources'])
        for source in source_states:
            if source['status'] == 'completed' and not source['fetched'] and not source.get('warning'):
                source['warning'] = 'La fuente devolvió cero registros. Revisa la consulta o el dataset; no se han añadido ofertas.'
        state = 'partial' if latest['status'] == 'completed' and any(s.get('warning') for s in source_states) else latest['status']
        latest_run = CollectionRun(**dict(latest, sources=source_states, status=state))
    return CollectionStatus(settings=settings(organization), catalog_total=counts['total'], added_last_24h=counts['added'],
                            reserved_eur=costs['reserved'] / 100, actual_usd=costs['actual'], uncertain_runs=uncertain,
                            latest=latest_run)


def enqueue(organization):
    from .sources import connections
    sources = [SourceProgress(code=c.code, name=c.name).model_dump() for c in REGISTRY.values()]
    sources += [SourceProgress(code=c['id'], name=c['name']).model_dump() for c in connections(organization) if c['enabled']]
    with connect() as db:
        db.execute('BEGIN IMMEDIATE')
        db.execute("INSERT OR IGNORE INTO collection_runs VALUES(?,?,?,'queued',?,?,NULL)",
                   (uid(), organization, day_key(), json.dumps(sources), now()))
        return db.execute('SELECT id FROM collection_runs WHERE org_id=? AND day=?', (organization, day_key())).fetchone()['id']


@router.post('/collection/refresh', response_model=CollectionStatus, status_code=202)
def refresh():
    enqueue(org())
    return status()


async def euro_rate():
    # ECB reference, cached for one hour; fail closed if unavailable or stale.
    xml = await fetch('https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml', ttl=3600)
    root = ElementTree.fromstring(xml)
    dated = next(e for e in root.iter() if 'time' in e.attrib)
    age = (datetime.now(timezone.utc).date() - datetime.fromisoformat(dated.attrib['time']).date()).days
    rate = float(next(e.attrib['rate'] for e in root.iter() if e.attrib.get('currency') == 'USD'))
    if not 0 <= age <= 7 or not .5 < rate < 2:
        raise ValueError('Tipo de cambio no vigente')
    return rate


async def budget_quote(value, token):
    from .sources import apify_request
    try:
        metadata = (await apify_request('GET', f"acts/{value['actor_id'].replace('/', '~')}", token))['data']
        prices = sorted((p for p in metadata.get('pricingInfos', []) if p.get('startedAt', '') <= now()), key=lambda p: p.get('startedAt', ''))
        price = prices[-1] if prices else {}
        if price.get('pricingModel') != 'PAY_PER_EVENT':
            raise HTTPException(422, 'Este Actor no admite el tope monetario por eventos. Se omite para proteger el presupuesto; puedes importar su dataset existente.')
        # These charge events expose usage pass-through in PPE pricing. Unknown billing is not authorized.
        events = price.get('pricingPerEvent', {}).get('actorChargeEvents', {})
        if any(k.startswith('apify-') and k not in {'apify-actor-start', 'apify-default-dataset-item'} for k in events):
            raise HTTPException(422, 'Actor con costes de plataforma adicionales: recogida de pago bloqueada para proteger el presupuesto.')
        minimum = float(price.get('minimalMaxTotalChargeUsd') or 0)
        if not math.isfinite(minimum) or minimum < 0:
            raise ValueError('Precio mínimo inválido')
        return await euro_rate(), minimum
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(422, 'No se pudo verificar el precio o el cambio EUR/USD. No se iniciará ningún scraper de pago.') from None


def reserve(db, organization, connection_id, requested_usd, rate, minimum, allocation_cents=None):
    """Called inside the same IMMEDIATE transaction that claims the source launch."""
    day = day_key()
    if db.execute('SELECT 1 FROM scrape_budget WHERE org_id=? AND day=? AND connection_id=?', (organization, day, connection_id)).fetchone():
        raise HTTPException(409, 'Esta fuente ya tiene una extracción reservada hoy. No se vuelve a cobrar; se reutiliza el dataset.')
    if db.execute("SELECT 1 FROM scrape_budget WHERE org_id=? AND status IN ('reserved','UNKNOWN','READY','RUNNING','TIMING-OUT','ABORTING')", (organization,)).fetchone():
        raise HTTPException(409, 'Hay un lanzamiento sin confirmar. Comprueba Apify antes de gastar más.')
    budget = settings(organization, db).daily_budget_eur * 100
    spent = db.execute('SELECT coalesce(sum(reserved_cents),0) FROM scrape_budget WHERE org_id=? AND (day=? OR finished_day=?)', (organization, day, day)).fetchone()[0]
    cents = min(budget - spent, allocation_cents if allocation_cents is not None else budget)
    # 30% buffer relative to ECB conversion; keep full reservations for the day, even after completion.
    cap = math.floor(min(requested_usd, cents / 100 * rate / 1.30) * 10000) / 10000
    if cents <= 0 or cap < max(.001, minimum):
        raise HTTPException(409, 'Presupuesto diario insuficiente para esta fuente. Se conserva el catálogo y se intentará otro día.')
    reserved = min(cents, math.ceil(cap / rate * 1.30 * 100))
    reservation = uid()
    db.execute("INSERT INTO scrape_budget VALUES(?,?,?,?,?,?,NULL,'reserved',NULL,NULL)",
               (reservation, organization, day, connection_id, reserved, cap))
    return reservation, cap


def record_launch(reservation, organization, run_id, state):
    with connect() as db:
        db.execute('UPDATE scrape_budget SET run_id=?,status=? WHERE org_id=? AND id=?', (run_id, state, organization, reservation))


def record_cost(organization, run):
    cost = run.get('usageTotalUsd')
    if not isinstance(cost, (float, int)) or not math.isfinite(cost) or cost < 0:
        cost = None
    with connect() as db:
        terminal = run['status'] in {'SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'}
        db.execute('UPDATE scrape_budget SET status=?,actual_usd=?,finished_day=coalesce(finished_day,?) WHERE org_id=? AND run_id=?',
                   (run['status'], cost, day_key() if terminal else None, organization, run['id']))


def progress(run_id, organization, code, **changes):
    with connect() as db:
        row = db.execute('SELECT sources FROM collection_runs WHERE org_id=? AND id=?', (organization, run_id)).fetchone()
        sources = json.loads(row['sources'])
        for source in sources:
            if source['code'] == code:
                source.update(changes)
        db.execute('UPDATE collection_runs SET sources=? WHERE org_id=? AND id=?', (json.dumps(sources), organization, run_id))


async def collect(run_id, organization):
    from .sources import ApifyDataset, check_connection, get_connection, launch_scrape, connections
    with connect() as db:
        row = db.execute('SELECT sources,day FROM collection_runs WHERE org_id=? AND id=?', (organization, run_id)).fetchone()
    sources = json.loads(row['sources'])
    paid_ids = {c['id'] for c in connections(organization) if c['enabled'] and c['actor_id']}
    paid_count = max(1, sum(s['code'] in paid_ids for s in sources))
    allocation = settings(organization).daily_budget_eur * 100 // paid_count
    query = collection_query()
    for source in sources:
        code = source['code']
        if source['status'] in {'completed', 'failed', 'skipped'}:
            continue
        warning = None
        try:
            progress(run_id, organization, code, status='running', fetched=0, accepted=0)
            if code in REGISTRY:
                connector = REGISTRY[code]
            else:
                value = get_connection(code, organization)
                if not value['enabled']:
                    raise HTTPException(409, 'Conexión desactivada')
                if value['actor_id']:
                    try:
                        # An old interrupted daily run must never launch a new billable run on another day.
                        if row['day'] != day_key():
                            raise HTTPException(409, 'Recogida de un día anterior: solo se importa el dataset existente.')
                        value = await launch_scrape(code, organization, allocation)
                    except HTTPException as exc:
                        warning = str(exc.detail)
                        value = get_connection(code, organization)
                    if value.get('run_id') and value.get('run_status') in {'READY', 'RUNNING', 'TIMING-OUT', 'ABORTING'}:
                        for _ in range(25):
                            await asyncio.sleep(4)
                            await check_connection(code, organization)
                            value = get_connection(code, organization)
                            if value.get('run_status') not in {'READY', 'RUNNING', 'TIMING-OUT', 'ABORTING'}:
                                break
                    if value.get('run_id') and value.get('run_status') == 'SUCCEEDED':
                        await check_connection(code, organization)
                        value = get_connection(code, organization)
                    if value.get('run_status') != 'SUCCEEDED':
                        warning = warning or 'Extracción sin completar. Se importa únicamente el dataset anterior, si existe.'
                connector = ApifyDataset(value, organization)
            fetched = accepted = 0
            async with asyncio.timeout(110):
                async for batch in connector.batches(query):
                    for candidate in batch:
                        fetched += 1
                        accepted += int(ingest(candidate, connector, query, None, organization))
                    progress(run_id, organization, code, fetched=fetched, accepted=accepted)
            if not fetched:
                warning = warning or 'La fuente devolvió cero registros. Revisa la consulta o el dataset; no se han añadido ofertas.'
            progress(run_id, organization, code, status='completed', warning=warning)
        except Exception as exc:
            from .connectors import ProviderError
            message = str(exc.detail) if isinstance(exc, HTTPException) else str(exc) if isinstance(exc, ProviderError) else 'No se pudo completar esta fuente. Las demás continúan.'
            if warning:
                message = warning + ' ' + message
            logger.warning('collection_source_failed source=%s type=%s', code, type(exc).__name__)
            progress(run_id, organization, code, status='failed', warning=message)
    prune(organization)
    with connect() as db:
        sources = json.loads(db.execute('SELECT sources FROM collection_runs WHERE org_id=? AND id=?', (organization, run_id)).fetchone()['sources'])
        state = 'partial' if any(s['status'] != 'completed' or s.get('warning') for s in sources) else 'completed'
        db.execute('UPDATE collection_runs SET status=?,completed_at=? WHERE org_id=? AND id=?', (state, now(), organization, run_id))


async def collection_loop():
    # One local worker. Restart resumes imports; reservations prevent duplicate billable launches.
    organization = org()
    with connect() as db:
        db.execute("UPDATE collection_runs SET status='queued' WHERE org_id=? AND status='running'", (organization,))
    while True:
        try:
            prune(organization)
            config = settings(organization)
            if config.enabled and datetime.now(MADRID).hour >= config.hour:
                enqueue(organization)
            with connect() as db:
                db.execute('BEGIN IMMEDIATE')
                row = db.execute("SELECT id FROM collection_runs WHERE org_id=? AND status='queued' ORDER BY created_at LIMIT 1", (organization,)).fetchone()
                if row:
                    db.execute("UPDATE collection_runs SET status='running' WHERE id=? AND org_id=?", (row['id'], organization))
            if row:
                await collect(row['id'], organization)
        except Exception:
            logger.exception('collection_tick_failed')
        await asyncio.sleep(15)
