-- =====================================================================
--  Migración 003: asistencia con solo la cédula
--
--  La persona registra su asistencia escribiendo su documento, sin código.
--  El administrador solo abre o cierra el registro desde el panel.
--  (El código del cartel queda como opción: exigir_codigo = true.)
--
--  Requiere haber ejecutado la migración 002. Se puede repetir sin problema.
-- =====================================================================

alter table public.eventos add column if not exists exigir_codigo boolean not null default false;

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

create or replace function public.estado_asistencia(p_evento text, p_codigo text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_build_object(
      'abierta', e.asistencia_abierta,
      'codigo_valido', (not e.exigir_codigo) or upper(trim(coalesce(p_codigo, ''))) = e.codigo_asistencia,
      'nombre', e.nombre, 'lugar', e.lugar)
    from public.eventos e where e.slug = p_evento and e.activo
  ), jsonb_build_object('abierta', false, 'codigo_valido', false))
$$;

revoke execute on function public.estado_asistencia(text, text) from public;
revoke execute on function public.registrar_asistencia(text, text, text) from public;
grant execute on function public.estado_asistencia(text, text)          to anon, authenticated;
grant execute on function public.registrar_asistencia(text, text, text) to anon, authenticated;
