// Interruptor y consentimiento de voz (ADR-015):
// node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/voice.mjs
import assert from 'node:assert/strict';
import { VOICE_CONSENT_VERSION, consentIsValid, voiceStatus, voiceSwitchOn } from '../../apps/web/lib/voice.ts';

const results = [];
const step = async (name, fn) => { try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]); } };
const ID = '00000000-0000-4000-8000-000000000001';
const valid = { version: VOICE_CONSENT_VERSION, accepted_at: '2026-10-26T10:00:00Z', revoked_at: null };

await step('apagada por defecto: sin variable, vacía, «off» o cualquier otra cosa', () => {
  for (const v of [undefined, '', 'off', 'true', '1', 'yes']) assert.equal(voiceSwitchOn({ VOICE_ROLEPLAY: v }), false, String(v));
  assert.equal(voiceSwitchOn({}), false); assert.equal(voiceSwitchOn({ VOICE_ROLEPLAY: ' ON ' }), true);
});
await step('sin interruptor no se lee ni la base, aunque haya consentimiento', async () => {
  let reads = 0; const read = async () => { reads += 1; return valid; };
  assert.deepEqual(await voiceStatus(ID, {}, read), { enabled: false, reason: 'switch_off', consent: null }); assert.equal(reads, 0);
});
await step('con interruptor pero sin consentimiento, revocado o de otra versión: no', async () => {
  for (const row of [undefined, { ...valid, revoked_at: '2026-10-27T00:00:00Z' }, { ...valid, version: 'v0-viejo' }]) {
    const s = await voiceStatus(ID, { VOICE_ROLEPLAY: 'on' }, async () => row); assert.equal(s.enabled, false); assert.equal(s.reason, 'no_consent');
  }
  assert.equal(consentIsValid(valid), true); assert.equal(consentIsValid(undefined), false); assert.equal(consentIsValid(null), false);
});
await step('una lectura fallida se declara: no es «sin consentimiento»', async () => {
  assert.deepEqual(await voiceStatus(ID, { VOICE_ROLEPLAY: 'on' }, async () => null), { enabled: false, reason: 'consent_unreadable', consent: null });
});
await step('interruptor + consentimiento vigente = lista', async () => {
  const s = await voiceStatus(ID, { VOICE_ROLEPLAY: 'on' }, async () => valid);
  assert.deepEqual(s, { enabled: true, reason: 'ready', consent: { version: VOICE_CONSENT_VERSION, accepted_at: valid.accepted_at } });
});

for (const [s, n, m] of results) console.log(s, ' ', n, m ?? '');
const bad = results.filter(r => r[0] === 'FAIL').length;
console.log(`\n${results.length - bad}/${results.length} pasos OK`);
process.exit(bad ? 1 : 0);
