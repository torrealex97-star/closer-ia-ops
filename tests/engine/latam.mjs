// Cobertura LATAM del motor: mercado por palabra completa, ISO de FreeHire, «inglés requerido» por
// proximidad, redirección seguida una vez y lote de activación según el plan de Workers.
// Uso: node --experimental-strip-types tests/engine/latam.mjs   (sin red ni Cloudflare)
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workerPath = fileURLToPath(new URL('../../sites/engine/worker.js', import.meta.url));
const stage = join(mkdtempSync(join(tmpdir(), 'wdc-engine-latam-')), 'worker.mjs');
copyFileSync(workerPath, stage);
const { __test } = await import(pathToFileURL(stage).href);
const { isoCountryName, hintInText, MARKET_HINTS, spanishBodyGate, activationBudget, checkTarget, explicitSpain } = __test;
const latam = hay => MARKET_HINTS.LATAM.some(k => hintInText(hay, k));

assert.equal(isoCountryName('MX'), 'México');
assert.equal(isoCountryName(' co '), 'Colombia');
assert.equal(isoCountryName('ZZ'), 'ZZ', 'código desconocido: tal cual, sin inventar');

for (const ok of ['remoto latinoamerica', 'ciudad de mexico', 'remote latam', 'bogota colombia', 'cono sur', 'paraguay', 'republica dominicana'])
  assert.ok(latam(ok), `debe ser LATAM: ${ok}`);
for (const no of ['perugia italia', 'chilean wine', 'madrid espana', 'panamericano de ventas'])
  assert.ok(!latam(no), `no es LATAM: ${no}`);

const es = 'buscamos closer para nuestro equipo de ventas con experiencia en llamadas, oferta con comisiones y clientes ';
assert.equal(spanishBodyGate(es + 'se valora ingles').ok, true, 'inglés valorado no es inglés requerido');
assert.equal(spanishBodyGate(es + 'atencion a clientes en ingles').ok, true, '«atención a clientes» + inglés lejos de una exigencia: pasa');
assert.equal(spanishBodyGate(es + 'requiere ingles avanzado').ok, false);
assert.equal(spanishBodyGate(es + 'english required').ok, false);
assert.equal(spanishBodyGate(es + 'perfil bilingue english').ok, false);

assert.equal(activationBudget({}), 25, 'plan gratuito: 25');
assert.equal(activationBudget({ SUBREQUEST_LIMIT: '1000' }), 150, 'plan de pago: tope 150');
assert.equal(activationBudget({ SUBREQUEST_LIMIT: '200' }), 41);

// LATAM por defecto: sin país ni España explícita entra; con España explícita, no.
assert.equal(explicitSpain({ title: 'Closer', location: null }), false);
assert.equal(explicitSpain({ title: 'Closer', location: 'Remoto' }), false, '«remoto» no es un lugar');
assert.equal(explicitSpain({ title: 'Closer', location: 'Madrid, España' }), true);
assert.equal(explicitSpain({ title: 'Closer', location: 'Miami, Florida' }), true, 'señal clara de otro mercado: no es «sin país»');
for (const ok of ['la habana cuba', 'cuba', 'tegucigalpa']) assert.ok(latam(ok), ok);

// Redirección: se sigue una vez y manda el cuerpo de la página final.
const realFetch = globalThis.fetch;
try {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url) === 'https://a.test/job') return new Response(null, { status: 301, headers: { location: 'https://ats.test/p/1' } });
    return new Response('<h1>Closer de ventas</h1> Acme', { status: 200 });
  };
  const [result, , meta] = await checkTarget('https://a.test/job', 'Closer de ventas', 'Acme');
  assert.equal(result, 'open'); assert.equal(calls.length, 2); assert.equal(meta.http_status, 200);
  globalThis.fetch = async (url) => new Response(null, { status: 302, headers: { location: 'http://insegura.test/x' } });
  const [r2, code] = await checkTarget('https://a.test/job', 'Closer de ventas', 'Acme');
  assert.equal(r2, 'unknown'); assert.equal(code, 'redirect_without_verification', 'redirección a http: sin evidencia');
} finally { globalThis.fetch = realFetch; }

console.log('PASS  motor LATAM: mercado por palabra, ISO, inglés por proximidad, redirección y lote por plan');
