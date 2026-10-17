-- Pruebas de comportamiento (RLS por user_id, CHECK, grants) de student_application_profiles y student_applications.
-- Cada bloque termina con una excepción `TIEMPOS: ...` a propósito (así se deshace todo) y fija un statement_timeout.
-- Ejecutar los 4 bloques por separado (execute_sql tiene un límite de 60 s por llamada). Cualquier fallo de aserción empieza por `FALLO`.
-- Resultado esperado (verificado contra la BD real el 2026-10-17):
--   1) prep: setup en ~35 ms · 2) perfil: sel=1,updB=0,insB:42501,org:42501,mail:23514,cv:23514,ans:23514
--   3) candidaturas: dup:23505,insB:42501,st:23514,url:42501,app=1,delB=0,delA=1
--   4) guardado + anon: anios:23514,auth:23514,save=1,role anon ok,anonP:42501,anonA:42501

-- 1) setup (tiempos)
do $$
declare a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); r text := ''; t0 timestamptz := clock_timestamp();
begin
  set local statement_timeout = '5s';
  insert into public.students(email,status) values ('a2@t.dev','invited'),('b2@t.dev','invited');
  insert into auth.users(id,email,instance_id,aud,role) values (a,'a2@t.dev','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),(b,'b2@t.dev','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
  insert into public.student_application_profiles(user_id,pitch) values (a,'Hola A'),(b,'Hola B');
  insert into public.student_applications(user_id,offer_ref,offer_title,offer_url) values (b,'ext-1','Closer B','https://x.test/1');
  raise exception 'TIEMPOS: % ms', round(extract(milliseconds from clock_timestamp()-t0)::numeric);
end $$;

-- 2) la alumna A solo ve y edita SU formulario; CHECK de email, CV https y objeto en answers
do $$
declare a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); n int; r text := '';
begin
  set local statement_timeout = '5s';
  insert into public.students(email,status) values ('a2@t.dev','invited'),('b2@t.dev','invited');
  insert into auth.users(id,email,instance_id,aud,role) values (a,'a2@t.dev','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),(b,'b2@t.dev','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
  insert into public.student_application_profiles(user_id,pitch) values (a,'Hola A'),(b,'Hola B');
  perform set_config('request.jwt.claims', json_build_object('sub',a,'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from public.student_application_profiles; r := r || 'sel='||n||',';
  update public.student_application_profiles set pitch='robado' where user_id=b; get diagnostics n = row_count; r := r || 'updB='||n||',';
  begin insert into public.student_application_profiles(user_id,pitch) values (b,'x'); exception when others then r := r || 'insB:'||sqlstate||','; end;
  begin update public.student_application_profiles set org_id='otra' where user_id=a; exception when others then r := r || 'org:'||sqlstate||','; end;
  begin update public.student_application_profiles set contact_email='no-es-correo' where user_id=a; exception when others then r := r || 'mail:'||sqlstate||','; end;
  begin update public.student_application_profiles set cv_url='http://x.y' where user_id=a; exception when others then r := r || 'cv:'||sqlstate||','; end;
  begin update public.student_application_profiles set answers='[1]'::jsonb where user_id=a; exception when others then r := r || 'ans:'||sqlstate||','; end;
  raise exception 'TIEMPOS: %', r;
end $$;

-- 3) candidaturas: una por oferta, no suplantar, estado válido, no cambiar la oferta, no tocar las de B
do $$
declare a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); n int; r text := ''; appid uuid;
begin
  set local statement_timeout = '2s';
  insert into public.students(email,status) values ('a2@t.dev','invited'),('b2@t.dev','invited');
  insert into auth.users(id,email,instance_id,aud,role) values (a,'a2@t.dev','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),(b,'b2@t.dev','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
  insert into public.student_applications(user_id,offer_ref,offer_title,offer_url) values (b,'ext-1','Closer B','https://x.test/1');
  perform set_config('request.jwt.claims', json_build_object('sub',a,'role','authenticated')::text, true);
  set local role authenticated;
  insert into public.student_applications(user_id,offer_ref,offer_title,offer_url) values (a,'ext-1','Closer A','https://x.test/1') returning id into appid;
  begin insert into public.student_applications(user_id,offer_ref,offer_title,offer_url) values (a,'ext-1','Dup','https://x.test/1'); exception when others then r := r || 'dup:'||sqlstate||','; end;
  begin insert into public.student_applications(user_id,offer_ref,offer_title,offer_url) values (b,'ext-9','Suplanta','https://x.test/9'); exception when others then r := r || 'insB:'||sqlstate||','; end;
  begin update public.student_applications set status='sent' where id=appid; r := r || 'st ok,'; exception when others then r := r || 'st:'||sqlstate||','; end;
  begin update public.student_applications set offer_url='https://otra.test' where id=appid; r := r || 'url ok,'; exception when others then r := r || 'url:'||sqlstate||','; end;
  update public.student_applications set status='applied', applied_at=now() where id=appid; get diagnostics n = row_count; r := r || 'app='||n||',';
  delete from public.student_applications where user_id=b; get diagnostics n = row_count; r := r || 'delB='||n||',';
  delete from public.student_applications where id=appid; get diagnostics n = row_count; r := r || 'delA='||n||',';
  raise exception 'TIEMPOS: %', r;
end $$;

-- 4) guardado válido de A y anon sin acceso
do $$
declare a uuid := gen_random_uuid(); n int; r text := '';
begin
  set local statement_timeout = '2s';
  insert into public.students(email,status) values ('a2@t.dev','invited');
  insert into auth.users(id,email,instance_id,aud,role) values (a,'a2@t.dev','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
  insert into public.student_application_profiles(user_id,pitch) values (a,'Hola A');
  perform set_config('request.jwt.claims', json_build_object('sub',a,'role','authenticated')::text, true);
  set local role authenticated;
  begin update public.student_application_profiles set years_sales=99 where user_id=a; exception when others then r := r || 'anios:'||sqlstate||','; end;
  begin update public.student_application_profiles set work_authorization='nose' where user_id=a; exception when others then r := r || 'auth:'||sqlstate||','; end;
  update public.student_application_profiles set contact_email='a@t.dev', cv_url='https://drive.google.com/x', years_sales=3, autofill_consent_at=now(), autofill_consent_version='v1-borrador' where user_id=a; get diagnostics n = row_count; r := r || 'save='||n||',';
  perform set_config('request.jwt.claims','{"role":"anon"}', true);
  set local role anon; r := r || 'role anon ok,';
  begin perform 1 from public.student_application_profiles limit 1; exception when others then r := r || 'anonP:'||sqlstate||','; end;
  begin perform 1 from public.student_applications limit 1; exception when others then r := r || 'anonA:'||sqlstate||','; end;
  raise exception 'TIEMPOS: %', r;
end $$;
