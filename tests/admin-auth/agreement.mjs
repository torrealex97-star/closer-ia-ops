// Acuerdo IA/humano: node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/agreement.mjs
import assert from 'node:assert/strict';
import { computeAgreement, MIN_PAIRS } from '../../apps/web/lib/aiAgreement.ts';
const r = (would, status, by = null, applied) => ({ editorial_status: status, reviewed_by: by, ai_review: { would_decide: would, ...(applied ? { applied: true } : {}) } });
const empty = computeAgreement([]);
assert.equal(empty.pairs, 0); assert.equal(empty.agree_rate, null); assert.equal(empty.verdict, 'insufficient', 'sin pares no hay veredicto');
const a = computeAgreement([
  r('approve', 'approved', 'a@x.dev'), r('approve', 'published', 'a@x.dev'), r('approve', 'withdrawn', 'a@x.dev'), r('withdraw', 'withdrawn', 'a@x.dev'), r('withdraw', 'approved', 'a@x.dev'),
  r('approve', 'draft'), r('human', 'approved', 'a@x.dev'), r('approve', 'approved', 'ai-review', true), r('approve', 'approved', 'auto-vigencia'), { editorial_status: 'draft', reviewed_by: null, ai_review: null },
  // Las reglas y la cola automática también son la máquina: no valen como contraste humano.
  r('approve', 'approved', 'auto-reglas'), r('withdraw', 'needs_review', 'auto-excepcion'),
]);
assert.deepEqual([a.proposed, a.pairs, a.agree, a.false_approve, a.false_withdraw, a.pending, a.deferred], [9, 5, 3, 1, 1, 4, 1], 'auto-reglas/auto-excepcion quedan pendientes, no como pares humanos');
assert.equal(a.agree_rate, 0.6); assert.equal(a.ai_approvals_decided, 3); assert.equal(a.false_approve_rate, 0.333); assert.equal(a.verdict, 'insufficient');
const many = (good, bad) => computeAgreement([...Array(good).fill(0).map(() => r('approve', 'approved', 'a@x.dev')), ...Array(bad).fill(0).map(() => r('approve', 'withdrawn', 'a@x.dev'))]);
assert.equal(many(MIN_PAIRS, 0).verdict, 'ready'); assert.equal(many(28, 2).verdict, 'not_ready', '2/30 > 5 %'); assert.equal(many(29, 1).verdict, 'ready', '1/30 ≤ 5 %');
console.log('PASS  acuerdo IA/humano: pares, falsas aprobaciones/retiradas, aplicadas excluidas, veredicto solo con ≥ 30 pares');
