-- =====================================================================
--  Migración 005: cada persona puede actualizar sus datos de inclusión
--  (grupo poblacional o comunidad) y su celular, y el listado de
--  inscritos lo trae con la fecha de actualización. Se puede ejecutar
--  varias veces.
-- =====================================================================

alter table public.personas add column if not exists datos_actualizados_en timestamptz;

create or replace function public.actualizar_datos(
  p_documento              text,
  p_celular                text,
  p_poblacion              text[],
  p_acepta_tratamiento     boolean,
  p_acepta_datos_sensibles boolean
) returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_doc  text := public.normalizar_doc(p_documento);
  v_id   uuid;
  v_cel  text := nullif(regexp_replace(coalesce(p_celular, ''), '\D', '', 'g'), '');
  v_pob  text[];
begin
  if not coalesce(p_acepta_tratamiento, false) then
    raise exception 'Para actualizar tus datos debes autorizar su tratamiento.' using errcode = 'P0001';
  end if;
  select id into v_id from public.personas where documento = v_doc;
  if v_id is null then
    raise exception 'No encontramos ese documento.' using errcode = 'P0001';
  end if;
  if v_cel is not null and length(v_cel) not between 7 and 15 then
    raise exception 'El número de celular no es válido.' using errcode = 'P0001';
  end if;
  if coalesce(p_acepta_datos_sensibles, false) then
    select array_agg(distinct left(trim(x), 80)) into v_pob
      from unnest(coalesce(p_poblacion, '{}')) as x
     where trim(x) <> '';
    if coalesce(array_length(v_pob, 1), 0) > 12 then
      raise exception 'Demasiadas opciones seleccionadas.' using errcode = 'P0001';
    end if;
  end if;

  update public.personas set
    celular                = coalesce(v_cel, celular),
    poblacion              = case when coalesce(p_acepta_datos_sensibles, false) then v_pob else poblacion end,
    acepta_datos_sensibles = case when coalesce(p_acepta_datos_sensibles, false) then true else acepta_datos_sensibles end,
    acepta_tratamiento     = true,
    datos_actualizados_en  = now(),
    actualizado_en         = now()
  where id = v_id;

  return jsonb_build_object('ok', true);
end $$;

-- Listado de inscritos con la fecha en que la persona actualizó sus datos
create or replace function public.exportar_personas(p_evento text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_evento bigint := public.evento_id(p_evento);
begin
  if not public.puede_consultar() then
    raise exception 'No tienes permiso para descargar listados.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'tipo_documento', p.tipo_documento,
      'documento', p.documento,
      'nombres', p.nombres,
      'apellidos', p.apellidos,
      'tipo_asistente', p.tipo_asistente,
      'dependencia', p.dependencia,
      'entidad', p.entidad,
      'correo', p.correo,
      'celular', p.celular,
      'origen', p.origen,
      'inscrito_en', p.creado_en,
      'asistio', a.id is not null,
      'hora_ingreso', a.registrado_en,
      'poblacion', array_to_string(p.poblacion, '; '),
      'datos_actualizados_en', p.datos_actualizados_en
    ) order by p.apellidos, p.nombres)
    from public.personas p
    left join public.asistencias a on a.persona_id = p.id and a.evento_id = v_evento
  ), '[]'::jsonb);
end $$;

revoke execute on function public.actualizar_datos(text, text, text[], boolean, boolean) from public;
grant execute on function public.actualizar_datos(text, text, text[], boolean, boolean) to anon, authenticated;

-- =====================================================================
--  Migración 006: mantenimiento desde el panel (solo administradores).
--  Incluye la 005, así que basta con ejecutar este archivo.
-- =====================================================================

create or replace function public.resumen_datos(p_evento text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_evento bigint := public.evento_id(p_evento);
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede ver este resumen.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'institucionales', (select count(*) from public.personas where origen = 'institucional'),
    'autorregistros',  (select count(*) from public.personas where origen = 'registro'),
    'actualizaron',    (select count(*) from public.personas where datos_actualizados_en is not null),
    'asistencias',     (select count(*) from public.asistencias where evento_id = v_evento)
  );
end $$;

create or replace function public.limpiar_datos(p_evento text, p_que text, p_confirmacion text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_evento bigint := public.evento_id(p_evento);
  v_n int := 0;
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede borrar datos.' using errcode = '42501';
  end if;
  if coalesce(p_confirmacion, '') <> 'BORRAR' then
    raise exception 'Escribe BORRAR para confirmar.' using errcode = 'P0001';
  end if;
  if p_que = 'asistencias' then
    delete from public.asistencias where evento_id = v_evento;
    get diagnostics v_n = row_count;
  elsif p_que = 'autorregistros' then
    delete from public.personas where origen = 'registro';
    get diagnostics v_n = row_count;
  elsif p_que = 'actualizaciones' then
    update public.personas
       set poblacion = null, acepta_datos_sensibles = false, datos_actualizados_en = null
     where origen = 'institucional' and (poblacion is not null or datos_actualizados_en is not null);
    get diagnostics v_n = row_count;
  else
    raise exception 'Opción no válida.' using errcode = 'P0001';
  end if;
  return jsonb_build_object('ok', true, 'afectados', v_n);
end $$;

revoke execute on function public.resumen_datos(text) from public;
revoke execute on function public.limpiar_datos(text, text, text) from public;
grant execute on function public.resumen_datos(text) to authenticated;
grant execute on function public.limpiar_datos(text, text, text) to authenticated;
