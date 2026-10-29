-- =====================================================================
--  Migración 004: gestión del personal desde el panel y rol "consulta"
--
--  Roles:
--    portero  escanea pases y busca personas por cédula
--    consulta ve estadísticas y descarga listados
--    admin    todo, incluida la gestión del personal
--
--  Crear o borrar cuentas lo hace la Edge Function "personal"
--  (supabase/functions/personal/index.ts). Aquí quedan los permisos,
--  el listado y el cambio de rol. Se puede ejecutar varias veces.
-- =====================================================================

alter table public.staff drop constraint if exists staff_rol_check;
alter table public.staff add constraint staff_rol_check check (rol in ('portero', 'consulta', 'admin'));

-- Si se borra la cuenta de un portero, sus registros de ingreso se conservan
alter table public.asistencias drop constraint if exists asistencias_registrado_por_fkey;
alter table public.asistencias add constraint asistencias_registrado_por_fkey
  foreign key (registrado_por) references auth.users(id) on delete set null;

create or replace function public.puede_consultar()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where user_id = auth.uid() and rol in ('admin', 'consulta'))
$$;

-- Listado de asistentes (ahora también para el rol consulta)
create or replace function public.exportar_asistencia(p_evento text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_evento bigint := public.evento_id(p_evento);
begin
  if not public.puede_consultar() then
    raise exception 'No tienes permiso para descargar listados.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'hora_ingreso', a.registrado_en,
      'punto', a.punto,
      'metodo', a.metodo,
      'sin_conexion', a.sin_conexion,
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
      'poblacion', array_to_string(p.poblacion, '; ')
    ) order by a.registrado_en)
    from public.asistencias a join public.personas p on p.id = a.persona_id
    where a.evento_id = v_evento
  ), '[]'::jsonb);
end $$;

-- Todas las personas inscritas, hayan asistido o no
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
      'poblacion', array_to_string(p.poblacion, '; ')
    ) order by p.apellidos, p.nombres)
    from public.personas p
    left join public.asistencias a on a.persona_id = p.id and a.evento_id = v_evento
  ), '[]'::jsonb);
end $$;

-- Personal con acceso (solo administradores)
create or replace function public.listar_personal()
returns jsonb language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede ver el personal.' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_id', s.user_id,
      'nombre', s.nombre,
      'correo', u.email,
      'rol', s.rol,
      'creado_en', s.creado_en,
      'ultimo_ingreso', u.last_sign_in_at,
      'soy_yo', s.user_id = auth.uid()
    ) order by case s.rol when 'admin' then 0 when 'consulta' then 1 else 2 end, s.nombre)
    from public.staff s join auth.users u on u.id = s.user_id
  ), '[]'::jsonb);
end $$;

create or replace function public.cambiar_rol(p_user_id uuid, p_rol text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede cambiar roles.' using errcode = '42501';
  end if;
  if p_rol not in ('portero', 'consulta', 'admin') then
    raise exception 'Rol no válido.' using errcode = 'P0001';
  end if;
  if p_user_id = auth.uid() and p_rol <> 'admin' then
    raise exception 'No puedes quitarte a ti mismo el rol de administrador.' using errcode = 'P0001';
  end if;
  update public.staff set rol = p_rol where user_id = p_user_id;
  if not found then
    raise exception 'Esa persona no está en el personal.' using errcode = 'P0001';
  end if;
  return jsonb_build_object('ok', true);
end $$;

revoke execute on function public.puede_consultar() from public;
revoke execute on function public.exportar_personas(text) from public;
revoke execute on function public.listar_personal() from public;
revoke execute on function public.cambiar_rol(uuid, text) from public;
grant execute on function public.exportar_personas(text)   to authenticated;
grant execute on function public.listar_personal()         to authenticated;
grant execute on function public.cambiar_rol(uuid, text)   to authenticated;
grant execute on function public.exportar_asistencia(text) to authenticated;
