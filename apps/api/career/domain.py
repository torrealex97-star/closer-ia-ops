"""P01B WDC Opportunity domain: versioned student-facing projection over jobs.

La vista del admin siempre conserva trazabilidad (job, posting, raw, evidencia) y la de
alumna es un DTO permitido (spec 17): desconocidos explícitos, sin relaciones inventadas
(direct_company exige evidencia registrada; nunca se infiere del dominio del enlace) y con
estados de vigencia derivados de verificación, no de clasificación.
"""
import hashlib
import json
import re
from datetime import datetime, timedelta, timezone
from typing import Literal

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .connectors import USER_AGENT
from .db import connect, now, org, uid
from .pipeline import folded

router = APIRouter(prefix='/v1/wdc')

EDITORIAL = Literal['draft', 'needs_review', 'approved', 'published', 'withdrawn']
ACTIVITY = Literal['active', 'verifying', 'closed']
CONNECTION = Literal['direct_partner', 'direct_recruiter', 'direct_company', 'external_application',
                      'marketplace_application', 'community_opportunity']
APPLICATION = Literal['company_ats', 'external_platform', 'marketplace', 'wdc_referral', 'email',
                      'contact_form', 'community_contact', 'unknown']
Locale = Literal['es', 'en']
VERDICT = Literal['open', 'closed', 'unknown']

UNSPECIFIED = 'No especificado'


class JobEligibility(BaseModel):
    """Hechos de elegibilidad separados; vacío/null = desconocido, nunca worldwide implícito."""
    employer_country: str | None = None
    customer_markets: list[str] = []
    allowed_worker_countries: list[str] = []
    excluded_worker_countries: list[str] = []
    residency_required: bool | None = None
    work_authorization_requirements: str | None = None
    timezone_overlap: str | None = None
    languages: list[dict] = []
    backfilled: bool = False


class OpportunityVersionPayload(BaseModel):
    """Contenido editable de una revisión; la fila creada es inmutable.
    extra='forbid': un campo desconocido del formulario se nombra en el 422 en vez de
    descartarse en silencio (la edición perdida sin aviso también es deshonestidad)."""
    model_config = ConfigDict(extra='forbid')
    headline: str
    role: str
    short_summary: str = ''
    what_they_are_looking_for: list[str] = []
    what_you_would_do: list[str] = []
    compensation_summary: str = UNSPECIFIED
    location_summary: str = UNSPECIFIED
    language_requirements: list[str] = []
    experience_summary: str = UNSPECIFIED
    why_it_may_be_interesting: list[str] = []
    application_type: APPLICATION = 'unknown'
    application_url: str | None = None
    next_step: dict = Field(default_factory=lambda: {
        'action': 'view_process', 'label': 'Ver proceso', 'destination_label': UNSPECIFIED,
        'destination_domain': None, 'requires_account': None, 'enabled': False,
        'disabled_reason': 'Sin verificación de vigencia'})
    field_provenance: dict = {}
    selection_method: Literal['human', 'deterministic_rule'] = 'deterministic_rule'
    selection_policy_version: str = '1'


class WDCOpportunityDTO(BaseModel):
    """DTO admin: proyección + trazabilidad mínima para operar con honestidad."""
    id: str
    job_id: str
    current_version_id: str | None
    version: int | None
    editorial_status: EDITORIAL
    opportunity_status: ACTIVITY
    last_verified_at: str | None
    verified_until: str | None
    status_reason: str | None
    connection_type: CONNECTION
    locale: str
    version_payload: dict
    eligibility: JobEligibility
    job_snapshot: dict


class WDCOpportunityList(BaseModel):
    """Listado admin: el total cuenta el filtro completo, no solo la página devuelta."""
    items: list[WDCOpportunityDTO]
    total: int


class StudentOpportunityDTO(BaseModel):
    """DTO de alumna (spec 17): permitido; sin fuente/proveedor/score ni trazabilidad."""
    id: str
    version: int
    headline: str
    company_name: str | None
    role: str
    short_summary: str
    what_they_are_looking_for: list[str]
    what_you_would_do: list[str]
    compensation_summary: str
    location_summary: str
    language_requirements: list[str]
    experience_summary: str
    why_it_may_be_interesting: list[str]
    published_at: str | None
    published_relative: str | None
    opportunity_status: ACTIVITY
    status_reason: str | None
    last_verified_at: str | None
    next_step: dict
    connection_type: CONNECTION
    application_type: APPLICATION
    application_url: str | None
    attribution: list[dict]


def eligibility_backfill(description: str) -> dict:
    """Hechos observables del texto; lo no encontrado queda desconocido."""
    text = re.sub(r'\s+', ' ', (description or '').lower())
    facts: dict = {}
    if re.search(r'\b(necesaria|imprescindible|requerida|residir|required)\b.{0,40}\b(residencia|residency|en españa)\b', text) \
            or re.search(r'\bresidencia\b.{0,30}\b(en españa|requerida|necesaria)\b', text):
        facts['residency_required'] = True
    if re.search(r'\b(permiso|autorizaci[oó]n|documentaci[oó]n)\b.{0,30}\b(trabajo|trabajar|work)\b', text) \
            or re.search(r'\b(work permit|work authorization)\b', text):
        facts['work_authorization_requirements'] = 'Requisito de autorización de trabajo mencionado en la oferta.'
    return facts


def fold_country(location: str) -> str | None:
    """País observable en la ubicación declarada; None = desconocido."""
    known = {'españa': 'España', 'spain': 'España', 'mexico': 'México', 'méxico': 'México',
             'colombia': 'Colombia', 'chile': 'Chile', 'argentina': 'Argentina', 'peru': 'Perú',
             'perú': 'Perú', 'francia': 'Francia', 'france': 'Francia', 'alemania': 'Alemania',
             'germany': 'Alemania', 'portugal': 'Portugal', 'italia': 'Italia', 'italy': 'Italia'}
    for token, name in known.items():
        if token in (location or '').lower():
            return name
    return None


def derive_activity(last_verified_at: str | None, verified_until: str | None, closed_evidence: bool) -> str:
    """Estados de vigencia (spec 17): activa exige verificación positiva vigente;
    verificando por defecto; cerrada solo con evidencia explícita."""
    if closed_evidence:
        return 'closed'
    if not last_verified_at:
        return 'verifying'
    if verified_until and verified_until <= now():
        return 'verifying'
    return 'active'


def relative_date(published_at: str | None) -> str | None:
    """published_relative se calcula al mostrar; fecha desconocida sigue siendo desconocida."""
    if not published_at:
        return None
    try:
        delta = datetime.now(timezone.utc) - datetime.fromisoformat(published_at)
        days = delta.days
        if days <= 0:
            return 'Hoy'
        if days == 1:
            return 'Ayer'
        if days < 30:
            return f'Hace {days} días'
        if days < 365:
            months = max(1, days // 30)
            return f'Hace {months} mes' + ('es' if months > 1 else '')
        years = max(1, days // 365)
        return f'Hace {years} año' + ('s' if years > 1 else '')
    except (ValueError, TypeError):
        return None


def backfill_opportunity(db, organization: str, job_id: str, posting: dict) -> int:
    """Crea opportunity (draft/verifying) + versión 1 + elegibilidad. Idempotente.
    Sin textos LLM: resumen = título literal; desconocidos explícitos."""
    application_url = posting.get('application_url') or None
    source_url = posting.get('source_url') or None
    # Modalidad derivable de forma determinista: la candidatura ocurre en la plataforma
    # externa de la publicación (job board/ATS). Sin enlace verificable: unknown y CTA off.
    application_type = 'external_platform' if (application_url or source_url) else 'unknown'
    version_payload = OpportunityVersionPayload(
        headline=str(posting.get('title') or 'Oportunidad')[:180],
        role=str(posting.get('title') or '')[:180],
        compensation_summary=UNSPECIFIED,
        location_summary=', '.join(posting.get('locations') or []) or UNSPECIFIED,
        experience_summary=UNSPECIFIED,
        application_type=application_type,
        application_url=application_url,
        next_step={'action': 'view_process' if source_url else 'none',
                   'label': 'Ver proceso de candidatura' if source_url else 'Sin proceso verificado',
                   'destination_label': 'Publicación original' if source_url else UNSPECIFIED,
                   'destination_domain': (source_url or '').split('/')[2] if '://' in (source_url or '') else None,
                   'requires_account': None, 'enabled': False,
                   'disabled_reason': 'Revisión editorial pendiente'},
        field_provenance={'headline': 'job_postings.title literal', 'location_summary': 'job_postings.locations literal',
                          'application_url': 'job_postings.application_url literal'},
    ).model_dump()
    created = now()
    opportunity_id = uid()
    version_id = uid()
    db.execute("INSERT INTO opportunities(id,org_id,job_id,current_version_id,editorial_status,created_at,updated_at) "
               "VALUES(?,?,?,?,?,?,?)", (opportunity_id, organization, job_id, version_id, 'draft', created, created))
    db.execute("""INSERT INTO opportunity_versions
        (id,org_id,opportunity_id,version,locale,payload,job_revision_hash,presentation_schema_version,
         created_by,selection_method,selection_policy_version,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
               (version_id, organization, opportunity_id, 1, 'es', json.dumps(version_payload, ensure_ascii=False),
                '', '1', 'backfill', version_payload['selection_method'], version_payload['selection_policy_version'], created))
    description = str(posting.get('description') or '')
    locations = posting.get('locations') or []
    eligibility = JobEligibility(
        employer_country=fold_country(locations[0]) if locations else None,
        backfilled=True, **eligibility_backfill(description))
    db.execute('INSERT INTO job_eligibility VALUES(?,?,?,?)',
               (organization, job_id, json.dumps(eligibility.model_dump(), ensure_ascii=False), created))
    return 1


def ensure_opportunity(db, organization: str, job_id: str, posting: dict) -> None:
    """Hook del pipeline de importación: toda oferta elegible obtiene su WDCOpportunity draft."""
    if db.execute('SELECT 1 FROM opportunities WHERE org_id=? AND job_id=?',
                  (organization, job_id)).fetchone():
        return
    backfill_opportunity(db, organization, job_id, posting)


def _current_version(db, organization: str, opportunity) -> dict | None:
    version_id = opportunity['current_version_id']
    if version_id:
        row = db.execute('SELECT * FROM opportunity_versions WHERE org_id=? AND id=?',
                         (organization, version_id)).fetchone()
        if row:
            return dict(row)
    row = db.execute("""SELECT * FROM opportunity_versions WHERE org_id=? AND opportunity_id=?
                        ORDER BY version DESC LIMIT 1""", (organization, opportunity['id'])).fetchone()
    return dict(row) if row else None


def admin_dto(organization: str, opportunity, version: dict | None, eligibility_row,
              job_row: dict) -> WDCOpportunityDTO:
    payload = json.loads(version['payload']) if version else {}
    eligibility = json.loads(eligibility_row['facts']) if eligibility_row else {}
    return WDCOpportunityDTO(
        id=opportunity['id'], job_id=opportunity['job_id'],
        current_version_id=opportunity['current_version_id'],
        version=version['version'] if version else None,
        editorial_status=opportunity['editorial_status'],
        opportunity_status=opportunity['opportunity_status'],
        last_verified_at=opportunity['last_verified_at'],
        verified_until=opportunity['verified_until'],
        status_reason=opportunity['status_reason'],
        connection_type=opportunity['connection_type'],
        locale=version['locale'] if version else 'es',
        version_payload=payload, eligibility=JobEligibility(**eligibility),
        job_snapshot={'title': job_row.get('title'), 'company': job_row.get('company'),
                      'description': (job_row.get('description') or '')[:400],
                      'source_url': job_row.get('source_url'), 'locations': job_row.get('locations') or [],
                      'published_at': job_row.get('published_at'), 'source': job_row.get('source')})


def student_dto(organization: str, opportunity, version: dict | None, job_row: dict,
                attribution: list[dict]) -> StudentOpportunityDTO | None:
    """Solo approved/published llegan al feed; los demás estados no generan DTO."""
    if opportunity['editorial_status'] not in {'approved', 'published'}:
        return None
    if not version:
        return None
    payload = json.loads(version['payload'])
    return StudentOpportunityDTO(
        id=opportunity['id'], version=version['version'],
        headline=payload.get('headline') or 'Oportunidad',
        company_name=str(job_row.get('company') or '').strip() or None,
        role=payload.get('role') or str(job_row.get('title') or ''),
        short_summary=payload.get('short_summary') or '',
        what_they_are_looking_for=payload.get('what_they_are_looking_for') or [],
        what_you_would_do=payload.get('what_you_would_do') or [],
        compensation_summary=payload.get('compensation_summary') or UNSPECIFIED,
        location_summary=payload.get('location_summary') or UNSPECIFIED,
        language_requirements=payload.get('language_requirements') or [],
        experience_summary=payload.get('experience_summary') or UNSPECIFIED,
        why_it_may_be_interesting=payload.get('why_it_may_be_interesting') or [],
        published_at=job_row.get('published_at'),
        published_relative=relative_date(job_row.get('published_at')),
        opportunity_status=opportunity['opportunity_status'],
        status_reason=opportunity['status_reason'],
        last_verified_at=opportunity['last_verified_at'],
        next_step=payload.get('next_step') or {},
        connection_type=opportunity['connection_type'],
        application_type=payload.get('application_type') or 'unknown',
        application_url=payload.get('application_url'),
        attribution=attribution)


def _job_snapshot(db, organization: str, job_id: str) -> dict | None:
    row = db.execute("""SELECT p.payload, p.source, j.id FROM jobs j
        JOIN job_postings p ON p.org_id=j.org_id AND p.id=j.posting_id
        WHERE j.org_id=? AND j.id=?""", (organization, job_id)).fetchone()
    if not row:
        return None
    posting = json.loads(row['payload'])
    return {'id': row['id'], 'title': posting.get('title'), 'company': posting.get('company'),
            'description': posting.get('description'), 'source_url': posting.get('source_url'),
            'application_url': posting.get('application_url'), 'locations': posting.get('locations') or [],
            'published_at': posting.get('published_at'), 'source': row['source']}


def _attribution(db, organization: str, job_id: str) -> list[dict]:
    rows = db.execute("""SELECT p.source, p.payload FROM job_postings p
        JOIN jobs j ON j.org_id=p.org_id AND j.posting_id=p.id
        WHERE j.org_id=? AND j.id=?""", (organization, job_id)).fetchall()
    out = []
    for row in rows:
        posting = json.loads(row['payload'])
        out.append({'source': row['source'], 'source_url': posting.get('source_url'),
                    'original_title': posting.get('title')})
    return out


@router.get('/opportunities', response_model=WDCOpportunityList)
def list_opportunities(editorial_status: str | None = None, limit: int = 50):
    """Admin: listado de WDCOpportunities con estado derivado y trazabilidad mínima."""
    organization = org()
    where = 'WHERE org_id=?' + (' AND editorial_status=?' if editorial_status else '')
    query = f'SELECT * FROM opportunities {where} ORDER BY updated_at DESC LIMIT ?'
    params = [organization] + ([editorial_status] if editorial_status else []) + [min(limit, 200)]
    with connect() as db:
        total = db.execute(f'SELECT count(*) FROM opportunities {where}',
                           params[:-1]).fetchone()[0]
        rows = db.execute(query, params).fetchall()
        items = []
        for row in rows:
            version = _current_version(db, organization, row)
            eligibility = db.execute('SELECT facts FROM job_eligibility WHERE org_id=? AND job_id=?',
                                     (organization, row['job_id'])).fetchone()
            job = _job_snapshot(db, organization, row['job_id'])
            items.append(admin_dto(organization, row, version, eligibility, job or {}).model_dump())
    return {'items': items, 'total': total}


def _build_admin_response(db, organization: str, opportunity_id: str) -> dict:
    row = db.execute('SELECT * FROM opportunities WHERE org_id=? AND id=?',
                     (organization, opportunity_id)).fetchone()
    if not row:
        raise HTTPException(404, 'Oportunidad no encontrada')
    version = _current_version(db, organization, row)
    eligibility = db.execute('SELECT facts FROM job_eligibility WHERE org_id=? AND job_id=?',
                             (organization, row['job_id'])).fetchone()
    job = _job_snapshot(db, organization, row['job_id'])
    return admin_dto(organization, row, version, eligibility, job or {}).model_dump()


@router.get('/opportunities/{opportunity_id}')
def get_opportunity(opportunity_id: str):
    organization = org()
    with connect() as db:
        return _build_admin_response(db, organization, opportunity_id)


@router.get('/opportunities/{opportunity_id}/student')
def student_view(opportunity_id: str):
    """Preview de alumna con exactamente el DTO permitido (para el renderer de publicación)."""
    organization = org()
    with connect() as db:
        row = db.execute('SELECT * FROM opportunities WHERE org_id=? AND id=?',
                         (organization, opportunity_id)).fetchone()
        if not row:
            raise HTTPException(404, 'Oportunidad no encontrada')
        version = _current_version(db, organization, row)
        dto = student_dto(organization, row, version, _job_snapshot(db, organization, row['job_id']) or {},
                          _attribution(db, organization, row['job_id']))
        if not dto:
            raise HTTPException(409, 'La oportunidad no está aprobada ni publicada; sin vista de alumna')
        return dto.model_dump()


class ReviewRequest(BaseModel):
    editorial_status: EDITORIAL
    version_payload: dict
    locale: Locale = 'es'
    reviewed_by: str | None = None


@router.post('/opportunities/{opportunity_id}/review')
def review(opportunity_id: str, body: ReviewRequest):
    """Revisión editorial: crea versión nueva e inmutable y mueve el puntero; el raw no cambia."""
    organization = org()
    with connect() as db:
        row = db.execute('SELECT * FROM opportunities WHERE org_id=? AND id=?',
                         (organization, opportunity_id)).fetchone()
        if not row:
            raise HTTPException(404, 'Oportunidad no encontrada')
        previous = _current_version(db, organization, row)
        if not previous:
            raise HTTPException(409, 'La oportunidad no tiene versión que revisar')
        try:
            payload = OpportunityVersionPayload(**body.version_payload).model_dump()
        except ValidationError as exc:
            # El formulario puede enviar campos inventados tras una edición: nombrarlos
            # exactamente es más accionable que un 422 de pydantic con rutas anidadas.
            unknown = sorted({str(error['loc'][0]) for error in exc.errors() if error['type'] == 'extra_forbidden'})
            if unknown:
                raise HTTPException(422, 'Campos no permitidos en version_payload: ' + ', '.join(unknown)) from None
            raise HTTPException(422, 'version_payload no cumple el esquema: ' +
                                '; '.join(f"{error['loc'][0]}: {error['msg']}" for error in exc.errors()[:3])) from None
        if body.editorial_status == 'published' and payload['application_type'] == 'unknown':
            raise HTTPException(422, 'No se publica sin modalidad de candidatura determinada; usa needs_review')
        if body.editorial_status == 'published' and opportunity_status(row) == 'closed':
            raise HTTPException(409, 'No se publica una oportunidad cerrada')
        if body.editorial_status == 'published' and payload['next_step'].get('enabled') \
                and opportunity_status(row) != 'active':
            raise HTTPException(409, 'El siguiente paso solo se habilita con vigencia activa verificada')
        if opportunity_status(row) == 'active' and payload.get('application_url') \
                and not payload['next_step'].get('enabled'):
            # Con vigencia activa verificada el CTA se habilita solo: su disponibilidad se
            # deriva de la verificación, no de que el operador recuerde un flag oculto.
            payload['next_step']['enabled'] = True
            payload['next_step'].pop('disabled_reason', None)
        max_version = db.execute('SELECT max(version) FROM opportunity_versions WHERE org_id=? AND opportunity_id=?',
                                 (organization, row['id'])).fetchone()[0] or 0
        created = now()
        new_id = uid()
        db.execute("""INSERT INTO opportunity_versions
            (id,org_id,opportunity_id,version,locale,payload,job_revision_hash,presentation_schema_version,
             created_by,selection_method,selection_policy_version,created_at,reviewed_by,reviewed_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                   (new_id, organization, row['id'], max_version + 1, body.locale,
                    json.dumps(payload, ensure_ascii=False), '', '1', 'admin', payload['selection_method'],
                    payload['selection_policy_version'], created,
                    body.reviewed_by or None, created if body.editorial_status in {'approved', 'published', 'withdrawn'} else None))
        db.execute('UPDATE opportunities SET current_version_id=?, editorial_status=?, updated_at=? '
                   'WHERE org_id=? AND id=?', (new_id, body.editorial_status, created, organization, row['id']))
        return _build_admin_response(db, organization, row['id'])


def opportunity_status(row) -> str:
    return row['opportunity_status']


# --- Verificación de vigencia (P01B): una comprobación real escribe verification_events ---

# TTL por tipo de fuente: una decisión documentada, no una constante global. Cuanto más
# intermediado está el canal (agregadores que repintan fichas), antes caduca la vigencia;
# un ATS de la empresa es la señal más estable y admite la vigencia más larga.
TTL_HOURS_BY_KIND = {
    'ats': 72,        # endpoint oficial de la empresa: la oferta vive en su dominio
    'serpapi': 24,    # motor de búsqueda con caché propia: la ficha puede desaparecer hoy
    'aggregator': 48,  # job board que agrega ofertas de terceros
}
DEFAULT_TTL_HOURS = 24  # fuente desconocida = TTL corto conservador
AGGREGATOR_SOURCES = {'himalayas', 'weworkremotely', 'jobicy', 'remotive', 'remoteok', 'arbeitnow',
                      'workingnomads', 'virtualvocations', 'remotejobs', 'remotefirstjobs',
                      'jobspresso', 'remotojob', 'getonbrd-public', 'freehire'}

# Título en mayúsculas/minúsculas-insensible y sin acentos (folded del pipeline).
_TITLE_MIN_CHARS = 5


def _source_kind(source: str) -> str:
    if source.startswith('ats-'):
        return 'ats'
    if source.startswith('google'):
        return 'serpapi'
    if source in AGGREGATOR_SOURCES or source.startswith('jobtoday'):
        return 'aggregator'
    return 'unknown'

class VerifyRequest(BaseModel):
    """El operador decide la URL comprobada; por defecto la del anuncio original."""
    url: str | None = None
    force: bool = False


class VerificationResult(BaseModel):
    result: VERDICT
    method: str
    checked_at: str
    valid_until: str | None
    reason_code: str
    evidence_raw_id: str | None
    opportunity_status: ACTIVITY
    next_step_enabled: bool
    status_reason: str | None


def ttl_hours_for_source(source: str) -> int:
    """TTL documentado por tipo de fuente; fuente desconocida = TTL corto conservador."""
    return TTL_HOURS_BY_KIND.get(_source_kind(source), DEFAULT_TTL_HOURS)


def _store_verification_evidence(db, organization: str, job_id: str, method: str,
                                 url: str, detail: dict) -> str:
    """La evidencia de la comprobación es raw inmutable (fuente 'verification');
    nunca se reescribe: verification_events.evidence_raw_id apunta a ella."""
    evidence_id = uid()
    payload = json.dumps({'url': url, 'method': method, 'detail': detail}, ensure_ascii=False)
    db.execute("INSERT OR IGNORE INTO raw_items VALUES(?,?,?,?,?,?,?,?)",
               (evidence_id, organization, 'verification', 'http_status_content_v1',
                job_id, hashlib.sha256(payload.encode()).hexdigest(), payload, now()))
    return db.execute("SELECT id FROM raw_items WHERE org_id=? AND source='verification' AND external_id=? AND content_hash=?",
                      (organization, job_id, hashlib.sha256(payload.encode()).hexdigest())).fetchone()['id']


def _classify_verification(status: int, title_found: bool, company_found: bool) -> tuple[str, str]:
    """Regla P01B: HTTP 200 no basta; el contenido debe corroborar la oferta.
    closed = el origen declara que la oferta ya no existe; unknown = no se puede afirmar nada."""
    if status in {404, 410}:
        return 'closed', 'job_not_found'
    if status == 200:
        if title_found or company_found:
            return 'open', 'content_matches'
        return 'unknown', 'content_not_corroborated'
    if status == 403 or status == 429:
        return 'unknown', 'source_blocked'
    return 'unknown', 'http_' + str(status)


def _check_target(url: str, title: str, company: str) -> tuple[str, str, dict]:
    """Un GET acotado (timeout 10 s, 1 petición, sin reintentos) sobre la URL del
    anuncio; el resultado se clasifica con el contenido, no solo con el código HTTP."""
    try:
        response = httpx.get(url, timeout=10, follow_redirects=False,
                             headers={'User-Agent': USER_AGENT})
    except Exception:
        return 'unknown', 'network_unreachable', {}
    if response.status_code in {301, 302, 303, 307, 308}:
        return 'unknown', 'redirect_without_verification', {}
    title_folded = folded(title)
    body_folded = folded(response.text[:200_000])
    title_found = bool(title_folded) and len(title_folded) >= _TITLE_MIN_CHARS and title_folded in body_folded
    company_folded = folded(company)
    company_found = bool(company_folded) and company_folded in body_folded
    result, reason_code = _classify_verification(status=response.status_code, title_found=title_found,
                                                 company_found=company_found)
    detail = {'http_status': response.status_code, 'title_found': title_found,
              'company_found': company_found, 'checked_chars': len(response.text[:200_000])}
    return result, reason_code, detail


def _apply_verification(db, organization: str, opportunity, job: dict, result: str,
                        reason_code: str, method: str,
                        evidence_raw_id: str | None) -> tuple[str, str | None]:
    """Escribe el evento + actualiza la fila opportunities con la vigencia derivada."""
    checked_at = now()
    if result == 'open':
        valid_until = (datetime.now(timezone.utc)
                       + timedelta(hours=ttl_hours_for_source(str(job.get('source') or '')))).isoformat()
    else:
        valid_until = None
    db.execute("INSERT INTO verification_events VALUES(?,?,?,?,?,?,?,?,?,?,?)",
               (uid(), organization, opportunity['job_id'], opportunity['posting_id'] if 'posting_id' in opportunity.keys() else None,
                checked_at, result, method, evidence_raw_id, valid_until, reason_code, '1'))
    status = {'open': 'active', 'closed': 'closed', 'unknown': 'verifying'}[result]
    status_reason = {'open': f"Verificado activa ({method}); vigente hasta {valid_until}",
                     'closed': f"Cerrada según el origen ({reason_code})",
                     'unknown': f"No verificable ({reason_code}); sigue verificando"}[result]
    db.execute('''UPDATE opportunities SET opportunity_status=?, last_verified_at=?, verified_until=?,
                  status_reason=?, updated_at=? WHERE org_id=? AND id=?''',
               (status, checked_at, valid_until, status_reason, checked_at, organization, opportunity['id']))
    # El CTA de la versión vigente se deriva de la vigencia real: enabled solo con active.
    version = _current_version(db, organization, opportunity)
    if version:
        payload = json.loads(version['payload'])
        if payload.get('next_step', {}).get('enabled') != (status == 'active'):
            payload['next_step']['enabled'] = status == 'active'
            if status == 'active':
                payload['next_step'].pop('disabled_reason', None)
            else:
                payload['next_step']['disabled_reason'] = status_reason
            db.execute("UPDATE opportunity_versions SET payload=? WHERE org_id=? AND id=?",
                       (json.dumps(payload, ensure_ascii=False), organization, version['id']))
    return checked_at, valid_until


@router.post('/opportunities/{opportunity_id}/verify', response_model=VerificationResult)
def verify_opportunity(opportunity_id: str, body: VerifyRequest | None = None):
    """Verificación real de vigencia (spec 17): un GET acotado y contenido corroborante.
    HTTP 200 solo nunca basta: el cuerpo debe mencionar el título o la empresa del anuncio.
    Escribe verification_events (TTL por fuente) + evidencia raw inmutable + estado de vigencia."""
    body = body or VerifyRequest()
    organization = org()
    with connect() as db:
        row = db.execute('SELECT * FROM opportunities WHERE org_id=? AND id=?',
                         (organization, opportunity_id)).fetchone()
        if not row:
            raise HTTPException(404, 'Oportunidad no encontrada')
        job = _job_snapshot(db, organization, row['job_id'])
        if not job:
            raise HTTPException(409, 'La oportunidad no tiene oferta original que verificar')
        url = body.url or job.get('application_url') or job.get('source_url')
        if not url:
            raise HTTPException(409, 'Sin URL verificable: guarda un enlace de candidatura en la revisión')
        title, company = job.get('title') or '', job.get('company') or ''
        result, reason_code, detail = _check_target(url, title, company)
        method = 'http_status_content_v1'
        evidence_raw_id = _store_verification_evidence(db, organization, row['job_id'], method, url, detail)
        checked_at, valid_until = _apply_verification(db, organization, row, job, result, reason_code,
                                                      method, evidence_raw_id)
        refreshed = db.execute('SELECT * FROM opportunities WHERE org_id=? AND id=?',
                               (organization, opportunity_id)).fetchone()
        version = _current_version(db, organization, refreshed)
        next_step = (json.loads(version['payload']).get('next_step') or {}) if version else {}
        return VerificationResult(
            result=result, method=method, checked_at=checked_at, valid_until=valid_until,
            reason_code=reason_code, evidence_raw_id=evidence_raw_id,
            opportunity_status=refreshed['opportunity_status'],
            next_step_enabled=bool(next_step.get('enabled')),
            status_reason=refreshed['status_reason'])
