-- Aplicada en Supabase (proyecto closer-ia-ops) como `revoke_public_grants_b2b_weekly`.
-- Solo la service role (servidor) accede a estas tablas; anon/authenticated no deben tener privilegios
-- (hasta ahora la única barrera era RLS sin políticas).
revoke all on table public.b2b_leads from anon, authenticated;
revoke all on table public.weekly_reports from anon, authenticated;
