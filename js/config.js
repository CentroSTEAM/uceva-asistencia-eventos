// Configuración de la plataforma.
// Mientras SUPABASE_URL esté vacío, todo funciona en "modo demostración":
// los datos se guardan solo en este navegador y no se comparten.
//
// Para conectar la base real: en Supabase ve a Project Settings → API y
// copia "Project URL" y la llave "anon public". La llave anon es pública
// por diseño: la seguridad la ponen las funciones de supabase/schema.sql.

export const CONFIG = {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: '',

  evento: {
    slug: 'noche-inclusion-2026',          // igual al de la tabla eventos
    nombre: 'Noche de la Inclusión',
    fecha: '2026',                          // texto libre, p. ej. "Viernes 13 de noviembre · 6:00 p. m."
    lugar: 'UCEVA, Tuluá',
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
