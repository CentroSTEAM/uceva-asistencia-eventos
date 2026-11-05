-- =====================================================================
--  Migración 008: la asistencia solo se registra dentro del horario de las
--  actividades (por ejemplo, desde las 2:00 p. m.). Antes o después, la
--  página dice a qué hora abre y no guarda nada. Si no hay actividades
--  creadas, no hay restricción de horario. Se puede ejecutar varias veces.
-- =====================================================================

create or replace function public.en_horario(p_evento_id bigint, p_hora timestamptz)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (select 1 from public.actividades where evento_id = p_evento_id)
      or exists (select 1 from public.actividades where evento_id = p_evento_id
                  and p_hora >= inicio and p_hora < fin)
$$;

create or replace function public.proxima_apertura(p_evento_id bigint, p_hora timestamptz)
returns timestamptz language sql stable security definer set search_path = public as $$
  select min(inicio) from public.actividades where evento_id = p_evento_id and inicio > p_hora
$$;

create or replace function public.estado_asistencia(p_evento text, p_codigo text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_build_object(
      'abierta', e.asistencia_abierta,
      'en_horario', public.en_horario(e.id, now()),
      'abre', public.proxima_apertura(e.id, now()),
      'codigo_valido', (not e.exigir_codigo) or upper(trim(coalesce(p_codigo, ''))) = e.codigo_asistencia,
      'nombre', e.nombre, 'lugar', e.lugar)
    from public.eventos e where e.slug = p_evento and e.activo
  ), jsonb_build_object('abierta', false, 'codigo_valido', false))
$$;

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
          and now() >= inicio - interval '30 minutes' and now() < fin + interval '10 minutes') then
    return jsonb_build_object('estado', 'actividad_invalida');
  end if;
  -- Solo se registra dentro del horario de alguna actividad
  if not public.en_horario(e.id, now()) then
    return jsonb_build_object('estado', 'fuera_de_horario', 'abre', public.proxima_apertura(e.id, now()));
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

  if not public.en_horario(v_evento, v_hora) then
    return jsonb_build_object('estado', 'fuera_de_horario', 'abre', public.proxima_apertura(v_evento, v_hora),
      'nombre', p.nombres || ' ' || p.apellidos, 'documento', p.documento);
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

revoke execute on function public.en_horario(bigint, timestamptz) from public;
revoke execute on function public.proxima_apertura(bigint, timestamptz) from public;
