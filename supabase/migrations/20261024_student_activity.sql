-- Actividad de alumnas para los paneles de progreso (sesión 78). Aditiva.
-- Guarda SOLO señales de uso, nunca contenido: entrada al portal, una práctica
-- terminada con feedback, una revisión de ejercicio de formación y la corrección
-- del examen. El detalle es un resumen numérico acotado (2 KB), sin texto libre.
-- La escribe y la lee solo el servidor con la service role; el navegador no la consulta.

create table if not exists public.student_activity (
  id uuid primary key default gen_random_uuid(),
  org_id text not null default 'cloud-wdc',
  student_id uuid not null references public.students(id) on delete cascade,
  kind text not null check (kind in ('session', 'practice', 'training_review', 'training_exam')),
  ref text check (ref is null or char_length(ref) between 1 and 80),
  score smallint check (score is null or score between 0 and 100),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object' and pg_column_size(detail) <= 2000),
  created_at timestamptz not null default now()
);

comment on table public.student_activity is
  'Señales de uso de la alumna para los paneles de progreso. Sin conversaciones ni texto libre; retención de 180 días por política de la app (limpieza manual del operador).';

create index if not exists student_activity_student_time on public.student_activity (student_id, created_at desc);
create index if not exists student_activity_org_time on public.student_activity (org_id, created_at desc);

alter table public.student_activity enable row level security;
revoke all on table public.student_activity from anon, authenticated;
-- Sin políticas a propósito: solo la service role (servidor) puede leer y escribir.
