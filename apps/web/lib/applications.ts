import { ORG } from './external';
import { externalForStudent } from './externalSurface';
import { serviceRest } from './supabaseAuth';
import { ANSWER_KEYS, CONTRACTS, LEVELS, WORK_AUTH, getAppProfile, type AppProfile } from './applicationProfile';
import { getProfile, type Profile } from './students';

// Candidatura ASISTIDA (3.2): la app prepara un borrador y los datos para copiar; la alumna los revisa, los pega en la web
// de la empresa y envía ELLA. La app solo anota en qué punto está (borrador → abierta → enviada por ella → descartada).
// No hay ninguna ruta que envíe correos, rellene formularios ni contacte con la empresa.
export const STATUSES = ['draft', 'opened', 'applied', 'discarded'] as const;
export type AppStatus = (typeof STATUSES)[number];
export type Application = { id: string; offer_ref: string; offer_title: string; offer_company: string | null; offer_url: string; status: AppStatus; cover_message: string | null; notes: string | null; created_at: string; updated_at: string; applied_at: string | null };
const COLS = 'id,offer_ref,offer_title,offer_company,offer_url,status,cover_message,notes,created_at,updated_at,applied_at';

// Transiciones permitidas (la alumna decide; el servidor solo evita saltos incoherentes).
const NEXT: Record<AppStatus, AppStatus[]> = { draft: ['opened', 'applied', 'discarded'], opened: ['draft', 'applied', 'discarded'], applied: ['discarded'], discarded: ['draft'] };
export const canMove = (from: AppStatus, to: AppStatus) => from === to || NEXT[from].includes(to);

// Borrador DETERMINISTA (sin IA): solo usa datos que ella ha escrito; lo que falta se omite, nunca se inventa.
export function buildCoverMessage(student: Pick<Profile, 'full_name'> | null, app: Partial<AppProfile> | null, opp: { title: string; company: string | null }): string {
  const name = student?.full_name?.trim(), company = opp.company && !/no indicada/i.test(opp.company) ? opp.company : null;
  const lines: string[] = [company ? `Hola, equipo de ${company}:` : 'Hola:'];
  lines.push('', `${name ? `Me llamo ${name} y me` : 'Me'} interesa el puesto de ${opp.title}.`);
  if (app?.pitch) lines.push('', app.pitch);
  const exp: string[] = [];
  if (app?.years_sales != null) exp.push(`${app.years_sales} ${app.years_sales === 1 ? 'año' : 'años'} de experiencia en ventas${app.years_high_ticket ? ` (${app.years_high_ticket} en high ticket)` : ''}`);
  if (app?.available_from) exp.push(`disponibilidad desde el ${app.available_from.split('-').reverse().join('/')}`);
  if (exp.length) lines.push('', `Cuento con ${exp.join(' y ')}.`);
  if (app?.motivation) lines.push('', app.motivation);
  lines.push('', 'Quedo a vuestra disposición para una llamada.', '', name ? `Un saludo,\n${name}` : 'Un saludo,');
  return lines.join('\n').slice(0, 3000);
}

// Datos listos para copiar en cualquier formulario, en el orden en que suelen pedirse. Solo lo que ella ha rellenado.
export type CopyField = { key: string; label: string; value: string };
export function buildCopyData(student: Pick<Profile, 'full_name' | 'city' | 'video_url' | 'languages'> | null, app: Partial<AppProfile> | null): CopyField[] {
  const out: CopyField[] = [];
  const add = (key: string, label: string, value: string | number | null | undefined) => { if (value !== null && value !== undefined && String(value).trim() !== '') out.push({ key, label, value: String(value) }); };
  add('full_name', 'Nombre y apellidos', student?.full_name); add('contact_email', 'Email', app?.contact_email); add('phone', 'Teléfono', app?.phone);
  add('city', 'Ciudad', student?.city); add('country_residence', 'País de residencia', app?.country_residence);
  add('work_authorization', 'Situación laboral / permiso', app?.work_authorization ? WORK_AUTH[app.work_authorization] : null);
  add('linkedin_url', 'LinkedIn', app?.linkedin_url); add('cv_url', 'CV (enlace)', app?.cv_url); add('video_url', 'Vídeo de presentación (enlace)', student?.video_url);
  const langs = Object.entries(app?.language_levels ?? {}).map(([c, l]) => `${c.toUpperCase()}: ${LEVELS[l]}`).join(', ');
  add('languages', 'Idiomas y nivel', langs);
  add('years_sales', 'Años de experiencia en ventas', app?.years_sales); add('years_high_ticket', 'Años en high ticket', app?.years_high_ticket);
  add('sales_experience', 'Experiencia en ventas', app?.sales_experience); add('tools', 'Herramientas / CRM', app?.tools?.join(', '));
  add('available_from', 'Disponible desde', app?.available_from ? app.available_from.split('-').reverse().join('/') : null); add('hours_per_week', 'Horas por semana', app?.hours_per_week);
  add('contract_preferences', 'Tipo de contrato', app?.contract_preferences?.map(c => CONTRACTS[c]).join(', '));
  add('salary_expectation', 'Expectativa salarial', app?.salary_expectation); add('notice_period', 'Preaviso', app?.notice_period);
  add('pitch', 'Presentación breve', app?.pitch); add('motivation', 'Motivación', app?.motivation);
  for (const [k, label] of Object.entries(ANSWER_KEYS)) add(`answer_${k}`, label, app?.answers?.[k as keyof typeof ANSWER_KEYS]);
  return out;
}

const uuid = /^[0-9a-f-]{36}$/;
const message = (v: unknown, max: number) => typeof v === 'string' ? v.replace(/<[^>]+>/g, ' ').replace(/\r/g, '').trim().slice(0, max) : null; // su propio texto: se conservan sus datos de contacto

export async function listApplications(userId: string): Promise<Application[] | null> {
  if (!uuid.test(userId)) return null;
  const r = await serviceRest(`student_applications?org_id=eq.${ORG}&user_id=eq.${userId}&select=${COLS}&order=updated_at.desc&limit=200`);
  const rows = r.ok ? await r.json().catch(() => null) : null;
  return Array.isArray(rows) ? rows : null;
}

export type PrepareResult = { ok: true; application: Application; created: boolean } | { ok: false; status: number; detail: string };
// Solo se prepara candidatura de una oferta APROBADA y visible hoy para las alumnas; los datos de la oferta salen del catálogo, no del cliente.
export async function prepareApplication(userId: string, offerRef: unknown, deps: { load?: typeof externalForStudent } = {}): Promise<PrepareResult> {
  if (typeof offerRef !== 'string' || !/^ext-[0-9a-f-]{36}$/.test(offerRef) || !uuid.test(userId)) return { ok: false, status: 422, detail: 'Oferta no válida.' };
  const [student, app] = await Promise.all([getProfile(userId), getAppProfile(userId)]);
  if (!student?.consent_at) return { ok: false, status: 422, detail: 'Guarda antes tu perfil y acepta el tratamiento de tus datos.' };
  const existing = (await listApplications(userId))?.find(a => a.offer_ref === offerRef);
  if (existing) return { ok: true, application: existing, created: false };
  const visible = await (deps.load ?? externalForStudent)({ role: null, market: 'any', days: 30, include_bilingual: student.languages.includes('en'), starred_only: false }).catch(() => []);
  const opp = (visible as Array<{ id: string; original_title: string; company: string; source_url: string }>).find(o => o.id === offerRef);
  if (!opp) return { ok: false, status: 404, detail: 'Esa oferta ya no está disponible.' };
  const cover = buildCoverMessage(student, app, { title: opp.original_title, company: opp.company });
  const r = await serviceRest('student_applications?on_conflict=user_id,offer_ref', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({ user_id: userId, org_id: ORG, offer_ref: offerRef, offer_title: opp.original_title.slice(0, 200), offer_company: /no indicada/i.test(opp.company) ? null : opp.company.slice(0, 200), offer_url: opp.source_url, cover_message: cover }) });
  const rows = r.ok ? await r.json().catch(() => null) : null;
  if (!Array.isArray(rows) || !rows[0]) {
    const again = (await listApplications(userId))?.find(a => a.offer_ref === offerRef); // carrera: otra pestaña la creó antes
    return again ? { ok: true, application: again, created: false } : { ok: false, status: 503, detail: 'No se pudo preparar la candidatura.' };
  }
  return { ok: true, application: rows[0], created: true };
}

export type UpdateResult = { ok: true; application: Application } | { ok: false; status: number; detail: string };
export async function updateApplication(userId: string, id: unknown, patch: { status?: unknown; cover_message?: unknown; notes?: unknown }): Promise<UpdateResult> {
  if (typeof id !== 'string' || !uuid.test(id) || !uuid.test(userId)) return { ok: false, status: 422, detail: 'Candidatura no válida.' };
  const current = (await listApplications(userId))?.find(a => a.id === id);
  if (!current) return { ok: false, status: 404, detail: 'Candidatura no encontrada.' };
  const body: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.status !== undefined) {
    if (typeof patch.status !== 'string' || !(STATUSES as readonly string[]).includes(patch.status)) return { ok: false, status: 422, detail: 'Estado no válido.' };
    const to = patch.status as AppStatus;
    if (!canMove(current.status, to)) return { ok: false, status: 409, detail: `No se puede pasar de «${current.status}» a «${to}».` };
    body.status = to; if (to === 'applied' && !current.applied_at) body.applied_at = new Date().toISOString();
  }
  if (patch.cover_message !== undefined) body.cover_message = message(patch.cover_message, 3000);
  if (patch.notes !== undefined) body.notes = message(patch.notes, 1000);
  // Guarda: solo sus filas y solo si el estado no cambió entretanto (otra pestaña).
  const r = await serviceRest(`student_applications?org_id=eq.${ORG}&user_id=eq.${userId}&id=eq.${id}&status=eq.${current.status}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(body) });
  const rows = r.ok ? await r.json().catch(() => null) : null;
  return Array.isArray(rows) && rows.length === 1 ? { ok: true, application: rows[0] } : { ok: false, status: 409, detail: 'La candidatura cambió mientras la editabas. Recarga e inténtalo de nuevo.' };
}

export async function deleteApplication(userId: string, id: unknown): Promise<boolean> {
  if (typeof id !== 'string' || !uuid.test(id) || !uuid.test(userId)) return false;
  const r = await serviceRest(`student_applications?org_id=eq.${ORG}&user_id=eq.${userId}&id=eq.${id}`, { method: 'DELETE', headers: { Prefer: 'return=representation' } });
  const rows = r.ok ? await r.json().catch(() => null) : null;
  return Array.isArray(rows) && rows.length === 1;
}

// Derecho de supresión: borra TODAS sus candidaturas (borradores, mensajes y notas).
export async function eraseApplications(userId: string): Promise<boolean> {
  if (!uuid.test(userId)) return false;
  return (await serviceRest(`student_applications?org_id=eq.${ORG}&user_id=eq.${userId}`, { method: 'DELETE' })).ok;
}
