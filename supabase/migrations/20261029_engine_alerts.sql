-- PENDIENTE DE APLICAR en Supabase real: lo aplica el propietario, por orden expresa (AGENTS.md).
-- Historial de salud del motor cloud y de los avisos por correo ya enviados. Es lo que permite avisar UNA
-- vez por estado: sin este registro no se puede saber si el aviso ya salió, y se repetiría en cada
-- comprobación (el cron diario y, con Vercel Pro, una pasada cada hora). Aditiva y reversible.
-- Reversión: `drop table if exists public.engine_alerts;` (el código lo declara en el panel y no envía).
-- Seguridad: tabla solo para la clave de servicio (RLS sin políticas, sin privilegios para anon/authenticated),
-- como el resto de tablas del panel. No guarda datos de alumnas, ni claves, ni conversaciones: solo el estado
-- del motor, su código HTTP, el texto de causa compartido y a quién/cuándo se avisó.
create table if not exists public.engine_alerts (
  id uuid primary key default gen_random_uuid(),
  org_id text not null default 'cloud-wdc',
  status text not null,
  http_status integer,
  detail text not null,
  since timestamptz not null default now(),
  checked_at timestamptz not null default now(),
  checked_by text not null,
  notified_at timestamptz,
  notified_kind text,
  notified_detail text,
  constraint engine_alerts_status_check check (status in ('ok', 'allowance', 'timeout', 'down')),
  constraint engine_alerts_notified_kind_check check (notified_kind is null or notified_kind in ('outage', 'recovery')),
  constraint engine_alerts_http_status_check check (http_status is null or (http_status >= 100 and http_status <= 599)),
  constraint engine_alerts_detail_check check (char_length(detail) <= 500),
  constraint engine_alerts_notified_detail_check check (notified_detail is null or char_length(notified_detail) <= 500)
);
create index if not exists engine_alerts_recent_idx on public.engine_alerts using btree (org_id, checked_at desc);

alter table public.engine_alerts enable row level security;
revoke all on public.engine_alerts from anon, authenticated;
