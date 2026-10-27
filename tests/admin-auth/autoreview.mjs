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
    // approvalsToday: cuenta con content-range, como PostgREST con Prefer: count=exact. Acepta `eq.x` y `in.(x,y)`.
    if (q.reviewed_by) {
      const since = q.reviewed_at?.replace('gte.', '') ?? '';
      const wanted = q.reviewed_by.startsWith('in.(') ? q.reviewed_by.slice(4, -1).split(',') : [q.reviewed_by.replace('eq.', '')];
      const n = all.filter(r => wanted.includes(r.reviewed_by) && r.reviewed_at && r.reviewed_at >= since).length;
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
  url: `https://jobs.example.com/${n}`,
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

// 1) La regla, caso por caso: aprueba lo comprobable, remite lo dudoso y RETIRA lo que no es un anuncio.
assert.equal(judgeOffer(offer(1)).decision, 'approve');
for (const [row, why] of [
  [offer(4, { title: 'Senior Sales Closer', description: 'We are hiring a closer for our growing team in Madrid.' }), 'idioma_dudoso'],
  [offer(5, { red_flags: ['pide_inversion'] }), 'banderas_rojas'],
  [offer(6, { score: 30 }), 'score_bajo'],
  [offer(7, { role: null }), 'sin_perfil'],
]) assert.equal(judgeOffer(row).why, why, why);
// Una página de resultados de un portal no es una oferta: ni se aprueba ni ocupa la cola humana.
const index = judgeOffer(offer(9, { title: 'Ofertas de trabajo de Closer', company: null, url: 'https://www.infojobs.net/ofertas-trabajo/closer' }));
assert.equal(index.decision, 'withdraw');
assert.equal(index.why, 'no_es_oferta');
assert.equal(judgeOffer(offer(9, { url: 'https://es.trabajo.org/empleos/closer' })).decision, 'withdraw', 'basta la URL del listado');
// Un enlace cerrado no se revisa a mano: se retira (la vigencia automática ya lo hacía por otra vía).
assert.equal(judgeOffer(offer(10, { verified_result: 'closed' })).decision, 'withdraw');
assert.equal(judgeOffer(offer(10, { verified_result: 'closed' })).why, 'enlace_cerrado');
// Estados de EE. UU. que el gazetteer español conoce como municipios: manda el dato literal del anuncio.
const florida = judgeOffer(offer(11, { title: 'Closer high ticket', location: 'Miramar, FL', salary: '$90k', spain: true, market: 'ES', market_basis: 'ubicacion_espana' }));
assert.equal(florida.market, 'US_LATINO', 'Miramar, FL no es España');
assert.equal(florida.basis, 'ubicacion_estados_unidos');
assert.equal(florida.decision, 'approve', 'una oferta real en dólares sí entra sola');
console.log('PASS  la regla distingue lo claro, lo dudoso y lo que ni es una oferta');

// 2) Ejecución completa: lo claro se aprueba, lo dudoso se MUEVE a la cola humana y lo que no es una oferta se retira.
seed();
const r = await run();
assert.equal(r.checked, 8, 'se miran los ocho borradores');
assert.equal(r.approved, 3, 'tres claras');
assert.equal(r.withdrawn, 1, 'el enlace cerrado se retira');
assert.equal(r.exceptions, 4, 'cuatro necesitan criterio');
assert.equal(r.moved, 4, 'y las cuatro se mueven de verdad a la cola');
assert.equal(r.failed_writes, undefined, 'sin escrituras fallidas');
for (const n of [1, 2, 3]) {
  assert.equal(face(n).editorial_status, 'approved', `clara ${n}`);
  assert.equal(face(n).reviewed_by, 'auto-reglas');
}
for (const n of [4, 5, 6, 7]) {
  assert.equal(face(n).editorial_status, 'needs_review', `excepción ${n} en la cola humana`);
  assert.equal(face(n).reviewed_by, 'auto-excepcion', 'no consume el tope de aprobaciones');
  assert.equal(typeof face(n).auto_review?.why, 'string', 'con su motivo guardado');
}
assert.equal(face(4).auto_review.why, 'idioma_dudoso');
assert.equal(face(8).editorial_status, 'withdrawn', 'un enlace cerrado sale del catálogo');
assert.equal(face(8).reviewed_by, 'auto-retira', 'retirar no gasta cupo de aprobaciones');
assert.equal(face(8).auto_review.why, 'enlace_cerrado');
console.log('PASS  lo dudoso llega a la cola humana con motivo; lo que no es una oferta se retira');

// 3) Guarda de estado: solo se escriben borradores (una persona pudo mover la oferta mientras se decidía).
for (const p of patches) assert.match(p.query, /editorial_status=eq\.draft/, 'la escritura no pisa lo que ya movió alguien');
console.log('PASS  las escrituras llevan WHERE editorial_status=draft');

// 4) Tope diario: lo que cumple las reglas pero no cabe se queda en BORRADOR para mañana, no va a la cola.
seed();
const capped = await run({ cap: 2 });
assert.equal(capped.approved, 2);
assert.ok([1, 2, 3].some(n => face(n).editorial_status === 'draft'), 'la que no cabe sigue en borrador');
assert.equal(capped.by_reason.tope_diario, 1);
assert.equal(capped.withdrawn, 1, 'la retirada no depende del cupo de aprobaciones');
assert.equal(capped.moved, 4, 'las excepciones se mueven igual: no dependen del cupo de aprobaciones');
console.log('PASS  el tope diario no manda a una persona lo que la máquina sabía cerrar');

// 5) Escritura fallida: se declara y no se cuenta como hecha.
seed(); failWrites = true;
const failed = await run();
assert.equal(failed.moved, undefined, 'nada confirmado');
assert.equal(failed.failed_writes, 8, 'las 3 aprobaciones, las 4 excepciones y la retirada se declaran fallidas');
for (const n of [1, 4]) assert.equal(face(n).editorial_status, 'draft', 'sin escritura no hay cambio');
console.log('PASS  si la base falla, se declara y nada se da por hecho');

// 6) El tope diario lo gasta TODA la máquina, no solo las reglas. Antes se contaban únicamente las filas de
// `auto-reglas`, así que en una pasada posterior del mismo día la IA volvía a tener sus 25 y el día podía
// cerrar con más de 100 aprobaciones automáticas.
seed();
const today = new Date().toISOString();
for (let i = 0; i < 98; i++) rows.set(uuid(500 + i), offer(500 + i, { editorial_status: 'approved', reviewed_by: 'ai-review', reviewed_at: today }));
const nearlyFull = await run({ cap: 100 });
assert.equal(nearlyFull.used_before, 98, 'la IA también cuenta en el cupo del día');
assert.equal(nearlyFull.approved, 2, 'solo caben las que faltan hasta 100');
assert.equal(nearlyFull.by_reason.tope_diario, 1, 'la que no cabe se queda en borrador');
// Y una pasada que ya no tiene hueco no escribe NADA (ni aprobaciones ni cola humana).
const escriturasAntes = patches.length;
const noRoom = await run({ cap: 100 });
assert.equal(noRoom.used_before, 100);
assert.equal(noRoom.approved, 0);
assert.equal(noRoom.checked, 0, 'sin cupo ni se miran los borradores');
assert.equal(patches.length, escriturasAntes, 'sin cupo no se toca la base');
console.log('PASS  el tope diario lo gasta toda la máquina (reglas + IA), también entre pasadas');

// 7) El cupo de la IA viaja como entorno explícito de SU llamada: no se escribe `process.env`.
seed();
delete process.env.AI_REVIEW_MAX_APPROVALS;
process.env.AI_REVIEW_MODE = 'live';
const seen = [];
const aiStub = async (deps) => { seen.push(deps?.env?.AI_REVIEW_MAX_APPROVALS); return { mode: 'live', reviewed: 0, would_approve: 0, would_withdraw: 0, human: 0, applied: 0 }; };
const conIa = await run({ cap: 5, ai: aiStub });
assert.equal(conIa.approved, 3, 'las reglas siguen cerrando lo claro');
assert.equal(seen.length, 1, 'la IA se llama una vez');
assert.equal(seen[0], '2', 'el hueco que queda (5 menos 3) es el cupo que recibe la IA');
assert.equal(process.env.AI_REVIEW_MAX_APPROVALS, undefined, 'no se escribe en el entorno del proceso');
process.env.AI_REVIEW_MODE = 'shadow';
console.log('PASS  el cupo de la IA va en su propio entorno, sin tocar el del proceso');

// 8) Lo que ni es una oferta ni se puede mostrar sale del catálogo sin gastar cupo y sin ocupar la cola humana.
seed();
rows.set(uuid(9), offer(9, { title: 'Ofertas de trabajo de Closer de ventas', company: null, url: 'https://www.infojobs.net/ofertas-trabajo/closer-de-ventas', score: 90 }));
rows.set(uuid(10), offer(10, { title: 'Empleos de closer en España', company: null, url: 'https://es.trabajo.org/empleos/closer', score: 80 }));
const mixed = await run({ cap: 100 });
assert.equal(mixed.checked, 10, 'se miran los diez borradores');
assert.equal(mixed.approved, 3, 'solo las tres claras se aprueban');
assert.equal(mixed.withdrawn, 3, 'los dos listados y el enlace cerrado');
assert.equal(mixed.by_reason.no_es_oferta, 2);
assert.equal(mixed.by_reason.enlace_cerrado, 1);
assert.equal(mixed.exceptions, 4, 'la cola humana no se llena con lo que no es revisable');
assert.equal(face(9).editorial_status, 'withdrawn');
assert.equal(face(9).reviewed_by, 'auto-retira');
assert.ok(face(9).reviewed_at, 'queda registrado cuándo se retiró');
for (const p of patches) assert.match(p.query, /editorial_status=eq\.draft/, 'la retirada tampoco pisa lo que ya movió alguien');
// Las retiradas no son aprobaciones: el cupo del día solo cuenta lo que la máquina puso delante de una alumna.
const after = await run({ cap: 100 });
assert.equal(after.used_before, 3, 'las retiradas no consumen el cupo de aprobaciones');
assert.equal(after.checked, 0, 'y no queda nada por clasificar');
console.log('PASS  listados y enlaces cerrados se retiran sin gastar cupo ni ensuciar la cola');

server.close();
