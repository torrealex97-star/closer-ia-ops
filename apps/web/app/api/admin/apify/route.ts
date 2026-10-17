import { NextRequest } from 'next/server';
import { authenticate, originBlocked, publicBaseUrl, withCookies } from '../../../../lib/adminAuth';
import { ACTOR_RE, apifyToken, fetchSchema, harvestPending, listActors, listRuns, MONTHLY_BUDGET_USD, monthSpent, PRESETS } from '../../../../lib/apify';
import { ORG, SOURCE_RE } from '../../../../lib/external';
import { startRun } from '../../../../lib/apify';
import { serviceRest } from '../../../../lib/supabaseAuth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// Actores de Apify desde el panel. Ver y recoger resultados: cualquier operador. Crear, editar, borrar y lanzar (gasta
// crédito de Apify): solo el propietario.
async function gate(request: NextRequest, ownerOnly: boolean) {
  if (originBlocked(request)) return { error: Response.json({ detail: 'Origen no permitido' }, { status: 403 }) };
  const auth = await authenticate(request);
  if (!auth.ok) return { error: Response.json({ detail: auth.detail }, { status: auth.status }) };
  if (ownerOnly && auth.admin.role !== 'owner') return { error: Response.json({ detail: 'Solo el propietario puede configurar o lanzar actores.' }, { status: 403 }) };
  return { auth };
}
const reply = (auth: { setCookies: string[] }, body: unknown, status = 200) => withCookies(Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } }), auth.setCookies);
const int = (v: unknown, min: number, max: number, d: number) => { const n = Math.floor(Number(v)); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d; };

export async function GET(request: NextRequest) {
  const { auth, error } = await gate(request, false);
  if (error) return error;
  const [actors, runs, spent, token] = await Promise.all([listActors(), listRuns(), monthSpent(), apifyToken()]);
  if (!actors || !runs) return Response.json({ detail: 'No se pudo leer los actores.' }, { status: 503 });
  return reply(auth!, { actors, runs, presets: PRESETS, budget: { spent: spent === null ? null : Number(spent.toFixed(4)), limit: MONTHLY_BUDGET_USD() }, has_key: Boolean(token) });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = body.action;
  const { auth, error } = await gate(request, action !== 'harvest');
  if (error) return error;

  if (action === 'harvest') return reply(auth!, { results: await harvestPending(45000) });

  if (action === 'save') {
    const label = typeof body.label === 'string' ? body.label.trim().slice(0, 80) : '', actor = typeof body.actor === 'string' ? body.actor.trim() : '', source = typeof body.source === 'string' ? body.source.trim() : '';
    if (!label || !ACTOR_RE.test(actor) || !SOURCE_RE.test(source)) return Response.json({ detail: 'Revisa el nombre, el actor (propietario/nombre) y el código de fuente (minúsculas, números y guiones).' }, { status: 422 });
    let template: unknown = null;
    if (typeof body.input_template === 'string' && body.input_template.trim()) { try { template = JSON.parse(body.input_template); } catch { return Response.json({ detail: 'La plantilla de entrada no es un JSON válido.' }, { status: 422 }); } if (!template || typeof template !== 'object' || Array.isArray(template)) return Response.json({ detail: 'La plantilla debe ser un objeto JSON.' }, { status: 422 }); }
    const row = { org_id: ORG, label, actor, source, input_template: template, max_items: int(body.max_items, 10, 5000, 500), memory_mb: int(body.memory_mb, 256, 4096, 1024), timeout_s: int(body.timeout_s, 60, 3600, 900), schedule_daily: body.schedule_daily === true, created_by: auth!.admin.email };
    const id = typeof body.id === 'string' && /^[0-9a-f-]{36}$/.test(body.id) ? body.id : null;
    const response = id ? await serviceRest(`apify_actors?org_id=eq.${ORG}&id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(row) }) : await serviceRest('apify_actors', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(row) });
    return response.ok ? reply(auth!, { ok: true }, id ? 200 : 201) : Response.json({ detail: 'No se pudo guardar el actor.' }, { status: 503 });
  }

  if (action === 'delete') {
    if (typeof body.id !== 'string' || !/^[0-9a-f-]{36}$/.test(body.id)) return Response.json({ detail: 'Actor no válido.' }, { status: 422 });
    const response = await serviceRest(`apify_actors?org_id=eq.${ORG}&id=eq.${body.id}`, { method: 'DELETE' });
    return response.ok ? reply(auth!, { ok: true }) : Response.json({ detail: 'No se pudo borrar.' }, { status: 503 });
  }

  if (action === 'start') {
    const actors = await listActors(); const actor = actors?.find(a => a.id === body.id);
    if (!actor) return Response.json({ detail: 'Actor no encontrado.' }, { status: 404 });
    const result = await startRun(actor, auth!.admin.email, publicBaseUrl(request));
    return result.ok ? reply(auth!, result, 202) : Response.json({ detail: result.error }, { status: 409 });
  }

  if (action === 'schema') {
    const token = await apifyToken(); const actor = typeof body.actor === 'string' ? body.actor.trim() : '';
    if (!token) return Response.json({ detail: 'Guarda antes la clave de Apify en la pestaña APIs.' }, { status: 409 });
    if (!ACTOR_RE.test(actor)) return Response.json({ detail: 'Actor no válido.' }, { status: 422 });
    const schema = await fetchSchema(actor, token);
    return schema ? reply(auth!, { fields: Object.entries(schema.properties).map(([name, p]) => ({ name, type: p.type ?? '?', required: schema.required.includes(name) })) }) : Response.json({ detail: 'No se pudo leer el esquema del actor.' }, { status: 404 });
  }
  return Response.json({ detail: 'Acción no válida.' }, { status: 422 });
}
