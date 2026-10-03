"""Embudo diario por fuente (Bloque A del plan): revisadas → matching → elegibles → seleccionadas.

Cada etapa reutiliza las puertas que ya existen, nunca criterios nuevos:
- revisadas: registros que la fuente devolvió al importar (SourceProgress.fetched del run del día).
- matching: pasan el filtro común del catálogo (pipeline.match con collection_query, dedupe por URL
  original, ventana de 10 días). Con lo medible hoy esta etapa se sirve como cota inferior =
  elegibles de esa fuente; la señal fuerte del embudo es una fuente con revisadas altas y 0 aquí.
- elegibles: pasan la vista de alumna (rol + idioma + frescura). Los campos opcionalmente excluidos
  del formulario de alumna (bilingües, roles extra) NO se aplican: el embudo mide el stock disponible.
- seleccionadas: top de excelencia real (España primero, máx. 2 por empresa, nunca relleno).

Las filas solo se escriben al cerrar una recogida (source_funnel_daily, append idempotente por día);
el estado de HOY se recomputa siempre en vivo contra la BD. Una fuente que falla figura con su aviso
y nunca oculta a las demás. Nunca se consultan proveedores ni IA: solo BD local.
"""
import json

from fastapi import APIRouter
from pydantic import BaseModel, Field

from .db import connect, now, org
from .opportunities import OpportunityQuery, _search_result
from .sources import source_infos

router = APIRouter(prefix='/v1/funnel')

STAGES = ('revisadas', 'matching', 'elegibles', 'seleccionadas')


class FunnelRow(BaseModel):
    source: str
    source_name: str
    revisadas: int = Field(default=0, ge=0)
    matching: int = Field(default=0, ge=0)
    elegibles: int = Field(default=0, ge=0)
    seleccionadas: int = Field(default=0, ge=0)
    failure: str | None = None


class FunnelDay(BaseModel):
    day: str
    rows: list[FunnelRow]
    total: FunnelRow


def _day_key():
    from .collection import day_key
    return day_key()


def current(organization, day=None):
    """Embudo del día (o del día indicado): etapas en vivo + avisos del run diario."""
    day = day or _day_key()
    fetched, failure = {}, {}
    with connect() as db:
        run = db.execute('SELECT sources FROM collection_runs WHERE org_id=? AND day=? ORDER BY created_at DESC LIMIT 1',
                         (organization, day)).fetchone()
    if run:
        for source in json.loads(run['sources']):
            fetched[source['code']] = max(int(source.get('fetched') or 0), fetched.get(source['code'], 0))
            if source.get('warning'):
                failure[source['code']] = str(source['warning'])[:200]
    # Elegibles/seleccionadas: la vista de alumna con su consulta por defecto es LA puerta;
    # sus items ya llevan is_selected/excellence_rank de la selección de excelencia.
    result = _search_result(OpportunityQuery(), organization)
    name_to_code = {s['name']: s['code'] for s in source_infos(organization)}

    def code_of(offer):
        return name_to_code.get(offer.source_name, offer.source_name)

    rows: dict[str, FunnelRow] = {}

    def row_for(code, name):
        return rows.setdefault(code, FunnelRow(source=code, source_name=name))

    for offer in result.items:
        row = row_for(code_of(offer), offer.source_name)
        row.elegibles += 1
        if offer.is_selected:
            row.seleccionadas += 1
    for code, count in fetched.items():
        row_for(code, code).revisadas = count
    elegibles_by_code = {row.source: row.elegibles for row in rows.values()}
    for row in rows.values():
        row.matching = elegibles_by_code.get(row.source, 0)
        row.failure = failure.get(row.source)
    ordered = sorted(rows.values(), key=lambda row: (-(row.seleccionadas or row.elegibles), row.source))
    return FunnelDay(day=day, rows=ordered,
                     total=FunnelRow(source='total', source_name='Total',
                                     revisadas=sum(row.revisadas for row in ordered),
                                     **{stage: sum(getattr(row, stage) for row in ordered) for stage in STAGES[1:]}))


@router.get('', response_model=FunnelDay)
def funnel():
    return current(org())


def save_snapshot(organization, run_id):
    """Snapshot append-only al cerrar la recogida. Idempotente por día: releer el mismo
    run no duplica filas y conserva la primera medición cerrada de ese día. Solo un run
    del propio día escribe el snapshot; re-ejecutar un run antiguo no fabrica historia."""
    with connect() as db:
        run = db.execute('SELECT day FROM collection_runs WHERE org_id=? AND id=?', (organization, run_id)).fetchone()
    if not run or run['day'] != _day_key():
        return False
    result = current(organization, run['day'])
    with connect() as db:
        db.execute('BEGIN IMMEDIATE')
        if db.execute('SELECT 1 FROM source_funnel_daily WHERE org_id=? AND day=?', (organization, run['day'])).fetchone():
            return False
        db.execute('INSERT INTO source_funnel_daily VALUES(?,?,?,?)',
                   (organization, run['day'], result.model_dump_json(), now()))
    return True
