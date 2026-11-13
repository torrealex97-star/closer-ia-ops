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
const { isoCountryName, hintInText, MARKET_HINTS, spanishBodyGate, activationBudget, checkTarget, explicitSpain, marketHinted } = __test;
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

// Anuncio EN INGLÉS que EXIGE español (decisión del dueño, 2026-11-12): entra, y se marca para que la
// tarjeta lo diga. No entra por mencionar «Spanish» suelto, ni el portugués, ni se reetiqueta un anuncio
// que ya está en español.
const en = 'We are hiring a high-ticket closer for our sales team. You will run demos and close deals with inbound leads. ';
for (const [text, why] of [
  ['Spanish speaker required.', 'la fórmula literal'],
  ['Spanish speaking candidates only.', 'spanish speaking'],
  ['Bilingual Spanish is a must.', 'bilingüe + spanish'],
  ['Must be fluent in Spanish.', 'fluent in spanish'],
  ['Se requiere español.', 'exigencia en español'],
]) {
  const gate = spanishBodyGate(en + text);
  assert.equal(gate.ok, true, `entra: ${why}`);
  assert.equal(gate.enRequiresSpanish, true, `se marca: ${why}`);
  assert.equal(gate.langES, false, `es inglés, no español: ${why}`);
}
assert.equal(spanishBodyGate(en + 'Spanish is a plus.').ok, false, '«plus» no es una exigencia');
assert.equal(spanishBodyGate(en + 'Our Spanish office is in Madrid.').ok, false, 'nombrar el mercado no es exigir el idioma');
assert.equal(spanishBodyGate('Buscamos closer para nuestro equipo de ventas, con experiencia y clientes. ' + en + 'Spanish speaker required.').enRequiresSpanish, false, 'un anuncio en español no se reetiqueta');
assert.equal(spanishBodyGate('Vagas de vendas para nosso time. Procuramos closer com comissoes. ' + en + 'Spanish speaker required.').ok, false, 'portugués nunca entra, ni pidiendo español');

assert.equal(activationBudget({}), 25, 'plan gratuito: 25');
assert.equal(activationBudget({ SUBREQUEST_LIMIT: '1000' }), 150, 'plan de pago: tope 150');
assert.equal(activationBudget({ SUBREQUEST_LIMIT: '200' }), 41);

// Ambiguos: «Guadalajara» a secas o con España NO es LatAm; con México o Jalisco, sí.
const lat = loc => marketHinted('LATAM', { title: 'Closer', location: loc }, loc.toLowerCase());
assert.equal(lat('guadalajara, espana'), false); assert.equal(lat('guadalajara'), false); assert.equal(lat('medellin, badajoz'), false);
assert.equal(lat('guadalajara, jalisco'), true); assert.equal(lat('guadalajara, mexico'), true); assert.equal(lat('medellin, colombia'), true);

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
