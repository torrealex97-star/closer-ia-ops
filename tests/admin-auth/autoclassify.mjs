// Cualificación automática: reglas + IA deciden; solo las excepciones quedan para una persona.
// Uso: node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/autoclassify.mjs
import assert from 'node:assert/strict';
import http from 'node:http';

// Base de datos simulada: external_offers con guardas de estado como PostgREST (eq/in) y contador de
// aprobaciones automáticas del día para el tope.
const rows = new Map();
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x'); let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    const send = (s, d, headers = {}) => { res.writeHead(s, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(d)); };
    if (url.pathname !== '/rest/v1/external_offers') return send(200, []);
    const q = Object.fromEntries(url.searchParams);
    const all = [...rows.values()];
    if (req.method === 'PATCH') {
      const patch = JSON.parse(body || '{}');
      let hit = all;
      if (q.id?.startsWith('in.(')) { const ids = q.id.slice(4, -1).split(','); hit = hit.filter(r => ids.includes(r.id)); }
      else if (q.id?.startsWith('eq.')) hit = hit.filter(r => r.id === q.id.slice(3));
      if (q.editorial_status === 'eq.draft') hit = hit.filter(r => r.editorial_status === 'draft');
      if (q.ai_review === 'is.null') hit = hit.filter(r => !r.ai_review);
      hit.forEach(r => Object.assign(r, patch));
      return send(200, hit);
    }
    if (q.reviewed_by?.startsWith('in.(')) {
      const who = q.reviewed_by.slice(4, -1).split(',');
      const since = q.reviewed_at?.replace('gte.', '') ?? '';
      const n = all.filter(r => who.includes(r.reviewed_by) && r.reviewed_at && r.reviewed_at >= since).length;
      return send(200, [], { 'content-range': `0-0/${n}` });
    }
    let list = all;
    if (q.editorial_status === 'eq.draft') list = list.filter(r => r.editorial_status === 'draft');
    if (q.editorial_status?.startsWith('in.(')) { const st = q.editorial_status.slice(4, -1).split(','); list = list.filter(r => st.includes(r.editorial_status)); }
    if (q.ai_review === 'is.null') list = list.filter(r => !r.ai_review);
    if (q.id?.startsWith('in.(')) { const ids = q.id.slice(4, -1).split(','); list = list.filter(r => ids.includes(r.id)); }
    list.sort((a, b) => b.score - a.score);
    send(200, list.slice(0, Number(q.limit) || 100));
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'k';
process.env.SUPABASE_PUBLISHABLE_KEY = 'a';

const { judgeOffer, runAutoReview } = await import('../../apps/web/lib/autoReview.ts');
const ai = await import('../../apps/web/lib/aiReview.ts');

const base = (id, extra) => ({
  id, org_id: 'cloud-wdc', company: 'Acme', location: 'Madrid, España', salary: '30.000 €/año',
  description: 'Buscamos closer para cerrar ventas del programa con el equipo comercial de la empresa.',
  role: 'closer', score: 70, spain: true, verified_result: null, market: 'ES', market_basis: 'ubicacion_espana',
  red_flags: [], editorial_status: 'draft', ai_review: null, reviewed_by: null, reviewed_at: null,
  url: `https://jobs.example.com/${id}`, ...extra,
});

// 1) Regla determinista sobre hechos: páginas de resultados y enlaces cerrados no son anuncios.
const index = base('x', { title: 'Ofertas de trabajo de Closer de ventas', company: null, url: 'https://www.infojobs.net/ofertas-trabajo/closer-de-ventas', score: 55 });
assert.equal(judgeOffer(index).decision, 'withdraw');
assert.equal(judgeOffer(index).why, 'no_es_oferta', 'un listado de portal no se aprueba ni espera a una persona');
assert.equal(judgeOffer(base('y', { title: 'Closer', verified_result: 'closed' })).decision, 'withdraw');
assert.equal(judgeOffer(base('y', { title: 'Closer', verified_result: 'closed' })).why, 'enlace_cerrado');
assert.equal(judgeOffer(base('y', { title: 'Closer', score: 40 })).ai, true, 'la puntuación baja la decide la IA');
assert.equal(judgeOffer(base('y', { title: 'Closer', red_flags: ['pide_dinero'] })).decision, 'human', 'una bandera roja nunca se auto-aprueba');
assert.equal(judgeOffer(base('y', { title: 'Closer', score: 40 })).decision, 'human', 'la regla no aprueba lo dudoso: lo remite');
// Ubicación de EE. UU. con nombre de municipio español: no es España ni se cuela por el gazetteer.
const florida = judgeOffer(base('z', { title: 'Closer high ticket', location: 'Miramar, FL', score: 30, spain: true }));
assert.equal(florida.market, 'US_LATINO');
assert.equal(florida.decision, 'human');
assert.equal(florida.ai, true, 'la IA lee la ubicación literal antes de aprobarla');
// Municipio español con la columna guardada desactualizada: manda el dato actual.
const alcobendas = judgeOffer(base('w', { title: 'Closer de ventas', location: 'Alcobendas', spain: false, market: null, market_basis: null }));
assert.equal(alcobendas.decision, 'approve', 'Alcobendas es España aunque la fila se guardara con spain=false');
console.log('PASS  reglas: listados y enlaces cerrados fuera; dudoso a la IA; España recalculada');

// 2) Ejecución completa: reglas aprueban/retiran, la IA clasifica el resto y solo lo complejo queda.
const notSampled = (start, n) => {
  const out = [];
  for (let i = start; out.length < n; i++) if (!ai.auditSample(`33333333-3333-4333-8333-${String(i).padStart(12, '0')}`)) out.push(`33333333-3333-4333-8333-${String(i).padStart(12, '0')}`);
  return out;
};
const [a1, a2, a3, a4, a5] = notSampled(1, 5);
const seed = () => {
  rows.clear();
  // 3 claras (reglas)
  for (let i = 0; i < 3; i++) { const id = `44444444-4444-4444-8444-${String(i).padStart(12, '0')}`; rows.set(id, base(id, { title: `Closer de ventas ${i}` })); }
  // 2 listados de portal, 1 cerrada
  rows.set('55555555-5555-4555-8555-000000000001', base('55555555-5555-4555-8555-000000000001', { title: 'Ofertas de trabajo de Closer', company: null, url: 'https://www.infojobs.net/ofertas-trabajo/closer', score: 55 }));
  rows.set('55555555-5555-4555-8555-000000000002', base('55555555-5555-4555-8555-000000000002', { title: 'Empleos de closer en España', company: null, url: 'https://es.trabajo.org/empleos/closer', score: 50 }));
  rows.set('55555555-5555-4555-8555-000000000003', base('55555555-5555-4555-8555-000000000003', { title: 'Closer', verified_result: 'closed' }));
  // 1 sin mercado y 1 con bandera roja: no se pueden mostrar, esperan a una persona
  rows.set('66666666-6666-4666-8666-000000000001', base('66666666-6666-4666-8666-000000000001', { title: 'Closer remoto', location: null, salary: null, market: null, market_basis: 'sin_senal', spain: null, score: 80 }));
  rows.set('66666666-6666-4666-8666-000000000002', base('66666666-6666-4666-8666-000000000002', { title: 'Closer comisiones', red_flags: ['pide_inversion'] }));
  // 5 dudosas que sí podrían mostrarse: 2 aprueba la IA, 2 rechaza, 1 duda
  rows.set(a1, base(a1, { title: 'Closer España A', score: 40 }));
  rows.set(a2, base(a2, { title: 'Closer España B', score: 40 }));
  rows.set(a3, base(a3, { title: 'Closer España C', score: 40 }));
  rows.set(a4, base(a4, { title: 'Closer España D', score: 40 }));
  rows.set(a5, base(a5, { title: 'Closer high ticket', location: 'Miramar, FL', score: 30, spain: true, market: null, market_basis: null }));
};
const llm = async prompt => {
  if (prompt.includes('Closer España A') || prompt.includes('Closer España B')) return '{"verdict":"approve","confidence":95,"reasons":["puesto real de cierre"],"red_flags":[]}';
  if (prompt.includes('Closer España C') || prompt.includes('Miramar')) return '{"verdict":"reject","confidence":92,"reasons":["no encaja en el mercado"],"red_flags":[]}';
  return '{"verdict":"human","confidence":35,"reasons":["texto insuficiente"]}';
};
const aiDeps = { llm, fetchImpl: async () => new Response('Closer en Acme', { status: 200 }), resolve: async () => ['93.184.216.34'] };
const run = () => runAutoReview({ deadline: Date.now() + 60000, aiDeps });
const byTitle = t => [...rows.values()].find(r => r.title === t);

seed();
const r1 = await run();
assert.equal(r1.checked, 13, 'se miran todos los borradores vivos');
assert.equal(r1.approved, 5, '3 por reglas + 2 por la IA');
assert.equal(r1.withdrawn, 5, '2 listados + 1 cerrada + 2 rechazos de la IA');
assert.equal(r1.exceptions, 3, 'cola humana: sin mercado, bandera roja y duda de la IA');
assert.equal(r1.by_reason.sin_mercado, 1);
assert.equal(r1.by_reason.banderas_rojas, 1);
assert.equal(r1.by_reason.ia_duda, 1);
assert.equal(byTitle('Closer España A').editorial_status, 'approved');
assert.equal(byTitle('Closer España A').reviewed_by, 'ai-review');
assert.equal(byTitle('Closer España B').ai_review.would_decide, 'approve');
assert.equal(byTitle('Closer España C').editorial_status, 'withdrawn');
assert.equal(byTitle('Closer España D').editorial_status, 'needs_review', 'la duda de la IA va a la cola humana, no queda en borrador');
assert.equal(byTitle('Closer high ticket').editorial_status, 'withdrawn', 'la IA ve «Miramar, FL» y la retira');
assert.equal(byTitle('Ofertas de trabajo de Closer').editorial_status, 'withdrawn');
assert.equal(byTitle('Closer remoto').editorial_status, 'draft', 'sin mercado no se aprueba (no se podría ni mostrar)');
assert.equal(r1.ai.reviewed, 5);
assert.equal(r1.ai.approved, 2);
assert.equal(r1.ai.human, 1);
console.log('PASS  ejecución: lo claro entra, lo que no encaja se retira, solo lo complejo llega a una persona');

// 3) Tope diario único para reglas e IA: con 4 huecos no entran más de 4 aprobaciones.
seed();
const capped = await runAutoReview({ deadline: Date.now() + 60000, cap: 4, aiDeps });
assert.equal(capped.approved, 4, '3 reglas + 1 IA: el tope se respeta entre las dos vías');
assert.equal(capped.ai.approved, 1);
assert.ok(capped.exceptions >= 1, 'la que no cabe en el tope espera en la cola, no se aprueba');
console.log('PASS  tope: reglas y IA comparten el mismo cupo diario');

// 4) Sin proveedor no se inventa nada: lo dudoso queda pendiente y se declara.
seed();
const noAi = await runAutoReview({ deadline: Date.now() + 60000, aiDeps: { ...aiDeps, llm: null } });
assert.equal(noAi.ai.skipped, 'sin clave de Groq');
assert.equal(noAi.approved, 3, 'solo lo que cierran las reglas');
assert.equal(noAi.exceptions, 2 + 5, 'sin mercado + bandera roja + las 5 que la IA no pudo ver');
assert.equal(noAi.by_reason.ia_sin_proveedor, 5);
assert.equal(byTitle('Closer España A').editorial_status, 'draft');
console.log('PASS  proveedor ausente: se declara y no se aprueba por suposición');

// 5) El proveedor que falla se cuenta (antes devolvía «0 revisadas» como si no hubiera trabajo).
seed();
const broken = await runAutoReview({ deadline: Date.now() + 60000, aiDeps: { ...aiDeps, llm: async () => null } });
assert.equal(broken.ai.reviewed, 0);
assert.equal(broken.ai.failed_calls, 5);
assert.equal(broken.ai.skipped, 'el modelo falló (fallo del modelo)');
assert.equal(broken.by_reason.ia_fallos, 5);
console.log('PASS  fallo del modelo: se declara y nada se aprueba por suposición');

server.close();
