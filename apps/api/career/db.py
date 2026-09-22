import json
import os
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from .migrations import migrate

ROOT = Path(__file__).resolve().parents[3]


def now():
    return datetime.now(timezone.utc).isoformat()


def uid():
    return str(uuid.uuid4())


def org():
    return os.environ.get("CAREER_ORG_ID", "local-wdc")


@contextmanager
def connect():
    path = Path(os.environ.get("CAREER_DB", str(ROOT / ".local/career.sqlite3")))
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=15)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def initialize():
    with connect() as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.executescript("""
        CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);
        INSERT OR IGNORE INTO schema_version VALUES(1);
        CREATE TABLE IF NOT EXISTS search_runs (
          id TEXT PRIMARY KEY, org_id TEXT NOT NULL, request_key TEXT NOT NULL,
          query TEXT NOT NULL, status TEXT NOT NULL, sources TEXT NOT NULL,
          created_at TEXT NOT NULL, completed_at TEXT,
          UNIQUE(org_id, request_key), UNIQUE(org_id, id)
        );
        CREATE TABLE IF NOT EXISTS raw_items (
          id TEXT PRIMARY KEY, org_id TEXT NOT NULL, source TEXT NOT NULL,
          provider TEXT NOT NULL, external_id TEXT NOT NULL, content_hash TEXT NOT NULL,
          payload TEXT NOT NULL, captured_at TEXT NOT NULL,
          UNIQUE(org_id, source, external_id, content_hash), UNIQUE(org_id, id)
        );
        CREATE TRIGGER IF NOT EXISTS raw_no_update BEFORE UPDATE ON raw_items
        BEGIN SELECT RAISE(ABORT, 'raw_items are immutable'); END;
        CREATE TRIGGER IF NOT EXISTS raw_no_delete BEFORE DELETE ON raw_items
        BEGIN SELECT RAISE(ABORT, 'raw_items are immutable'); END;
        CREATE TABLE IF NOT EXISTS job_postings (
          id TEXT PRIMARY KEY, org_id TEXT NOT NULL, raw_id TEXT NOT NULL,
          source TEXT NOT NULL, external_id TEXT NOT NULL, payload TEXT NOT NULL,
          UNIQUE(org_id, source, external_id), UNIQUE(org_id, id),
          FOREIGN KEY(org_id, raw_id) REFERENCES raw_items(org_id, id)
        );
        CREATE TABLE IF NOT EXISTS jobs (
          id TEXT PRIMARY KEY, org_id TEXT NOT NULL, posting_id TEXT NOT NULL,
          starred INTEGER NOT NULL DEFAULT 0,
          UNIQUE(org_id, posting_id), UNIQUE(org_id, id),
          FOREIGN KEY(org_id, posting_id) REFERENCES job_postings(org_id, id)
        );
        CREATE TABLE IF NOT EXISTS search_results (
          org_id TEXT NOT NULL, run_id TEXT NOT NULL, job_id TEXT NOT NULL, payload TEXT NOT NULL,
          PRIMARY KEY(org_id, run_id, job_id),
          FOREIGN KEY(org_id, run_id) REFERENCES search_runs(org_id, id),
          FOREIGN KEY(org_id, job_id) REFERENCES jobs(org_id, id)
        );
        CREATE TABLE IF NOT EXISTS saved_searches (
          id TEXT PRIMARY KEY, org_id TEXT NOT NULL, name TEXT NOT NULL, query TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS source_connections (
          id TEXT NOT NULL, org_id TEXT NOT NULL, payload TEXT NOT NULL,
          PRIMARY KEY(org_id, id)
        );
        CREATE TABLE IF NOT EXISTS provider_cache (
          key TEXT PRIMARY KEY, payload TEXT NOT NULL, expires_at REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS run_queue ON search_runs(status, created_at);
        CREATE INDEX IF NOT EXISTS run_org ON search_runs(org_id, created_at DESC);
        """)
        migrate(db)


def load_run(run_id: str, organization: str):
    with connect() as db:
        row = db.execute("SELECT * FROM search_runs WHERE id=? AND org_id=?", (run_id, organization)).fetchone()
        if not row:
            return None
        jobs = db.execute("""SELECT r.payload, j.starred FROM search_results r
          JOIN jobs j ON j.id=r.job_id AND j.org_id=r.org_id
          WHERE r.run_id=? AND r.org_id=?""", (run_id, organization)).fetchall()
    result = dict(row)
    result["query"] = json.loads(result["query"])
    result["sources"] = json.loads(result["sources"])
    result["jobs"] = sorted(
        [dict(json.loads(j["payload"]), starred=bool(j["starred"])) for j in jobs],
        key=lambda j: (-j["score"], j["title"]),
    )
    return result
