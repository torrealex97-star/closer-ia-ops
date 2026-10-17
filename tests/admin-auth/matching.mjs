// Matching alumna↔oferta: node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/matching.mjs
import assert from 'node:assert/strict';
import { scoreOpportunity, rankMatches, recommendForStudent, MAX_MATCHES } from '../../apps/web/lib/matching.ts';

const now = Date.parse('2026-10-17T12:00:00Z');
const day = n => new Date(now - n * 864e5).toISOString();
const opp = (id, o = {}) => ({ id, role: 'closer', role_label: 'Closer', original_title: `Closer ${id}`, company: 'Acme', compensation: '30.000 €/año', modality: 'Modalidad no indicada', location: 'Madrid, España', published_at: day(1), source_url: `https://x.test/${id}`, description: 'd'.repeat(2000), ...o });
const prof = (o = {}) => ({ city: 'Madrid', target_roles: ['closer'], languages: ['es'], ...o });

// Perfil: obligatorio si lo eligió; puntúa menos si no
assert.equal(scoreOpportunity(prof(), opp('a', { role: 'setter', role_label: 'Setter' }), now), null, 'otro perfil: fuera');
const full = scoreOpportunity(prof(), opp('a'), now);
assert.equal(full.score, 50 + 15 + 10 + 15, 'perfil + ciudad + retribución + reciente = 90');
assert.deepEqual(full.unknowns, []);
const noRoles = scoreOpportunity(prof({ target_roles: [] }), opp('a'), now);
assert.equal(noRoles.score, 20 + 15 + 10 + 15); assert.ok(noRoles.unknowns.some(u => /perfiles/.test(u)));
// Ubicación: remoto cuenta; ciudad distinta no suma; sin dato se declara y no se supone
assert.equal(scoreOpportunity(prof({ city: 'Sevilla' }), opp('a', { modality: 'Remoto', location: 'Madrid' }), now).score, 90);
assert.equal(scoreOpportunity(prof({ city: 'Sevilla' }), opp('a'), now).score, 75, 'otra ciudad: sin los 15');
const noCity = scoreOpportunity(prof({ city: null }), opp('a'), now); assert.equal(noCity.score, 75); assert.ok(noCity.unknowns.some(u => /ciudad/.test(u)));
const noLoc = scoreOpportunity(prof(), opp('a', { location: 'Ubicación no indicada' }), now); assert.ok(noLoc.unknowns.some(u => /ubicación/.test(u))); assert.equal(noLoc.score, 75);
assert.equal(scoreOpportunity(prof({ city: 'málaga' }), opp('a', { location: 'MALAGA, España' }), now).score, 90, 'sin tildes ni mayúsculas');
// Retribución y fecha: lo no declarado no puntúa y se lista
const bare = scoreOpportunity(prof(), opp('a', { compensation: 'Importe no publicado', published_at: null }), now);
assert.equal(bare.score, 65); assert.deepEqual(bare.unknowns.sort(), ['Fecha de publicación no indicada', 'No publica la retribución']);
assert.equal(scoreOpportunity(prof(), opp('a', { published_at: day(5) }), now).score, 50 + 15 + 10 + 8);
assert.equal(scoreOpportunity(prof(), opp('a', { published_at: day(9) }), now).score, 50 + 15 + 10);
assert.equal(scoreOpportunity(prof(), opp('a', { published_at: 'basura' }), now).unknowns.includes('Fecha de publicación no indicada'), true);
// Salida: descripción recortada, tope y orden estable
assert.ok(full.opportunity.description.length <= 400);
const many = Array.from({ length: 30 }, (_, i) => opp(`n${i}`, { published_at: day(i % 10) }));
const ranked = rankMatches(prof(), many, now);
assert.equal(ranked.length, MAX_MATCHES);
assert.ok(ranked.every((m, i) => i === 0 || ranked[i - 1].score >= m.score), 'ordenadas por encaje');
assert.deepEqual(rankMatches(prof(), many, now).map(m => m.opportunity.id), ranked.map(m => m.opportunity.id), 'determinista');
console.log('PASS  matching: puntos explicados, sin inventar (unknowns), tope y orden estable');

// recommendForStudent: puertas de entrada
const loaded = [];
const load = async q => { loaded.push(q); return [opp('r1')]; };
assert.deepEqual(await recommendForStudent('u', async () => null, load), { ready: false, hint: 'Completa y guarda tu perfil para ver ofertas para ti.', matches: [] });
assert.equal((await recommendForStudent('u', async () => ({ ...prof(), consent_at: null }), load)).ready, false, 'sin consentimiento no hay matching');
assert.equal((await recommendForStudent('u', async () => ({ ...prof({ languages: ['fr'] }), consent_at: 'x' }), load)).ready, false);
assert.equal(loaded.length, 0, 'sin perfil válido ni siquiera se consultan ofertas');
const ok = await recommendForStudent('u', async () => ({ ...prof({ languages: ['es', 'en'] }), consent_at: 'x' }), load);
assert.equal(ok.ready, true); assert.equal(ok.matches.length, 1); assert.equal(loaded[0].include_bilingual, true); assert.equal(loaded[0].role, null);
const broken = await recommendForStudent('u', async () => ({ ...prof(), consent_at: 'x' }), async () => { throw new Error('boom'); });
assert.deepEqual([broken.ready, broken.matches.length], [true, 0], 'si falla la fuente, lista vacía sin romper');
console.log('PASS  recomendación: exige perfil+consentimiento+idioma; bilingüe solo con inglés; tolera fallos');
