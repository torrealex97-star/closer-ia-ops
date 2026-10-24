-- NO APLICADA en Supabase (aplicar DDL exige orden expresa del propietario). Aditiva y reversible (drop table).
-- Actividad de las alumnas en el portal: entradas, revisiones de formación, examen de egreso y prácticas.
-- Solo el servidor (service role) lee y escribe; RLS activado SIN políticas, igual que `students`.
-- La nota del examen la calcula el servidor a partir de las respuestas acertadas, nunca viene del navegador.
create table if not exists public.student_activity (
  id uuid primary key default gen_random_uuid(),
  org_id text not null default 'cloud-wdc',
  student_id uuid not null references public.students(id) on delete cascade,
  kind text not null check (kind in ('session','training_review','training_exam','practice')),
  ref text check (ref is null or char_length(ref) <= 80),
  score smallint check (score is null or score between 0 and 100),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object' and pg_column_size(detail) <= 2000),
  created_at timestamptz not null default now()
);
create index if not exists student_activity_student_idx on public.student_activity (org_id, student_id, created_at desc);
create index if not exists student_activity_org_idx on public.student_activity (org_id, created_at desc);
alter table public.student_activity enable row level security;
revoke all on public.student_activity from anon, authenticated;
