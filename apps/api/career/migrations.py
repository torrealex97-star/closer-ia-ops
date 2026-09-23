"""Versioned additive migrations. Existing local evidence is never reset."""
import json
from pathlib import Path

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
]), (5, [
    # Watchlist de empresas objetivo para conectores ATS públicos (P03D / TIER 3).
    'CREATE TABLE IF NOT EXISTS company_watchlist (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, UNIQUE(org_id,name))',
    'CREATE TABLE IF NOT EXISTS watchlist_targets (watchlist_id TEXT NOT NULL, ats TEXT NOT NULL, slug TEXT NOT NULL, PRIMARY KEY(watchlist_id,ats,slug), FOREIGN KEY(watchlist_id) REFERENCES company_watchlist(id))',
    "INSERT INTO company_watchlist VALUES('watchlist-wdc','local-wdc','Empresas objetivo WDC',1,strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))",
    "INSERT INTO watchlist_targets VALUES ('watchlist-wdc','greenhouse','stripe'), ('watchlist-wdc','greenhouse','typeform'), ('watchlist-wdc','greenhouse','wallapop'), ('watchlist-wdc','ashby','pennylane'), ('watchlist-wdc','recruitee','livestorm')",
]), (6, [
    # Aprendizaje por fuente del orquestador cost-aware (ADR-009).
    'CREATE TABLE IF NOT EXISTS source_stats (org_id TEXT NOT NULL, source TEXT NOT NULL, updated_at TEXT NOT NULL, candidates_found INTEGER NOT NULL DEFAULT 0, qualified_jobs INTEGER NOT NULL DEFAULT 0, high_quality_jobs INTEGER NOT NULL DEFAULT 0, cost_eur REAL NOT NULL DEFAULT 0, quality_yield REAL NOT NULL DEFAULT 0, duplicate_ratio REAL NOT NULL DEFAULT 0, failure INTEGER NOT NULL DEFAULT 0, cost_per_qualified REAL, cost_per_high_quality REAL, PRIMARY KEY(org_id, source))',
]), (7, [
    # Watchlist España: Cabify verificada 2026-09-23 con 14 ofertas de ventas en su board público.
    "INSERT OR IGNORE INTO watchlist_targets VALUES ('watchlist-wdc','greenhouse','cabify')",
]), (8, [
    # Base de empresas objetivo verificadas (61 únicas de base_empresas_closers; product-hackers con feed Teamtailor
    # verificado 2026-09-23 con oferta B2B Sales Executive activa). priority 1 = top30 del usuario.
    'CREATE TABLE IF NOT EXISTS company_target (slug TEXT PRIMARY KEY, name TEXT NOT NULL, website TEXT NOT NULL DEFAULT \'\', sector TEXT NOT NULL DEFAULT \'\', country TEXT NOT NULL DEFAULT \'España\', ticket TEXT NOT NULL DEFAULT \'\', careers_url TEXT NOT NULL DEFAULT \'\', priority INTEGER NOT NULL DEFAULT 2, score INTEGER NOT NULL DEFAULT 0, monitoring TEXT NOT NULL DEFAULT \'manual\', enabled INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL)',
    'CREATE INDEX company_target_priority ON company_target(priority, enabled)',
    "INSERT OR IGNORE INTO watchlist_targets VALUES ('watchlist-wdc','teamtailor','producthackers')",
]), (9, [
    # Nombre real de la empresa para ofertas sin campo company (RSS de Teamtailor). El slug ATS
    # (producthackers) no coincide con el slug de company_target (product-hackers-school).
    'ALTER TABLE watchlist_targets ADD COLUMN company_name TEXT NOT NULL DEFAULT \'\'',
    "UPDATE watchlist_targets SET company_name='Product Hackers School' WHERE ats='teamtailor' AND slug='producthackers'",
]), (10, [
    # Hallazgo Manu (2026-09-23): investigación de dónde publica cada empresa.
    # Monest Capital / Inversor PRO: Teamtailor con dominio propio verificado
    # (careers.monestcapital.com/jobs.rss, 5 vacantes, incluida 'Closer de ventas').
    "INSERT OR IGNORE INTO watchlist_targets VALUES ('watchlist-wdc','teamtailor','monestcapital','Monest Capital / Inversor PRO')",
    # Las demás del hallazgo publican en LinkedIn o página propia sin feed: registro del canal real,
    # vigilancia del canal correspondiente (linkedin_guest cuando aplique), nunca un ATS inventado.
    "UPDATE company_target SET monitoring='linkedin_guest', careers_url='https://es.linkedin.com/jobs/view/acompa%C3%B1amiento-en-el-embarazo-at-conquista-tu-maternidad-s-l-4417498558' WHERE slug='conquista-tu-maternidad-s-l'",
    "UPDATE company_target SET monitoring='careers_page', careers_url='https://www.bastidafarina.com/equipo/posiciones-abiertas' WHERE slug='bastida-farina'",
    "UPDATE company_target SET monitoring='linkedin_guest', careers_url='https://www.linkedin.com/company/autopublicacion' WHERE slug='autopublicacion-com'",
    "UPDATE company_target SET monitoring='teamtailor_feed', careers_url='https://careers.monestcapital.com/jobs' WHERE slug='inversor-pro-monest-capital'",
    "UPDATE company_target SET monitoring='linkedin_guest', careers_url='https://es.linkedin.com/jobs/view/cerrador-de-ventas-inmobiliarias-en-remoto-at-gold-waves-group-4463455248' WHERE slug='gold-waves-group'",
    "UPDATE company_target SET monitoring='linkedin_guest', careers_url='https://es.linkedin.com/jobs/view/closer-de-ventas-at-monest-capital-4466547457' WHERE slug='talent'",
    "UPDATE company_target SET monitoring='linkedin_guest' WHERE slug='novacliniqai'",
    "UPDATE company_target SET monitoring='linkedin_guest' WHERE slug='webifly-es'",
    "UPDATE company_target SET monitoring='linkedin_guest' WHERE slug='sales-beast-group'",
    # Kämpe: oferta cerrada, sin canal activo verificado; se mantiene en seguimiento manual.
])]


def migrate(db):
    db.execute('BEGIN IMMEDIATE')
    for version, statements in MIGRATIONS:
        if db.execute('SELECT 1 FROM schema_version WHERE version=?', (version,)).fetchone():
            continue
        for sql in statements:
            db.execute(sql)
        db.execute('INSERT INTO schema_version VALUES(?)', (version,))
    seed_company_targets(db)


def seed_company_targets(db):
    """Base verificada de empresas objetivo (idempotente: INSERT OR IGNORE respeta
    el `enabled` que el operador haya cambiado). Nuevas empresas del JSON se añaden."""
    path = Path(__file__).with_name('data') / 'company_targets.json'
    if not path.exists():
        return
    rows = json.loads(path.read_text())
    for row in rows:
        db.execute(
            "INSERT OR IGNORE INTO company_target (slug,name,website,sector,country,ticket,careers_url,priority,score,monitoring,enabled,created_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,1,strftime('%Y-%m-%dT%H:%M:%f+00:00','now'))",
            (row['slug'], row['name'], row.get('website', ''), row.get('sector', ''), row.get('country', 'España'),
             row.get('ticket', ''), row.get('careers_url', ''), int(row.get('priority', 2)), int(row.get('score', 0)),
             row.get('monitoring', 'manual')))
