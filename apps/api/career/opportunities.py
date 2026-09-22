"""Allowlisted student presentation: company, conditions and an honest next step."""
import json
import re
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel, Field

from .catalog import collection_query
from .db import connect, now, org
from .pipeline import match
from .presentation import fold, language_evidence, professional_role
from .sources import source_infos

router = APIRouter(prefix='/v1/opportunities')
Role = Literal['closer', 'setter', 'cold_caller']
LABELS = {'closer': 'Closer', 'setter': 'Setter', 'cold_caller': 'Cold Caller'}
COUNTRIES = {'united states': 'Estados Unidos', 'usa': 'Estados Unidos', 'spain': 'España',
             'mexico': 'México', 'germany': 'Alemania', 'france': 'Francia', 'italy': 'Italia',
             'united kingdom': 'Reino Unido', 'europe': 'Europa', 'worldwide': 'Todo el mundo',
             'latin america': 'Latinoamérica', 'netherlands': 'Países Bajos', 'ireland': 'Irlanda'}


class OpportunityQuery(BaseModel):
    role: Role | None = 'closer'
    market: Literal['any', 'ES', 'EU', 'LATAM', 'US'] = 'any'
    days: int = Field(default=10, ge=1, le=10)
    include_bilingual: bool = False
    starred_only: bool = False


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


class OpportunityList(BaseModel):
    items: list[Opportunity]
    total: int


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


@router.post('/search', response_model=OpportunityList)
def search(body: OpportunityQuery):
    organization = org()
    query = collection_query().model_copy(update={'market': body.market, 'days': body.days})
    names = {s['code']: s['name'] for s in source_infos(organization)}
    with connect() as db:
        rows = db.execute('''SELECT j.id,j.starred,p.payload,p.source,c.expires_at
            FROM catalog_entries c JOIN jobs j ON j.org_id=c.org_id AND j.id=c.job_id
            JOIN job_postings p ON p.org_id=j.org_id AND p.id=j.posting_id
            WHERE c.org_id=? AND c.expires_at>? ORDER BY c.first_seen_at DESC,j.id''', (organization, now())).fetchall()
    items, seen = [], set()
    for row in rows:
        if body.starred_only and not row['starred']:
            continue
        item = json.loads(row['payload'])
        role = professional_role(item['title'], item['description'])
        language = language_evidence(item['description'])
        if not role or (body.role and body.role != role) or not match(item, query):
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
        items.append(Opportunity(id=row['id'], role=role, role_label=LABELS[role], original_title=item['title'],
            company=item['company'], compensation=pay if spanish or item.get('salary_min') is not None else 'Importe no publicado en campos estructurados',
            compensation_note=note, modality='Híbrido' if re.search(r'\b(?:hybrid|hibrid[oa])\b', work) else 'Remoto',
            location=', '.join(COUNTRIES.get(fold(place), place) for place in item['locations']) or 'Ubicación admitida por confirmar',
            language='Español e inglés requeridos' if language['english_required'] else 'Español requerido · anuncio original en inglés' if not spanish else 'Anuncio en español',
            experience=excerpt(details, r'\bexperiencia\b', 'Experiencia no especificada'),
            schedule=excerpt(details, r'\b(?:jornada|horario|disponibilidad|\d+\s*horas?\s*(?:semanal|a la semana))', 'Horario no especificado'),
            contract=excerpt(details, r'\b(?:contrato|contractor|freelance|autonom[oa])\b', 'Contrato no especificado'),
            description=item['description'], published_at=item['published_at'], expires_at=row['expires_at'],
            source_name=names.get(row['source'], row['source']), source_url=item['source_url'], starred=bool(row['starred'])))
    return OpportunityList(items=items, total=len(items))
