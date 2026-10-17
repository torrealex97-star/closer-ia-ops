// Tablero de relevo: node tests/handoff.mjs
import assert from 'node:assert/strict';
import { parseClaim, check, board, load } from '../scripts/handoff.mjs';

const doc = (o = {}) => `---\nagent: ${o.agent ?? 'a1'}\nstatus: ${o.status ?? 'in_progress'}\nbranch: ${o.branch ?? 'feat/x'}\ntouches: ${o.touches ?? 'apps/web/lib/a.ts'}\ndate: ${o.date ?? '2026-10-17'}\n${o.depends ? `depends_on: ${o.depends}\n` : ''}${o.pr ? `pr: ${o.pr}\n` : ''}---\ntexto`;
const claim = (name, o) => parseClaim(doc(o), name);

// Formato
assert.deepEqual(parseClaim('sin cabecera', 'x').errors, ['sin cabecera ---']);
assert.deepEqual(parseClaim('---\nagent: a\n---', 'x').errors.sort(), ['falta branch', 'falta date', 'falta status', 'falta touches']);
assert.ok(claim('x', { status: 'listo' }).errors.some(e => /status inválido/.test(e)));
assert.ok(claim('x', { date: '17/10/2026' }).errors.some(e => /AAAA-MM-DD/.test(e)));
assert.deepEqual(claim('x', { touches: 'a.ts, b/ ,c.ts' }).touches, ['a.ts', 'b/', 'c.ts']);

// Solapes entre agentes distintos
assert.deepEqual(check([claim('c1', { agent: 'a1', touches: 'apps/web/lib/a.ts' }), claim('c2', { agent: 'a2', touches: 'apps/web/lib/b.ts' })]), []);
assert.match(check([claim('c1', { agent: 'a1', touches: 'x.ts' }), claim('c2', { agent: 'a2', touches: 'x.ts' })])[0], /ambos tocan x\.ts/);
assert.match(check([claim('c1', { agent: 'a1', touches: 'apps/web/lib/' }), claim('c2', { agent: 'a2', touches: 'apps/web/lib/a.ts' })])[0], /ambos tocan/);
assert.deepEqual(check([claim('c1', { agent: 'a1', touches: 'apps/web/libreria' }), claim('c2', { agent: 'a2', touches: 'apps/web/lib' })]), [], 'prefijo solo en frontera de directorio');
assert.match(check([claim('c1', { agent: 'a1', touches: 'table:students' }), claim('c2', { agent: 'a2', touches: 'table:students' })])[0], /table:students/);
// Un trabajo en curso por agente, salvo cadena declarada; los validated en cola de revisión no cuentan
assert.match(check([claim('c1', { agent: 'a1', touches: 'a.ts' }), claim('c2', { agent: 'a1', touches: 'b.ts' })])[0], /un trabajo en curso por agente/);
assert.deepEqual(check([claim('c1', { agent: 'a1', status: 'validated', touches: 'a.ts' }), claim('c2', { agent: 'a1', status: 'in_progress', touches: 'b.ts' })]), [], 'uno validated + uno en curso: permitido');
assert.deepEqual(check([claim('c1', { agent: 'a1', status: 'validated', touches: 'a.ts' }), claim('c2', { agent: 'a1', status: 'validated', touches: 'b.ts' })]), []);
assert.deepEqual(check([claim('c1', { agent: 'a1', touches: 'a.ts' }), claim('c2', { agent: 'a1', touches: 'a.ts', depends: 'c1' })]), [], 'pila declarada: mismo agente y mismo fichero permitidos');
assert.deepEqual(check([claim('c1', { agent: 'a1', touches: 'a.ts' }), claim('c2', { agent: 'a1', touches: 'b.ts', depends: 'c1' }), claim('c3', { agent: 'a1', touches: 'a.ts', depends: 'c2' })]), [], 'cadena transitiva');
assert.match(check([claim('c1', { agent: 'a1', depends: 'fantasma' })])[0], /depends_on desconocido/);
assert.match(check([parseClaim('nada', 'roto')])[0], /roto: sin cabecera/);
// Tablero
const b = board([claim('c2', { date: '2026-10-18', pr: 7 }), claim('c1', { date: '2026-10-17' })]);
assert.ok(b.indexOf('2026-10-17') < b.indexOf('2026-10-18') && b.includes('#7'));

assert.deepEqual(load('/ruta/que/no/existe'), [], 'sin carpeta de fichas = sin trabajos vivos, no un error');

// Las fichas reales del repositorio deben pasar su propia comprobación
const real = load(new URL('../docs/handoff/claims/', import.meta.url).pathname);
assert.deepEqual(check(real), [], 'fichas reales sin solapes ni errores');
console.log('PASS  relevo: formato, solapes, un trabajo en curso por agente, cadenas y fichas reales');
