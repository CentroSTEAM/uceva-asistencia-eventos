import { api, normalizarDoc } from './api.js';
import { CONFIG } from './config.js';
import { montarBarra, mensaje, htmlPase, htmlPaseVacio, descargarPase, guardarUltimoPase, ultimoPase, activarTilt, vigilarPase, ICONOS, esc, $ } from './comun.js';

montarBarra('index.html');

const form = $('#form-consulta');
const campo = $('#documento');
const boton = $('#btn-consultar');
const resultado = $('#resultado');
const contPase = $('#pase');
const acciones = $('#acciones-pase');
let paseActual = null;

// Datos del evento, íconos y botones
$('#chips').innerHTML = [
  [ICONOS.calendario, CONFIG.evento.fecha],
  [ICONOS.lugar, CONFIG.evento.lugar],
  [ICONOS.boleta, CONFIG.evento.horario],
].filter(([, t]) => t).map(([i, t]) => `<li class="chip">${i}${esc(t)}</li>`).join('');
document.querySelectorAll('[data-icono]').forEach((el) => { el.innerHTML = ICONOS[el.dataset.icono] || ''; });
$('#btn-invitado').insertAdjacentHTML('beforeend', ICONOS.flecha);
$('#btn-descargar').innerHTML = `${ICONOS.descargar} Descargar pase`;
$('#btn-descargar').addEventListener('click', () => paseActual && descargarPase(paseActual));
$('#btn-imprimir').addEventListener('click', () => window.print());
activarTilt($('.portada__pase'));
vigilarPase($('.portada__pase'));

// Cuenta regresiva (solo si hay fecha exacta configurada)
if (CONFIG.evento.fechaISO) {
  const meta = new Date(CONFIG.evento.fechaISO).getTime();
  const cuenta = $('#cuenta');
  const pintar = () => {
    const falta = meta - Date.now();
    if (falta <= 0) { cuenta.hidden = true; return; }
    const d = Math.floor(falta / 864e5), h = Math.floor(falta / 36e5) % 24, m = Math.floor(falta / 6e4) % 60;
    cuenta.hidden = false;
    cuenta.setAttribute('aria-label', `Faltan ${d} días, ${h} horas y ${m} minutos`);
    cuenta.innerHTML = [[d, d === 1 ? 'día' : 'días'], [h, 'horas'], [m, 'min']]
      .map(([n, t]) => `<div aria-hidden="true"><b>${String(n).padStart(2, '0')}</b><span>${t}</span></div>`).join('');
  };
  pintar(); setInterval(pintar, 30000);
}

// Si el registro de asistencia está abierto, se muestra de primero.
api.estadoAsistencia('').then((e) => {
  if (!e?.abierta) return;
  const caja = $('#aviso-asistencia');
  caja.className = 'aviso-asistencia tarjeta';
  caja.innerHTML = `<span class="aviso-asistencia__punto" aria-hidden="true"></span>
    <div><strong>¿Ya estás en el evento?</strong><p>Registra tu asistencia con tu cédula. Toma un segundo.</p></div>
    <a class="boton boton--verde" href="asistir.html">Registrar mi asistencia</a>`;
  caja.hidden = false;
}).catch(() => {});

function mostrarPase(p) {
  paseActual = p;
  contPase.innerHTML = p ? htmlPase(p) : htmlPaseVacio();
  acciones.hidden = !p;
}

function iniciar() {
  const guardado = ultimoPase();
  mostrarPase(guardado);
  if (guardado) {
    resultado.innerHTML = mensaje('info', 'Este es el último pase que consultaste aquí',
      'Si es de otra persona, consulta un documento distinto.');
  }
  const doc = new URLSearchParams(location.search).get('doc');
  if (doc) { campo.value = doc; form.requestSubmit(); }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const doc = normalizarDoc(campo.value);
  if (doc.length < 4) {
    campo.setAttribute('aria-invalid', 'true');
    resultado.innerHTML = mensaje('error', 'Escribe tu número de documento', 'Debe tener al menos 4 caracteres, sin puntos ni espacios.');
    campo.focus();
    return;
  }
  campo.removeAttribute('aria-invalid');
  boton.disabled = true; boton.textContent = 'Consultando…';
  try {
    const r = await api.consultar(doc);
    if (r?.encontrado) {
      mostrarPase(r);
      guardarUltimoPase({ ...r, documento: doc });
      resultado.innerHTML = mensaje('ok', `¡Estás en la lista, ${r.nombre.split(' ')[0]}!`,
        'Guarda tu pase. Al llegar puedes registrar tu asistencia tú mismo con tu cédula, o mostrar este QR al personal de la entrada para que lo escanee.');
      if (matchMedia('(max-width: 959px)').matches) contPase.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      mostrarPase(null);
      resultado.innerHTML = mensaje('aviso', 'No encontramos ese documento',
        `Revisa que esté bien escrito. Si eres de la UCEVA, tu dependencia puede no haber enviado la lista todavía; en ese caso, o si eres invitado, regístrate ahora.
         <br><a class="boton boton--verde" href="registro.html?doc=${encodeURIComponent(doc)}">Registrarme ${ICONOS.flecha}</a>`);
    }
  } catch (err) {
    resultado.innerHTML = mensaje('error', 'No pudimos consultar en este momento',
      err.sinConexion ? 'Revisa tu conexión a internet e inténtalo de nuevo.' : esc(err.message));
  } finally {
    boton.disabled = false; boton.textContent = 'Consultar';
  }
});

window.addEventListener('DOMContentLoaded', iniciar);
