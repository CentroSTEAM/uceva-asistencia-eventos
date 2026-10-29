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
