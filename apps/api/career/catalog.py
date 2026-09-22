"""Ten-day local catalog. First-seen tombstones prevent old listings resurfacing."""
import json
from datetime import datetime, timedelta, timezone

from .db import connect, now
from .models import Job
from .pipeline import match


def collection_query():
    from .models import SearchQuery
    return SearchQuery(role='digital_sales', require_spanish=True, days=10, work_mode='remote_hybrid')


def remember(db, organization, job_id, captured):
    # Exact original URL only: preserve first appearance when another connection imports it.
    previous = db.execute('''SELECT min(c.first_seen_at) FROM catalog_entries c
        JOIN jobs j ON j.org_id=c.org_id AND j.id=c.job_id
        JOIN job_postings p ON p.org_id=j.org_id AND p.id=j.posting_id
        WHERE c.org_id=? AND json_extract(p.payload,'$.source_url')=(
          SELECT json_extract(p2.payload,'$.source_url') FROM jobs j2 JOIN job_postings p2
          ON p2.org_id=j2.org_id AND p2.id=j2.posting_id WHERE j2.org_id=? AND j2.id=?)''',
                          (organization, organization, job_id)).fetchone()[0]
    captured = min(captured, previous) if previous else captured
    expires = (datetime.fromisoformat(captured) + timedelta(days=10)).isoformat()
    db.execute('INSERT OR IGNORE INTO catalog_entries VALUES(?,?,?,?)',
               (organization, job_id, captured, expires))


def prune(organization):
    # Remove searchable snapshots; retain immutable provenance and identity tombstones.
    with connect() as db:
        db.execute('DELETE FROM search_results WHERE org_id=? AND job_id IN '
                   '(SELECT job_id FROM catalog_entries WHERE org_id=? AND expires_at<=?)',
                   (organization, organization, now()))


def available_sources(organization):
    from .sources import source_infos
    result = {s['code']: s['name'] for s in source_infos(organization) if s['available']}
    with connect() as db:
        for row in db.execute('SELECT DISTINCT p.source FROM catalog_entries c JOIN jobs j ON j.org_id=c.org_id AND j.id=c.job_id '
                              'JOIN job_postings p ON p.org_id=j.org_id AND p.id=j.posting_id WHERE c.org_id=? AND c.expires_at>?', (organization, now())):
            result.setdefault(row['source'], row['source'])
    return result


def search_catalog(run_id, organization, query):
    prune(organization)
    query = query.model_copy(update={"days": min(query.days, 10)})
    current = now()
    with connect() as db:
        rows = db.execute('''SELECT p.source,p.payload,r.id AS raw_id,r.captured_at,r.provider,
            j.id,j.starred,c.first_seen_at,c.expires_at FROM catalog_entries c
            JOIN jobs j ON j.org_id=c.org_id AND j.id=c.job_id
            JOIN job_postings p ON p.org_id=j.org_id AND p.id=j.posting_id
            JOIN raw_items r ON r.org_id=p.org_id AND r.id=p.raw_id
            WHERE c.org_id=? AND c.expires_at>?''', (organization, current)).fetchall()
        run = db.execute('SELECT sources,status FROM search_runs WHERE org_id=? AND id=?', (organization, run_id)).fetchone()
        if not run or run['status'] == 'cancelled':
            return
        progress = json.loads(run['sources'])
        names = {s['code']: s['name'] for s in progress}
        counts = {code: [0, 0] for code in names}
        seen_urls = set()
        for row in rows:
            if row['source'] not in names:
                continue
            counts[row['source']][0] += 1
            item = json.loads(row['payload'])
            if not match(item, collection_query()):
                continue
            matching = match(item, query)
            if not matching:
                continue
            if item['source_url'] in seen_urls:
                continue
            seen_urls.add(item['source_url'])
            score, reasons, warnings = matching
            job = Job(**{k: v for k, v in item.items() if k not in {'expires_at', 'work_mode'}},
                      id=row['id'], source=names[row['source']], score=score, reasons=reasons,
                      warnings=warnings, raw_id=row['raw_id'], captured_at=row['captured_at'],
                      provider=row['provider'], starred=bool(row['starred']),
                      first_seen_at=row['first_seen_at'], catalog_expires_at=row['expires_at'])
            db.execute('INSERT OR REPLACE INTO search_results VALUES(?,?,?,?)', (organization, run_id, row['id'], job.model_dump_json()))
            counts[row['source']][1] += 1
        for source in progress:
            source.update(status='completed', fetched=counts[source['code']][0], accepted=counts[source['code']][1],
                          warning=None, latency_ms=0)
        db.execute("UPDATE search_runs SET status='completed',sources=?,completed_at=? WHERE org_id=? AND id=? AND status!='cancelled'",
                   (json.dumps(progress), now(), organization, run_id))


def catalog_counts(organization):
    current = datetime.now(timezone.utc)
    with connect() as db:
        rows = db.execute('SELECT c.first_seen_at,p.payload FROM catalog_entries c JOIN jobs j ON j.org_id=c.org_id AND j.id=c.job_id '
                          'JOIN job_postings p ON p.org_id=j.org_id AND p.id=j.posting_id WHERE c.org_id=? AND c.expires_at>?',
                          (organization, current.isoformat())).fetchall()
    by_url = {}
    for row in rows:
        item = json.loads(row['payload'])
        if match(item, collection_query()):
            by_url.setdefault(item['source_url'], row)
    eligible = list(by_url.values())
    return {'total': len(eligible), 'added': sum(r['first_seen_at'] >= (current - timedelta(days=1)).isoformat() for r in eligible)}
