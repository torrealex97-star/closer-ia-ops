// Embudo por fuente y mercado: node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/funnel.mjs
import assert from 'node:assert/strict';
import { computeFunnel } from '../../apps/web/lib/funnel.ts';

const now = new Date('2026-11-08T12:00:00Z');
const ago = h => new Date(now.getTime() - h * 3600e3).toISOString();
const offer = (o) => ({ source: 'freehire-latam', market: 'LATAM', market_basis: 'ubicacion_latam', first_seen_at: ago(2), editorial_status: 'draft', reviewed_by: null, reviewed_at: null, expires_at: ago(-240), auto_review: null, ...o });

const offers = [
  offer({}), // nueva hace 2 h (LATAM por ubicación)
  offer({ first_seen_at: ago(100), editorial_status: 'approved', reviewed_by: 'auto-reglas', reviewed_at: ago(90) }), // nueva 7 d, aprobada 7 d (no 24 h)
  offer({ market_basis: 'sin_senal', first_seen_at: ago(3), editorial_status: 'approved', reviewed_by: 'auto-reglas', reviewed_at: ago(1) }), // LATAM por defecto
  offer({ source: 'google-jobs', market: 'ES', market_basis: 'ubicacion_espana', first_seen_at: ago(5), editorial_status: 'needs_review', reviewed_by: 'auto-excepcion', reviewed_at: ago(4), auto_review: { why: 'score_bajo' } }),
  offer({ source: 'google-jobs', market: 'ES', market_basis: 'ubicacion_espana', first_seen_at: ago(300), editorial_status: 'withdrawn', reviewed_by: 'auto-retira', reviewed_at: ago(2), auto_review: { why: 'sin_perfil' } }), // vista hace 12 d: no es nueva en 7 d, sí retirada en 24 h
  offer({ source: 'google-jobs', market: null, market_basis: null, first_seen_at: ago(6), editorial_status: 'withdrawn', reviewed_by: 'persona@x.dev', reviewed_at: ago(5) }), // retirada por una PERSONA: no cuenta como regla
];
const live = [{ source: 'freehire-latam', market: 'LATAM', market_basis: 'ubicacion_latam' }, { source: 'freehire-latam', market: 'LATAM', market_basis: 'sin_senal' }, { source: 'google-jobs', market: 'ES', market_basis: 'ubicacion_espana' }];
const runs = [
  { source: 'freehire-latam', received: 50, accepted: 12, created_at: ago(3) },
  { source: 'freehire-latam', received: 40, accepted: 8, created_at: ago(60) },
  { source: 'google-jobs', received: 30, accepted: 10, created_at: ago(400) }, // fuera de los 7 días
];
const f = computeFunnel(offers, live, runs, now);
const get = (source, market) => f.rows.find(r => r.source === source && r.market === market);

assert.equal(get('freehire-latam', 'LATAM').new24, 1); assert.equal(get('freehire-latam', 'LATAM').new7, 2);
assert.equal(get('freehire-latam', 'LATAM').approved7, 1); assert.equal(get('freehire-latam', 'LATAM').approved24, 0, 'aprobada hace 90 h: 7 d sí, 24 h no');
assert.equal(get('freehire-latam', 'LATAM_DEFECTO').approved24, 1, 'LATAM por defecto va aparte del LATAM con ubicación');
assert.equal(get('freehire-latam', 'LATAM').visible, 1); assert.equal(get('freehire-latam', 'LATAM_DEFECTO').visible, 1);
assert.equal(get('google-jobs', 'ES').human7, 1); assert.equal(get('google-jobs', 'ES').withdrawn24, 1); assert.equal(get('google-jobs', 'ES').new7, 1, 'la vista hace 12 días no es nueva');
assert.equal(get('google-jobs', 'SIN_MERCADO').withdrawn7, 0, 'la retirada de una persona no es una regla');
assert.deepEqual(f.totals.reasons, { score_bajo: 1, sin_perfil: 1 }, 'motivos solo de reglas');
assert.equal(f.totals.visible, 3);
assert.deepEqual(f.ingest.find(i => i.source === 'freehire-latam'), { source: 'freehire-latam', received24: 50, accepted24: 12, received7: 90, accepted7: 20 });
assert.equal(f.ingest.find(i => i.source === 'google-jobs'), undefined, 'fuera de la ventana no cuenta');
// Un hueco no es un cero: sin lectura de ingesta es null; vacío es lista vacía.
assert.equal(computeFunnel(offers, live, null, now).ingest, null);
assert.deepEqual(computeFunnel([], [], [], now).ingest, []);
assert.equal(computeFunnel([], [], [], now, true).truncated, true);
// Fechas futuras o nulas no cuentan.
const odd = computeFunnel([offer({ first_seen_at: ago(-5), reviewed_at: null }), offer({ first_seen_at: null })], [], [], now);
assert.equal(odd.totals.new7, 0);
console.log('PASS  embudo: ventanas 24 h/7 d, LATAM por defecto aparte, motivos solo de reglas, hueco ≠ 0');
