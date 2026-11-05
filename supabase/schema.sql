-- =====================================================================
--  UCEVA · Plataforma de asistencia a eventos
--  Esquema para Supabase (PostgreSQL 15+)
--
--  Cómo usarlo: en Supabase abre "SQL Editor", pega todo este archivo
--  y ejecútalo una sola vez. Se puede volver a ejecutar sin perder datos.
--
--  Seguridad: las tablas quedan cerradas (RLS sin políticas). Nadie las
--  lee directamente con la llave pública; todo pasa por las funciones
--  de abajo, que deciden qué puede ver el público y qué solo el personal.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
--  Tablas
-- ---------------------------------------------------------------------

create table if not exists public.eventos (
  id          bigint generated always as identity primary key,
  slug        text unique not null,
  nombre      text not null,
  fecha       date,
  lugar       text,
  activo      boolean not null default true,
  creado_en   timestamptz not null default now()
);

create table if not exists public.personas (
  id                      uuid primary key default gen_random_uuid(),
  token                   text unique not null,
  tipo_documento          text not null default 'CC'
                          check (tipo_documento in ('CC','TI','CE','PA','PPT','RC','NIT','OTRO')),
  documento               text unique not null,
  nombres                 text not null,
  apellidos               text not null default '',
  correo                  text,
  celular                 text,
  tipo_asistente          text not null
                          check (tipo_asistente in ('estudiante','docente','investigador',
                                                    'directivo','administrativo','egresado','externo')),
  dependencia             text,          -- programa, facultad u oficina (institucionales)
  entidad                 text,          -- empresa, colegio o procedencia (externos)
  poblacion               text[],        -- dato sensible y opcional
  acepta_tratamiento      boolean not null default false,
  acepta_datos_sensibles  boolean not null default false,
  origen                  text not null default 'institucional'
                          check (origen in ('institucional','registro')),
  creado_en               timestamptz not null default now(),
  actualizado_en          timestamptz not null default now()
);

create index if not exists personas_busqueda_idx
  on public.personas using gin (to_tsvector('simple', nombres || ' ' || apellidos));

create table if not exists public.staff (
  user_id   uuid primary key references auth.users(id) on delete cascade,
  nombre    text not null,
  rol       text not null default 'portero' check (rol in ('portero','admin')),
  creado_en timestamptz not null default now()
);

create table if not exists public.asistencias (
  id              bigint generated always as identity primary key,
  evento_id       bigint not null references public.eventos(id) on delete cascade,
  persona_id      uuid   not null references public.personas(id) on delete cascade,
  registrado_en   timestamptz not null default now(),
  punto           text,
  metodo          text not null check (metodo in ('qr','documento')),
  registrado_por  uuid references auth.users(id),
  sin_conexion    boolean not null default false,
  unique (evento_id, persona_id)
);

create index if not exists asistencias_evento_hora_idx
  on public.asistencias (evento_id, registrado_en desc);

alter table public.eventos     enable row level security;
alter table public.personas    enable row level security;
alter table public.staff       enable row level security;
alter table public.asistencias enable row level security;

-- ---------------------------------------------------------------------
--  Utilidades internas
-- ---------------------------------------------------------------------

-- Deja el documento solo con letras y números, en mayúscula.
create or replace function public.normalizar_doc(p text)
returns text language sql immutable as $$
  select upper(regexp_replace(coalesce(p,''), '[^0-9A-Za-z]', '', 'g'))
$$;

-- Código del pase: 10 caracteres sin letras que se confundan (0/O, 1/I/L).
-- En Supabase, pgcrypto vive en el esquema "extensions"; por eso se incluye en la ruta.
create or replace function public.generar_token()
returns text language plpgsql volatile set search_path = public, extensions as $$
declare
  alfabeto constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  bytes bytea := gen_random_bytes(10);
  salida text := '';
  i int;
begin
  for i in 0..9 loop
    salida := salida || substr(alfabeto, (get_byte(bytes, i) % length(alfabeto)) + 1, 1);
  end loop;
  return salida;
end $$;

create or replace function public.personas_antes_de_guardar()
returns trigger language plpgsql as $$
begin
  new.documento := public.normalizar_doc(new.documento);
  if new.token is null or new.token = '' then
    new.token := public.generar_token();
  end if;
  new.nombres   := initcap(trim(new.nombres));
  new.apellidos := initcap(trim(coalesce(new.apellidos,'')));
  new.correo    := nullif(lower(trim(coalesce(new.correo,''))), '');
  new.actualizado_en := now();
  return new;
end $$;

drop trigger if exists personas_antes_de_guardar on public.personas;
create trigger personas_antes_de_guardar
  before insert or update on public.personas
  for each row execute function public.personas_antes_de_guardar();

create or replace function public.es_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where user_id = auth.uid())
$$;

create or replace function public.es_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.staff where user_id = auth.uid() and rol = 'admin')
$$;

create or replace function public.evento_id(p_slug text)
returns bigint language sql stable security definer set search_path = public as $$
  select id from public.eventos where slug = p_slug and activo
$$;

-- Nombre corto para mostrar al público: "Juan S." en vez del nombre completo.
create or replace function public.nombre_publico(p_nombres text, p_apellidos text)
returns text language sql immutable as $$
  select split_part(trim(p_nombres), ' ', 1)
         || case when coalesce(trim(p_apellidos),'') = '' then ''
                 else ' ' || left(trim(p_apellidos), 1) || '.' end
$$;

-- ---------------------------------------------------------------------
--  Funciones públicas (llave anon)
-- ---------------------------------------------------------------------

-- Información del evento para mostrar en el portal.
create or replace function public.info_evento(p_evento text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('nombre', nombre, 'fecha', fecha, 'lugar', lugar)
  from public.eventos where slug = p_evento and activo
$$;

-- ¿Estoy en la base de datos? Devuelve solo lo necesario para el pase.
create or replace function public.consultar_persona(p_documento text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  p public.personas;
begin
  select * into p from public.personas
  where documento = public.normalizar_doc(p_documento);

  if not found then
    return jsonb_build_object('encontrado', false);
  end if;

  return jsonb_build_object(
    'encontrado',     true,
    'nombre',         public.nombre_publico(p.nombres, p.apellidos),
    'tipo_asistente', p.tipo_asistente,
    'documento_fin',  right(p.documento, 4),
    'token',          p.token
  );
end $$;

-- Autorregistro: invitados externos y miembros de la UCEVA que no aparecen
-- en las bases institucionales (quedan con origen 'registro' para verificarlos).
drop function if exists public.registrar_externo(text,text,text,text,text,text,text,text[],boolean,boolean);
create or replace function public.registrar_persona(
  p_tipo_asistente text,
  p_dependencia    text,
  p_tipo_documento text,
  p_documento      text,
  p_nombres        text,
  p_apellidos      text,
  p_correo         text,
  p_celular        text,
  p_entidad        text,
  p_poblacion      text[],
  p_acepta_tratamiento     boolean,
  p_acepta_datos_sensibles boolean
) returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_doc text := public.normalizar_doc(p_documento);
  v_tipo text := lower(trim(coalesce(p_tipo_asistente, 'externo')));
  p public.personas;
begin
  if v_tipo not in ('estudiante','docente','investigador','directivo','administrativo','egresado','externo') then
    raise exception 'Elige tu relación con la UCEVA.' using errcode = 'P0001';
  end if;
  if v_tipo <> 'externo' and length(trim(coalesce(p_dependencia,''))) < 2 then
    raise exception 'Escribe tu programa, facultad u oficina.' using errcode = 'P0001';
  end if;
  if not coalesce(p_acepta_tratamiento, false) then
    raise exception 'Debes aceptar el tratamiento de datos para registrarte.' using errcode = 'P0001';
  end if;
  if length(v_doc) < 4 or length(v_doc) > 20 then
    raise exception 'El número de documento no es válido.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.personas where documento = v_doc) then
    return jsonb_build_object('estado', 'ya_registrado');
  end if;
  if length(trim(coalesce(p_nombres,''))) < 2 or length(trim(coalesce(p_apellidos,''))) < 2 then
    raise exception 'Escribe tus nombres y apellidos.' using errcode = 'P0001';
  end if;
  if p_correo is not null and p_correo <> '' and p_correo !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'El correo no tiene un formato válido.' using errcode = 'P0001';
  end if;

  insert into public.personas (
    tipo_documento, documento, nombres, apellidos, correo, celular,
    tipo_asistente, dependencia, entidad, poblacion,
    acepta_tratamiento, acepta_datos_sensibles, origen
  ) values (
    coalesce(nullif(p_tipo_documento,''), 'CC'), v_doc, p_nombres, p_apellidos,
    p_correo, nullif(trim(coalesce(p_celular,'')), ''),
    v_tipo,
    case when v_tipo <> 'externo' then nullif(trim(coalesce(p_dependencia,'')), '') end,
    case when v_tipo = 'externo' then nullif(trim(coalesce(p_entidad,'')), '') end,
    case when coalesce(p_acepta_datos_sensibles, false) then p_poblacion else null end,
    true, coalesce(p_acepta_datos_sensibles, false), 'registro'
  ) returning * into p;

  return jsonb_build_object(
    'estado',         'creado',
    'nombre',         public.nombre_publico(p.nombres, p.apellidos),
    'tipo_asistente', p.tipo_asistente,
    'documento_fin',  right(p.documento, 4),
    'token',          p.token
  );
end $$;

-- ---------------------------------------------------------------------
--  Funciones del personal de ingreso (usuario autenticado en staff)
-- ---------------------------------------------------------------------

create or replace function public.mi_perfil_staff()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('nombre', nombre, 'rol', rol)
  from public.staff where user_id = auth.uid()
$$;

-- Registra el ingreso por código QR (p_token) o por documento (p_documento).
create or replace function public.registrar_ingreso(
  p_evento    text,
  p_token     text default null,
  p_documento text default null,
  p_punto     text default null,
  p_hora      timestamptz default null,
  p_sin_conexion boolean default false
) returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_evento bigint;
  p public.personas;
  a public.asistencias;
  v_token text := upper(regexp_replace(coalesce(p_token,''), '^UCV:', '', 'i'));
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

  insert into public.asistencias (evento_id, persona_id, punto, metodo, registrado_por,
                                  registrado_en, sin_conexion)
  values (v_evento, p.id, p_punto,
          case when v_token <> '' then 'qr' else 'documento' end,
          auth.uid(), coalesce(p_hora, now()), coalesce(p_sin_conexion, false))
  on conflict (evento_id, persona_id) do nothing
  returning * into a;

  if a.id is null then
    select * into a from public.asistencias where evento_id = v_evento and persona_id = p.id;
    return jsonb_build_object(
      'estado', 'repetido',
      'nombre', p.nombres || ' ' || p.apellidos,
      'tipo_asistente', p.tipo_asistente,
      'dependencia', coalesce(p.dependencia, p.entidad),
      'documento', p.documento,
      'origen', p.origen,
      'hora_previa', a.registrado_en,
      'punto_previo', a.punto
    );
  end if;

  return jsonb_build_object(
    'estado', 'ok',
    'nombre', p.nombres || ' ' || p.apellidos,
    'tipo_asistente', p.tipo_asistente,
    'dependencia', coalesce(p.dependencia, p.entidad),
    'documento', p.documento,
    'origen', p.origen,
    'hora', a.registrado_en
  );
end $$;

-- Sincroniza ingresos guardados mientras no había internet.
-- p_lote: [{"token": "...", "documento": "...", "hora": "...", "punto": "..."}]
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
    r := public.registrar_ingreso(
      p_evento, item->>'token', item->>'documento', item->>'punto',
      (item->>'hora')::timestamptz, true);
    resultados := resultados || jsonb_build_array(r || jsonb_build_object('id_local', item->'id_local'));
  end loop;
  return resultados;
end $$;

-- Búsqueda de respaldo: por documento (inicio) o por nombre.
create or replace function public.buscar_personas(p_evento text, p_texto text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_evento bigint := public.evento_id(p_evento);
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
      where (v_doc <> '' and p.documento like v_doc || '%')
         or (p.nombres || ' ' || p.apellidos) ilike '%' || v_txt || '%'
      order by p.apellidos, p.nombres
      limit 12
    ) t
  ), '[]'::jsonb);
end $$;

-- Copia del padrón para validar sin internet en la puerta.
create or replace function public.descargar_padron(p_evento text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_evento bigint := public.evento_id(p_evento);
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
    'ingresos',  (select count(*) from public.asistencias where evento_id = v_evento),
    'base',      (select count(*) from public.personas),
    'externos_registrados', (select count(*) from public.personas where origen = 'registro' and tipo_asistente = 'externo'),
    'uceva_autorregistro',  (select count(*) from public.personas where origen = 'registro' and tipo_asistente <> 'externo'),
    'ultimos_15_min', (select count(*) from public.asistencias
                       where evento_id = v_evento and registrado_en > now() - interval '15 minutes'),
    'por_tipo', coalesce((
      select jsonb_object_agg(tipo_asistente, n) from (
        select p.tipo_asistente, count(*) n
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

-- ---------------------------------------------------------------------
--  Funciones de administración
-- ---------------------------------------------------------------------

-- Carga o actualiza la base institucional que envían las dependencias.
-- p_filas: [{"tipo_documento","documento","nombres","apellidos","correo",
--            "celular","tipo_asistente","dependencia"}]
create or replace function public.importar_personas(p_filas jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  f jsonb;
  v_doc text;
  nuevos int := 0;
  actualizados int := 0;
  errores jsonb := '[]'::jsonb;
  n int := 0;
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede importar personas.' using errcode = '42501';
  end if;

  for f in select * from jsonb_array_elements(p_filas) loop
    n := n + 1;
    v_doc := public.normalizar_doc(f->>'documento');
    begin
      if length(v_doc) < 4 or coalesce(trim(f->>'nombres'),'') = '' then
        raise exception 'Falta documento o nombres';
      end if;
      if lower(trim(coalesce(f->>'tipo_asistente',''))) not in
         ('estudiante','docente','investigador','directivo','administrativo','egresado','externo') then
        raise exception 'Tipo de asistente no válido: "%"', coalesce(f->>'tipo_asistente','(vacío)');
      end if;
      insert into public.personas (tipo_documento, documento, nombres, apellidos, correo,
                                   celular, tipo_asistente, dependencia, origen,
                                   acepta_tratamiento)
      values (coalesce(nullif(upper(f->>'tipo_documento'),''),'CC'), v_doc, f->>'nombres',
              coalesce(f->>'apellidos',''), f->>'correo', f->>'celular',
              lower(trim(f->>'tipo_asistente')), f->>'dependencia', 'institucional', false)
      on conflict (documento) do update set
        nombres        = excluded.nombres,
        apellidos      = excluded.apellidos,
        correo         = coalesce(excluded.correo, personas.correo),
        celular        = coalesce(excluded.celular, personas.celular),
        tipo_asistente = excluded.tipo_asistente,   -- la base oficial prevalece
        origen         = 'institucional',
        dependencia    = coalesce(excluded.dependencia, personas.dependencia);
      if (select creado_en = actualizado_en from public.personas where documento = v_doc) then
        nuevos := nuevos + 1;
      else
        actualizados := actualizados + 1;
      end if;
    exception when others then
      errores := errores || jsonb_build_array(jsonb_build_object(
        'fila', n, 'documento', f->>'documento', 'error', sqlerrm));
    end;
  end loop;

  return jsonb_build_object('nuevos', nuevos, 'actualizados', actualizados, 'errores', errores);
end $$;

create or replace function public.exportar_asistencia(p_evento text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_evento bigint := public.evento_id(p_evento);
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede exportar.' using errcode = '42501';
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

-- ---------------------------------------------------------------------
--  Permisos: el público solo ejecuta las funciones públicas
-- ---------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.info_evento(text)       to anon, authenticated;
grant execute on function public.consultar_persona(text) to anon, authenticated;
grant execute on function public.registrar_persona(text,text,text,text,text,text,text,text,text,text[],boolean,boolean)
  to anon, authenticated;

grant execute on function public.mi_perfil_staff()                       to authenticated;
grant execute on function public.registrar_ingreso(text,text,text,text,timestamptz,boolean) to authenticated;
grant execute on function public.registrar_ingresos_lote(text,jsonb)     to authenticated;
grant execute on function public.buscar_personas(text,text)              to authenticated;
grant execute on function public.descargar_padron(text)                  to authenticated;
grant execute on function public.estadisticas(text)                      to authenticated;
grant execute on function public.importar_personas(jsonb)                to authenticated;
grant execute on function public.exportar_asistencia(text)               to authenticated;

-- ---------------------------------------------------------------------
--  Evento inicial
-- ---------------------------------------------------------------------

insert into public.eventos (slug, nombre, fecha, lugar)
values ('noche-inclusion-2026', 'Noche de la Inclusión', null, 'UCEVA, Tuluá')
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------
--  Autoregistro de asistencia (igual a migracion-002-autoasistencia.sql)
-- ---------------------------------------------------------------------

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

-- ---------------------------------------------------------------------
--  Asistencia con solo la cédula (igual a migracion-003-asistencia-simple.sql)
-- ---------------------------------------------------------------------

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

-- ---------------------------------------------------------------------
--  Personal y rol consulta (igual a migracion-004-personal.sql)
-- ---------------------------------------------------------------------

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
                'Exterior del Coliseo Cubierto Carlos María Lozano'),
               ('IV Noche de Inclusión: pasarela central', timestamptz '2026-11-05 19:00-05', timestamptz '2026-11-05 23:59-05',
                'Coliseo Cubierto Carlos María Lozano')) as x(nombre, inicio, fin, lugar)
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

-- Actividades activas para la lista desplegable de registro: las que están en
-- curso (o empiezan en los próximos 30 minutos, para quien llega un poco antes)
create or replace function public.actividades_vigentes(p_evento text)
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'nombre', a.nombre, 'inicio', a.inicio, 'fin', a.fin, 'lugar', a.lugar,
           'en_curso', now() >= a.inicio and now() < a.fin) order by a.inicio), '[]'::jsonb)
    from public.actividades a
   where a.evento_id = public.evento_id(p_evento)
     and now() >= a.inicio - interval '30 minutes' and now() < a.fin
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
          and now() >= inicio - interval '30 minutes' and now() < fin + interval '10 minutes') then
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
