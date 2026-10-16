"""Recolector programado de ofertas en España con JobSpy (open source, MIT) -> /api/ingest del panel.

Qué hace: busca ofertas de closer/setter/comercial en Indeed, LinkedIn y Google Jobs con volumen bajo y pausas,
y envía los candidatos como BORRADORES. Una alumna solo ve lo que un operador apruebe en el panel.
Decisión de riesgo: estas webs prohíben el scraping en sus condiciones de uso; el operador lo asume (ADR-011).
No guarda datos de contacto: se descartan los correos que JobSpy encuentra y se limpian teléfonos del texto.

Uso (lo lanza .github/workflows/jobspy-collect.yml):
  INGEST_URL=https://app.../api/ingest INGEST_TOKEN=... python scripts/jobspy_collect.py [--dry-run] [--sites indeed,linkedin,google]
"""
import argparse
import json
import math
import os
import sys
import time
import urllib.request

QUERIES = ['closer de ventas', 'closer high ticket', 'setter de ventas', 'televenta', 'asesor comercial', 'ejecutivo comercial', 'cold caller']
SITES = ('indeed', 'linkedin', 'google')   # el código de la fuente en el panel coincide con el nombre del sitio
RESULTS_WANTED = 20
HOURS_OLD = 240           # 10 días: la ventana del catálogo
PAUSE_SECONDS = 10        # pausa entre búsquedas para no castigar a los sitios
BATCH = 100


def clean(value):
    """NaN/None/'' de pandas -> None; el resto como cadena sin espacios sobrantes."""
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    text = str(value).strip()
    return text or None


def salary(row):
    low, high, cur, interval = (clean(row.get(k)) for k in ('min_amount', 'max_amount', 'currency', 'interval'))
    if not (low or high):
        return None
    fmt = lambda v: f'{float(v):,.0f}'.replace(',', '.')  # noqa: E731
    amount = f'{fmt(low)}–{fmt(high)}' if low and high else fmt(low or high)
    unit = {'yearly': 'año', 'monthly': 'mes', 'weekly': 'semana', 'daily': 'día', 'hourly': 'hora'}.get(interval or '', interval)
    return ' '.join(p for p in (amount, cur or '€', f'/ {unit}' if unit else None) if p)


def map_row(row, site):
    """Fila de JobSpy -> candidato del contrato de /api/ingest. Sin correos ni contactos."""
    url = clean(row.get('job_url_direct')) or clean(row.get('job_url'))
    title = clean(row.get('title'))
    external_id = clean(row.get('id')) or url
    if not (url and title and external_id) or not url.startswith(('http://', 'https://')):
        return None
    return {
        'external_id': external_id, 'title': title, 'company': clean(row.get('company')), 'location': clean(row.get('location')),
        'url': url, 'salary': salary(row), 'posted_at': clean(row.get('date_posted')), 'description': clean(row.get('description')),
        'raw': {k: v for k, v in {'site': site, 'job_type': clean(row.get('job_type')), 'is_remote': row.get('is_remote') if isinstance(row.get('is_remote'), bool) else None,
                                  'job_level': clean(row.get('job_level')), 'listing_type': clean(row.get('listing_type'))}.items() if v is not None},
    }


def map_rows(rows, site):
    seen, out = set(), []
    for row in rows:
        candidate = map_row(row, site)
        if candidate and candidate['external_id'] not in seen:
            seen.add(candidate['external_id'])
            out.append(candidate)
    return out


def post(url, token, source, candidates, note=None):
    body = json.dumps({'source': source, 'via': 'jobspy', 'candidates': candidates, 'note': note}).encode()
    request = urllib.request.Request(url, data=body, method='POST', headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {token}'})
    with urllib.request.urlopen(request, timeout=60) as response:  # noqa: S310 - URL fijada por el operador
        return json.loads(response.read())


def collect(sites, scrape, sleep=time.sleep, pause=PAUSE_SECONDS):
    """Una búsqueda por (sitio, consulta). Un fallo (p. ej. 429 de LinkedIn) no detiene el resto."""
    found, errors = {site: [] for site in sites}, []
    for site in sites:
        for query in QUERIES:
            try:
                rows = scrape(site, query)
                found[site].extend(map_rows(rows, site))
            except Exception as error:  # noqa: BLE001 - cada sitio falla a su manera
                errors.append(f'{site}/{query}: {type(error).__name__}')
            sleep(pause)
    # Las mismas ofertas salen en varias consultas: se quedan una vez por sitio.
    return {site: list({c['external_id']: c for c in items}.values()) for site, items in found.items()}, errors


def jobspy_scrape(site, query):
    from jobspy import scrape_jobs  # import tardío: solo hace falta al ejecutar el recolector
    kwargs = dict(site_name=[site], search_term=query, location='España', results_wanted=RESULTS_WANTED, hours_old=HOURS_OLD,
                  country_indexed='Spain', linkedin_fetch_description=False, verbose=0)
    if site == 'google':
        kwargs['google_search_term'] = f'{query} empleo en España en los últimos 10 días'
    frame = scrape_jobs(**kwargs)
    return frame.drop(columns=['emails'], errors='ignore').to_dict('records')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--dry-run', action='store_true', help='busca y muestra, sin enviar')
    parser.add_argument('--sites', default=','.join(SITES))
    args = parser.parse_args(argv)
    sites = [s for s in args.sites.split(',') if s in SITES]
    url, token = os.environ.get('INGEST_URL'), os.environ.get('INGEST_TOKEN')
    if not args.dry_run and not (url and token):
        sys.exit('Faltan INGEST_URL e INGEST_TOKEN (secretos del repositorio).')
    results, errors = collect(sites, jobspy_scrape)
    for site, items in results.items():
        print(f'{site}: {len(items)} candidatos', flush=True)
        if args.dry_run or not items:
            continue
        for i in range(0, len(items), BATCH):
            print(' ->', post(url, token, site, items[i:i + BATCH], note='; '.join(errors)[:300] or None), flush=True)
    for error in errors:
        print('aviso:', error, file=sys.stderr)


if __name__ == '__main__':
    main()
