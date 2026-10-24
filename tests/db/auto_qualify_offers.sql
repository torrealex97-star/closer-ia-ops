-- Pruebas de comportamiento de `20261024_auto_qualify_offers.sql`.
-- Un bloque que termina con una excepción `TIEMPOS: ...` a propósito: así se deshace TODO (rollback).
-- Resultado esperado:
--   filas=2 · market=LATAM · basis=moneda_usd · cur=USD · apply=… · web=… · mail=1 · tel=1
--   reingesta: apply=nuevo, contact=previo · apply_ftp:23514 · basis_malo:23514 · market_malo:23514
--   claim1=1 · claim2=0 (segunda persona no pisa) · auto_review=cumple_reglas
--   Falta cualquier `FALLO` en la salida.

do $$
declare
  n int; r text := ''; got record; claimed int;
begin
  set local statement_timeout = '20s';

  -- 1) Ingesta con los campos nuevos: se guardan tal cual, sin deducir nada.
  select public.external_upsert('cloud-wdc', 'google-jobs', jsonb_build_array(jsonb_build_object(
    'external_id', 't-auto-1', 'title', 'Closer high ticket', 'company', 'Acme', 'location', 'Remoto',
    'url', 'https://www.linkedin.com/jobs/view/1', 'salary', '3.000 USD al mes',
    'description', 'Buscamos closer para el equipo comercial en LatAm. Escribe a talento@acme.com o +34 600 123 456.',
    'role', 'closer', 'spain', null, 'score', 72, 'fingerprint', 'acme|closer high ticket|remoto',
    'market', 'LATAM', 'market_basis', 'moneda_usd', 'currency', 'USD',
    'apply_url', 'https://jobs.lever.co/acme/123', 'company_url', 'https://acme.com/empleo',
    'contact', jsonb_build_object('emails', jsonb_build_array('talento@acme.com'), 'phones', jsonb_build_array('+34 600 123 456'))))) into n;
  if n <> 1 then r := r || 'filas=' || n || ' '; end if;

  select market, market_basis, currency, apply_url, company_url,
         jsonb_array_length(contact->'emails') as mails, jsonb_array_length(contact->'phones') as phones
    into got from public.external_offers where org_id = 'cloud-wdc' and source = 'google-jobs' and external_id = 't-auto-1';
  r := r || 'market=' || coalesce(got.market, '—') || ' basis=' || coalesce(got.market_basis, '—') || ' cur=' || coalesce(got.currency, '—')
       || ' apply=' || coalesce(got.apply_url, '—') || ' web=' || coalesce(got.company_url, '—')
       || ' mail=' || coalesce(got.mails, -1) || ' tel=' || coalesce(got.phones, -1) || ' ';

  -- 2) Reingesta: el enlace de candidatura se actualiza; el contacto previo no se pierde si la fuente deja de mandarlo.
  perform public.external_upsert('cloud-wdc', 'google-jobs', jsonb_build_array(jsonb_build_object(
    'external_id', 't-auto-1', 'title', 'Closer high ticket', 'url', 'https://www.linkedin.com/jobs/view/1',
    'apply_url', 'https://acme.com/aplicar', 'market', 'LATAM', 'market_basis', 'moneda_usd', 'currency', 'USD')));
  select apply_url, jsonb_array_length(contact->'emails') as mails into got
    from public.external_offers where org_id = 'cloud-wdc' and source = 'google-jobs' and external_id = 't-auto-1';
  r := r || 'reingesta: apply=' || coalesce(got.apply_url, '—') || ', contact=' || coalesce(got.mails, -1) || ' ';

  -- 3) Guardas: URL que no es http, motivo y mercado fuera de catálogo se rechazan.
  begin
    update public.external_offers set apply_url = 'ftp://x.test/a' where external_id = 't-auto-1';
  exception when check_violation then r := r || 'apply_ftp:' || sqlstate || ' '; end;
  begin
    update public.external_offers set market_basis = 'porque_si' where external_id = 't-auto-1';
  exception when check_violation then r := r || 'basis_malo:' || sqlstate || ' '; end;
  begin
    update public.external_offers set market = 'MARTE' where external_id = 't-auto-1';
  exception when check_violation then r := r || 'market_malo:' || sqlstate || ' '; end;

  -- 4) Reclamo atómico de la aprobación automática: la segunda escritura no encuentra borrador.
  update public.external_offers set editorial_status = 'draft', auto_review = null where external_id = 't-auto-1';
  update public.external_offers set editorial_status = 'approved', reviewed_by = 'auto-reglas',
         auto_review = jsonb_build_object('decision', 'approve', 'why', 'cumple_reglas')
   where org_id = 'cloud-wdc' and editorial_status = 'draft' and external_id = 't-auto-1';
  get diagnostics claimed = row_count;
  r := r || 'claim1=' || claimed || ' ';
  update public.external_offers set editorial_status = 'withdrawn'
   where org_id = 'cloud-wdc' and editorial_status = 'draft' and external_id = 't-auto-1';
  get diagnostics claimed = row_count;
  r := r || 'claim2=' || claimed || ' ';
  select auto_review->>'why' as why into got from public.external_offers where external_id = 't-auto-1';
  r := r || 'auto_review=' || coalesce(got.why, '—');

  raise exception 'TIEMPOS: %', r;
end $$;
