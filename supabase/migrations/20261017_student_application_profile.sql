-- Aplicada en Supabase como `student_application_profile`.
-- Fase 3.2: formulario base de la alumna + seguimiento de candidaturas ASISTIDAS. Aditiva.
-- El formulario base es la fuente única de datos con los que la alumna rellena cualquier formulario; hoy lo copia ELLA.
-- En el futuro una automatización podría usarlo, pero solo con su consentimiento explícito aparte (autofill_consent_*)
-- y con autorización escrita del propietario: NADA se envía ni se rellena automáticamente desde esta migración.
-- Vídeo y CV: solo ENLACES a su propio Drive (no se guardan ficheros).

create table if not exists public.student_application_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  org_id text not null default 'cloud-wdc',
  contact_email text check (contact_email is null or (char_length(contact_email) <= 254 and contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
  phone text check (char_length(phone) <= 30),
  linkedin_url text check (linkedin_url is null or (linkedin_url ~ '^https://[^[:space:]]+$' and char_length(linkedin_url) <= 300)),
  cv_url text check (cv_url is null or (cv_url ~ '^https://[^[:space:]]+$' and char_length(cv_url) <= 1000)),
  country_residence text check (char_length(country_residence) <= 80),
  work_authorization text check (work_authorization in ('eu_citizen','work_permit','needs_sponsorship','other')),
  language_levels jsonb not null default '{}'::jsonb check (jsonb_typeof(language_levels) = 'object' and pg_column_size(language_levels) <= 600),
  years_sales smallint check (years_sales between 0 and 60),
  years_high_ticket smallint check (years_high_ticket between 0 and 60),
  sales_experience text check (char_length(sales_experience) <= 1500),
  tools text[] not null default '{}' check (cardinality(tools) <= 12),
  available_from date,
  hours_per_week smallint check (hours_per_week between 1 and 80),
  contract_preferences text[] not null default '{}' check (cardinality(contract_preferences) <= 4),
  salary_expectation text check (char_length(salary_expectation) <= 200),
  notice_period text check (char_length(notice_period) <= 100),
  pitch text check (char_length(pitch) <= 1200),
  motivation text check (char_length(motivation) <= 1200),
  answers jsonb not null default '{}'::jsonb check (jsonb_typeof(answers) = 'object' and pg_column_size(answers) <= 6000),
  autofill_consent_at timestamptz,
  autofill_consent_version text check (char_length(autofill_consent_version) <= 20),
  updated_at timestamptz not null default now()
);
alter table public.student_application_profiles enable row level security;
revoke all on table public.student_application_profiles from anon, authenticated;
grant select on public.student_application_profiles to authenticated;
grant insert (user_id, contact_email, phone, linkedin_url, cv_url, country_residence, work_authorization, language_levels, years_sales, years_high_ticket, sales_experience, tools, available_from, hours_per_week, contract_preferences, salary_expectation, notice_period, pitch, motivation, answers, autofill_consent_at, autofill_consent_version) on public.student_application_profiles to authenticated;
grant update (contact_email, phone, linkedin_url, cv_url, country_residence, work_authorization, language_levels, years_sales, years_high_ticket, sales_experience, tools, available_from, hours_per_week, contract_preferences, salary_expectation, notice_period, pitch, motivation, answers, autofill_consent_at, autofill_consent_version, updated_at) on public.student_application_profiles to authenticated;
create policy sap_select_own on public.student_application_profiles for select to authenticated using (user_id = (select auth.uid()));
create policy sap_insert_own on public.student_application_profiles for insert to authenticated with check (user_id = (select auth.uid()) and org_id = 'cloud-wdc');
create policy sap_update_own on public.student_application_profiles for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create table if not exists public.student_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id text not null default 'cloud-wdc',
  offer_ref text not null check (char_length(offer_ref) between 1 and 64),
  offer_title text not null check (char_length(offer_title) <= 200),
  offer_company text check (char_length(offer_company) <= 200),
  offer_url text not null check (offer_url ~ '^https?://[^[:space:]]+$' and char_length(offer_url) <= 1000),
  status text not null default 'draft' check (status in ('draft','opened','applied','discarded')),
  cover_message text check (char_length(cover_message) <= 3000),
  notes text check (char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  applied_at timestamptz,
  unique (user_id, offer_ref)
);
create index if not exists student_applications_user_idx on public.student_applications (user_id, status);
alter table public.student_applications enable row level security;
revoke all on table public.student_applications from anon, authenticated;
grant select, delete on public.student_applications to authenticated;
grant insert (user_id, offer_ref, offer_title, offer_company, offer_url, cover_message, notes) on public.student_applications to authenticated;
grant update (status, cover_message, notes, applied_at, updated_at) on public.student_applications to authenticated;
create policy sa_select_own on public.student_applications for select to authenticated using (user_id = (select auth.uid()));
create policy sa_insert_own on public.student_applications for insert to authenticated with check (user_id = (select auth.uid()) and org_id = 'cloud-wdc');
create policy sa_update_own on public.student_applications for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy sa_delete_own on public.student_applications for delete to authenticated using (user_id = (select auth.uid()));
