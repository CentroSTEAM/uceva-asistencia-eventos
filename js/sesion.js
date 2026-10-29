// Inicio de sesión del personal (porteros y administradores).
import { api } from './api.js';
import { MODO_DEMO } from './config.js';
import { mensaje, esc, $ } from './comun.js';

export async function exigirSesion(contenedor, { soloAdmin = false } = {}) {
  const perfil = await api.perfil();
  if (perfil && (!soloAdmin || perfil.rol === 'admin')) {
    try { localStorage.setItem('uceva-perfil', JSON.stringify(perfil)); } catch {}
    return perfil;
  }

  return new Promise((resolver) => {
    contenedor.innerHTML = `
      <section class="acceso" aria-labelledby="titulo-acceso">
        <h1 id="titulo-acceso">${soloAdmin ? 'Panel del evento' : 'Ingreso al evento'}</h1>
        <p class="entrada">Solo para el personal ${soloAdmin ? 'administrador' : 'de logística'}. Usa el correo y la contraseña que te asignaron.</p>
        ${perfil && soloAdmin ? mensaje('aviso', 'Tu usuario no es administrador', 'Pide acceso a la coordinación del evento.') : ''}
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
        if (soloAdmin && p.rol !== 'admin') throw new Error('Tu usuario no es administrador.');
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
