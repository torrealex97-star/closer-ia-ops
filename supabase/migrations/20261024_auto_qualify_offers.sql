-- Cualificación automática de ofertas externas (sesión 79). Aditiva.
-- Guarda lo que hasta ahora solo se calculaba en memoria o se perdía:
--   · apply_url / company_url: dónde se aplica de verdad (enlace de candidatura de la fuente y web
--     publicada en el anuncio que no sea un portal de empleo). Sin URLs inventadas.
--   · contact: SOLO el contacto que el anuncio publica literalmente (decisión del propietario).
--   · market / market_basis / currency: mercado deducido y el motivo (ubicación o, si no la hay, moneda).
--   · auto_review: por qué aprobó sola la regla (o por qué quedó para una persona).
-- El motor cloud no escribe aquí: este esquema es de las fuentes externas.

alter table public.external_offers
  add column if not exists apply_url text,
  add column if not exists company_url text,
  add column if not exists contact jsonb,
  add column if not exists market_basis text,
  add column if not exists auto_review jsonb;

alter table public.external_offers
  drop constraint if exists external_offers_apply_url_check,
  add constraint external_offers_apply_url_check check (apply_url is null or apply_url ~ '^https?://'),
  drop constraint if exists external_offers_company_url_check,
  add constraint external_offers_company_url_check check (company_url is null or company_url ~ '^https?://'),
  drop constraint if exists external_offers_contact_check,
  add constraint external_offers_contact_check check (contact is null or (jsonb_typeof(contact) = 'object' and pg_column_size(contact) <= 1000)),
  drop constraint if exists external_offers_market_basis_check,
  add constraint external_offers_market_basis_check check (market_basis is null or market_basis in
    ('ubicacion_espana', 'ubicacion_latam', 'ubicacion_estados_unidos', 'moneda_eur', 'moneda_usd', 'sin_senal')),
  drop constraint if exists external_offers_auto_review_check,
  add constraint external_offers_auto_review_check check (auto_review is null or (jsonb_typeof(auto_review) = 'object' and pg_column_size(auto_review) <= 2000));

comment on column public.external_offers.apply_url is
  'Enlace de candidatura que publica la fuente (SerpApi apply_options, portales). NULL si no lo da: nunca se deduce.';
comment on column public.external_offers.company_url is
  'Web del anuncio que no es un portal de empleo (corporativa o ATS). Literal del texto; NULL si no aparece.';
comment on column public.external_offers.contact is
  'Contacto publicado literalmente en el anuncio: {"emails":[…],"phones":[…]} acotado. Sin datos de otras fuentes.';
comment on column public.external_offers.market_basis is
  'Motivo del mercado: ubicación explícita o, si no la hay, la moneda del importe.';
comment on column public.external_offers.auto_review is
  'Decisión de la regla automática y su motivo (cumple_reglas, sin_perfil, sin_mercado, idioma_dudoso…).';

-- El RPC de ingesta es la única puerta de escritura de las fuentes externas: se reemplaza para que
-- los campos nuevos entren desde el primer día y para que una oferta ya guardada se actualice con
-- el enlace de candidatura cuando la fuente lo publique después.
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
      insert into public.external_offers (org_id, source, external_id, title, company, location, url, salary, description, posted_at, raw,
                                          role, spain, score, fingerprint, market, market_basis, currency, apply_url, company_url, contact)
      values (p_org, p_source, r->>'external_id', r->>'title', r->>'company', r->>'location', r->>'url', r->>'salary', r->>'description',
              nullif(r->>'posted_at', '')::timestamptz, coalesce(r->'raw', '{}'::jsonb),
              r->>'role', (r->>'spain')::boolean, coalesce((r->>'score')::int, 0), fp,
              nullif(r->>'market', ''), nullif(r->>'market_basis', ''), nullif(r->>'currency', ''),
              nullif(r->>'apply_url', ''), nullif(r->>'company_url', ''),
              case when jsonb_typeof(r->'contact') = 'object' then r->'contact' end)
      on conflict (org_id, source, external_id) do update
        set last_seen_at = now(), expires_at = now() + interval '10 days', title = excluded.title, url = excluded.url,
            company = coalesce(excluded.company, public.external_offers.company),
            location = coalesce(excluded.location, public.external_offers.location),
            salary = coalesce(excluded.salary, public.external_offers.salary),
            description = coalesce(excluded.description, public.external_offers.description),
            posted_at = coalesce(excluded.posted_at, public.external_offers.posted_at),
            role = excluded.role, spain = excluded.spain, score = excluded.score,
            fingerprint = coalesce(excluded.fingerprint, public.external_offers.fingerprint),
            market = coalesce(excluded.market, public.external_offers.market),
            market_basis = coalesce(excluded.market_basis, public.external_offers.market_basis),
            currency = coalesce(excluded.currency, public.external_offers.currency),
            apply_url = coalesce(excluded.apply_url, public.external_offers.apply_url),
            company_url = coalesce(excluded.company_url, public.external_offers.company_url),
            contact = coalesce(excluded.contact, public.external_offers.contact);
    end if;
    n := n + 1;
  end loop;
  return n;
end $function$;

revoke execute on function public.external_upsert(text, text, jsonb) from public, anon, authenticated;
