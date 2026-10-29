// Autoregistro de asistencia: la persona llega al evento, escanea el QR del
// cartel con su celular y registra su asistencia con su documento.

import { api, TIPOS, normalizarDoc } from './api.js';
import { CONFIG } from './config.js';
import { montarBarra, mensaje, ultimoPase, guardarUltimoPase, ICONOS, esc, $ } from './comun.js';

montarBarra('asistir.html');

const vista = $('#vista');
$('#evento-nombre').textContent = CONFIG.evento.nombre;

const params = new URLSearchParams(location.search);
const codigo = (params.get('c') || sessionStorage.getItem('uceva-codigo-asistencia') || '').trim().toUpperCase();
if (codigo) try { sessionStorage.setItem('uceva-codigo-asistencia', codigo); } catch {}
const hora = (iso) => new Date(iso).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });

function pintar(html) { vista.innerHTML = html; vista.querySelector('[data-foco]')?.focus(); }

function vistaAviso(icono, titulo, texto) {
  pintar(`<div class="asistir__estado">
    <span class="asistir__icono asistir__icono--${icono}">${ICONOS[icono === 'cerrado' ? 'aviso' : icono]}</span>
    <h1>${esc(titulo)}</h1><p>${texto}</p></div>`);
}

function vistaFormulario(prefill = '') {
  const pase = ultimoPase();
  pintar(`
    <h1 class="titulo-espectro asistir__titulo">Registra tu asistencia</h1>
    ${pase ? `
      <div class="tarjeta asistir__rapido">
        <p class="ayuda">En este celular está guardado el pase de</p>
        <p class="asistir__quien">${esc(pase.nombre)}</p>
        <p class="ayuda">${esc(TIPOS[pase.tipo_asistente] || '')}, documento terminado en ${esc(pase.documento_fin)}</p>
        <button class="boton boton--verde boton--bloque boton--grande" type="button" id="btn-soy" data-foco>Sí, soy yo: registrar mi asistencia</button>
      </div>
      <p class="asistir__o">¿No eres tú? Escribe tu documento</p>` : '<p class="entrada">Escribe tu número de documento. Toma un segundo.</p>'}
    <form id="form-asistir" class="tarjeta consulta asistir__form" novalidate>
      <label for="documento">Número de documento</label>
      <div class="consulta__fila">
        <input id="documento" type="text" inputmode="numeric" autocomplete="off" placeholder="1116254789" value="${esc(prefill)}" ${pase ? '' : 'data-foco'}>
        <button class="boton ${pase ? '' : 'boton--verde'}" type="submit" id="btn-asistir">Registrar</button>
      </div>
      <div id="error-form" aria-live="assertive"></div>
    </form>`);
  $('#btn-soy')?.addEventListener('click', (e) => enviar(null, e.currentTarget));
  $('#form-asistir').addEventListener('submit', (e) => { e.preventDefault(); enviar($('#documento').value, $('#btn-asistir')); });
}

async function enviar(documentoEscrito, boton) {
  const pase = ultimoPase();
  let doc = documentoEscrito != null ? normalizarDoc(documentoEscrito) : null;
  // "Sí, soy yo" usa el documento completo guardado al consultar o registrarse
  if (doc == null) doc = pase?.documento || '';
  if (doc.length < 4) {
    if (documentoEscrito == null) { vistaFormulario(); return; }
    $('#error-form').innerHTML = mensaje('error', 'Escribe tu número de documento', 'Sin puntos ni espacios.');
    $('#documento').focus(); return;
  }
  const texto = boton.textContent; boton.disabled = true; boton.textContent = 'Registrando…';
  try {
    const r = await api.registrarAsistencia(codigo, doc);
    mostrarResultado(r, doc);
  } catch (err) {
    boton.disabled = false; boton.textContent = texto;
    const destino = $('#error-form') || vista;
    destino.insertAdjacentHTML('afterbegin', mensaje('error', 'No se pudo registrar', err.sinConexion
      ? 'Parece que no hay internet. Acércate a la mesa de registro o inténtalo de nuevo en un momento.' : esc(err.message)));
  }
}

function mostrarResultado(r, doc) {
  if (r.estado === 'ok' || r.estado === 'repetido') {
    const pase = ultimoPase();
    if (pase && pase.documento === doc) guardarUltimoPase({ ...pase, asistio: r.hora });
    pintar(`<div class="asistir__estado asistir__estado--ok">
      <span class="asistir__icono asistir__icono--ok">${ICONOS.ok}</span>
      <h1>${r.estado === 'ok' ? `¡Bienvenido, ${esc(r.nombre.split(' ')[0])}!` : `Ya estabas registrado, ${esc(r.nombre.split(' ')[0])}`}</h1>
      <p class="asistir__confirma">${r.estado === 'ok' ? 'Tu asistencia quedó registrada' : 'Tu asistencia ya estaba registrada'} a las <strong>${hora(r.hora)}</strong></p>
      <p class="asistir__nombre">${esc(r.nombre)}<span>${esc(TIPOS[r.tipo_asistente] || '')}</span></p>
      <p class="ayuda">Disfruta la ${esc(CONFIG.evento.nombre)}. Si el personal te lo pide, muestra esta pantalla.</p>
    </div>`);
    return;
  }
  if (r.estado === 'no_encontrado') {
    pintar(`<div class="asistir__estado">
      <span class="asistir__icono asistir__icono--aviso">${ICONOS.aviso}</span>
      <h1>No estás en la lista todavía</h1>
      <p>No hay problema: regístrate ahora y tu asistencia quedará guardada al terminar.</p>
      <a class="boton boton--verde boton--grande boton--bloque" data-foco href="registro.html?doc=${encodeURIComponent(doc)}&asistir=${encodeURIComponent(codigo)}">Registrarme y marcar mi asistencia</a>
      <button type="button" class="enlace" id="btn-otra">Escribí mal el documento</button>
    </div>`);
    $('#btn-otra').addEventListener('click', () => vistaFormulario(doc));
    return;
  }
  if (r.estado === 'cerrado') return vistaAviso('cerrado', 'El registro de asistencia aún no está abierto', 'Se abre cuando empiece el evento. Vuelve a esta página en un momento. Mientras tanto puedes <a href="index.html">consultar tu pase</a>.');
  vistaAviso('error', 'Este código no es válido', 'Escanea el código QR del cartel que está en la entrada del evento.');
}

async function iniciar() {
  try {
    const e = await api.estadoAsistencia(codigo);
    if (!e.codigo_valido) return mostrarResultado({ estado: 'codigo_invalido' });
    if (!e.abierta) return mostrarResultado({ estado: 'cerrado' });
    vistaFormulario(params.get('doc') || '');
  } catch (err) {
    vistaAviso('error', 'No pudimos conectarnos', 'Revisa tu conexión a internet y vuelve a escanear el código.');
  }
}

iniciar();
