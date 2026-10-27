// Auditoría del catálogo: qué ofertas YA aprobadas retiraría hoy la regla, con su motivo, y sin tocar nada.
// La pasada automática solo mira borradores, así que una oferta aprobada antes del arreglo (o por una persona)
// seguía publicada sin que nadie lo viera. Esta lista lo enseña; NO cambia filas ni gasta cupo.
// Uso: node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/ruleaudit.mjs
import assert from 'node:assert/strict';
import http from 'node:http';

// PostgREST simulado, con las guardas que usa el código: `editorial_status=in.(…)`, `expires_at=gt.…` y offset.
const rows = [];
let writes = 0;
let failReads = false;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let body = '';
  req.on('data', c => body += c);
  req.on('end', () => {
    const send = (s, d, headers = {}) => { res.writeHead(s, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(d)); };
    if (!url.pathname.endsWith('/external_offers')) return send(200, []);
    // La auditoría es de solo lectura: cualquier escritura es un fallo de la prueba, no un detalle.
    if (req.method !== 'GET') { writes++; return send(200, []); }
    if (failReads) return send(500, { message: 'lectura rechazada' });
    const q = Object.fromEntries(url.searchParams);
    let list = [...rows];
    if (q.editorial_status?.startsWith('in.(')) list = list.filter(r => q.editorial_status.slice(4, -1).split(',').includes(r.editorial_status));
    if (q.expires_at?.startsWith('gt.')) list = list.filter(r => r.expires_at > decodeURIComponent(q.expires_at.slice(3)));
    const offset = Number(q.offset) || 0, limit = Number(q.limit) || 200;
    return send(200, list.slice(offset, offset + limit));
  });
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
process.env.SUPABASE_URL = `http://127.0.0.1:${server.address().port}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.SUPABASE_PUBLISHABLE_KEY = 'anon-key';

const { auditApprovedByRules } = await import('../../apps/web/lib/ruleAudit.ts');
const { judgeOffer, withdrawalReason } = await import('../../apps/web/lib/autoReview.ts');

const live = () => new Date(Date.now() + 5 * 864e5).toISOString();
const offer = (id, extra = {}) => ({
  id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(id).padStart(12, '0')}`, source: 'infojobs', title: `Closer de ventas ${id}`, company: 'Acme',
  location: 'Madrid, España', url: `https://www.infojobs.net/oferta-${id}`, salary: '30.000 €/año',
  description: 'Buscamos closer para cerrar ventas del programa con el equipo comercial de la empresa.',
  role: 'closer', score: 70, spain: true, verified_result: null, market: 'ES', market_basis: 'ubicacion_espana', red_flags: [],
  editorial_status: 'approved', reviewed_by: 'auto-reglas', expires_at: live(), ...extra,
});

// 1) El criterio es UNO: la auditoría usa la misma función que decide las retiradas, así que no puede haber
//    una copia que diga «listado» donde la regla dice «oferta» (fue el fallo real con las fichas de Jobijoba).
const listing = { title: 'Ofertas de trabajo de Closer', company: null, url: 'https://www.infojobs.net/ofertas-trabajo/closer', verified_result: null };
assert.equal(withdrawalReason(listing), 'no_es_oferta');
assert.equal(judgeOffer(offer(1, listing)).why, 'no_es_oferta');
const closed = { title: 'Closer de ventas', company: 'Acme', url: 'https://jobs.example.com/1', verified_result: 'closed' };
assert.equal(withdrawalReason(closed), 'enlace_cerrado');
assert.equal(judgeOffer(offer(2, closed)).why, 'enlace_cerrado');
// La ficha de una oferta concreta no es un listado (casos reales de producción).
const ficha = { title: 'Closer de Ventas Inbound | Altos Ingresos y Crecimiento (Palma)', company: 'Tradeando', url: 'https://www.jobijoba.es/oferta-empleo/69/da8f172d91a5ff0ef3d3f7c8fadc7652', verified_result: null };
assert.equal(withdrawalReason(ficha), null);
assert.equal(judgeOffer(offer(3, ficha)).decision, 'approve');
console.log('PASS  auditoría y regla comparten el mismo criterio de retirada');

// 2) Catálogo mixto: solo las aprobadas/publicadas Y VIVAS entran, y solo se listan las dos retirables.
rows.length = 0;
rows.push(
  offer(1),                                                                        // real: no aparece
  offer(2, listing),                                                               // listado aprobado: aparece
  offer(3, { ...closed, editorial_status: 'published', reviewed_by: 'auto-reglas' }), // enlace cerrado publicado: aparece
  offer(4, ficha),                                                                 // ficha real: no aparece
  offer(5, listing),                                                               // (abajo se cambia el estado)
  offer(6, { expires_at: new Date(Date.now() - 864e5).toISOString() }),            // caducada: no se audita
  offer(7, { editorial_status: 'draft' }),                                         // borrador: lo mira la pasada, no esto
  offer(8, { editorial_status: 'needs_review' }),
);
rows[4].editorial_status = 'draft'; rows[4].title = 'Empleos de closer en España'; rows[4].company = null; rows[4].url = 'https://es.trabajo.org/empleos/closer';
const audit = await auditApprovedByRules();
assert.ok(audit, 'la lectura del catálogo funciona');
assert.equal(audit.scanned, 4, 'solo las aprobadas/publicadas y vivas (1, 2, 3, 4)');
assert.equal(audit.matches.length, 2, 'el listado aprobado y el enlace cerrado publicado');
assert.deepEqual(audit.matches.map(m => m.why).sort(), ['enlace_cerrado', 'no_es_oferta']);
assert.deepEqual(audit.by_reason, { no_es_oferta: 1, enlace_cerrado: 1 });
assert.equal(audit.matches.find(m => m.why === 'no_es_oferta').id, rows[1].id);
assert.equal(audit.truncated, false, 'con el catálogo entero leído no se declara corte');
// Lo importante: informa, no actúa. Ninguna fila cambió y no hubo ni una escritura.
assert.equal(writes, 0, 'la auditoría no escribe nada');
assert.equal(rows[1].editorial_status, 'approved', 'el listado sigue aprobado: retirarlo es una decisión con botón propio');
assert.equal(rows[2].editorial_status, 'published', 'el enlace cerrado sigue publicado tras auditarlo');
console.log('PASS  el catálogo se audita en solo lectura: 2 motivos, ninguna escritura');

// 3) Tope: si no se llega a mirar todo, se dice (`truncated`) en vez de presentar una lista incompleta.
const cut = await auditApprovedByRules(2);
assert.equal(cut.scanned, 2, 'se mira solo hasta el tope');
assert.equal(cut.truncated, true, 'y se declara que la lista no está completa');
assert.equal(writes, 0);
console.log('PASS  el tope se declara como corte, no como catálogo limpio');

// 4) Fallo de lectura ≠ catálogo limpio: devuelve desconocido, no una lista vacía.
failReads = true;
assert.equal(await auditApprovedByRules(), null, 'un fallo de la base no se publica como «0 que retirar»');
failReads = false;
console.log('PASS  si la base falla, la auditoría dice «no se pudo», no «nada que retirar»');

assert.equal(writes, 0, 'ni un solo PATCH en toda la prueba');
server.close();
