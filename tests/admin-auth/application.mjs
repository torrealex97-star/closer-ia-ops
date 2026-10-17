// Formulario base y candidaturas asistidas (puro): node --experimental-strip-types --import ./tests/admin-auth/ts-resolve.mjs tests/admin-auth/application.mjs
import assert from 'node:assert/strict';
import { sanitizeAppProfile, completeness } from '../../apps/web/lib/applicationProfile.ts';
import { buildCoverMessage, buildCopyData, canMove } from '../../apps/web/lib/applications.ts';

// Saneado: valores fuera de rango/enumeración se descartan; nada de claves ajenas
const s = sanitizeAppProfile({ contact_email: ' ANA@Ejemplo.COM ', phone: 'tel: +34 600 11 22 33 <b>', linkedin_url: 'http://insegura.test/x', cv_url: 'https://drive.google.com/file/d/1/view', country_residence: 'España',
  work_authorization: 'eu_citizen', language_levels: { es: 'native', en: 'advanced', xx: 'native', fr: 'dios' }, years_sales: '3', years_high_ticket: 99, sales_experience: '<i>Cierre</i> con ana@x.com',
  tools: ['GoHighLevel', 'GoHighLevel', '', 'HubSpot'], available_from: '2026-11-03', hours_per_week: 0, contract_preferences: ['employee', 'esclavitud', 'freelance'], pitch: 'Closer', answers: { why_this_role: 'Porque sí', hack: 'x' },
  user_id: 'robado', org_id: 'otra', autofill_consent: true });
assert.equal(s.contact_email, 'ana@ejemplo.com'); assert.equal(s.phone, '+34 600 11 22 33'); assert.equal(s.linkedin_url, null, 'http se descarta'); assert.equal(s.cv_url, 'https://drive.google.com/file/d/1/view');
assert.equal(s.work_authorization, 'eu_citizen'); assert.deepEqual(s.language_levels, { es: 'native', en: 'advanced' }); assert.equal(s.years_sales, 3); assert.equal(s.years_high_ticket, null, '99 > 60');
assert.ok(!/[<@]/.test(s.sales_experience)); assert.deepEqual(s.tools, ['GoHighLevel', 'HubSpot']); assert.equal(s.available_from, '2026-11-03'); assert.equal(s.hours_per_week, null);
assert.deepEqual(s.contract_preferences, ['employee', 'freelance']); assert.deepEqual(s.answers, { why_this_role: 'Porque sí' }); assert.equal(s.autofill_consent, true);
assert.ok(!('user_id' in s) && !('org_id' in s), 'nunca se aceptan user_id/org_id');
assert.equal(sanitizeAppProfile({ available_from: '2026-02-31' }).available_from, null, 'fecha imposible'); assert.equal(sanitizeAppProfile({ contact_email: 'no-es-correo' }).contact_email, null);
assert.equal(sanitizeAppProfile({ cv_url: 'https://10.0.0.1/x' }).cv_url, null, 'IP literal'); assert.equal(sanitizeAppProfile({ autofill_consent: 'true' }).autofill_consent, false, 'solo true booleano');
assert.equal(sanitizeAppProfile(null), null);
console.log('PASS  formulario base: saneado, enumeraciones, enlaces https, fechas reales, sin claves ajenas');

// Completitud: orientativa y honesta
assert.deepEqual(completeness(null, null).pct, 0); assert.equal(completeness(null, null).missing.length, 10);
const full = { contact_email: 'a@b.co', phone: '600000000', country_residence: 'ES', work_authorization: 'eu_citizen', years_sales: 0, sales_experience: 'x', pitch: 'p', cv_url: 'https://x.co', available_from: '2026-11-01' };
assert.deepEqual(completeness(full, 'https://v.co'), { pct: 100, missing: [] }, 'años = 0 cuenta como dato (no es hueco)');
assert.deepEqual(completeness(full, null).missing, ['Enlace a tu vídeo (en tu perfil)']);
console.log('PASS  completitud: 0 años es un dato, lo que falta se nombra');

// Borrador determinista: solo datos que ella escribió; lo que falta se omite
const opp = { title: 'Closer High Ticket', company: 'Acme' };
const m1 = buildCoverMessage({ full_name: 'Ana Pérez' }, { pitch: 'Cierro llamadas de 5.000 €.', years_sales: 3, years_high_ticket: 2, available_from: '2026-11-03', motivation: 'Quiero crecer.' }, opp);
assert.match(m1, /^Hola, equipo de Acme:/); assert.match(m1, /Me llamo Ana Pérez y me interesa el puesto de Closer High Ticket\./); assert.match(m1, /Cuento con 3 años de experiencia en ventas \(2 en high ticket\) y disponibilidad desde el 03\/11\/2026\./);
assert.match(m1, /Cierro llamadas de 5\.000 €\./); assert.match(m1, /Quiero crecer\./); assert.match(m1, /Un saludo,\nAna Pérez$/);
const m2 = buildCoverMessage(null, null, { title: 'Closer', company: 'Empresa no indicada' });
assert.equal(m2, 'Hola:\n\nMe interesa el puesto de Closer.\n\nQuedo a vuestra disposición para una llamada.\n\nUn saludo,'); assert.ok(!/undefined|null/.test(m2), 'nada inventado ni "undefined"');
assert.match(buildCoverMessage({ full_name: 'A' }, { years_sales: 1 }, opp), /1 año de experiencia/);
assert.match(buildCoverMessage({ full_name: 'A' }, { years_sales: 0 }, opp), /0 años de experiencia/, '0 años se dice, no se oculta');
assert.ok(buildCoverMessage({ full_name: 'A' }, { pitch: 'x'.repeat(5000) }, opp).length <= 3000);
console.log('PASS  borrador: determinista, solo datos suyos, sin "undefined" ni invenciones');

// Datos para copiar: solo lo rellenado, con etiquetas legibles
const copy = buildCopyData({ full_name: 'Ana', city: 'Sevilla', video_url: 'https://drive.google.com/v', languages: ['es'] }, { contact_email: 'a@b.co', work_authorization: 'eu_citizen', language_levels: { es: 'native', en: 'basic' }, years_sales: 0, contract_preferences: ['employee', 'commission_only'], answers: { why_this_role: 'Porque sí' }, tools: [] });
const byKey = Object.fromEntries(copy.map(c => [c.key, c.value]));
assert.equal(byKey.full_name, 'Ana'); assert.equal(byKey.work_authorization, 'Ciudadana de la UE'); assert.equal(byKey.languages, 'ES: Nativo, EN: Básico'); assert.equal(byKey.years_sales, '0');
assert.equal(byKey.contract_preferences, 'Contrato laboral, Solo comisiones'); assert.equal(byKey.answer_why_this_role, 'Porque sí'); assert.equal(byKey.video_url, 'https://drive.google.com/v');
assert.ok(!('phone' in byKey) && !('tools' in byKey) && !('pitch' in byKey), 'lo vacío no aparece');
assert.deepEqual(buildCopyData(null, null), []);
console.log('PASS  datos para copiar: solo lo rellenado, orden estable, etiquetas legibles');

// Transiciones de estado
assert.ok(canMove('draft', 'opened') && canMove('draft', 'applied') && canMove('opened', 'applied') && canMove('opened', 'draft') && canMove('discarded', 'draft') && canMove('applied', 'discarded') && canMove('draft', 'draft'));
assert.ok(!canMove('applied', 'draft') && !canMove('applied', 'opened') && !canMove('discarded', 'applied') && !canMove('discarded', 'opened'));
console.log('PASS  estados: transiciones coherentes (enviada no vuelve a borrador)');
