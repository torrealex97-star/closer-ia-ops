"""Acquisition capabilities; metadata inspection is not an extraction validation."""
import json
from functools import lru_cache
from pathlib import Path
from urllib.parse import quote


@lru_cache(maxsize=1)
def audit():
    path = Path(__file__).with_name('source_audit.json')
    return json.loads(path.read_text()) if path.exists() else {}


PUBLIC = {
    'himalayas': ('Búsqueda API', ['Palabras clave', 'País', 'Orden reciente'], 'España primero; hasta tres páginas por término y mercado.'),
    'getonbrd-public': ('API por categoría', ['Categoría ventas'], 'No admite todos los filtros WDC en origen; idioma y modalidad se comprueban al importar.'),
    'remotive': ('API por categoría', ['Categoría ventas'], 'Consulta de ventas cacheada seis horas. El resto de requisitos se comprueba al importar.'),
    'weworkremotely': ('RSS de ventas y marketing', ['Categoría ventas y marketing'], 'Feed de categoría; no garantiza búsqueda por palabras clave. Validación local final.'),
    'remoteok': ('Feed público', [], 'El feed no ofrece filtros verificados para este flujo; descarga compartida y cacheada.'),
    'arbeitnow': ('Feed público', [], 'Sin búsqueda por keywords verificada; no se inventan parámetros. Filtrado local.'),
}


def strategy(code):
    if code in PUBLIC:
        method, filters, note = PUBLIC[code]
        return {'acquisition_method': method, 'upstream_filters': filters, 'acquisition_note': note,
                'validation_status': 'Conector operativo', 'provider_candidates': [], 'checked_at': ''}
    record = audit().get(code, {})
    candidates = record.get('candidates', [])
    fields = set().union(*(set(c['fields']) for c in candidates)) if candidates else set()
    filters = []
    for label, keys in [('Palabras clave', {'keywords','searchQueries','searchTerm','searchQuery','query','keyword','search'}),
                        ('Enlaces de búsqueda filtrados', {'startUrls','urls','searchUrls','searchUrl','startUrl'}),
                        ('Ubicación', {'location','country','city'}),
                        ('Modalidad', {'onlyTeleworking','remote','workplaceType','jobType'})]:
        if fields & keys:
            filters.append(label)
    return {'acquisition_method': 'Apify · selección guiada' if candidates else 'Adaptador específico pendiente',
            'upstream_filters': filters,
            'acquisition_note': 'Capacidades de candidatos, no de todos los scrapers. Preparar verifica el esquema y muestra qué filtros se enviarán. La primera extracción valida la salida.' if candidates else 'No se ha verificado un scraper compatible. Necesita una búsqueda pública concreta y validar un proveedor o adaptador; no se ejecuta un rastreo general.',
            'validation_status': 'Metadatos revisados · extracción pendiente' if candidates else 'Sin proveedor verificado',
            'provider_candidates': [c['url'] for c in candidates], 'checked_at': record.get('checked_at','')}


def discovery_url(name):
    return 'https://apify.com/store?search=' + quote(name + ' scraper')


BRANDS = {
    "jooble": ["jooble"], "simplyhired": ["simplyhired", "simply-hired"],
    'infojobs': ['infojobs'], 'computrabajo': ['computrabajo'], 'workana': ['workana'],
    'getonbrd': ['getonbrd'], 'linkedin': ['linkedin'], 'indeed': ['indeed'],
    'infoempleo': ['infoempleo'], 'jobtoday': ['jobtoday'], 'trabajos': ['trabajos-com'],
    'torre': ['torre-ai', 'torre-co', 'torre-scraper'], 'weremoto': ['weremoto'], 'remotoco': ['remoto-co'],
    'laborum': ['bumeran', 'laborum'], 'elempleo': ['elempleo'], 'upwork': ['upwork'],
    'freelancer': ['freelancer-com'], 'malt': ['malt'], 'eures': ['eures'],
    'europe-language': ['europelanguagejobs', 'europe-language-jobs'], 'jobsqd': ['jobsqd'],
    'facebook': ['facebook'], 'linkedin-posts': ['linkedin'], 'skool': ['skool'],
    'telegram': ['telegram'], 'reddit': ['reddit'], 'company': ['greenhouse', 'lever', 'ashby'],
}


def actor_matches(source, actor):
    # Store search is fuzzy (Torre returned torrent downloaders). Fail closed.
    name = actor.split('/')[-1].lower()
    if not any(brand in name for brand in BRANDS.get(source, [])):
        return False
    if any(word in name for word in ['members', 'reactions', 'profile-scraper', 'freelancers']):
        return False
    if source == 'malt' and not any(word in name for word in ['job', 'mission']):
        return False
    if source == 'skool' and 'post' not in name:
        return False
    if source == 'linkedin' and not any(word in name for word in ['job', 'search-api']):
        return False
    if source == 'linkedin-posts' and 'post' not in name:
        return False
    return True


@lru_cache(maxsize=1)
def source_presets():
    return json.loads(Path(__file__).with_name('wdc_source_presets.json').read_text())


def suggested_searches(code, organization):
    presets = source_presets()
    if organization != presets['organization']:
        return []
    return sorted([{k: row[k] for k in ['name', 'url', 'language', 'preferred']}
                   for row in presets['searches'] if row['source'] == code], key=lambda row: not row['preferred'])
