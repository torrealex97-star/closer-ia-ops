-- NO EJECUTADA. Prueba de comportamiento de student_voice_consent (con rollback). Ejecutar solo tras aplicar 20261027_voice_consent.sql.
begin;
  -- RLS activada y sin acceso para anon/authenticated
  do $$ begin
    if not (select relrowsecurity from pg_class where oid = 'public.student_voice_consent'::regclass) then raise exception 'RLS no activada'; end if;
    if has_table_privilege('anon', 'public.student_voice_consent', 'select') or has_table_privilege('authenticated', 'public.student_voice_consent', 'select') then raise exception 'anon/authenticated no deben leer'; end if;
  end $$;
  -- una fila por alumna; versión obligatoria; borrar la alumna borra su consentimiento
  insert into public.students (id, org_id, email, status) values ('00000000-0000-4000-8000-0000000000aa', 'test-org', 'voz@test.dev', 'active');
  insert into public.student_voice_consent (org_id, student_id, version) values ('test-org', '00000000-0000-4000-8000-0000000000aa', 'v1-borrador');
  do $$ begin
    begin insert into public.student_voice_consent (org_id, student_id, version) values ('test-org', '00000000-0000-4000-8000-0000000000aa', 'v2'); raise exception 'duplicado aceptado';
    exception when unique_violation then null; end;
    begin insert into public.student_voice_consent (org_id, student_id, version) values ('test-org', '00000000-0000-4000-8000-0000000000ab', ''); raise exception 'versión vacía aceptada';
    exception when check_violation or foreign_key_violation then null; end;
  end $$;
  delete from public.students where id = '00000000-0000-4000-8000-0000000000aa';
  do $$ begin if exists (select 1 from public.student_voice_consent where student_id = '00000000-0000-4000-8000-0000000000aa') then raise exception 'el consentimiento debía borrarse con la alumna'; end if; end $$;
rollback;
