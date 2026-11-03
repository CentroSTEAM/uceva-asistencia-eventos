-- =====================================================================
--  Limpieza de datos de prueba antes del evento.
--  Paso 1: ejecuta solo la parte "REVISAR" y mira qué se va a borrar.
--  Paso 2: si todo está bien, ejecuta la parte "BORRAR".
--  No toca las bases institucionales (estudiantes y personal cargados).
-- =====================================================================

-- ---------- REVISAR ----------
select count(*) as asistencias_registradas from public.asistencias;

select documento, nombres, apellidos, tipo_asistente, creado_en
  from public.personas
 where origen = 'registro'
 order by creado_en;

-- ---------- BORRAR ----------
-- delete from public.asistencias;
-- delete from public.personas where origen = 'registro';
-- update public.personas set poblacion = null, acepta_datos_sensibles = false, datos_actualizados_en = null
--  where origen = 'institucional' and (poblacion is not null or datos_actualizados_en is not null);
