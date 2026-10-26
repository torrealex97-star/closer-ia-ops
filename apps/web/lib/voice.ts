import { ORG } from './external';
import { serviceRest } from './supabaseAuth';

// Voz continua en la sala (ADR-015): apagada por defecto. Solo la abre el propietario con VOICE_ROLEPLAY=on, y aun así hace falta un
// consentimiento de voz vigente de la alumna. Este módulo NO mueve audio: decide si la voz podría ofrecerse y por qué no.
export const VOICE_CONSENT_VERSION = 'v1-borrador'; // texto legal pendiente de revisión (se escribirá con la función de voz)

export const voiceSwitchOn = (env: Record<string, string | undefined> = process.env) => (env.VOICE_ROLEPLAY ?? '').trim().toLowerCase() === 'on';

export type VoiceReason = 'switch_off' | 'no_consent' | 'consent_unreadable' | 'ready';
export type VoiceStatus = { enabled: boolean; reason: VoiceReason; consent: { version: string; accepted_at: string } | null };

type ConsentRow = { version: string; accepted_at: string; revoked_at: string | null };
/** Un consentimiento vale si no está revocado y es de la versión del texto vigente. */
export const consentIsValid = (row: ConsentRow | null | undefined) => Boolean(row && !row.revoked_at && row.version === VOICE_CONSENT_VERSION);

/** `null` = no se pudo leer (tabla ausente o Supabase caído): no es lo mismo que «sin consentimiento». */
export async function readVoiceConsent(studentId: string): Promise<ConsentRow | null | undefined> {
  if (!/^[0-9a-f-]{36}$/.test(studentId)) return undefined;
  const r = await serviceRest(`student_voice_consent?org_id=eq.${ORG}&student_id=eq.${studentId}&select=version,accepted_at,revoked_at&limit=1`).catch(() => null);
  const rows = r?.ok ? await r.json().catch(() => null) : null;
  return Array.isArray(rows) ? (rows[0] ?? undefined) : null;
}

/** Estado de la voz para una alumna. Sin interruptor no se lee ni la base: apagada es apagada. */
export async function voiceStatus(studentId: string, env: Record<string, string | undefined> = process.env, read: typeof readVoiceConsent = readVoiceConsent): Promise<VoiceStatus> {
  if (!voiceSwitchOn(env)) return { enabled: false, reason: 'switch_off', consent: null };
  const row = await read(studentId);
  if (row === null) return { enabled: false, reason: 'consent_unreadable', consent: null };
  if (!consentIsValid(row)) return { enabled: false, reason: 'no_consent', consent: null };
  return { enabled: true, reason: 'ready', consent: { version: row!.version, accepted_at: row!.accepted_at } };
}
