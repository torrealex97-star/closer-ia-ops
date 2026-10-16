"""Mapeo y flujo del recolector JobSpy sin red ni JobSpy instalado."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))

import jobspy_collect as jc  # noqa: E402

NAN = float('nan')


def row(**over):
    base = {'id': 'in-1', 'site': 'indeed', 'job_url': 'https://es.indeed.com/viewjob?jk=1', 'job_url_direct': None, 'title': 'Closer de ventas', 'company': 'Acme',
            'location': 'Madrid, ES', 'date_posted': '2026-10-15', 'job_type': 'fulltime', 'interval': 'yearly', 'min_amount': 24000.0, 'max_amount': 36000.0,
            'currency': 'EUR', 'is_remote': True, 'description': 'Buscamos closer para ventas', 'emails': 'rrhh@acme.com'}
    base.update(over)
    return base


def test_map_row_normalises_and_never_carries_contacts():
    c = jc.map_row(row(), 'indeed')
    assert c['external_id'] == 'in-1' and c['url'] == 'https://es.indeed.com/viewjob?jk=1' and c['company'] == 'Acme'
    assert c['salary'] == '24.000–36.000 EUR / año'
    assert 'emails' not in c and 'rrhh@acme.com' not in str(c)
    assert c['raw'] == {'site': 'indeed', 'job_type': 'fulltime', 'is_remote': True}


def test_nan_values_become_none_and_direct_url_wins():
    c = jc.map_row(row(company=NAN, location=NAN, min_amount=NAN, max_amount=NAN, job_url_direct='https://acme.com/job/1', date_posted=NAN), 'linkedin')
    assert c['company'] is None and c['location'] is None and c['salary'] is None and c['posted_at'] is None
    assert c['url'] == 'https://acme.com/job/1'


def test_rows_without_url_title_or_with_bad_scheme_are_dropped_and_duplicates_collapse():
    rows = [row(), row(), row(id='x', job_url=None), row(id='y', title=None), row(id='z', job_url='javascript:alert(1)'), row(id='in-2')]
    assert [c['external_id'] for c in jc.map_rows(rows, 'indeed')] == ['in-1', 'in-2']


def test_collect_keeps_going_when_one_site_fails_and_pauses_between_searches():
    pauses = []

    def scrape(site, query):
        if site == 'linkedin':
            raise RuntimeError('429')
        return [row(id=f'{site}-{query}')]

    results, errors = jc.collect(['indeed', 'linkedin'], scrape, sleep=pauses.append, pause=7)
    assert len(results['indeed']) == len(jc.QUERIES) and results['linkedin'] == []
    assert len(errors) == len(jc.QUERIES) and errors[0].startswith('linkedin/') and 'RuntimeError' in errors[0]
    assert pauses == [7] * (2 * len(jc.QUERIES))


def test_sites_match_panel_source_codes():
    assert set(jc.SITES) == {'indeed', 'linkedin', 'google'}
