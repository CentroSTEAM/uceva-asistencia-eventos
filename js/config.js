// Configuración de la plataforma.
// Mientras SUPABASE_URL esté vacío, todo funciona en "modo demostración":
// los datos se guardan solo en este navegador y no se comparten.
//
// Para conectar la base real: en Supabase ve a Project Settings → API y
// copia "Project URL" y la llave "anon public". La llave anon es pública
// por diseño: la seguridad la ponen las funciones de supabase/schema.sql.

export const CONFIG = {
  SUPABASE_URL: 'https://mhdsrvseaqygmqpywddn.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_QinhG52FJLfF0m-0wDN3tg_q4lnphv0',   // llave publicable (segura en el navegador)

  evento: {
    slug: 'noche-inclusion-2026',          // igual al de la tabla eventos
    nombre: 'IV Noche de Inclusión',
    marco: 'Día de la Inclusión 2026',
    fecha: 'Jueves 5 de noviembre, 7:00 p. m.',
    fechaISO: '2026-11-05T19:00:00-05:00',  // activa la cuenta regresiva
    lugar: 'Coliseo Carlos María Lozano',
  },

  institucion: {
    sigla: 'UCEVA',
    nombre: 'Unidad Central del Valle del Cauca',
    politicaDatosUrl: 'https://www.uceva.edu.co/',   // reemplazar por el enlace a la política de datos
  },

  // Puntos de ingreso que aparecen en la pantalla del personal
  puntos: ['Puerta principal', 'Puerta 2', 'Puerta 3', 'Acceso preferencial'],
};

export const MODO_DEMO = !CONFIG.SUPABASE_URL;
