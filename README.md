# UCEVA · Asistencia a eventos

Plataforma web para registrar la asistencia a eventos institucionales de la UCEVA. La primera versión está preparada para la **Noche de la Inclusión** (3.000 a 5.000 asistentes).

## Cómo funciona

| Página | Para quién | Qué hace |
|---|---|---|
| `index.html` | Público | Consulta por documento si la persona está en la lista y le entrega su **pase con código QR**. |
| `registro.html` | Invitados externos | Formulario de registro con autorización de datos (Ley 1581 de 2012). Al terminar entrega el pase. |
| `ingreso.html` | Personal de logística | Escáner de QR con la cámara del celular y búsqueda por documento o nombre. Funciona **sin internet** usando una copia local del padrón. |
| `panel.html` | Administradores | Asistencia en vivo, carga de las bases que envían las dependencias (CSV) y descarga del listado de asistentes. |

En la puerta, el resultado ocupa toda la pantalla con ícono, palabra y color: **Puede entrar** (verde), **Ya había ingresado** (amarillo, con hora y punto del primer ingreso) o **No está en la lista** (rojo).

## Modo demostración

Mientras `js/config.js` no tenga los datos de Supabase, la plataforma funciona en modo demostración: los datos se guardan solo en el navegador y viene con 9 personas de ejemplo. Para entrar a `ingreso.html` o `panel.html` usa cualquier correo y la contraseña `demo`.

## Puesta en marcha con Supabase

1. Crea una cuenta en [supabase.com](https://supabase.com) y un proyecto nuevo (plan gratuito, región `East US` o `South America`).
2. En **SQL Editor**, pega el contenido de `supabase/schema.sql` y ejecútalo.
3. En **Project Settings → API** copia *Project URL* y la llave *anon public* en `js/config.js`.
4. Crea los usuarios del personal en **Authentication → Users → Add user** (correo y contraseña, marcando *Auto Confirm User*).
5. Habilítalos como personal en **SQL Editor**:

   ```sql
   insert into staff (user_id, nombre, rol)
   select id, 'Coordinación VIPS', 'admin' from auth.users where email = 'coordinacion@uceva.edu.co';

   insert into staff (user_id, nombre, rol)
   select id, split_part(email, '@', 1), 'portero' from auth.users
   where email in ('puerta1@uceva.edu.co', 'puerta2@uceva.edu.co');
   ```

6. Ajusta en `js/config.js` el nombre, la fecha, el lugar y los puntos de ingreso del evento.

La llave *anon* es pública por diseño. Las tablas están cerradas con RLS; el público solo puede consultar su propio pase por documento y registrarse, y todo lo demás exige un usuario del personal.

## Bases institucionales

Pide a cada dependencia un CSV con estas columnas (descarga la plantilla desde el panel):

```
tipo_documento;documento;nombres;apellidos;tipo_asistente;dependencia;correo;celular
```

- `tipo_asistente`: estudiante, docente, investigador, directivo, administrativo o egresado. Si el archivo no lo trae, el panel permite asignar uno a todo el archivo.
- Se aceptan encabezados equivalentes (`cedula`, `programa`, `email`, `estamento`…) y archivos guardados desde Excel.
- Volver a cargar un archivo no duplica personas: actualiza sus datos y conserva su código QR.

## Lista para la noche del evento

- [ ] Bases institucionales cargadas y revisadas en el panel.
- [ ] Un usuario de personal por cada celular de la puerta, con sesión iniciada **antes** de abrir puertas (así se descarga el padrón para trabajar sin internet).
- [ ] Probar la cámara de cada celular escaneando un pase de prueba.
- [ ] Celulares con batería completa y brillo alto; una batería externa por punto.
- [ ] Publicar el enlace de consulta (y su QR) en redes y correos institucionales días antes, para que la gente llegue con su pase.
- [ ] Mantener el proyecto de Supabase activo: en el plan gratuito se pausa tras 7 días sin uso.

## Estructura

```
index.html, registro.html, ingreso.html, panel.html
css/        estilos (base, portal, ingreso, panel)
js/         config, api (Supabase + demostración), comun, sesion y un archivo por página
supabase/   schema.sql: tablas, seguridad y funciones
vendor/     librerías locales: supabase-js, qrcode-generator, qr-scanner
```

Sitio estático sin compilación: se publica tal cual en GitHub Pages.
