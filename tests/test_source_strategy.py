import pytest
from career.integrations import PrepareSource, prepare_input
from career.source_strategy import actor_matches, strategy
from career.sources import CATALOG


def test_every_source_has_explicit_strategy_and_no_false_operational_claim():
    for code, *_ in CATALOG:
        info = strategy(code)
        assert info['acquisition_method'] and info['validation_status']
        # Ninguna entrada del catálogo es un conector operativo; pueden ser rutas Apify pendientes
        # o informativas sin listado extraíble (p. ej. ClosersAvenue), nunca falso operativo.
        assert info['validation_status'] != 'Conector operativo'
    assert not actor_matches('torre', 'epctex/torrent-downloader')
    assert not actor_matches('remotoco', 'orgupdate/remote-co-jobs-scraper')
    assert not actor_matches('weremoto', 'example/webmotors-scraper')
    assert not actor_matches('linkedin-posts', 'example/linkedin-post-reactions')
    assert actor_matches('infojobs', 'haketa/infojobs-scraper')


def test_single_keyword_does_not_silently_discard_rest():
    schema = {'properties': {'keywords': {'type': 'string'}, 'maxJobs': {'type': 'integer'}}}
    with pytest.raises(ValueError, match='un solo término'):
        prepare_input(schema, PrepareSource(keywords=['closer', 'setter']))
    result, *_ = prepare_input(schema, PrepareSource(keywords=['closer']))
    assert result['keywords'] == 'closer' and result['maxJobs'] == 25


def test_explicit_location_overrides_provider_default_and_respects_enum():
    schema = {'properties': {'keywords': {'type': 'array'}, 'maxItems': {'type': 'integer'},
        'location': {'type': 'string', 'default': 'United States'}, 'onlyTeleworking': {'type': 'boolean'}}}
    result, *_ = prepare_input(schema, PrepareSource())
    assert result['location'] == 'Spain' and result['onlyTeleworking'] is True
    schema['properties']['location']['enum'] = ['US']
    with pytest.raises(ValueError, match='formato de ubicación'):
        prepare_input(schema, PrepareSource())


def test_search_urls_preserve_the_sites_filters():
    url = 'https://www.infojobs.net/ofertas-trabajo/closer?provincia=28'
    schema = {'properties': {'startUrls': {'type': 'array', 'editor': 'requestListSources'},
        'keywords': {'type': 'array'}, 'maxItems': {'type': 'integer'}}}
    result, *_ = prepare_input(schema, PrepareSource(urls=[url]))
    assert result['startUrls'] == [{'url': url}]
    assert 'keywords' not in result  # URL query drives acquisition, no invented AND combination.


def test_per_search_caps_and_optional_enrichment_are_bounded():
    schema = {'properties': {'keywords': {'type': 'array'}, 'limitPerSource': {'type': 'integer'},
        'scrapeComments': {'type': 'boolean', 'default': True}, 'withAiSummary': {'type': 'boolean', 'default': True}}}
    result, *_ = prepare_input(schema, PrepareSource(keywords=['closer', 'setter'], max_items=25))
    assert result['limitPerSource'] == 12
    assert result['scrapeComments'] is False and result['withAiSummary'] is False


def test_public_connectors_use_sales_category_before_download(monkeypatch):
    import asyncio
    import json
    from career.connectors import REGISTRY
    from career.models import SearchQuery
    calls = []
    async def fetch(url, params=None, ttl=900):
        calls.append((url, params))
        return '<rss><channel></channel></rss>' if url.endswith('.rss') else json.dumps({'jobs': []})
    monkeypatch.setattr('career.connectors.fetch', fetch)
    async def collect():
        for code in ['remotive', 'weworkremotely']:
            async for _ in REGISTRY[code].batches(SearchQuery()):
                pass
    asyncio.run(collect())
    assert calls[0][1] == {'category': 'sales'}
    assert calls[1][0].endswith('/categories/remote-sales-and-marketing-jobs.rss')


def test_wdc_workbook_presets_are_scoped_and_recover_real_hyperlinks():
    from career.source_strategy import suggested_searches
    facebook = suggested_searches('facebook', 'local-wdc')
    assert len(facebook) == 27
    assert any('719085275327684' in row['url'] for row in facebook)
    assert facebook[0]['preferred'] and not facebook[-1]['preferred']
    assert suggested_searches('facebook', 'another-org') == []
    infojobs = suggested_searches('infojobs', 'local-wdc')[0]
    assert 'page=3' not in infojobs['url'] and 'teleworkingIds=2' in infojobs['url']
    assert len(suggested_searches('telegram', 'local-wdc')) == 11


def test_community_hiring_is_not_a_candidate_ad():
    from career.presentation import professional_role
    assert professional_role('Publicación de comunidad', 'Busco una closer para nuestro equipo de ventas') == 'closer'
    assert professional_role('Publicación de comunidad', 'Buscamos appointment setter para ventas') == 'setter'
    assert professional_role('Publicación de comunidad', 'Soy closer y busco trabajo remoto') is None
