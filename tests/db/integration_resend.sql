-- Prueba de comportamiento de 20261026_integration_resend.sql y 20261028_voice_consent_student_index.sql (con rollback; no deja datos).
-- Ejecutar completo en el SQL Editor de Supabase. NO EJECUTADA todavía (la confirmación del propietario está pendiente).
begin;
  do $$ begin
    -- el CHECK de proveedores admite resend y sigue rechazando otros
    insert into public.integration_connections (provider, secret_ciphertext, last4, updated_by) values ('resend', 'x.y.z', '1234', 'test');
    begin insert into public.integration_connections (provider, secret_ciphertext, last4, updated_by) values ('inventado', 'x.y.z', '1234', 'test'); raise exception 'FALLO: proveedor inventado aceptado';
    exception when check_violation then null; end;
    -- el índice de cobertura existe
    if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'student_voice_consent_student_idx') then raise exception 'FALLO: falta student_voice_consent_student_idx'; end if;
  end $$;
rollback;
