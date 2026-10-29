-- =====================================================================
--  Migración 002: cada persona registra su propia asistencia
--
--  En la entrada del evento hay un cartel con un QR que abre asistir.html
--  con el código del evento. La persona escribe su documento y su
--  asistencia queda guardada. El administrador abre y cierra el registro
--  desde el panel, y puede cambiar el código si se filtra.
--
--  Se puede ejecutar varias veces sin perder datos.
-- =====================================================================

alter table public.eventos add column if not exists codigo_asistencia text;
alter table public.eventos add column if not exists asistencia_abierta boolean not null default false;
update public.eventos set codigo_asistencia = public.generar_token() where codigo_asistencia is null;

alter table public.asistencias drop constraint if exists asistencias_metodo_check;
alter table public.asistencias add constraint asistencias_metodo_check
  check (metodo in ('qr', 'documento', 'autoregistro'));

-- Estado del registro de asistencia, para la página que abre el cartel.
create or replace function public.estado_asistencia(p_evento text, p_codigo text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_build_object(
      'abierta', e.asistencia_abierta,
      'codigo_valido', upper(trim(coalesce(p_codigo, ''))) = e.codigo_asistencia,
      'nombre', e.nombre, 'lugar', e.lugar)
    from public.eventos e where e.slug = p_evento and e.activo
  ), jsonb_build_object('abierta', false, 'codigo_valido', false))
$$;

-- La persona registra su asistencia con su documento.
create or replace function public.registrar_asistencia(p_evento text, p_codigo text, p_documento text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  e public.eventos;
  p public.personas;
  a public.asistencias;
begin
  select * into e from public.eventos where slug = p_evento and activo;
  if e.id is null then
    return jsonb_build_object('estado', 'sin_evento');
  end if;
  if upper(trim(coalesce(p_codigo, ''))) <> e.codigo_asistencia then
    return jsonb_build_object('estado', 'codigo_invalido');
  end if;
  if not e.asistencia_abierta then
    return jsonb_build_object('estado', 'cerrado');
  end if;

  select * into p from public.personas where documento = public.normalizar_doc(p_documento);
  if p.id is null then
    return jsonb_build_object('estado', 'no_encontrado');
  end if;

  insert into public.asistencias (evento_id, persona_id, metodo, punto)
  values (e.id, p.id, 'autoregistro', 'Celular (autoregistro)')
  on conflict (evento_id, persona_id) do nothing
  returning * into a;

  if a.id is null then
    select * into a from public.asistencias where evento_id = e.id and persona_id = p.id;
    return jsonb_build_object('estado', 'repetido',
      'nombre', public.nombre_publico(p.nombres, p.apellidos),
      'tipo_asistente', p.tipo_asistente, 'hora', a.registrado_en);
  end if;

  return jsonb_build_object('estado', 'ok',
    'nombre', public.nombre_publico(p.nombres, p.apellidos),
    'tipo_asistente', p.tipo_asistente, 'hora', a.registrado_en);
end $$;

-- Administración: ver el código, abrir o cerrar, y cambiar el código.
create or replace function public.config_asistencia(p_evento text, p_abierta boolean default null, p_renovar boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  e public.eventos;
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede cambiar esto.' using errcode = '42501';
  end if;
  update public.eventos set
    asistencia_abierta = coalesce(p_abierta, asistencia_abierta),
    codigo_asistencia  = case when p_renovar then public.generar_token() else codigo_asistencia end
  where slug = p_evento
  returning * into e;
  if e.id is null then
    raise exception 'El evento no existe.' using errcode = 'P0001';
  end if;
  return jsonb_build_object('abierta', e.asistencia_abierta, 'codigo', e.codigo_asistencia);
end $$;

revoke execute on function public.estado_asistencia(text, text) from public;
revoke execute on function public.registrar_asistencia(text, text, text) from public;
revoke execute on function public.config_asistencia(text, boolean, boolean) from public;
grant execute on function public.estado_asistencia(text, text)              to anon, authenticated;
grant execute on function public.registrar_asistencia(text, text, text)     to anon, authenticated;
grant execute on function public.config_asistencia(text, boolean, boolean)  to authenticated;
