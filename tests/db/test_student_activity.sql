-- Prueba de comportamiento de `student_activity` (sesión 78). No deja datos:
-- todo ocurre dentro de una transacción que termina en ROLLBACK.
-- Uso: ejecutar el archivo completo contra la base (MCP `execute_sql` o psql).
begin;

-- 1) La tabla existe, tiene RLS y nadie del navegador puede leerla.
do $$
begin
  if not exists (select 1 from pg_class where oid = 'public.student_activity'::regclass) then
    raise exception 'falta la tabla student_activity';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.student_activity'::regclass) then
    raise exception 'RLS desactivado en student_activity';
  end if;
  if has_table_privilege('anon', 'public.student_activity', 'select')
     or has_table_privilege('authenticated', 'public.student_activity', 'select')
     or has_table_privilege('anon', 'public.student_activity', 'insert') then
    raise exception 'anon/authenticated conservan privilegios sobre student_activity';
  end if;
end $$;

-- 2) Alta de una alumna de prueba y de una señal válida de cada tipo.
insert into public.students (org_id, email, status, invited_by)
values ('cloud-wdc', 'prueba-actividad@example.test', 'active', 'test');

insert into public.student_activity (org_id, student_id, kind, ref, score, detail)
select 'cloud-wdc', s.id, v.kind, v.ref, v.score, v.detail::jsonb
from public.students s,
  (values
    ('session', null, null, '{}'),
    ('practice', 'entrevista-directa', 72, '{"turns":6}'),
    ('training_review', 'precall', null, '{"met":4,"total":4}'),
    ('training_exam', 'final', 100, '{"correct":6,"total":6,"passed":true}')
  ) as v(kind, ref, score, detail)
where s.email = 'prueba-actividad@example.test';

do $$
begin
  if (select count(*) from public.student_activity a join public.students s on s.id = a.student_id
      where s.email = 'prueba-actividad@example.test') <> 4 then
    raise exception 'no se guardaron las cuatro señales';
  end if;
end $$;

-- 3) Se rechazan tipo desconocido, nota fuera de rango y detalle gigante.
do $$
declare sid uuid;
begin
  select id into sid from public.students where email = 'prueba-actividad@example.test';
  begin
    insert into public.student_activity (student_id, kind) values (sid, 'compra');
    raise exception 'aceptó un tipo desconocido';
  exception when check_violation then null;
  end;
  begin
    insert into public.student_activity (student_id, kind, score) values (sid, 'practice', 101);
    raise exception 'aceptó una nota de 101';
  exception when check_violation then null;
  end;
  begin
    insert into public.student_activity (student_id, kind, detail) values (sid, 'practice', jsonb_build_object('x', repeat('a', 4000)));
    raise exception 'aceptó un detalle de más de 2 KB';
  exception when check_violation then null;
  end;
end $$;

-- 4) La baja de la alumna arrastra su actividad (nada huérfano).
do $$
declare sid uuid; left_count integer;
begin
  select id into sid from public.students where email = 'prueba-actividad@example.test';
  delete from public.students where id = sid;
  select count(*) into left_count from public.student_activity where student_id = sid;
  if left_count <> 0 then raise exception 'quedaron % señales huérfanas', left_count; end if;
end $$;

rollback;
