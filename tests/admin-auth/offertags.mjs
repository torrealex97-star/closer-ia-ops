// Etiquetas de nicho y modelo de pago:
// node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/offertags.mjs
import assert from 'node:assert/strict';
import { offerTags } from '../../apps/web/lib/offerTags.ts';

const results = [];
const step = async (name, fn) => { try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]); } };

await step('modelo de pago: solo comisión, fijo + comisión, fijo y no indicado', () => {
  assert.equal(offerTags({ title: 'Closer', description: 'Trabajo 100% a comisión' }).pay, 'solo_comision');
  assert.equal(offerTags({ title: 'Closer', description: 'Sin sueldo fijo, solo comisiones' }).pay, 'solo_comision');
  assert.equal(offerTags({ title: 'Closer', description: 'Sueldo fijo de 1.400 € brutos al mes más comisiones' }).pay, 'fijo_mas_comision');
  assert.equal(offerTags({ title: 'Closer', salary: '24.000 €/año', description: 'Buen ambiente' }).pay, 'fijo');
  assert.equal(offerTags({ title: 'Closer', salary: '24.000 €/año', description: 'Con bonus por objetivos' }).pay, 'fijo_mas_comision');
  assert.equal(offerTags({ title: 'Closer', description: 'Buscamos closer con experiencia' }).pay, 'no_indicado');
  assert.equal(offerTags({ title: 'Closer', description: 'Comisiones atractivas' }).pay, 'no_indicado'); // comisión sin fijo declarado ≠ «solo comisión»
});
await step('pago: la promesa de ingresos no es un fijo; el nicho no se deja llevar por «formación» o «salud» genéricas', () => {
  assert.equal(offerTags({ title: 'Closer', description: 'Ganarás hasta 3.000 € al mes con comisiones' }).pay, 'no_indicado');
  assert.equal(offerTags({ title: 'Closer', description: 'Sueldo fijo 1.400 € al mes más comisiones' }).pay, 'fijo_mas_comision');
  assert.equal(offerTags({ title: 'Comercial', description: 'Ofrecemos formación continua y seguro de salud' }).niche, null);
});
await step('nicho: por palabras del anuncio, con el título pesando doble', () => {
  assert.equal(offerTags({ title: 'Closer high ticket', description: 'Programa de mentoría para agencias' }).niche, 'formacion');
  assert.equal(offerTags({ title: 'Closer SaaS B2B', description: 'Vendemos software de facturación' }).niche, 'saas_b2b');
  assert.equal(offerTags({ title: 'Asesora comercial', description: 'Clínica dental de ortodoncia' }).niche, 'salud_estetica');
  assert.equal(offerTags({ title: 'Comercial de reformas', description: 'Reformas integrales de viviendas' }).niche, 'inmobiliaria_reformas');
  assert.equal(offerTags({ title: 'Vendedora', description: 'Gimnasio y entrenador personal' }).niche, 'fitness_bienestar');
});
await step('sin señal o con empate: null, no «otros»', () => {
  assert.equal(offerTags({ title: 'Closer', description: 'Empresa con ganas de crecer' }).niche, null);
  assert.equal(offerTags({ title: 'Closer', description: 'Curso de yoga' }).niche, null); // formación vs fitness empatan
});
await step('con acentos o sin ellos, igual', () => {
  assert.deepEqual(offerTags({ title: 'Clínica estética', description: 'COMISIÓN 100%' }), offerTags({ title: 'Clinica estetica', description: 'comision 100%' }));
});

for (const [s, n, m] of results) console.log(s, ' ', n, m ?? '');
const bad = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - bad}/${results.length} pasos OK`);
process.exit(bad ? 1 : 0);
