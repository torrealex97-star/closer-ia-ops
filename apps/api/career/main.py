import csv
import io
import json
import os
import secrets
from .integrations import router as integrations_router
from .ai import router as ai_router
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, Header, HTTPException
from fastapi.responses import Response
from openpyxl import Workbook
from .sources import registry, router as sources_router, source_infos
from .db import connect, initialize, load_run, now, org, uid
from .models import (Configuration, ExportRequest, SavedRequest, SavedSearch, SearchRequest,
                     SearchRun, SourceProgress, StarRequest)


@asynccontextmanager
async def lifespan(app):
    if not os.environ.get("CAREER_LOCAL_TOKEN"):
        raise RuntimeError("Start with npm run dev: local API requires a generated token")
    initialize()
    yield


def authorize(authorization: str = Header(default="")):
    expected = os.environ.get("CAREER_LOCAL_TOKEN", "")
    if not expected or not secrets.compare_digest(authorization, "Bearer " + expected):
        raise HTTPException(401, "Acceso local no autorizado")


app = FastAPI(title="Career Platform API", version="0.1.0", lifespan=lifespan,
              dependencies=[Depends(authorize)])


app.include_router(sources_router)
app.include_router(integrations_router)
app.include_router(ai_router)


@app.get("/health/live")
def health():
    return {"status": "ok", "mode": "local"}


@app.get("/v1/config", response_model=Configuration)
def config():
    return Configuration(organization=os.environ.get("CAREER_ORG_NAME", "Women Digital Closer"),
                         product_name="Oportunidades", sources=source_infos(org()))



@app.post("/v1/search-runs", response_model=SearchRun, status_code=202)
def create_search(request: SearchRequest):
    if request.query.role == "custom" and not request.query.keywords.strip():
        raise HTTPException(422, "Indica el puesto que quieres buscar")
    available = registry(org())
    if any(code not in available for code in request.query.sources):
        raise HTTPException(422, "Selecciona fuentes disponibles; configura primero su dataset")
    with connect() as db:
        db.execute("BEGIN IMMEDIATE")
        existing = db.execute("SELECT id,query FROM search_runs WHERE org_id=? AND request_key=?", (org(), request.idempotency_key)).fetchone()
        if existing:
            if json.loads(existing["query"]) != request.query.model_dump():
                raise HTTPException(409, "La clave de búsqueda ya corresponde a otros filtros")
            run_id = existing["id"]
        else:
            active = db.execute("SELECT count(*) FROM search_runs WHERE org_id=? AND status IN ('queued','running')", (org(),)).fetchone()[0]
            if active >= 3:
                raise HTTPException(429, "Ya hay tres búsquedas en curso. Espera o cancela una.")
            run_id = uid()
            sources = [SourceProgress(code=c, name=available[c].name).model_dump() for c in dict.fromkeys(request.query.sources)]
            db.execute("INSERT INTO search_runs VALUES(?,?,?,?,?,?,?,NULL)",
                       (run_id, org(), request.idempotency_key, request.query.model_dump_json(), "queued", json.dumps(sources), now()))
    return load_run(run_id, org())


@app.get("/v1/search-runs", response_model=list[SearchRun])
def history():
    with connect() as db:
        rows = db.execute("SELECT id,query,status,sources,created_at,completed_at FROM search_runs WHERE org_id=? ORDER BY created_at DESC LIMIT 30", (org(),)).fetchall()
    return [dict(r, query=json.loads(r["query"]), sources=json.loads(r["sources"]), jobs=[]) for r in rows]


@app.get("/v1/search-runs/{run_id}", response_model=SearchRun)
def get_run(run_id: str):
    run = load_run(run_id, org())
    if not run:
        raise HTTPException(404, "Búsqueda no encontrada")
    return run


@app.post("/v1/search-runs/{run_id}/cancel", response_model=SearchRun)
def cancel(run_id: str):
    with connect() as db:
        db.execute("UPDATE search_runs SET status='cancelled',completed_at=? WHERE id=? AND org_id=? AND status IN ('queued','running')", (now(), run_id, org()))
    return get_run(run_id)


@app.patch("/v1/jobs/{job_id}/star")
def star(job_id: str, body: StarRequest):
    with connect() as db:
        result = db.execute("UPDATE jobs SET starred=? WHERE id=? AND org_id=?", (int(body.starred), job_id, org()))
        if not result.rowcount:
            raise HTTPException(404, "Oferta no encontrada")
    return {"ok": True}


@app.get("/v1/saved-searches", response_model=list[SavedSearch])
def saved():
    with connect() as db:
        rows = db.execute("SELECT id,name,query FROM saved_searches WHERE org_id=? ORDER BY name", (org(),)).fetchall()
    return [dict(r, query=json.loads(r["query"])) for r in rows]


@app.post("/v1/saved-searches", response_model=SavedSearch)
def save(body: SavedRequest):
    search_id = uid()
    with connect() as db:
        db.execute("INSERT INTO saved_searches VALUES(?,?,?,?)", (search_id, org(), body.name, body.query.model_dump_json()))
    return SavedSearch(id=search_id, **body.model_dump())


def spreadsheet_safe(value):
    text = str(value if value is not None else "")
    return "'" + text if text.lstrip().startswith(("=", "+", "-", "@")) or text.startswith(("\t", "\r")) else text


@app.post("/v1/exports")
def export(body: ExportRequest):
    run = get_run(body.run_id)
    ids = set(body.job_ids)
    jobs = [j for j in run["jobs"] if j["id"] in ids]
    if len(jobs) != len(ids):
        raise HTTPException(422, "La selección contiene ofertas ajenas a esta búsqueda")
    fields = ["title", "company", "locations", "salary_min", "salary_max", "salary_currency",
              "salary_period", "published_at", "source", "source_url", "application_url", "score", "warnings"]
    headers = {"Content-Disposition": f'attachment; filename="oportunidades.{body.format}"', "Cache-Control": "no-store"}
    if body.format == "json":
        return Response(json.dumps(jobs, ensure_ascii=False, indent=2), media_type="application/json", headers=headers)
    rows = [[spreadsheet_safe(", ".join(j[f]) if isinstance(j[f], list) else j[f]) for f in fields] for j in jobs]
    if body.format == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(fields)
        writer.writerows(rows)
        return Response("\ufeff" + output.getvalue(), media_type="text/csv; charset=utf-8", headers=headers)
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Oportunidades"
    sheet.append(fields)
    for row in rows:
        sheet.append(row)
    sheet.freeze_panes = "A2"
    sheet.auto_filter.ref = sheet.dimensions
    output = io.BytesIO()
    workbook.save(output)
    return Response(output.getvalue(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", headers=headers)
