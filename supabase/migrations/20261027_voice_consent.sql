-- APLICADA en Supabase (2026-10-26, por orden del dueño). Aditiva y reversible (drop table).
-- Consentimiento PROPIO de voz (ADR-015): separado del consentimiento del perfil y del de autorrelleno. Una fila por alumna;
-- revocar rellena revoked_at (el historial queda en la fila; volver a aceptar crea versión nueva sobre la misma fila).
-- Solo la clave de servicio accede: RLS activada y sin políticas, como el resto de tablas de alumnas del portal.
create table if not exists public.student_voice_consent (
  org_id text not null default 'cloud-wdc',
  student_id uuid not null references public.students(id) on delete cascade,
  version text not null check (length(version) between 1 and 40),
  accepted_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (org_id, student_id)
);
alter table public.student_voice_consent enable row level security;
revoke all on public.student_voice_consent from anon, authenticated;
