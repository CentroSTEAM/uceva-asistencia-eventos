// "Actualizar mis datos": la persona puede identificarse con un grupo
// poblacional o comunidad y dejar su celular. Se ofrece después de consultar
// el pase y después de registrar la asistencia.
import { api } from './api.js?v=20261105a';
import { CONFIG } from './config.js?v=20261105a';
import { mensaje, esc, ICONOS } from './comun.js?v=20261105a';

export const POBLACIONES = [
  'Persona con discapacidad',
  'Comunidad indígena',
  'Comunidad negra, afrocolombiana, raizal o palenquera',
  'Pueblo Rrom',
  'Víctima del conflicto armado',
  'Población LGBTIQ+',
  'Persona migrante',
  'Persona mayor',
  'Población campesina',
  'Madre o padre cabeza de hogar',
];

let contador = 0;

export function ofrecerActualizacion(contenedor, documento) {
  if (!contenedor || !documento) return;
  const id = `act${++contador}`;
  contenedor.innerHTML = `
    <section class="actualizar tarjeta" aria-labelledby="${id}-t">
      <div class="actualizar__cabeza">
        <span class="actualizar__icono" aria-hidden="true">${ICONOS.boleta}</span>
        <div>
          <h2 id="${id}-t">¿Quieres actualizar tus datos?</h2>
          <p>Cuéntanos si te reconoces en algún grupo poblacional o comunidad. Es opcional y nos ayuda a hacer eventos más incluyentes.</p>
        </div>
      </div>
      <button type="button" class="boton boton--claro" id="${id}-abrir" aria-expanded="false" aria-controls="${id}-f">Actualizar mis datos</button>
      <form id="${id}-f" class="actualizar__form" hidden novalidate>
        <fieldset>
          <legend>¿Te reconoces en alguno de estos grupos? <span class="opcional">Marca los que apliquen</span></legend>
          <div class="opciones">
            ${POBLACIONES.map((p) => `<label class="marca-check"><input type="checkbox" name="poblacion" value="${esc(p)}"> ${esc(p)}</label>`).join('')}
          </div>
          <div class="campo actualizar__otro">
            <label for="${id}-otro">Otro grupo o comunidad <span class="opcional">Opcional</span></label>
            <input id="${id}-otro" type="text" maxlength="70" autocomplete="off" placeholder="Escríbelo aquí">
          </div>
        </fieldset>
        <div class="campo">
          <label for="${id}-cel">Celular <span class="opcional">Opcional</span></label>
          <input id="${id}-cel" type="tel" inputmode="tel" autocomplete="tel" maxlength="20" placeholder="3001234567">
          <p class="ayuda">Si lo dejas vacío, se conserva el que teníamos.</p>
        </div>
        <label class="marca-check"><input type="checkbox" id="${id}-sens"> Autorizo a la UCEVA a tratar el grupo poblacional que marqué, que es un dato sensible, únicamente con fines estadísticos institucionales. Responder es opcional, no condiciona mi ingreso y el dato no se entregará a terceros.</label>
        <label class="marca-check"><input type="checkbox" id="${id}-legal"> <span>Autorizo a la UCEVA a tratar mis datos personales únicamente para gestionar mi asistencia a este evento y con fines estadísticos institucionales, conforme a la Ley 1581 de 2012 y a su <a href="${esc(CONFIG.institucion.politicaDatosUrl)}" target="_blank" rel="noopener">política de tratamiento de datos</a>. Mis datos no se entregarán a terceros.</span></label>
        <div id="${id}-msg" aria-live="polite"></div>
        <div class="actualizar__acciones">
          <button type="submit" class="boton boton--verde" id="${id}-guardar">Guardar mis datos</button>
          <button type="button" class="enlace" id="${id}-cerrar">Ahora no</button>
        </div>
      </form>
    </section>`;

  const q = (s) => contenedor.querySelector(s);
  const form = q(`#${id}-f`), abrir = q(`#${id}-abrir`);
  abrir.addEventListener('click', () => {
    form.hidden = false; abrir.hidden = true; abrir.setAttribute('aria-expanded', 'true');
    form.querySelector('input').focus();
  });
  q(`#${id}-cerrar`).addEventListener('click', () => {
    form.hidden = true; abrir.hidden = false; abrir.setAttribute('aria-expanded', 'false'); abrir.focus();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = q(`#${id}-msg`);
    const poblacion = [...form.querySelectorAll('input[name="poblacion"]:checked')].map((c) => c.value);
    const otro = q(`#${id}-otro`).value.trim();
    if (otro) poblacion.push(`Otro: ${otro}`);
    const celular = q(`#${id}-cel`).value.trim();
    const sensible = q(`#${id}-sens`).checked;
    const legal = q(`#${id}-legal`).checked;

    if (!poblacion.length && !celular) {
      msg.innerHTML = mensaje('aviso', 'No hay nada para guardar', 'Marca un grupo o escribe tu celular.'); return;
    }
    if (poblacion.length && !sensible) {
      msg.innerHTML = mensaje('aviso', 'Falta tu autorización', 'Para guardar el grupo poblacional marca la autorización del dato sensible.'); return;
    }
    if (!legal) {
      msg.innerHTML = mensaje('aviso', 'Falta tu autorización', 'Marca la autorización de tratamiento de datos para guardar.'); return;
    }
    const btn = q(`#${id}-guardar`); btn.disabled = true; btn.textContent = 'Guardando…';
    try {
      await api.actualizarDatos({ documento, celular, poblacion, acepta_tratamiento: legal, acepta_datos_sensibles: sensible && poblacion.length > 0 });
      contenedor.innerHTML = `<section class="actualizar tarjeta">${mensaje('ok', '¡Gracias! Tus datos quedaron actualizados', 'Si quieres cambiarlos después, vuelve a consultar tu documento.')}</section>`;
    } catch (err) {
      msg.innerHTML = mensaje('error', 'No se pudieron guardar tus datos', err.sinConexion ? 'Revisa tu conexión e inténtalo de nuevo.' : esc(err.message));
      btn.disabled = false; btn.textContent = 'Guardar mis datos';
    }
  });
}
