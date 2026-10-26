// Cualificación automática de fuentes externas: lo claro se aprueba y lo dudoso ACABA en la cola
// humana. Antes solo se contaba: cada pasada dejaba todo en borrador y el panel mostraba «0 a
// revisar», así que la pestaña de excepciones nunca tenía nada.
// Uso: node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/autoreview.mjs
import assert from 'node:assert/strict';
import http from 'node:http';

// PostgREST simulado: external_offers con las guardas que usa el código (in., eq.draft, count=exact).
const rows = new Map();
const patches = [];   // cada PATCH, para comprobar la guarda de estado
let failWrites = false;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    const send = (s, d, headers = {}) => { res.writeHead(s, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(d)); };
    if (!url.pathname.endsWith('/external_offers')) return send(200, []);
    const q = Object.fromEntries(url.searchParams);
    const all = [...rows.values()];
    const ids = q.id?.startsWith('in.(') ? q.id.slice(4, -1).split(',') : null;

    if (req.method === 'PATCH') {
      patches.push({ query: url.search, body });
      if (failWrites) return send(500, { message: 'escritura rechazada' });
      let hit = ids ? all.filter(r => ids.includes(r.id)) : all;
      if (q.editorial_status === 'eq.draft') hit = hit.filter(r => r.editorial_status === 'draft');
      const patch = JSON.parse(body || '{}');
      hit.forEach(r => Object.assign(r, patch));
      return send(200, hit);
    }
    // approvalsToday: cuenta con content-range, como PostgREST con Prefer: count=exact.
    if (q.reviewed_by === 'eq.auto-reglas') {
      const since = q.reviewed_at?.replace('gte.', '') ?? '';
      const n = all.filter(r => r.reviewed_by === 'auto-reglas' && r.reviewed_at && r.reviewed_at >= since).length;
      return send(200, [], { 'content-range': `0-0/${n}` });
    }
    let list = all;
    if (q.editorial_status === 'eq.draft') list = list.filter(r => r.editorial_status === 'draft');
    if (ids) list = list.filter(r => ids.includes(r.id));
    list.sort((a, b) => b.score - a.score);
    return send(200, list.slice(0, Number(q.limit) || 100));
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.SUPABASE_PUBLISHABLE_KEY = 'anon-key';
process.env.AI_REVIEW_MODE = 'shadow';

const { judgeOffer, runAutoReview } = await import('../../apps/web/lib/autoReview.ts');

const uuid = (n) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
const offer = (n, extra = {}) => ({
  id: uuid(n), title: `Closer de ventas ${n}`, company: 'Acme', location: 'Madrid, España',
  description: 'Buscamos closer para cerrar ventas del programa con el equipo comercial de la empresa.',
  salary: '30.000 €/año', role: 'closer', score: 70, spain: true, verified_result: null,
  market: 'ES', market_basis: 'ubicacion_espana', red_flags: [],
  editorial_status: 'draft', reviewed_by: null, reviewed_at: null, ai_review: null,
  expires_at: new Date(Date.now() + 5 * 864e5).toISOString(), ...extra,
});
const seed = () => {
  rows.clear(); patches.length = 0; failWrites = false;
  rows.set(uuid(1), offer(1));                                               // clara
  rows.set(uuid(2), offer(2));                                               // clara
  rows.set(uuid(3), offer(3));                                               // clara
  rows.set(uuid(4), offer(4, { title: 'Senior Sales Closer', description: 'We are hiring a closer for our growing team in Madrid.' })); // idioma dudoso
  rows.set(uuid(5), offer(5, { red_flags: ['pide_inversion'] }));            // bandera roja
  rows.set(uuid(6), offer(6, { score: 30 }));                                // puntuación baja
  rows.set(uuid(7), offer(7, { role: null }));                               // sin perfil
  rows.set(uuid(8), offer(8, { verified_result: 'closed' }));                // enlace cerrado
};
const face = (n) => rows.get(uuid(n));
const run = (deps = {}) => runAutoReview({ deadline: Date.now() + 60_000, ...deps });

// 1) La regla, caso por caso: aprueba lo comprobable y remite lo demás (nunca aprueba «por si acaso»).
assert.equal(judgeOffer(offer(1)).decision, 'approve');
for (const [row, why] of [
  [offer(4, { title: 'Senior Sales Closer', description: 'We are hiring a closer for our growing team in Madrid.' }), 'idioma_dudoso'],
  [offer(5, { red_flags: ['pide_inversion'] }), 'banderas_rojas'],
  [offer(6, { score: 30 }), 'score_bajo'],
  [offer(7, { role: null }), 'sin_perfil'],
  [offer(8, { verified_result: 'closed' }), 'enlace_cerrado'],
]) assert.equal(judgeOffer(row).why, why, why);
console.log('PASS  la regla distingue lo claro de lo dudoso, con su motivo');

// 2) Ejecución completa: lo claro se aprueba y lo dudoso se MUEVE a la cola humana, con su motivo.
seed();
const r = await run();
assert.equal(r.checked, 8, 'se miran los ocho borradores');
assert.equal(r.approved, 3, 'tres claras');
assert.equal(r.exceptions, 5, 'cinco necesitan criterio');
assert.equal(r.moved, 5, 'y las cinco se mueven de verdad a la cola');
assert.equal(r.failed_writes, undefined, 'sin escrituras fallidas');
for (const n of [1, 2, 3]) {
  assert.equal(face(n).editorial_status, 'approved', `clara ${n}`);
  assert.equal(face(n).reviewed_by, 'auto-reglas');
}
for (const n of [4, 5, 6, 7, 8]) {
  assert.equal(face(n).editorial_status, 'needs_review', `excepción ${n} en la cola humana`);
  assert.equal(face(n).reviewed_by, 'auto-excepcion', 'no consume el tope de aprobaciones');
  assert.equal(typeof face(n).auto_review?.why, 'string', 'con su motivo guardado');
}
assert.equal(face(4).auto_review.why, 'idioma_dudoso');
assert.equal(face(8).auto_review.why, 'enlace_cerrado');
console.log('PASS  lo dudoso llega a la cola humana con motivo, no se queda en borrador');

// 3) Guarda de estado: solo se escriben borradores (una persona pudo mover la oferta mientras se decidía).
for (const p of patches) assert.match(p.query, /editorial_status=eq\.draft/, 'la escritura no pisa lo que ya movió alguien');
console.log('PASS  las escrituras llevan WHERE editorial_status=draft');

// 4) Tope diario: lo que cumple las reglas pero no cabe se queda en BORRADOR para mañana, no va a la cola.
seed();
const capped = await run({ cap: 2 });
assert.equal(capped.approved, 2);
assert.ok([1, 2, 3].some(n => face(n).editorial_status === 'draft'), 'la que no cabe sigue en borrador');
assert.equal(capped.by_reason.tope_diario, 1);
assert.equal(capped.moved, 5, 'las excepciones se mueven igual: no dependen del cupo de aprobaciones');
console.log('PASS  el tope diario no manda a una persona lo que la máquina sabía cerrar');

// 5) Escritura fallida: se declara y no se cuenta como hecha.
seed(); failWrites = true;
const failed = await run();
assert.equal(failed.moved, undefined, 'nada confirmado');
assert.equal(failed.failed_writes, 8, 'las 3 aprobaciones y las 5 excepciones se declaran fallidas');
for (const n of [1, 4]) assert.equal(face(n).editorial_status, 'draft', 'sin escritura no hay cambio');
console.log('PASS  si la base falla, se declara y nada se da por hecho');

server.close();
