-- BASELINE DE REFERENCIA — NO ES UNA MIGRACIÓN Y NO SE APLICA.
--
-- Reconstruido el 2026-10-17 leyendo el catálogo del Supabase en vivo
-- (proyecto jzchuizybyubtkownhlw) con consultas de solo lectura. NO son las
-- migraciones originales: esas nunca se versionaron y viven (si existen) en el
-- repo del motor cloud `closer-offers-engine`. Sirve para que un entorno nuevo
-- o un agente pueda ver el esquema de las 9 tablas sin versionar.
-- Cuando el dueño ejecute `supabase db pull`, ese resultado sustituye a este archivo.
--
-- Las tablas posteriores (students, student_profiles, student_application_profiles,
-- student_applications) SÍ están en supabase/migrations/.
-- Estado de seguridad verificado: RLS activada en las 9 tablas, sin políticas
-- (solo service role) y sin grants para anon/authenticated.
-- Evidencia: inspeccionado contra el catálogo real; este archivo NO se ha ejecutado.

-- ── admin_users ─────────────────────────────────────────────────────────────
create table public.admin_users (
  email text not null,
  role text not null default 'admin',
  invited_by text,
  created_at timestamptz not null default now(),
  constraint admin_users_pkey primary key (email),
  constraint admin_users_email_check check (email = lower(email) and email like '%@%'),
  constraint admin_users_role_check check (role in ('owner', 'admin'))
);

-- ── apify_actors ────────────────────────────────────────────────────────────
create table public.apify_actors (
  id uuid not null default gen_random_uuid(),
  org_id text not null default 'cloud-wdc',
  label text not null,
  actor text not null,
  source text not null,
  input_template jsonb,
  max_items integer not null default 500,
  memory_mb integer not null default 1024,
  timeout_s integer not null default 900,
  schedule_daily boolean not null default false,
  created_by text not null,
  created_at timestamptz not null default now(),
  engine_managed boolean not null default false,
  tier smallint not null default 2,
  market text,
  query text,
  run_interval_hours integer not null default 6,
  status text not null default 'pending_validation',
  paused_until timestamptz,
  last_run_at timestamptz,
  last_offer_at timestamptz,
  constraint apify_actors_pkey primary key (id),
  constraint apify_actors_actor_check check (actor ~ '^[A-Za-z0-9._-]+[/~][A-Za-z0-9._-]+$'),
  constraint apify_actors_market_check check (market in ('ES', 'LATAM', 'US_LATINO', 'MULTI')),
  constraint apify_actors_max_items_check check (max_items >= 10 and max_items <= 5000),
  constraint apify_actors_memory_mb_check check (memory_mb >= 256 and memory_mb <= 4096),
  constraint apify_actors_run_interval_hours_check check (run_interval_hours >= 1),
  constraint apify_actors_source_check check (source ~ '^[a-z0-9-]{2,40}$'),
  constraint apify_actors_status_check check (status in ('pending_validation', 'active', 'paused', 'inactive')),
  constraint apify_actors_tier_check check (tier in (1, 2, 3)),
  constraint apify_actors_timeout_s_check check (timeout_s >= 60 and timeout_s <= 3600)
);
create index apify_actors_engine_idx on public.apify_actors using btree (org_id, engine_managed, status, tier, last_run_at);

-- ── apify_runs ──────────────────────────────────────────────────────────────
create table public.apify_runs (
  id uuid not null default gen_random_uuid(),
  org_id text not null default 'cloud-wdc',
  actor_id uuid not null,
  run_id text not null,
  dataset_id text,
  status text not null default 'RUNNING',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  items_total integer,
  harvested integer not null default 0,
  cost_usd numeric(10,4),
  error text,
  started_by text not null,
  http_blocked boolean not null default false,
  items_kept integer not null default 0,
  constraint apify_runs_pkey primary key (id),
  constraint apify_runs_run_id_key unique (run_id),
  constraint apify_runs_actor_id_fkey foreign key (actor_id) references public.apify_actors (id) on delete cascade
);
create index apify_runs_idx on public.apify_runs using btree (org_id, started_at desc);

-- ── b2b_leads ───────────────────────────────────────────────────────────────
create table public.b2b_leads (
  id uuid not null default gen_random_uuid(),
  org_id text not null default 'cloud-wdc',
  advertiser text not null,
  market text not null default 'MULTI',
  ad_library_url text,
  landing_url text,
  vertical text,
  cta text,
  weeks_active numeric,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  status text not null default 'nuevo',
  notes text,
  constraint b2b_leads_pkey primary key (id),
  constraint b2b_leads_org_id_advertiser_market_key unique (org_id, advertiser, market),
  constraint b2b_leads_status_check check (status in ('nuevo', 'contactado', 'respondio', 'colocacion', 'descartado'))
);

-- ── external_ingest_runs ────────────────────────────────────────────────────
create table public.external_ingest_runs (
  id uuid not null default gen_random_uuid(),
  org_id text not null default 'cloud-wdc',
  source text not null,
  via text not null,
  received integer not null default 0,
  accepted integer not null default 0,
  rejected integer not null default 0,
  note text,
  created_at timestamptz not null default now(),
  constraint external_ingest_runs_pkey primary key (id)
);
create index external_ingest_runs_idx on public.external_ingest_runs using btree (org_id, created_at desc);

-- ── external_offers ─────────────────────────────────────────────────────────
create table public.external_offers (
  id uuid not null default gen_random_uuid(),
  org_id text not null default 'cloud-wdc',
  source text not null,
  external_id text not null,
  title text not null,
  company text,
  location text,
  url text not null,
  salary text,
  description text,
  posted_at timestamptz,
  raw jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 days'),
  editorial_status text not null default 'draft',
  reviewed_by text,
  reviewed_at timestamptz,
  verified_at timestamptz,
  verified_result text,
  role text,
  spain boolean,
  score integer not null default 0,
  fingerprint text,
  also_seen text[] not null default '{}'::text[],
  market text,
  remote boolean,
  pay_model text,
  pay_detail text,
  currency text,
  vertical text,
  language text,
  red_flags text[] not null default '{}'::text[],
  ai_review jsonb,
  constraint external_offers_pkey primary key (id),
  constraint external_offers_org_id_source_external_id_key unique (org_id, source, external_id),
  constraint external_offers_editorial_status_check check (editorial_status in ('draft', 'needs_review', 'approved', 'published', 'withdrawn')),
  constraint external_offers_market_check check (market in ('ES', 'LATAM', 'US_LATINO')),
  constraint external_offers_pay_model_check check (pay_model in ('comision', 'fijo', 'mixto', 'no_indicado')),
  constraint external_offers_url_check check (url ~ '^https?://'),
  constraint external_offers_verified_result_check check (verified_result in ('open', 'closed', 'unknown'))
);
create index external_offers_status_idx on public.external_offers using btree (org_id, editorial_status, expires_at desc);
create index external_offers_source_idx on public.external_offers using btree (org_id, source, last_seen_at desc);
create index external_offers_rank_idx on public.external_offers using btree (org_id, editorial_status, score desc, posted_at desc nulls last);
create index external_offers_fp_idx on public.external_offers using btree (org_id, fingerprint);
create index external_offers_role_idx on public.external_offers using btree (org_id, role, spain);
create index external_offers_market_idx on public.external_offers using btree (org_id, market, editorial_status, score desc);

-- ── integration_connections (claves cifradas; nunca en claro) ───────────────
create table public.integration_connections (
  provider text not null,
  secret_ciphertext text not null,
  last4 text not null,
  updated_by text not null,
  updated_at timestamptz not null default now(),
  last_test_at timestamptz,
  last_test_ok boolean,
  last_test_detail text,
  constraint integration_connections_pkey primary key (provider),
  constraint integration_connections_provider_check check (provider in ('apify', 'serpapi', 'groq', 'openai', 'adzuna', 'jooble', 'infojobs'))
);

-- ── source_settings ─────────────────────────────────────────────────────────
create table public.source_settings (
  org_id text not null default 'cloud-wdc',
  source text not null,
  enabled boolean not null default true,
  updated_by text not null,
  updated_at timestamptz not null default now(),
  constraint source_settings_pkey primary key (org_id, source),
  constraint source_settings_source_check check (source ~ '^[a-z0-9-]{2,40}$')
);

-- ── weekly_reports ──────────────────────────────────────────────────────────
create table public.weekly_reports (
  org_id text not null default 'cloud-wdc',
  week_start date not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  constraint weekly_reports_pkey primary key (org_id, week_start)
);

-- ── Seguridad: solo service role ────────────────────────────────────────────
alter table public.admin_users enable row level security;
alter table public.apify_actors enable row level security;
alter table public.apify_runs enable row level security;
alter table public.b2b_leads enable row level security;
alter table public.external_ingest_runs enable row level security;
alter table public.external_offers enable row level security;
alter table public.integration_connections enable row level security;
alter table public.source_settings enable row level security;
alter table public.weekly_reports enable row level security;

revoke all on public.admin_users, public.apify_actors, public.apify_runs, public.b2b_leads,
  public.external_ingest_runs, public.external_offers, public.integration_connections,
  public.source_settings, public.weekly_reports from anon, authenticated;

-- ── Funciones ───────────────────────────────────────────────────────────────
-- Versión vigente (incluye alumnas: tabla public.students, migración 20261017_student_auth_foundation).
create or replace function public.enforce_admin_allowlist()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  if new.email is null
     or not (exists (select 1 from public.admin_users a where a.email = lower(new.email))
          or exists (select 1 from public.students s where s.email = lower(new.email) and s.status <> 'paused')) then
    raise exception 'signup_disabled: este email no está invitado' using errcode = 'P0001';
  end if;
  return new;
end $function$;

create trigger enforce_admin_allowlist before insert on auth.users
  for each row execute function public.enforce_admin_allowlist();

create or replace function public.external_upsert(p_org text, p_source text, p_rows jsonb)
 returns integer
 language plpgsql
 set search_path to ''
as $function$
declare r jsonb; n integer := 0; dup uuid; fp text;
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    fp := nullif(r->>'fingerprint', '');
    dup := null;
    if fp is not null and not exists (select 1 from public.external_offers o where o.org_id = p_org and o.source = p_source and o.external_id = r->>'external_id') then
      select o.id into dup from public.external_offers o where o.org_id = p_org and o.fingerprint = fp and o.source <> p_source limit 1;
    end if;
    if dup is not null then
      update public.external_offers set last_seen_at = now(), expires_at = now() + interval '10 days',
        also_seen = (select coalesce(array_agg(distinct s), '{}') from unnest(also_seen || p_source) s) where id = dup;
    else
      insert into public.external_offers (org_id, source, external_id, title, company, location, url, salary, description, posted_at, raw, role, spain, score, fingerprint)
      values (p_org, p_source, r->>'external_id', r->>'title', r->>'company', r->>'location', r->>'url', r->>'salary', r->>'description',
              nullif(r->>'posted_at', '')::timestamptz, coalesce(r->'raw', '{}'::jsonb), r->>'role', (r->>'spain')::boolean, coalesce((r->>'score')::int, 0), fp)
      on conflict (org_id, source, external_id) do update
        set last_seen_at = now(), expires_at = now() + interval '10 days', title = excluded.title, url = excluded.url,
            company = coalesce(excluded.company, public.external_offers.company),
            location = coalesce(excluded.location, public.external_offers.location),
            salary = coalesce(excluded.salary, public.external_offers.salary),
            description = coalesce(excluded.description, public.external_offers.description),
            posted_at = coalesce(excluded.posted_at, public.external_offers.posted_at),
            role = excluded.role, spain = excluded.spain, score = excluded.score, fingerprint = coalesce(excluded.fingerprint, public.external_offers.fingerprint);
    end if;
    n := n + 1;
  end loop;
  return n;
end $function$;

revoke execute on function public.enforce_admin_allowlist() from public, anon, authenticated;
revoke execute on function public.external_upsert(text, text, jsonb) from public, anon, authenticated;
