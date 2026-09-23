import asyncio
import json
import logging
import time
from .connectors import ProviderError
from .sources import registry as source_registry, ApifyDataset, get_connection
from .db import connect, initialize, now
from .models import SearchQuery
from .pipeline import ingest

logger = logging.getLogger("career.worker")


def update_source(run_id, organization, code, **updates):
    with connect() as db:
        row = db.execute("SELECT sources FROM search_runs WHERE id=? AND org_id=?", (run_id, organization)).fetchone()
        sources = json.loads(row["sources"])
        for source in sources:
            if source["code"] == code:
                source.update(updates)
        db.execute("UPDATE search_runs SET sources=? WHERE id=? AND org_id=?", (json.dumps(sources), run_id, organization))


def cancelled(run_id, organization):
    with connect() as db:
        return db.execute("SELECT status FROM search_runs WHERE id=? AND org_id=?", (run_id, organization)).fetchone()["status"] == "cancelled"


async def run_source(connector, query, run_id, organization):
    start = time.monotonic()
    fetched = accepted = 0
    update_source(run_id, organization, connector.code, status="running", fetched=0, accepted=0, warning=None)
    try:
        async with asyncio.timeout(100):
            async for batch in connector.batches(query):
                if cancelled(run_id, organization):
                    update_source(run_id, organization, connector.code, status="cancelled")
                    return
                for candidate in batch:
                    fetched += 1
                    accepted += int(ingest(candidate, connector, query, run_id, organization))
                update_source(run_id, organization, connector.code, fetched=fetched, accepted=accepted)
        update_source(run_id, organization, connector.code, status="completed", latency_ms=int((time.monotonic() - start) * 1000))
    except Exception as error:
        logger.warning("connector_failed source=%s type=%s", connector.code, type(error).__name__)
        warning = str(error) if isinstance(error, ProviderError) else "La fuente no ha podido completar la consulta. Los resultados recibidos se conservan."
        update_source(run_id, organization, connector.code, status="failed", warning=warning,
                      latency_ms=int((time.monotonic() - start) * 1000))


async def execute(run_id, organization, query, registry=None):
    if registry is None:
        from .catalog import search_catalog
        search_catalog(run_id, organization, query)
        return
    registry = registry or source_registry(organization)
    for code in query.sources:
        if code not in registry:
            registry[code] = ApifyDataset(get_connection(code, organization), organization)
    await layered_or_classic(run_id, organization, query, registry)
    with connect() as db:
        row = db.execute("SELECT sources,status FROM search_runs WHERE id=? AND org_id=?", (run_id, organization)).fetchone()
        sources = json.loads(row["sources"])
        failures = sum(s["status"] == "failed" for s in sources)
        count = db.execute("SELECT count(*) FROM search_results WHERE org_id=? AND run_id=?", (organization, run_id)).fetchone()[0]
        status = "failed" if failures == len(sources) and not count else "partial" if failures else "completed"
        if row["status"] != "cancelled":
            db.execute("UPDATE search_runs SET status=?,completed_at=? WHERE id=? AND org_id=?", (status, now(), run_id, organization))


async def layered_or_classic(run_id, organization, query, registry):
    """ADR-009: si la ejecucion es por capas, el orchestrator cierra el run; si no, cierre clasico."""
    from .orchestrator import execute_layered
    await execute_layered(run_id, organization, query, registry)
    with connect() as db:
        row = db.execute("SELECT sources FROM search_runs WHERE id=? AND org_id=?", (run_id, organization)).fetchone()
        sources = json.loads(row["sources"])
        failures = sum(s["status"] == "failed" for s in sources if s.get("status"))
        count = db.execute("SELECT count(*) FROM search_results WHERE org_id=? AND run_id=?", (organization, run_id)).fetchone()[0]
        status = "failed" if failures == len(sources) and not count else "partial" if failures else "completed"
        db.execute("UPDATE search_runs SET status=?,completed_at=? WHERE id=? AND org_id=?",
                   (status if row else "completed", now(), run_id, organization))


async def main():
    initialize()
    from .ai import ai_loop
    from .collection import collection_loop
    collection_task = asyncio.create_task(collection_loop())
    collection_task.add_done_callback(lambda task: task.result() if not task.cancelled() else None)
    ai_task = asyncio.create_task(ai_loop())
    ai_task.add_done_callback(lambda task: task.result() if not task.cancelled() else None)
    # Single consumer in local mode. Restarts replay idempotently from the durable queue.
    with connect() as db:
        db.execute("UPDATE search_runs SET status='queued' WHERE status='running'")
    while True:
        with connect() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT id,org_id,query FROM search_runs WHERE status='queued' ORDER BY created_at LIMIT 1").fetchone()
            if row:
                db.execute("UPDATE search_runs SET status='running' WHERE id=?", (row["id"],))
        if row:
            await execute(row["id"], row["org_id"], SearchQuery.model_validate_json(row["query"]))
        else:
            await asyncio.sleep(0.6)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main())
