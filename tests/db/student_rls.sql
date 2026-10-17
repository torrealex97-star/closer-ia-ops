-- Prueba de RLS y del bloqueo de altas de alumnas. Ejecutar con execute_sql / psql contra el proyecto: TERMINA con una
-- excepción `RLS_OK: ...` a propósito (así se deshace todo). Cualquier otra excepción empieza por `FALLO`.
do $$
declare a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); n int; r text := '';
begin
  begin insert into auth.users(id,email,instance_id,aud,role) values (gen_random_uuid(),'nadie@t.dev','00000000-0000-0000-0000-000000000000','authenticated','authenticated'); raise exception 'FALLO: alta no invitada pasó'; exception when sqlstate 'P0001' then r := r || 'trigger_rechaza_no_invitada,'; end;
  insert into public.students(email,status) values ('a@t.dev','invited'),('b@t.dev','invited'),('p@t.dev','paused');
  insert into auth.users(id,email,instance_id,aud,role) values (a,'a@t.dev','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),(b,'b@t.dev','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
  r := r || 'trigger_admite_invitada,';
  begin insert into auth.users(id,email,instance_id,aud,role) values (gen_random_uuid(),'p@t.dev','00000000-0000-0000-0000-000000000000','authenticated','authenticated'); raise exception 'FALLO: pausada pasó'; exception when sqlstate 'P0001' then r := r || 'trigger_rechaza_pausada,'; end;
  insert into public.student_profiles(user_id,full_name) values (a,'Ana'),(b,'Berta');
  perform set_config('request.jwt.claims', json_build_object('sub',a,'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.student_profiles; if n <> 1 then raise exception 'FALLO: A ve % filas', n; end if; r := r || 'A_ve_solo_la_suya,';
  update public.student_profiles set full_name='Ana2' where user_id=b; get diagnostics n = row_count; if n <> 0 then raise exception 'FALLO: A editó a B'; end if; r := r || 'A_no_edita_a_B,';
  begin insert into public.student_profiles(user_id,full_name) values (b,'x'); raise exception 'FALLO: A insertó como B'; exception when insufficient_privilege or sqlstate '42501' then r := r || 'A_no_inserta_como_B,'; end;
  begin update public.student_profiles set org_id='otra' where user_id=a; raise exception 'FALLO: A cambió org_id'; exception when insufficient_privilege then r := r || 'A_no_cambia_org_id,'; end;
  begin perform 1 from public.students limit 1; raise exception 'FALLO: A leyó students'; exception when insufficient_privilege then r := r || 'A_no_lee_students,'; end;
  begin perform 1 from public.b2b_leads limit 1; raise exception 'FALLO: A leyó b2b_leads'; exception when insufficient_privilege then r := r || 'A_no_lee_b2b,'; end;
  begin update public.student_profiles set video_url='http://x.y' where user_id=a; raise exception 'FALLO: video http'; exception when check_violation then r := r || 'CHECK_video_https,'; end;
  update public.student_profiles set video_url='https://drive.google.com/file/d/1/view' where user_id=a; get diagnostics n = row_count; if n <> 1 then raise exception 'FALLO: A no pudo guardar su vídeo'; end if; r := r || 'A_guarda_su_enlace,';
  perform set_config('request.jwt.claims','{"role":"anon"}', true); set local role anon;
  begin perform 1 from public.student_profiles limit 1; raise exception 'FALLO: anon leyó perfiles'; exception when insufficient_privilege then r := r || 'anon_sin_acceso,'; end;
  raise exception 'RLS_OK: %', r;
end $$;
