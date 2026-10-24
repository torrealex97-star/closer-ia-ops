"""Allowlisted student presentation: company, conditions and an honest next step."""
import json
import re
from collections import Counter
from datetime import datetime
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from .catalog import collection_query
from .db import connect, now, org
from .pipeline import match
from .presentation import fold, language_evidence, professional_role
from .sources import source_infos


def _role_for(item, job_id, organization):
    """Determinista primero (parsers son el primer paso, ADR-007); si no clasifica,
    la clasificación IA opt-in completa el hueco léxico cuando es válida."""
    role = professional_role(item['title'], item['description'])
    if role:
        return role, None
    from .classification import llm_role_for
    llm = llm_role_for(job_id, organization)
    if llm:
        return llm['family'], llm
    return None, None

router = APIRouter(prefix='/v1/opportunities')
Role = Literal['closer', 'setter', 'cold_caller', 'account_executive', 'sdr']
LABELS = {'closer': 'Closer', 'setter': 'Setter', 'cold_caller': 'Cold Caller',
          'account_executive': 'Ejecutivo comercial', 'sdr': 'SDR / BDR'}
# account_executive y sdr son vocabulario canónico real: si la alumna elige Closer
# y la oferta es solo AE/SDR, no compiten por el mismo hueco.
ROLE_FILTER_MAP = {'closer': {'closer'}, 'setter': {'setter'}, 'cold_caller': {'cold_caller'},
                   'account_executive': {'account_executive'}, 'sdr': {'sdr'}}
# Selección de excelencia (SPEC-002): el catálogo puede traer cientos de elegibles;
# la alumna ve primero las 10-20 que mejor cumplen los requisitos del día.
TOP_TARGET = 20
ROLE_PRIORITY = {'closer': 0, 'setter': 1, 'cold_caller': 2}
EXTRA_ROLES = {'account_executive', 'sdr'}
COUNTRIES = {'united states': 'Estados Unidos', 'usa': 'Estados Unidos', 'spain': 'España',
             'mexico': 'México', 'germany': 'Alemania', 'france': 'Francia', 'italy': 'Italia',
             'united kingdom': 'Reino Unido', 'europe': 'Europa', 'worldwide': 'Todo el mundo',
             'latin america': 'Latinoamérica', 'netherlands': 'Países Bajos', 'ireland': 'Irlanda'}


class OpportunityQuery(BaseModel):
    role: Role | None = None
    market: Literal['any', 'ES', 'EU', 'LATAM', 'US'] = 'any'
    days: int = Field(default=10, ge=1, le=10)
    include_bilingual: bool = False
    starred_only: bool = False
    include_extra_roles: bool = False


class Contact(BaseModel):
    """Contacto publicado por el anuncio; vacío cuando no publica ninguno."""
    emails: list[str] = Field(default_factory=list)
    phones: list[str] = Field(default_factory=list)


class Opportunity(BaseModel):
    id: str
    role: Role
    role_label: str
    original_title: str
    company: str
    compensation: str
    compensation_note: str
    modality: str
    location: str
    language: str
    experience: str
    schedule: str
    contract: str
    description: str
    published_at: str | None
    expires_at: str
    source_name: str
    source_url: str
    starred: bool
    excellence_rank: int | None = None
    is_selected: bool = False
    # Opcionales: solo las ofertas externas traen enlace de candidatura propio, web corporativa
    # publicada, contacto literal y mercado deducido. El motor no los emite, así que ausente ≠ error.
    apply_url: str | None = None
    company_url: str | None = None
    contact: Contact | None = None
    market: Literal['ES', 'LATAM', 'US_LATINO'] | None = None


class OpportunityList(BaseModel):
    items: list[Opportunity]
    total: int
    selection_total: int = Field(default=0, ge=0)


def excerpt(description, pattern, fallback):
    for line in re.split(r'[\n]+|(?<=[.!?])\s+', description):
        if re.search(pattern, fold(line)):
            return re.sub(r'\s+', ' ', line).strip()[:230]
    return fallback


def compensation(item):
    # Prefer literal context: structured amounts alone don't distinguish fixed from OTE.
    evidence = excerpt(item['description'], r'\b(?:salario|sueldo|compensacion|remuneracion|pago|comisiones|comisional|salary|compensation|pay rate)\b', '')
    if evidence and re.search(r'\d|base|fijo|comision|commission', fold(evidence)):
        label = re.sub(r'^(?:Compensación|Remuneración|Atractivo Salarial):\s*', '', evidence, flags=re.I)
        if re.match(r'^Contrato:', label, re.I) and re.search(r'\bsalario\b', label, re.I):
            label = label[re.search(r'\bsalario\b', label, re.I).start():]
        label = label[:1].upper() + label[1:]
    elif item.get('salary_min') is not None or item.get('salary_max') is not None:
        low, high = item.get('salary_min'), item.get('salary_max')
        def amount(value):
            return f'{value:,.0f}'.replace(',', '.')
        label = f'{amount(low)} – {amount(high)}' if low is not None and high is not None else f'Desde {amount(low)}' if low is not None else f'Hasta {amount(high)}'
        period = {'annual': 'año', 'yearly': 'año', 'monthly': 'mes', 'hourly': 'hora', 'weekly': 'semana'}.get(item.get('salary_period'), '')
        label += f" {item.get('salary_currency') or '(moneda sin indicar)'}" + (f' / {period}' if period else '')
    else:
        return 'Importe no publicado', 'Pregunta por el fijo y las comisiones antes de avanzar.'
    variable = bool(re.search(r'comision|commission|\bote\b|promedio|potencial|hasta', fold(label)))
    note = 'La parte variable no es un ingreso garantizado.' if variable else 'Importe anunciado; confirma periodicidad y condiciones.'
    extra = excerpt(item['description'], r'\b(?:promedio comisional|ote|potencial)\b.*\d', '')
    if extra and extra not in label:
        note += ' ' + extra
    return label, note


def _select_top(ranked: list[Opportunity], target: int = TOP_TARGET) -> list[Opportunity]:
    """Las mejores del rango ya ordenado, con máximo dos plazas por empresa: el top
    no puede ser un mismo anunciante repetido. Nunca se rellena con relleno: si hay
    menos ofertas con empresas distintas, la selección es más corta ese día. Los roles
    extra (AE/SDR) son visibles por opt-in pero no protagonizan el top WDC."""
    top, counts = [], Counter()
    for offer in ranked:
        if len(top) >= target:
            break
        if offer.role in EXTRA_ROLES:
            continue
        company = str(offer.company).strip().lower()
        if counts[company] >= 2:
            continue
        counts[company] += 1
        top.append(offer)
    return top


def _published_ts(item):
    if not item.get('published_at'):
        return None
    try:
        return datetime.fromisoformat(str(item['published_at'])).timestamp()
    except (ValueError, TypeError):
        return None


def _search_result(body: OpportunityQuery, organization=None):
    """Corazón de la vista de alumna (filtros, idioma, ranking, selección de excelencia).
    Reutilizado por el embudo diario (funnel.py) con la organización explícita y la
    consulta por defecto, para que sus contadores midan exactamente las mismas puertas
    que verá la alumna. Nunca se consultan proveedores ni IA: solo BD local."""
    organization = org() if organization is None else organization
    query = collection_query().model_copy(update={'market': body.market, 'days': body.days})
    names = {s['code']: s['name'] for s in source_infos(organization)}
    with connect() as db:
        rows = db.execute('''SELECT j.id,j.starred,p.payload,p.source,c.expires_at
            FROM catalog_entries c JOIN jobs j ON j.org_id=c.org_id AND j.id=c.job_id
            JOIN job_postings p ON p.org_id=j.org_id AND p.id=j.posting_id
            WHERE c.org_id=? AND c.expires_at>? ORDER BY c.first_seen_at DESC,j.id''', (organization, now())).fetchall()
    items, seen, quality = [], set(), {}
    for row in rows:
        if body.starred_only and not row['starred']:
            continue
        item = json.loads(row['payload'])
        role, llm = _role_for(item, row['id'], organization)
        language = language_evidence(item['description'])
        matching = match(item, query)
        if not role or not matching:
            continue
        if body.role and not (body.role == role or role in ROLE_FILTER_MAP.get(body.role, {body.role})):
            continue
        # AE/SDR son visibles por defecto (trabajo comercial real), pero sin protagonismo:
        # no cuentan para el top de excelencia y se ocultan de la lista general salvo opt-in
        # del formulario. Elegirlos explícitamente en el desplegable ES el opt-in.
        if role in EXTRA_ROLES and not body.include_extra_roles and body.role != role:
            continue
        if not body.include_bilingual and (not language['spanish_text'] or language['english_required']):
            continue
        if item['source_url'] in seen:
            continue
        seen.add(item['source_url'])
        pay, note = compensation(item if language['spanish_text'] else {**item, 'description': ''})
        # Bilingual English notices stay opt-in; summaries/labels always use Spanish.
        spanish = language['spanish_text']
        details = item['description'] if spanish else ''
        work = fold(item.get('work_mode', '') + ' ' + item['description'])
        offer = Opportunity(id=row['id'], role=role, role_label=LABELS[role], original_title=item['title'],
            company=item['company'], compensation=pay if spanish or item.get('salary_min') is not None else 'Importe no publicado en campos estructurados',
            compensation_note=note, modality='Híbrido' if re.search(r'\b(?:hybrid|hibrid[oa])\b', work) else 'Remoto',
            location=', '.join(COUNTRIES.get(fold(place), place) for place in item['locations']) or 'Ubicación admitida por confirmar',
            language='Español e inglés requeridos' if language['english_required'] else 'Español requerido · anuncio original en inglés' if not spanish else 'Anuncio en español',
            experience=excerpt(details, r'\bexperiencia\b', 'Experiencia no especificada'),
            schedule=excerpt(details, r'\b(?:jornada|horario|disponibilidad|\d+\s*horas?\s*(?:semanal|a la semana))', 'Horario no especificado'),
            contract=excerpt(details, r'\b(?:contrato|contractor|freelance|autonom[oa])\b', 'Contrato no especificado'),
            description=item['description'], published_at=item['published_at'], expires_at=row['expires_at'],
            source_name=names.get(row['source'], row['source']), source_url=item['source_url'], starred=bool(row['starred']))
        # La inferencia IA se atribuye siempre: nunca pasa por clasificación humana silenciosa.
        if llm:
            offer.role_label = (LABELS.get(llm['family'], llm['family']) +
                                ' · IA (revisar)')
            offer.description = (item['description'] +
                                 f"\n\n[Clasificación IA {llm['confidence']}: {llm['reason']}]").strip()[:40000]
        items.append(offer)
        # Calidad determinista para la selección: score de match() (término del perfil,
        # frescura, ubicación, señales de proceso comercial real) + compensación publicada
        # + fecha. match() ya se ejecuta para filtrar; reutilizar su score no re-cuesta nada.
        quality[offer.id] = {'score': int(matching[0]),
                             'compensation': 0 if pay in {'Importe no publicado', 'Importe no publicado en campos estructurados'} else 1,
                             'published_ts': _published_ts(item), 'role': role}
    # Explicit Spain locations first, without interpreting remote as worldwide.
    def spain_first(offer):
        return 0 if re.search(r'\b(?:espana|spain|es)\b', fold(offer.location)) else 1
    ranked = sorted(items, key=lambda offer: (
        spain_first(offer),
        -quality[offer.id]['score'],
        -quality[offer.id]['compensation'],
        -(quality[offer.id]['published_ts'] or 0.0),
        ROLE_PRIORITY.get(quality[offer.id]['role'], 9)))
    selected = _select_top(ranked)
    selected_ids = {offer.id for offer in selected}
    items = [offer.model_copy(update={'excellence_rank': index + 1 if offer.id in selected_ids else None,
                                      'is_selected': offer.id in selected_ids})
             for index, offer in enumerate(ranked)]
    return OpportunityList(items=items, total=len(items), selection_total=len(selected))


@router.post('/search', response_model=OpportunityList)
def search(body: OpportunityQuery):
    return _search_result(body, org())
