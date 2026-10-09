"""Read public Apify metadata only; never launch actors or read credentials.

Además audita los slugs JobToday contra el sitio real: detecta renombrados
(redirects 301/308) y rutas muertas antes de que rompan la recogida diaria.
"""
import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path
import httpx
from career.connectors import REGISTRY, JobToday
from career.sources import CATALOG
from career.source_strategy import actor_matches

QUERIES = {'laborum': 'bumeran', 'europe-language': 'europe language jobs',
           'linkedin-posts': 'linkedin posts', 'facebook': 'facebook posts',
           'company': 'greenhouse jobs', 'custom': 'structured jobs'}

async def audit_jobtoday_slugs(client):
    """Check periódico de los slugs JobToday del REGISTRY: el destino real de cada
    ruta (redirect o 200) queda registrado como evidencia; un renombrado se detecta
    aquí antes de que la recogida falle. Nunca reescribe slugs: solo informa."""
    semaphore = asyncio.Semaphore(2)

    async def check(connector):
        async with semaphore:
            record = {'checked_at': datetime.now(timezone.utc).isoformat(), 'url': connector.url,
                      'status': 'ok', 'canonical_url': connector.url, 'http_status': None}
            try:
                response = await client.get(connector.url, follow_redirects=False,
                                            headers={'User-Agent': connector.BROWSER_UA})
                record['http_status'] = response.status_code
                if response.status_code in {301, 302, 303, 307, 308}:
                    location = response.headers.get('location', '').strip()
                    record['status'] = 'renamed'
                    record['canonical_url'] = str(response.url.join(location)) if location else connector.url
                    record['renamed_from'] = connector.url
                elif response.status_code == 410:
                    record['status'] = 'gone'
                elif response.status_code != 200:
                    record['status'] = 'unavailable'
            except httpx.HTTPError:
                record['status'] = 'unreachable'
            print(connector.code, record['status'], record['canonical_url'], flush=True)
            return connector.code, record

    return {'checked_at': datetime.now(timezone.utc).isoformat(),
            'slugs': dict(await asyncio.gather(*(check(c) for c in REGISTRY.values() if isinstance(c, JobToday))))}

async def main():
    semaphore = asyncio.Semaphore(3)
    async with httpx.AsyncClient(timeout=25) as client:
        async def get(path, params=None):
            async with semaphore:
                response = await client.get('https://api.apify.com/v2/' + path, params=params)
                response.raise_for_status()
                return response.json()['data']
        async def audit(row):
            code, name, _, _, link, _ = row
            record = {'checked_at': datetime.now(timezone.utc).isoformat(), 'candidates': [], 'status': 'not_found'}
            try:
                query = QUERIES.get(code, name.split(' · ')[0].split(' / ')[0])
                store = await get('store', {'search': query, 'limit': 3})
                actors = [f"{x['username']}/{x['name']}" for x in store.get('items', []) if x.get('username') and x.get('name')]
                if code == 'facebook':
                    actors.insert(0, 'apify/facebook-groups-scraper')
                if code == 'torre':
                    actors.insert(0, 'scrapers_lat/torre-scraper')
                if link.startswith('https://apify.com/') and '/store' not in link:
                    actors.insert(0, link.removeprefix('https://apify.com/'))
                for actor in [a for a in dict.fromkeys(actors) if actor_matches(code, a)][:3]:
                    try:
                        metadata, build = await asyncio.gather(get('acts/' + actor.replace('/', '~')), get('acts/' + actor.replace('/', '~') + '/builds/default'))
                        if metadata.get('isDeprecated') or build.get('status') != 'SUCCEEDED':
                            continue
                        schema = build.get('inputSchema') or build.get('actorDefinition', {}).get('input', {})
                        schema = json.loads(schema) if isinstance(schema, str) else schema
                        props = schema.get('properties', {})
                        # Metadata evidence, not a guarantee of extraction quality.
                        record['candidates'].append({'actor': actor, 'title': metadata.get('title', actor),
                            'url': 'https://apify.com/' + actor, 'build': build.get('buildNumber'),
                            'fields': list(props), 'required': schema.get('required', []),
                            'pricing_models': sorted({p.get('pricingModel', 'UNKNOWN') for p in metadata.get('pricingInfos', [])})})
                    except (httpx.HTTPError, ValueError, KeyError, TypeError):
                        continue
                record['status'] = 'metadata_checked' if record['candidates'] else 'not_found'
            except (httpx.HTTPError, ValueError, KeyError, TypeError):
                record['status'] = 'lookup_failed'
            print(code, record['status'], [x['actor'] for x in record['candidates']], flush=True)
            return code, record
        results = dict(await asyncio.gather(*(audit(row) for row in CATALOG)))
        jobtoday = await audit_jobtoday_slugs(client)
    Path('apps/api/career/source_audit.json').write_text(json.dumps(
        {'apify': results, 'jobtoday_slugs': jobtoday}, ensure_ascii=False, indent=2, default=str) + '\n')

asyncio.run(main())
