"""Versioned additive migrations. Existing local evidence is never reset."""
MIGRATIONS = [(2, [
    'CREATE TABLE IF NOT EXISTS integration_settings (org_id TEXT NOT NULL, provider TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(org_id,provider))',
    'CREATE TABLE IF NOT EXISTS integration_plans (id TEXT NOT NULL, org_id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(org_id,id))',
    'CREATE TABLE IF NOT EXISTS ai_generations (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, fingerprint TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT, UNIQUE(org_id,fingerprint))',
    'CREATE INDEX IF NOT EXISTS ai_queue ON ai_generations(status,created_at)',
 ]), (3, [
    "UPDATE ai_generations SET payload=json_set(payload, '$.provider', 'openai') WHERE json_extract(payload, '$.provider') IS NULL",
]), (4, [
    'CREATE TABLE catalog_entries (org_id TEXT NOT NULL, job_id TEXT NOT NULL, first_seen_at TEXT NOT NULL, expires_at TEXT NOT NULL, PRIMARY KEY(org_id,job_id), FOREIGN KEY(org_id,job_id) REFERENCES jobs(org_id,id))',
    "INSERT INTO catalog_entries SELECT j.org_id,j.id,min(r.captured_at),strftime('%Y-%m-%dT%H:%M:%f+00:00',min(r.captured_at),'+10 days') FROM jobs j JOIN job_postings p ON p.org_id=j.org_id AND p.id=j.posting_id JOIN raw_items r ON r.org_id=p.org_id AND r.source=p.source AND r.external_id=p.external_id GROUP BY j.org_id,j.id",
    'CREATE INDEX catalog_expiry ON catalog_entries(org_id,expires_at)',
    'CREATE TABLE collection_runs (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, day TEXT NOT NULL, status TEXT NOT NULL, sources TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT, UNIQUE(org_id,day))',
    'CREATE TABLE scrape_budget (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, day TEXT NOT NULL, connection_id TEXT NOT NULL, reserved_cents INTEGER NOT NULL, cap_usd REAL NOT NULL, run_id TEXT, status TEXT NOT NULL, actual_usd REAL, finished_day TEXT, UNIQUE(org_id,day,connection_id))',
])]


def migrate(db):
    db.execute('BEGIN IMMEDIATE')
    for version, statements in MIGRATIONS:
        if db.execute('SELECT 1 FROM schema_version WHERE version=?', (version,)).fetchone():
            continue
        for sql in statements:
            db.execute(sql)
        db.execute('INSERT INTO schema_version VALUES(?)', (version,))
