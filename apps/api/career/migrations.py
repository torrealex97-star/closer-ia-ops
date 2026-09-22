"""Versioned additive migrations. Existing local evidence is never reset."""
MIGRATIONS = [(2, [
    'CREATE TABLE IF NOT EXISTS integration_settings (org_id TEXT NOT NULL, provider TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(org_id,provider))',
    'CREATE TABLE IF NOT EXISTS integration_plans (id TEXT NOT NULL, org_id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(org_id,id))',
    'CREATE TABLE IF NOT EXISTS ai_generations (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, fingerprint TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT, UNIQUE(org_id,fingerprint))',
    'CREATE INDEX IF NOT EXISTS ai_queue ON ai_generations(status,created_at)',
 ]), (3, [
    "UPDATE ai_generations SET payload=json_set(payload, '$.provider', 'openai') WHERE json_extract(payload, '$.provider') IS NULL",
])]


def migrate(db):
    db.execute('BEGIN IMMEDIATE')
    for version, statements in MIGRATIONS:
        if db.execute('SELECT 1 FROM schema_version WHERE version=?', (version,)).fetchone():
            continue
        for sql in statements:
            db.execute(sql)
        db.execute('INSERT INTO schema_version VALUES(?)', (version,))
