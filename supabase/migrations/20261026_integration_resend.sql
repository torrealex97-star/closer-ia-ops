-- NO APLICADA en Supabase (aplicar DDL exige orden expresa del propietario). Aditiva y reversible.
-- Permite guardar la clave de Resend (correo) en la pestaña APIs. Solo amplía el CHECK de proveedores; no activa ningún envío.
-- Reversión: borrar la fila de 'resend' y volver al CHECK de siete proveedores.
alter table public.integration_connections drop constraint if exists integration_connections_provider_check;
alter table public.integration_connections add constraint integration_connections_provider_check
  check (provider in ('apify', 'serpapi', 'groq', 'openai', 'adzuna', 'jooble', 'infojobs', 'resend'));
