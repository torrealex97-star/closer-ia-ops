import { ORG, scrub } from './external';
import { serviceRest } from './supabaseAuth';
import { getProfile } from './students';

// Formulario base de la alumna (incremento 3.2): la FUENTE ÚNICA de los datos con los que se rellena cualquier formulario de
// candidatura. Hoy lo copia ELLA y envía ELLA. El consentimiento de «autorrelleno futuro» es APARTE, revocable y NO se usa
// todavía: ninguna parte de la app envía ni rellena nada automáticamente. Vídeo y CV son enlaces a su propio Drive.
export const WORK_AUTH = { eu_citizen: 'Ciudadana de la UE', work_permit: 'Permiso de trabajo en España', needs_sponsorship: 'Necesito patrocinio/visado', other: 'Otra situación' } as const;
export const LEVELS = { basic: 'Básico', intermediate: 'Intermedio', advanced: 'Avanzado', native: 'Nativo' } as const;
export const CONTRACTS = { employee: 'Contrato laboral', freelance: 'Autónoma / freelance', commission_only: 'Solo comisiones' } as const;
export const ANSWER_KEYS = { why_this_role: 'Por qué quiero este puesto', biggest_win: 'Mi mayor logro en ventas', handle_objection: 'Cómo gestiono una objeción', remote_experience: 'Mi experiencia trabajando en remoto' } as const;
export const LANGUAGE_CODES = ['es', 'en', 'pt', 'fr', 'de', 'it', 'ca'] as const;
export const AUTOFILL_CONSENT_VERSION = 'v1-borrador'; // texto legal pendiente de revisión

export type AppProfile = {
  contact_email: string | null; phone: string | null; linkedin_url: string | null; cv_url: string | null; country_residence: string | null;
  work_authorization: keyof typeof WORK_AUTH | null; language_levels: Record<string, keyof typeof LEVELS>; years_sales: number | null; years_high_ticket: number | null;
  sales_experience: string | null; tools: string[]; available_from: string | null; hours_per_week: number | null; contract_preferences: Array<keyof typeof CONTRACTS>;
  salary_expectation: string | null; notice_period: string | null; pitch: string | null; motivation: string | null; answers: Partial<Record<keyof typeof ANSWER_KEYS, string>>;
  autofill_consent_at: string | null; autofill_consent_version: string | null;
};
const COLS = 'contact_email,phone,linkedin_url,cv_url,country_residence,work_authorization,language_levels,years_sales,years_high_ticket,sales_experience,tools,available_from,hours_per_week,contract_preferences,salary_expectation,notice_period,pitch,motivation,answers,autofill_consent_at,autofill_consent_version';

const clip = (v: unknown, n: number) => typeof v === 'string' ? scrub(v).slice(0, n) || null : null;
const intIn = (v: unknown, min: number, max: number) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : null; };
const httpsUrl = (v: unknown, max: number) => { if (typeof v !== 'string' || !v.trim()) return null; try { const u = new URL(v.trim()); const h = u.hostname.toLowerCase();
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') || !h.includes('.') || /^[\d.]+$/.test(h) || h.startsWith('[') || /(^|\.)(localhost|local|internal|intranet)$/.test(h) || u.href.length > max) return null; return u.href; } catch { return null; } };
const email = (v: unknown) => { const t = typeof v === 'string' ? v.trim().toLowerCase() : ''; return t.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t) ? t : null; };
const phone = (v: unknown) => { const t = typeof v === 'string' ? v.replace(/[^\d+()\s.-]/g, '').trim().slice(0, 30) : ''; return /\d{6,}/.test(t.replace(/\D/g, '')) ? t : null; };
const day = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v ? v : null;

export function sanitizeAppProfile(input: unknown): (Omit<AppProfile, 'autofill_consent_at' | 'autofill_consent_version'> & { autofill_consent: boolean }) | null {
  if (!input || typeof input !== 'object') return null;
  const c = input as Record<string, unknown>;
  const lv = c.language_levels && typeof c.language_levels === 'object' ? c.language_levels as Record<string, unknown> : {};
  const answers = c.answers && typeof c.answers === 'object' ? c.answers as Record<string, unknown> : {};
  return {
    contact_email: email(c.contact_email), phone: phone(c.phone), linkedin_url: httpsUrl(c.linkedin_url, 300), cv_url: httpsUrl(c.cv_url, 1000),
    country_residence: clip(c.country_residence, 80),
    work_authorization: typeof c.work_authorization === 'string' && c.work_authorization in WORK_AUTH ? c.work_authorization as keyof typeof WORK_AUTH : null,
    language_levels: Object.fromEntries(Object.entries(lv).filter(([k, v]) => (LANGUAGE_CODES as readonly string[]).includes(k) && typeof v === 'string' && v in LEVELS)) as AppProfile['language_levels'],
    years_sales: intIn(c.years_sales, 0, 60), years_high_ticket: intIn(c.years_high_ticket, 0, 60), sales_experience: clip(c.sales_experience, 1500),
    tools: Array.isArray(c.tools) ? [...new Set(c.tools.map(t => clip(t, 40)).filter((t): t is string => !!t))].slice(0, 12) : [],
    available_from: day(c.available_from), hours_per_week: intIn(c.hours_per_week, 1, 80),
    contract_preferences: Array.isArray(c.contract_preferences) ? [...new Set(c.contract_preferences.filter((x): x is keyof typeof CONTRACTS => typeof x === 'string' && x in CONTRACTS))].slice(0, 4) : [],
    salary_expectation: clip(c.salary_expectation, 200), notice_period: clip(c.notice_period, 100), pitch: clip(c.pitch, 1200), motivation: clip(c.motivation, 1200),
    answers: Object.fromEntries(Object.entries(answers).filter(([k]) => k in ANSWER_KEYS).map(([k, v]) => [k, clip(v, 800)]).filter(([, v]) => v)) as AppProfile['answers'],
    autofill_consent: c.autofill_consent === true,
  };
}

// Qué le falta para que su formulario sirva para la mayoría de candidaturas (orientativo, no bloquea nada).
const REQUIRED: Array<[keyof AppProfile, string]> = [['contact_email', 'Email de contacto'], ['phone', 'Teléfono'], ['country_residence', 'País de residencia'], ['work_authorization', 'Situación laboral/permiso'],
  ['years_sales', 'Años en ventas'], ['sales_experience', 'Experiencia en ventas'], ['pitch', 'Presentación breve'], ['cv_url', 'Enlace a tu CV'], ['available_from', 'Disponibilidad (fecha)']];
export function completeness(p: Partial<AppProfile> | null, videoUrl: string | null): { pct: number; missing: string[] } {
  const miss = REQUIRED.filter(([k]) => { const v = p?.[k]; return v === null || v === undefined || v === ''; }).map(([, l]) => l);
  if (!videoUrl) miss.push('Enlace a tu vídeo (en tu perfil)');
  const total = REQUIRED.length + 1;
  return { pct: Math.round(((total - miss.length) / total) * 100), missing: miss };
}

export async function getAppProfile(userId: string): Promise<AppProfile | null> {
  if (!/^[0-9a-f-]{36}$/.test(userId)) return null;
  const r = await serviceRest(`student_application_profiles?org_id=eq.${ORG}&user_id=eq.${userId}&select=${COLS}&limit=1`);
  const rows = r.ok ? await r.json().catch(() => null) : null;
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

export type SaveResult = { ok: true; profile: AppProfile } | { ok: false; status: number; detail: string };
// Guardar exige el consentimiento base del perfil. El consentimiento de autorrelleno futuro es aparte: se fecha al marcarlo y se retira al desmarcarlo.
export async function saveAppProfile(userId: string, input: ReturnType<typeof sanitizeAppProfile>): Promise<SaveResult> {
  if (!input || !/^[0-9a-f-]{36}$/.test(userId)) return { ok: false, status: 422, detail: 'Formulario no válido.' };
  const base = await getProfile(userId);
  if (!base?.consent_at) return { ok: false, status: 422, detail: 'Guarda antes tu perfil y acepta el tratamiento de tus datos.' };
  const current = await getAppProfile(userId);
  const { autofill_consent, ...fields } = input;
  const consent = autofill_consent ? { autofill_consent_at: current?.autofill_consent_at ?? new Date().toISOString(), autofill_consent_version: current?.autofill_consent_version ?? AUTOFILL_CONSENT_VERSION } : { autofill_consent_at: null, autofill_consent_version: null };
  const r = await serviceRest('student_application_profiles?on_conflict=user_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify({ user_id: userId, org_id: ORG, ...fields, ...consent, updated_at: new Date().toISOString() }) });
  const rows = r.ok ? await r.json().catch(() => null) : null;
  if (!Array.isArray(rows) || !rows[0]) return { ok: false, status: 503, detail: 'No se pudo guardar el formulario.' };
  const { user_id: _u, org_id: _o, updated_at: _t, ...profile } = rows[0]; void _u; void _o; void _t;
  return { ok: true, profile };
}

export async function eraseAppProfile(userId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/.test(userId)) return false;
  return (await serviceRest(`student_application_profiles?org_id=eq.${ORG}&user_id=eq.${userId}`, { method: 'DELETE' })).ok;
}
