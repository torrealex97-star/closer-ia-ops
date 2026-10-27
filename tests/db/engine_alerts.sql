-- Prueba de comportamiento de 20261029_engine_alerts.sql. No deja datos: todo va dentro de una transacción
-- que termina en ROLLBACK. Uso: pegar el archivo completo en el SQL Editor de Supabase (o MCP `execute_sql`).
begin;

-- 1) La tabla existe, tiene RLS, el navegador no la alcanza y el índice de lectura reciente está.
do $$ begin
  if to_regclass('public.engine_alerts') is null then raise exception 'FALLO: falta la tabla engine_alerts'; end if;
  if not (select relrowsecurity from pg_class where oid = to_regclass('public.engine_alerts')) then
    raise exception 'FALLO: RLS desactivado en engine_alerts';
  end if;
  if has_table_privilege('anon', 'public.engine_alerts', 'select')
     or has_table_privilege('authenticated', 'public.engine_alerts', 'select')
     or has_table_privilege('authenticated', 'public.engine_alerts', 'insert') then
    raise exception 'FALLO: anon/authenticated conservan privilegios sobre engine_alerts';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'engine_alerts_recent_idx') then
    raise exception 'FALLO: falta el índice engine_alerts_recent_idx';
  end if;
end $$;

-- 2) Una pausa por cuota se guarda con su causa y SIN aviso; el inicio del estado arranca en la comprobación.
insert into public.engine_alerts (status, http_status, detail, checked_by)
values ('allowance', 429, 'En pausa por cuota de hosting (la plataforma responde 429). Sus ofertas no se pierden: se reactiva al reiniciarse la cuota del mes.', 'cron');

do $$ declare rid uuid; begin
  select id into rid from public.engine_alerts order by checked_at desc limit 1;
  if (select notified_at from public.engine_alerts where id = rid) is not null then
    raise exception 'FALLO: la fila nace con aviso enviado';
  end if;
  if (select since from public.engine_alerts where id = rid) <> (select checked_at from public.engine_alerts where id = rid) then
    raise exception 'FALLO: since y checked_at difieren al empezar el estado';
  end if;
end $$;

-- 3) El aviso enviado se anota en la MISMA fila (lo que permite no repetirlo).
do $$ declare rid uuid; begin
  select id into rid from public.engine_alerts order by checked_at desc limit 1;
  update public.engine_alerts set notified_at = now(), notified_kind = 'outage', notified_detail = 'Aviso enviado a owner@test.dev.' where id = rid;
  if (select notified_kind from public.engine_alerts where id = rid) <> 'outage' then
    raise exception 'FALLO: no se anotó el aviso enviado';
  end if;
end $$;

-- 4) Se rechazan estados, motivos, códigos HTTP y textos fuera de lo que el panel sabe leer.
do $$ begin
  begin
    insert into public.engine_alerts (status, detail, checked_by) values ('roto', 'x', 'test');
    raise exception 'FALLO: aceptó un estado desconocido';
  exception when check_violation then null; end;
  begin
    insert into public.engine_alerts (status, detail, checked_by, notified_kind) values ('down', 'x', 'test', 'quizá');
    raise exception 'FALLO: aceptó un motivo de aviso desconocido';
  exception when check_violation then null; end;
  begin
    insert into public.engine_alerts (status, detail, checked_by, http_status) values ('down', 'x', 'test', 99);
    raise exception 'FALLO: aceptó un código HTTP imposible';
  exception when check_violation then null; end;
  begin
    insert into public.engine_alerts (status, detail, checked_by) values ('down', repeat('x', 501), 'test');
    raise exception 'FALLO: aceptó un detalle de más de 500 caracteres';
  exception when check_violation then null; end;
  begin
    insert into public.engine_alerts (status, detail, checked_by, notified_at) values ('down', 'x', 'test', null);
  exception when others then
    raise exception 'FALLO: no aceptó una fila sin aviso'; end;
end $$;

rollback;
