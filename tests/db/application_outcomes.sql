-- Prueba de comportamiento de 20261025_application_outcomes.sql (NO aplicada todavía). Ejecutar con execute_sql / psql SOLO tras
-- aplicarla: TERMINA con una excepción `RESULTADOS_OK: ...` a propósito (se deshace todo). Cualquier otra empieza por `FALLO`.
do $$
declare u uuid := gen_random_uuid(); r text := '';
begin
  insert into auth.users(id,email,instance_id,aud,role) values (u,'res@t.dev','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
  insert into public.student_applications(user_id,offer_ref,offer_title,offer_url,status) values
    (u,'ext-1','Closer','https://jobs.example.com/1','applied'), (u,'ext-2','Closer 2','https://jobs.example.com/2','responded'),
    (u,'ext-3','Closer 3','https://jobs.example.com/3','interview'), (u,'ext-4','Closer 4','https://jobs.example.com/4','offer'),
    (u,'ext-5','Closer 5','https://jobs.example.com/5','rejected');
  r := r || 'acepta_estados_nuevos,';
  begin insert into public.student_applications(user_id,offer_ref,offer_title,offer_url,status) values (u,'ext-6','x','https://jobs.example.com/6','contratada'); raise exception 'FALLO: estado inventado pasó'; exception when check_violation then r := r || 'rechaza_estado_desconocido,'; end;
  update public.student_applications set status = 'discarded' where user_id = u and offer_ref = 'ext-1';
  r := r || 'sigue_aceptando_los_antiguos,';
  raise exception 'RESULTADOS_OK: %', r;
end $$;
