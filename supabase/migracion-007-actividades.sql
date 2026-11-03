-- =====================================================================
--  Migración 007: actividades con horario dentro del evento.
--  Al registrar asistencia la persona (o el portero) elige la actividad en
--  una lista que solo muestra las vigentes (las que no han terminado). Si no
--  se elige, se asigna la que está en curso. Una persona puede registrar
--  asistencia una vez por actividad. Las actividades se crean y editan desde
--  el panel. Se puede ejecutar varias veces.
-- =====================================================================

create table if not exists public.actividades (
  id         bigint generated always as identity primary key,
  evento_id  bigint not null references public.eventos(id) on delete cascade,
  nombre     text not null,
  inicio     timestamptz not null,
  fin        timestamptz not null,
  lugar      text,
  creado_en  timestamptz not null default now(),
  check (fin > inicio)
);
alter table public.actividades enable row level security;

alter table public.asistencias add column if not exists actividad_id bigint
  references public.actividades(id) on delete set null;

-- Un ingreso por persona y por actividad (antes: uno por evento)
alter table public.asistencias drop constraint if exists asistencias_evento_id_persona_id_key;
create unique index if not exists asistencias_unica_actividad
  on public.asistencias (evento_id, persona_id, (coalesce(actividad_id, 0)));

-- Actividades iniciales del Día de la Inclusión 2026 (solo si no hay ninguna)
insert into public.actividades (evento_id, nombre, inicio, fin, lugar)
select e.id, x.nombre, x.inicio, x.fin, x.lugar
  from public.eventos e,
       (values ('Bazar de emprendimientos inclusivos', timestamptz '2026-11-05 16:00-05', timestamptz '2026-11-05 19:00-05',
                'Exterior del Coliseo Cerrado Carlos María Lozano'),
               ('IV Noche de Inclusión: pasarela central', timestamptz '2026-11-05 19:00-05', timestamptz '2026-11-05 23:59-05',
                'Coliseo Cerrado Carlos María Lozano')) as x(nombre, inicio, fin, lugar)
 where e.slug = 'noche-inclusion-2026'
   and not exists (select 1 from public.actividades a where a.evento_id = e.id);

-- Actividad que corresponde a una hora: la que está en curso; si no hay,
-- la próxima en empezar; si ya terminaron todas, la última.
create or replace function public.actividad_para(p_evento_id bigint, p_hora timestamptz)
returns bigint language sql stable security definer set search_path = public as $$
  select coalesce(
    (select id from public.actividades where evento_id = p_evento_id and p_hora >= inicio and p_hora < fin order by inicio desc limit 1),
    (select id from public.actividades where evento_id = p_evento_id and inicio > p_hora order by inicio limit 1),
    (select id from public.actividades where evento_id = p_evento_id order by fin desc limit 1)
  )
$$;

-- Actividades que aún no terminan (para la lista desplegable de registro)
create or replace function public.actividades_vigentes(p_evento text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'nombre', a.nombre, 'inicio', a.inicio, 'fin', a.fin, 'lugar', a.lugar,
           'en_curso', now() >= a.inicio and now() < a.fin) order by a.inicio), '[]'::jsonb)
    from public.actividades a
   where a.evento_id = public.evento_id(p_evento) and a.fin > now()
$$;

-- Valida la actividad elegida; si no se eligió, usa la que corresponde a la hora
create or replace function public.actividad_elegida(p_evento_id bigint, p_actividad bigint, p_hora timestamptz)
returns bigint language plpgsql stable security definer set search_path = public as $$
begin
  if p_actividad is null then
    return public.actividad_para(p_evento_id, p_hora);
  end if;
  if not exists (select 1 from public.actividades where id = p_actividad and evento_id = p_evento_id) then
    raise exception 'La actividad elegida no existe.' using errcode = 'P0001';
  end if;
  return p_actividad;
end $$;

create or replace function public.listar_actividades(p_evento text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_evento bigint := public.evento_id(p_evento);
begin
  if not public.es_staff() then
    raise exception 'No tienes permiso.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'nombre', a.nombre, 'inicio', a.inicio, 'fin', a.fin, 'lugar', a.lugar,
      'en_curso', a.id = public.actividad_para(v_evento, now()) and now() >= a.inicio and now() < a.fin,
      'actual', a.id = public.actividad_para(v_evento, now()),
      'ingresos', (select count(*) from public.asistencias s where s.actividad_id = a.id)
    ) order by a.inicio)
    from public.actividades a where a.evento_id = v_evento
  ), '[]'::jsonb);
end $$;

create or replace function public.guardar_actividad(p_evento text, p_id bigint, p_nombre text,
                                                    p_inicio timestamptz, p_fin timestamptz, p_lugar text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_evento bigint := public.evento_id(p_evento); v_id bigint;
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede editar las actividades.' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_nombre, ''))) < 3 then
    raise exception 'Escribe el nombre de la actividad.' using errcode = 'P0001';
  end if;
  if p_inicio is null or p_fin is null or p_fin <= p_inicio then
    raise exception 'La hora de fin debe ser posterior a la de inicio.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.actividades
              where evento_id = v_evento and id is distinct from p_id
                and p_inicio < fin and p_fin > inicio) then
    raise exception 'Ese horario se cruza con otra actividad.' using errcode = 'P0001';
  end if;
  if p_id is null then
    insert into public.actividades (evento_id, nombre, inicio, fin, lugar)
    values (v_evento, trim(p_nombre), p_inicio, p_fin, nullif(trim(coalesce(p_lugar, '')), ''))
    returning id into v_id;
  else
    update public.actividades set nombre = trim(p_nombre), inicio = p_inicio, fin = p_fin,
           lugar = nullif(trim(coalesce(p_lugar, '')), '')
     where id = p_id and evento_id = v_evento returning id into v_id;
    if v_id is null then
      raise exception 'Esa actividad no existe.' using errcode = 'P0001';
    end if;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.borrar_actividad(p_id bigint)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede borrar actividades.' using errcode = '42501';
  end if;
  if exists (select 1 from public.asistencias where actividad_id = p_id) then
    raise exception 'Esa actividad ya tiene ingresos registrados; no se puede borrar.' using errcode = 'P0001';
  end if;
  delete from public.actividades where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- Registro de ingresos con actividad ----------

drop function if exists public.registrar_asistencia(text, text, text);
create or replace function public.registrar_asistencia(p_evento text, p_codigo text, p_documento text,
                                                       p_actividad bigint default null)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  e public.eventos;
  p public.personas;
  a public.asistencias;
  v_act bigint;
  v_act_nombre text;
begin
  select * into e from public.eventos where slug = p_evento and activo;
  if e.id is null then
    return jsonb_build_object('estado', 'sin_evento');
  end if;
  if e.exigir_codigo and upper(trim(coalesce(p_codigo, ''))) <> e.codigo_asistencia then
    return jsonb_build_object('estado', 'codigo_invalido');
  end if;
  if not e.asistencia_abierta then
    return jsonb_build_object('estado', 'cerrado');
  end if;

  select * into p from public.personas where documento = public.normalizar_doc(p_documento);
  if p.id is null then
    return jsonb_build_object('estado', 'no_encontrado');
  end if;

  if p_actividad is not null and not exists (
       select 1 from public.actividades where id = p_actividad and evento_id = e.id
          and fin > now() - interval '30 minutes') then
    return jsonb_build_object('estado', 'actividad_invalida');
  end if;
  v_act := public.actividad_elegida(e.id, p_actividad, now());
  select nombre into v_act_nombre from public.actividades where id = v_act;

  insert into public.asistencias (evento_id, persona_id, metodo, punto, actividad_id)
  values (e.id, p.id, 'autoregistro', 'Celular (autoregistro)', v_act)
  on conflict (evento_id, persona_id, (coalesce(actividad_id, 0))) do nothing
  returning * into a;

  if a.id is null then
    select * into a from public.asistencias
     where evento_id = e.id and persona_id = p.id and coalesce(actividad_id, 0) = coalesce(v_act, 0);
    return jsonb_build_object('estado', 'repetido',
      'nombre', public.nombre_publico(p.nombres, p.apellidos),
      'tipo_asistente', p.tipo_asistente, 'hora', a.registrado_en, 'actividad', v_act_nombre);
  end if;

  return jsonb_build_object('estado', 'ok',
    'nombre', public.nombre_publico(p.nombres, p.apellidos),
    'tipo_asistente', p.tipo_asistente, 'hora', a.registrado_en, 'actividad', v_act_nombre);
end $$;

drop function if exists public.registrar_ingreso(text, text, text, text, timestamptz, boolean);
create or replace function public.registrar_ingreso(
  p_evento    text,
  p_token     text default null,
  p_documento text default null,
  p_punto     text default null,
  p_hora      timestamptz default null,
  p_sin_conexion boolean default false,
  p_actividad bigint default null
) returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_evento bigint;
  p public.personas;
  a public.asistencias;
  v_token text := upper(regexp_replace(coalesce(p_token,''), '^UCV:', '', 'i'));
  v_hora timestamptz := coalesce(p_hora, now());
  v_act bigint;
  v_act_nombre text;
begin
  if not public.es_staff() then
    raise exception 'No tienes permiso para registrar ingresos.' using errcode = '42501';
  end if;

  v_evento := public.evento_id(p_evento);
  if v_evento is null then
    raise exception 'El evento no existe o no está activo.' using errcode = 'P0001';
  end if;

  if v_token <> '' then
    select * into p from public.personas where token = v_token;
  elsif coalesce(p_documento,'') <> '' then
    select * into p from public.personas where documento = public.normalizar_doc(p_documento);
  end if;

  if p.id is null then
    return jsonb_build_object('estado', 'no_encontrado');
  end if;

  v_act := public.actividad_elegida(v_evento, p_actividad, v_hora);
  select nombre into v_act_nombre from public.actividades where id = v_act;

  insert into public.asistencias (evento_id, persona_id, punto, metodo, registrado_por,
                                  registrado_en, sin_conexion, actividad_id)
  values (v_evento, p.id, p_punto,
          case when v_token <> '' then 'qr' else 'documento' end,
          auth.uid(), v_hora, coalesce(p_sin_conexion, false), v_act)
  on conflict (evento_id, persona_id, (coalesce(actividad_id, 0))) do nothing
  returning * into a;

  if a.id is null then
    select * into a from public.asistencias
     where evento_id = v_evento and persona_id = p.id and coalesce(actividad_id, 0) = coalesce(v_act, 0);
    return jsonb_build_object(
      'estado', 'repetido',
      'nombre', p.nombres || ' ' || p.apellidos,
      'tipo_asistente', p.tipo_asistente,
      'dependencia', coalesce(p.dependencia, p.entidad),
      'documento', p.documento,
      'origen', p.origen,
      'hora_previa', a.registrado_en,
      'punto_previo', a.punto,
      'actividad', v_act_nombre
    );
  end if;

  return jsonb_build_object(
    'estado', 'ok',
    'nombre', p.nombres || ' ' || p.apellidos,
    'tipo_asistente', p.tipo_asistente,
    'dependencia', coalesce(p.dependencia, p.entidad),
    'documento', p.documento,
    'origen', p.origen,
    'hora', a.registrado_en,
    'actividad', v_act_nombre
  );
end $$;

create or replace function public.registrar_ingresos_lote(p_evento text, p_lote jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  item jsonb;
  r jsonb;
  resultados jsonb := '[]'::jsonb;
begin
  if not public.es_staff() then
    raise exception 'No tienes permiso para registrar ingresos.' using errcode = '42501';
  end if;
  for item in select * from jsonb_array_elements(p_lote) loop
    begin
      r := public.registrar_ingreso(
        p_evento, item->>'token', item->>'documento', item->>'punto',
        (item->>'hora')::timestamptz, true, nullif(item->>'actividad', '')::bigint);
    exception when others then
      r := jsonb_build_object('estado', 'error', 'error', sqlerrm);
    end;
    resultados := resultados || jsonb_build_array(r || jsonb_build_object('id_local', item->'id_local'));
  end loop;
  return resultados;
end $$;

-- ---------- Consultas que cruzan personas con ingresos ----------
-- (ahora un ingreso por actividad: se cruza con la actividad actual)

create or replace function public.descargar_padron(p_evento text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_evento bigint := public.evento_id(p_evento);
  v_act bigint := public.actividad_para(v_evento, now());
begin
  if not public.es_staff() then
    raise exception 'No tienes permiso.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_array(
      p.token, p.documento, p.nombres || ' ' || p.apellidos, p.tipo_asistente,
      coalesce(p.dependencia, p.entidad), a.registrado_en, p.origen))
    from public.personas p
    left join public.asistencias a on a.persona_id = p.id and a.evento_id = v_evento
                                  and coalesce(a.actividad_id, 0) = coalesce(v_act, 0)
  ), '[]'::jsonb);
end $$;

create or replace function public.buscar_personas(p_evento text, p_texto text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_evento bigint := public.evento_id(p_evento);
  v_act bigint := public.actividad_para(v_evento, now());
  v_doc text := public.normalizar_doc(p_texto);
  v_txt text := trim(coalesce(p_texto,''));
begin
  if not public.es_staff() then
    raise exception 'No tienes permiso.' using errcode = '42501';
  end if;
  if length(v_txt) < 3 then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(x) from (
      select jsonb_build_object(
        'documento', p.documento,
        'nombre', p.nombres || ' ' || p.apellidos,
        'tipo_asistente', p.tipo_asistente,
        'dependencia', coalesce(p.dependencia, p.entidad),
        'ingreso', a.registrado_en
      ) as x
      from public.personas p
      left join public.asistencias a on a.persona_id = p.id and a.evento_id = v_evento
                                    and coalesce(a.actividad_id, 0) = coalesce(v_act, 0)
      where (v_doc <> '' and p.documento like v_doc || '%')
         or (p.nombres || ' ' || p.apellidos) ilike '%' || v_txt || '%'
      order by p.apellidos, p.nombres
      limit 12
    ) t
  ), '[]'::jsonb);
end $$;

create or replace function public.estadisticas(p_evento text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_evento bigint := public.evento_id(p_evento);
begin
  if not public.es_staff() then
    raise exception 'No tienes permiso.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'ingresos',  (select count(distinct persona_id) from public.asistencias where evento_id = v_evento),
    'registros', (select count(*) from public.asistencias where evento_id = v_evento),
    'base',      (select count(*) from public.personas),
    'externos_registrados', (select count(*) from public.personas where origen = 'registro' and tipo_asistente = 'externo'),
    'uceva_autorregistro',  (select count(*) from public.personas where origen = 'registro' and tipo_asistente <> 'externo'),
    'ultimos_15_min', (select count(*) from public.asistencias
                       where evento_id = v_evento and registrado_en > now() - interval '15 minutes'),
    'por_actividad', coalesce((
      select jsonb_object_agg(nombre, n) from (
        select coalesce(ac.nombre, 'Sin actividad') nombre, count(*) n
        from public.asistencias a left join public.actividades ac on ac.id = a.actividad_id
        where a.evento_id = v_evento group by 1) t), '{}'::jsonb),
    'por_tipo', coalesce((
      select jsonb_object_agg(tipo_asistente, n) from (
        select p.tipo_asistente, count(distinct p.id) n
        from public.asistencias a join public.personas p on p.id = a.persona_id
        where a.evento_id = v_evento group by 1) t), '{}'::jsonb),
    'por_punto', coalesce((
      select jsonb_object_agg(coalesce(punto,'Sin punto'), n) from (
        select punto, count(*) n from public.asistencias
        where evento_id = v_evento group by 1) t), '{}'::jsonb),
    'por_hora', coalesce((
      select jsonb_agg(jsonb_build_object('hora', h, 'n', n) order by h) from (
        select date_trunc('hour', registrado_en) +
               floor(extract(minute from registrado_en) / 15) * interval '15 minutes' h,
               count(*) n
        from public.asistencias where evento_id = v_evento group by 1) t), '[]'::jsonb)
  );
end $$;

create or replace function public.exportar_asistencia(p_evento text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_evento bigint := public.evento_id(p_evento);
begin
  if not public.puede_consultar() then
    raise exception 'No tienes permiso para descargar listados.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'hora_ingreso', a.registrado_en, 'actividad', ac.nombre, 'punto', a.punto, 'metodo', a.metodo,
      'sin_conexion', a.sin_conexion,
      'tipo_documento', p.tipo_documento, 'documento', p.documento, 'nombres', p.nombres, 'apellidos', p.apellidos,
      'tipo_asistente', p.tipo_asistente, 'dependencia', p.dependencia, 'entidad', p.entidad,
      'correo', p.correo, 'celular', p.celular, 'origen', p.origen,
      'poblacion', array_to_string(p.poblacion, '; ')
    ) order by a.registrado_en)
    from public.asistencias a
    join public.personas p on p.id = a.persona_id
    left join public.actividades ac on ac.id = a.actividad_id
    where a.evento_id = v_evento
  ), '[]'::jsonb);
end $$;

create or replace function public.exportar_personas(p_evento text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_evento bigint := public.evento_id(p_evento);
begin
  if not public.puede_consultar() then
    raise exception 'No tienes permiso para descargar listados.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'tipo_documento', p.tipo_documento, 'documento', p.documento, 'nombres', p.nombres, 'apellidos', p.apellidos,
      'tipo_asistente', p.tipo_asistente, 'dependencia', p.dependencia, 'entidad', p.entidad,
      'correo', p.correo, 'celular', p.celular, 'origen', p.origen, 'inscrito_en', p.creado_en,
      'asistio', r.n > 0, 'hora_ingreso', r.primera, 'actividades', r.actividades,
      'poblacion', array_to_string(p.poblacion, '; '),
      'datos_actualizados_en', p.datos_actualizados_en
    ) order by p.apellidos, p.nombres)
    from public.personas p
    left join lateral (
      select count(*) n, min(a.registrado_en) primera,
             string_agg(coalesce(ac.nombre, 'Sin actividad'), '; ' order by a.registrado_en) actividades
        from public.asistencias a left join public.actividades ac on ac.id = a.actividad_id
       where a.persona_id = p.id and a.evento_id = v_evento
    ) r on true
  ), '[]'::jsonb);
end $$;

revoke execute on function public.actividad_para(bigint, timestamptz) from public;
revoke execute on function public.actividad_elegida(bigint, bigint, timestamptz) from public;
revoke execute on function public.registrar_asistencia(text, text, text, bigint) from public;
revoke execute on function public.registrar_ingreso(text, text, text, text, timestamptz, boolean, bigint) from public;
grant execute on function public.actividades_vigentes(text) to anon, authenticated;
grant execute on function public.registrar_asistencia(text, text, text, bigint) to anon, authenticated;
grant execute on function public.registrar_ingreso(text, text, text, text, timestamptz, boolean, bigint) to authenticated;
grant execute on function public.registrar_ingresos_lote(text, jsonb) to authenticated;
revoke execute on function public.listar_actividades(text) from public;
revoke execute on function public.guardar_actividad(text, bigint, text, timestamptz, timestamptz, text) from public;
revoke execute on function public.borrar_actividad(bigint) from public;
grant execute on function public.listar_actividades(text) to authenticated;
grant execute on function public.guardar_actividad(text, bigint, text, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.borrar_actividad(bigint) to authenticated;
