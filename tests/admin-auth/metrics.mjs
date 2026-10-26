// Métricas de oferta: node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/metrics.mjs
import assert from 'node:assert/strict';
import { computeMetrics } from '../../apps/web/lib/metrics.ts';
const now = new Date('2026-10-16T12:00:00Z');
const o = (source, score, spain, daysAgo, extra = {}) => ({ source, score, spain, editorial_status: 'draft', first_seen_at: new Date(now.getTime() - daysAgo * 864e5).toISOString(), reviewed_by: null, reviewed_at: null, ...extra });
const m = computeMetrics([
  o('apify-jobspy', 70, true, 0), o('apify-jobspy', 59, true, 0), o('apify-jobspy', 90, false, 1), o('apify-jobspy', 80, true, 2, { editorial_status: 'approved', reviewed_by: 'a@x.dev', reviewed_at: now.toISOString() }),
  o('infojobs', 60, true, 3, { reviewed_by: 'ai-review', reviewed_at: now.toISOString() }), o('infojobs', 99, true, 30), o('infojobs', null, null, 1),
], [{ cost_usd: '0.30', started_at: now.toISOString() }, { cost_usd: 0.2, started_at: now.toISOString() }, { cost_usd: null, started_at: now.toISOString() }], now);
assert.equal(m.days.length, 14); assert.equal(m.days.at(-1), '2026-10-16');
assert.equal(m.goodPerDay['2026-10-16'], 1, 'umbral 60 y España: 59 y fuera no cuentan');
assert.deepEqual(m.perSource.map(s => [s.source, s.total, s.good, s.approved]), [['apify-jobspy', 4, 2, 1], ['infojobs', 2, 1, 0]], 'lo de hace 30 días queda fuera');
assert.deepEqual(m.apify, { cost_usd: 0.5, runs: 3, good_offers: 2, cost_per_good: 0.25 });
assert.deepEqual(m.review, { human_decisions: 1, ai_decisions: 1, minutes: null });
assert.equal(computeMetrics([], [], now).apify.cost_per_good, null, 'sin ofertas buenas no se inventa un coste');
// Un hueco no es un cero: lectura fallida de ejecuciones / decisiones = null; decisiones fuera de la ventana de «vistas» sí cuentan
const gap = computeMetrics([o('infojobs', 70, true, 0)], null, now, 14, null);
assert.deepEqual(gap.apify, { cost_usd: null, runs: null, good_offers: 0, cost_per_good: null }); assert.deepEqual(gap.review, { human_decisions: null, ai_decisions: null, minutes: null });
const old = computeMetrics([o('infojobs', 70, true, 0)], [], now, 14, [
  { reviewed_by: 'a@x.dev', reviewed_at: now.toISOString() }, { reviewed_by: 'ai-review', reviewed_at: now.toISOString() }, { reviewed_by: 'a@x.dev', reviewed_at: '2026-01-01T00:00:00Z' },
  // La máquina también decide: reglas y cola de excepciones no son decisiones humanas.
  { reviewed_by: 'auto-reglas', reviewed_at: now.toISOString() }, { reviewed_by: 'auto-excepcion', reviewed_at: now.toISOString() },
]);
assert.deepEqual(old.review, { human_decisions: 1, ai_decisions: 1, minutes: null }, 'auto-reglas/auto-excepcion no cuentan como humanas; las de ofertas vistas antes de la ventana sí, las fuera de la ventana no');
assert.deepEqual(old.apify, { cost_usd: 0, runs: 0, good_offers: 0, cost_per_good: null }, 'sin ejecuciones es 0 real, no hueco');
console.log('PASS  métricas: ofertas buenas por día/fuente, coste por oferta buena, decisiones; minutos = no medido');
