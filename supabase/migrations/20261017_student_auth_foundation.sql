-- Fase 2.1: acceso de alumnas. Aditiva. Aplicada en Supabase como `student_auth_foundation`.
-- Las alumnas entran SOLO por invitación (lista `students`), igual que el panel con `admin_users`.
-- Los vídeos NO se guardan aquí: cada alumna los tiene en su propio Drive y solo se guarda el enlace (`video_url`).

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  org_id text not null default 'cloud-wdc',
  email text not null,
  user_id uuid unique references auth.users(id) on delete set null,
  status text not null default 'invited' check (status in ('invited','active','paused')),
  invited_by text,
  created_at timestamptz not null default now(),
  constraint students_email_lower check (email = lower(email)),
  unique (org_id, email)
);
alter table public.students enable row level security;
revoke all on table public.students from anon, authenticated;

create table if not exists public.student_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  org_id text not null default 'cloud-wdc',
  full_name text check (char_length(full_name) <= 120),
  city text check (char_length(city) <= 80),
  target_roles text[] not null default '{}' check (cardinality(target_roles) <= 8),
  languages text[] not null default '{}' check (cardinality(languages) <= 8),
  availability text check (char_length(availability) <= 200),
  video_url text check (video_url is null or (video_url ~ '^https://[^[:space:]]+$' and char_length(video_url) <= 1000)),
  consent_at timestamptz,
  consent_version text check (char_length(consent_version) <= 20),
  updated_at timestamptz not null default now()
);
alter table public.student_profiles enable row level security;
revoke all on table public.student_profiles from anon, authenticated;
-- Defensa en profundidad (el servidor usa la service role y filtra por user_id): una alumna con su propio JWT
-- solo ve y edita SU fila, y solo columnas de perfil (no org_id ni user_id).
grant select on public.student_profiles to authenticated;
grant insert (user_id, full_name, city, target_roles, languages, availability, video_url, consent_at, consent_version) on public.student_profiles to authenticated;
grant update (full_name, city, target_roles, languages, availability, video_url, consent_at, consent_version, updated_at) on public.student_profiles to authenticated;
create policy student_profiles_select_own on public.student_profiles for select to authenticated using (user_id = (select auth.uid()));
create policy student_profiles_insert_own on public.student_profiles for insert to authenticated with check (user_id = (select auth.uid()) and org_id = 'cloud-wdc');
create policy student_profiles_update_own on public.student_profiles for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- El bloqueo de altas ahora admite también a las alumnas invitadas (y no pausadas).
create or replace function public.enforce_admin_allowlist() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if new.email is null
     or not (exists (select 1 from public.admin_users a where a.email = lower(new.email))
          or exists (select 1 from public.students s where s.email = lower(new.email) and s.status <> 'paused')) then
    raise exception 'signup_disabled: este email no está invitado' using errcode = 'P0001';
  end if;
  return new;
end $$;
