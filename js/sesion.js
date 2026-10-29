// Inicio de sesión del personal (porteros y administradores).
import { api } from './api.js';
import { MODO_DEMO } from './config.js';
import { mensaje, esc, $ } from './comun.js';

export async function exigirSesion(contenedor, { roles = null } = {}) {
  const soloAdmin = !!roles; // páginas restringidas a ciertos roles (el panel)
  const permitido = (p) => !roles || roles.includes(p.rol);
  const perfil = await api.perfil();
  if (perfil && permitido(perfil)) {
    try { localStorage.setItem('uceva-perfil', JSON.stringify(perfil)); } catch {}
    return perfil;
  }

  return new Promise((resolver) => {
    contenedor.innerHTML = `
      <section class="acceso" aria-labelledby="titulo-acceso">
        <h1 id="titulo-acceso">${soloAdmin ? 'Panel del evento' : 'Acceso del personal'}</h1>
        <p class="entrada">${soloAdmin ? 'Para administradores y personas con rol de consulta.' : 'Para el equipo de logística y la coordinación del evento.'} Entra con el correo y la contraseña que te asignaron.</p>
        ${soloAdmin ? '' : `<ul class="roles">
          <li><strong>Portero</strong><span>Escanea los pases y busca personas por cédula en la entrada.</span></li>
          <li><strong>Consulta</strong><span>Ve las estadísticas del panel y descarga los listados.</span></li>
          <li><strong>Administrador</strong><span>Todo lo anterior, y además abre o cierra el registro de asistencia, carga bases y gestiona el personal.</span></li>
        </ul>`}
        ${perfil && soloAdmin ? mensaje('aviso', 'Tu usuario no tiene acceso al panel', 'Tu rol es portero: puedes usar el escáner de pases. Para ver el panel pide acceso a la coordinación del evento.') : ''}
        <form id="form-acceso" novalidate>
          <div id="acceso-error" aria-live="assertive"></div>
          <div class="campo">
            <label for="correo">Correo</label>
            <input id="correo" type="email" autocomplete="username" required>
          </div>
          <div class="campo">
            <label for="clave">Contraseña</label>
            <input id="clave" type="password" autocomplete="current-password" required>
            ${MODO_DEMO ? '<p class="ayuda">Modo demostración: usa cualquier correo y la contraseña <strong>demo</strong>.</p>' : ''}
          </div>
          <button class="boton boton--bloque" type="submit" id="btn-entrar">Entrar</button>
        </form>
      </section>`;
    const form = $('#form-acceso', contenedor);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('#btn-entrar', contenedor);
      btn.disabled = true; btn.textContent = 'Entrando…';
      try {
        const p = await api.iniciarSesion($('#correo', contenedor).value.trim(), $('#clave', contenedor).value);
        if (!permitido(p)) throw new Error('Tu usuario no tiene acceso al panel. Tu rol es portero: usa el escáner de pases.');
        try { localStorage.setItem('uceva-perfil', JSON.stringify(p)); } catch {}
        resolver(p);
      } catch (err) {
        $('#acceso-error', contenedor).innerHTML = mensaje('error', 'No pudiste entrar', esc(err.message));
        btn.disabled = false; btn.textContent = 'Entrar';
      }
    });
    $('#correo', contenedor).focus();
  });
}

export async function salir() {
  await api.cerrarSesion();
  try { localStorage.removeItem('uceva-perfil'); } catch {}
  location.reload();
}
