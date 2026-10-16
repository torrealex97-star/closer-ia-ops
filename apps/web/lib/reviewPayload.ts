// Forma del payload de versión que acepta el motor (versionPayloadError en worker.js) y mapeo desde el
// detalle de una oportunidad. Lo comparten la revisión una a una y la revisión rápida.
export type NextStep = { action?: string; label?: string; enabled: boolean; disabled_reason?: string };
export type VersionPayload = {
  headline?: string; title?: string; role?: string; short_summary?: string;
  what_they_are_looking_for?: string[]; what_you_would_do?: string[]; why_it_may_be_interesting?: string[];
  compensation_summary?: string; location_summary?: string; experience_summary?: string;
  language_requirements?: string[]; application_type?: string; application_url?: string | null;
  next_step?: NextStep; [k: string]: unknown;
};
export type DetailLike = {
  version_payload: VersionPayload | null;
  job_snapshot: { title: string | null; company: string | null; location: string | null; salary: string | null; posted_at: string | null; source_url: string | null; source: string };
};

// El payload raw del collector (title/company/url…) no es válido tal cual: el motor rechaza campos desconocidos,
// así que solo se pasan los permitidos. `role` es la familia detectada o 'uncategorized'; nada se inventa.
export function draftFromDetail(d: DetailLike, detectedRole?: string | null): VersionPayload {
  const p = d.version_payload ?? {};
  return {
    ...p,
    headline: p.headline ?? p.title ?? d.job_snapshot.title ?? '',
    role: p.role ?? detectedRole ?? 'uncategorized',
    short_summary: p.short_summary ?? '',
    what_they_are_looking_for: p.what_they_are_looking_for ?? [],
    what_you_would_do: p.what_you_would_do ?? [],
    why_it_may_be_interesting: p.why_it_may_be_interesting ?? [],
    compensation_summary: p.compensation_summary ?? '',
    location_summary: p.location_summary ?? (d.job_snapshot.location ?? ''),
    experience_summary: p.experience_summary ?? '',
    language_requirements: p.language_requirements ?? [],
    application_type: p.application_type ?? 'unknown',
    application_url: p.application_url ?? (d.job_snapshot.source_url?.startsWith('https://') ? d.job_snapshot.source_url : null),
  };
}

// Solo los campos que el motor admite (descarta title/company/url/raw… del payload del collector).
const ALLOWED = ['headline', 'role', 'short_summary', 'what_they_are_looking_for', 'what_you_would_do', 'why_it_may_be_interesting', 'compensation_summary', 'location_summary', 'experience_summary', 'language_requirements', 'application_type', 'application_url', 'next_step'];
export function sendable(draft: VersionPayload): VersionPayload {
  return Object.fromEntries(Object.entries(draft).filter(([k]) => ALLOWED.includes(k))) as VersionPayload;
}
