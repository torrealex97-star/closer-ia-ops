// Detector de ofertas peligrosas:
// node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/offerrisk.mjs
import assert from 'node:assert/strict';
import { assessOffer } from '../../apps/web/lib/offerRisk.ts';
import { judgeOffer } from '../../apps/web/lib/autoReview.ts';

const results = [];
const step = async (name, fn) => { try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]); } };
const codes = a => a.detected_flags.map(f => f.code);

await step('una oferta normal de closer no tiene señales', () => {
  const r = assessOffer({ title: 'Closer de ventas high ticket', description: 'Buscamos closer con experiencia. Sueldo fijo 1.400 € al mes más comisiones. Entrevista con el equipo.' });
  assert.deepEqual(codes(r), []); assert.equal(r.risk_level, 'SAFE'); assert.equal(r.risk_score, 0); assert.equal(r.visibility, true);
});
await step('pago previo → bloqueada, con su código', () => {
  for (const text of ['Debes pagar una licencia de 300 € para empezar', 'Requiere pago inicial de la formación', 'Incluye compra del kit de ventas', 'Formación de pago obligatoria']) {
    const r = assessOffer({ title: 'Closer', description: text });
    assert.ok(codes(r).includes('ADVANCE_PAYMENT_DETECTED'), text); assert.equal(r.risk_level, 'BLOCKED', text); assert.equal(r.visibility, false);
  }
});
await step('multinivel y pirámide → bloqueada; vender no es reclutar', () => {
  assert.ok(codes(assessOffer({ description: 'Negocio de network marketing, construye tu línea descendente' })).includes('MLM_OR_PYRAMID'));
  assert.ok(codes(assessOffer({ description: 'Reclutarás gente: comisiones por cada persona que se una a tu equipo' })).includes('MLM_OR_PYRAMID'));
  assert.deepEqual(codes(assessOffer({ description: 'Buscamos reclutar a un equipo comercial para nuestra tienda' })), []);
});
await step('ingresos irreales sin experiencia → bloqueada; cifra alta sola → solo aviso', () => {
  const a = assessOffer({ description: 'Gana 12.000 € al mes sin experiencia desde la primera semana' });
  assert.ok(codes(a).includes('UNREALISTIC_INCOME')); assert.equal(a.risk_level, 'BLOCKED');
  const b = assessOffer({ description: 'Top performers superan los 10.000 € al mes en comisiones' });
  assert.deepEqual(codes(b), ['INCOME_CLAIM']); assert.equal(b.risk_level, 'WARNING'); assert.equal(b.visibility, true);
  assert.deepEqual(codes(assessOffer({ description: 'Salario de 2.500 € al mes' })), []);
  assert.deepEqual(codes(assessOffer({ salary: '30.000 €/año', description: 'Hasta 45.000 € anuales' })), []); // el sueldo anual no es una promesa mensual
});
await step('solo comisión, publicidad a su cargo, sin entrevista y solo WhatsApp → aviso, no bloqueo', () => {
  assert.ok(codes(assessOffer({ description: 'Trabajo 100% a comisión' })).includes('COMMISSION_ONLY'));
  assert.ok(codes(assessOffer({ description: 'La closer asumirá la inversión en publicidad' })).includes('AD_SPEND_ON_CLOSER'));
  assert.ok(codes(assessOffer({ description: 'Contratación inmediata, sin entrevista' })).includes('NO_INTERVIEW'));
  assert.ok(codes(assessOffer({ description: 'Escribe por WhatsApp al 600 000 000' })).includes('MESSAGING_ONLY_CONTACT'));
  assert.equal(assessOffer({ description: 'Escribe por WhatsApp o a jobs@empresa.com' }).detected_flags.length, 0);
  assert.equal(assessOffer({ description: 'Solo comisiones' }).risk_level, 'WARNING');
});
await step('varios avisos suman y pueden llegar a bloquear (≥ 85); la puntuación no pasa de 100', () => {
  const r = assessOffer({ description: 'Solo comisión, sin entrevista, inversión en publicidad a tu cargo, libertad financiera' });
  assert.ok(r.risk_score >= 85 && r.risk_score <= 100); assert.equal(r.risk_level, 'BLOCKED');
});
await step('con acentos o sin ellos, igual; es determinista', () => {
  const a = assessOffer({ description: 'Pago inicial: inversión previa' }); const b = assessOffer({ description: 'PAGO INICIAL: INVERSION PREVIA' });
  assert.deepEqual(a, b);
});
await step('la cualificación automática no aprueba ofertas con señales', () => {
  const base = { title: 'Closer high ticket', description: 'Buscamos closer con experiencia en ventas para nuestra empresa de formación en España. Requisitos y funciones.', location: 'Madrid, España', salary: null, role: 'closer', score: 80, spain: true, verified_result: null };
  assert.equal(judgeOffer(base).decision, 'approve');
  assert.equal(judgeOffer({ ...base, description: base.description + ' Debes pagar una licencia.' }).why, 'oferta_peligrosa');
  assert.equal(judgeOffer({ ...base, description: base.description + ' Trabajo 100% a comisión.' }).why, 'oferta_con_avisos');
});

for (const [s, n, m] of results) console.log(s, ' ', n, m ?? '');
const bad = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - bad}/${results.length} pasos OK`);
process.exit(bad ? 1 : 0);
