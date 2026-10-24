-- Prueba de comportamiento de `student_activity` (migración 20261024_student_activity.sql, NO aplicada todavía).
-- Ejecutar con execute_sql / psql SOLO tras aplicar la migración: TERMINA con una excepción `ACTIVIDAD_OK: ...` a propósito
-- (así se deshace todo, como ROLLBACK). Cualquier otra excepción empieza por `FALLO`.
do $$
declare s uuid; n int; r text := '';
begin
  insert into public.students(email,status) values ('act@t.dev','active') returning id into s;
  insert into public.student_activity(student_id,kind,ref,score,detail) values (s,'session',null,null,'{}');
  insert into public.student_activity(student_id,kind,ref,score,detail) values (s,'training_exam','final',100,'{"correct":6,"total":6,"passed":true}');
  r := r || 'inserta_validas,';
  begin insert into public.student_activity(student_id,kind) values (s,'hackeo'); raise exception 'FALLO: kind inválido pasó'; exception when check_violation then r := r || 'rechaza_kind,'; end;
  begin insert into public.student_activity(student_id,kind,score) values (s,'practice',101); raise exception 'FALLO: score 101 pasó'; exception when check_violation then r := r || 'rechaza_score,'; end;
  begin insert into public.student_activity(student_id,kind,detail) values (s,'practice','[1]'); raise exception 'FALLO: detail no objeto pasó'; exception when check_violation then r := r || 'rechaza_detail,'; end;
  begin insert into public.student_activity(student_id,kind) values (gen_random_uuid(),'session'); raise exception 'FALLO: alumna inexistente pasó'; exception when foreign_key_violation then r := r || 'exige_alumna,'; end;
  -- Un rol de cliente no lee ni escribe (RLS sin políticas + revoke).
  set local role authenticated;
  begin perform 1 from public.student_activity; raise exception 'FALLO: authenticated pudo leer'; exception when insufficient_privilege then r := r || 'authenticated_sin_acceso,'; end;
  reset role;
  -- Baja de la alumna borra su actividad.
  delete from public.students where id = s;
  select count(*) into n from public.student_activity where student_id = s;
  if n <> 0 then raise exception 'FALLO: la baja no borró la actividad (%)', n; end if;
  r := r || 'cascade_baja,';
  raise exception 'ACTIVIDAD_OK: %', r;
end $$;
