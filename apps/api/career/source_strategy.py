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
    'himalayas': ('Búsqueda API', ['Palabras clave', 'País', 'Orden reciente'], 'España primero; hasta diez páginas por término y mercado, parando en página vacía.'),
    'getonbrd-public': ('API por categoría', ['Categoría ventas'], 'No admite todos los filtros WDC en origen; idioma y modalidad se comprueban al importar.'),
    'remotive': ('API por categoría', ['Categoría ventas'], 'Consulta de ventas cacheada seis horas. El resto de requisitos se comprueba al importar.'),
    'weworkremotely': ('RSS de ventas y marketing', ['Categoría ventas y marketing'], 'Feed de categoría; no garantiza búsqueda por palabras clave. Validación local final.'),
    'remoteok': ('Feed público', [], 'El feed no ofrece filtros verificados para este flujo; descarga compartida y cacheada.'),
    'arbeitnow': ('Feed público', [], 'Sin búsqueda por keywords verificada; no se inventan parámetros. Filtrado local.'),
    'workingnomads': ('API pública', [], 'Descarga global cacheada una hora; sin filtros upstream verificados. Validación local.'),
    'virtualvocations': ('RSS general', [], 'Feed sin filtro de categoría; acepta perfiles de ventas y se filtra al importar.'),
    'remotejobs': ('RSS general', [], 'Feed sin filtro de categoría; acepta perfiles de ventas y se filtra al importar.'),
    'jobicy': ('API pública por industria', ['Industria ventas (slug seller)'], 'Descarga de la industria Sales; el resto de requisitos se comprueba al importar.'),
    'remotefirstjobs': ('RSS de ventas', [], 'Feed de la categoría ventas con descripción completa; validación local final.'),
    'jobspresso': ('RSS general', [], 'Ofertas curadas sin filtro de categoría; se filtra al importar.'),
    'remotojob': ('RSS general', [], 'Vacantes diarias en español; sin filtro de categoría en origen. Validación local.'),
    'jobtoday': ('Listado embebido (NEXT_DATA)', ['Ruta por keyword (closer)'], 'Ofertas comerciales España del listado closer-venta; sin keywords en origen. Validación local final.'),
    'jobtoday-telemarketing': ('Listado embebido (NEXT_DATA)', ['Ruta por keyword (telemarketing)'], 'Listado televenta España; sin keywords en origen. Validación local final. La ruta setter devuelve 410 Gone.'),
    'jobtoday-remoto': ('Listado embebido (NEXT_DATA)', ['Ruta por keyword (ventas-remoto)'], 'Listado comercial remoto España; sin keywords en origen. Validación local final.'),
    'closers-avenue': ('Sin listado público', [], 'Su bolsa devuelve 500 (2026-09-23). Entrada informativa: requiere Actor opt-in o acceso autorizado; no extraíble hoy.'),
    'google': ('SerpApi · motor google_jobs (pendiente de conectar)', ['Dork completo (site:, comillas, ubicación)', 'País (gl) e idioma (hl)'], 'Preset de la taxonomía WDC: cada dork busca en Google ofertas indexadas de LinkedIn y portales con filtros exactos. Necesita API key de SerpApi y se paga por búsqueda; sujeto al presupuesto diario de ADR-009. Hasta conectar la clave, los dorks son enlaces ejecutables para revisión manual.'),
}


def strategy(code):
    if code in PUBLIC:
        method, filters, note = PUBLIC[code]
        # Entradas informativas sin listado extraíble no son conectores operativos.
        # 'pendiente' en el método = requiere credencial/proveedor aún no conectado.
        if method == 'Sin listado público':
            status = 'Sin listado público extraíble'
        elif 'pendiente' in method.lower():
            status = 'Requiere API key · presets listos'
        else:
            status = 'Conector operativo'
        return {'acquisition_method': method, 'upstream_filters': filters, 'acquisition_note': note,
                'validation_status': status, 'provider_candidates': [], 'checked_at': ''}
    if code.startswith('ats-'):
        return {'acquisition_method': 'ATS público por empresa', 'upstream_filters': [],
                'acquisition_note': 'Tablero público de la empresa según su watchlist; sin palabras clave en origen. El filtrado es local.',
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
    "jooble": ["jooble"], "simplyhired": ["simplyhired", "simply-hired"], 'google': ['serpapi', 'google-jobs', 'google-search'],
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
