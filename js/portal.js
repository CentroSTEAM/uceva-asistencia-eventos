import { api, normalizarDoc } from './api.js';
import { montarBarra, mensaje, htmlPase, htmlPaseVacio, descargarPase, guardarUltimoPase, ultimoPase, ICONOS, $ } from './comun.js';

montarBarra('index.html');

const form = $('#form-consulta');
const campo = $('#documento');
const boton = $('#btn-consultar');
const resultado = $('#resultado');
const contPase = $('#pase');
const acciones = $('#acciones-pase');
let paseActual = null;

$('#btn-descargar').innerHTML = `${ICONOS.descargar} Descargar pase`;
$('#btn-descargar').addEventListener('click', () => paseActual && descargarPase(paseActual));
$('#btn-imprimir').addEventListener('click', () => window.print());

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
      guardarUltimoPase(r);
      resultado.innerHTML = mensaje('ok', `Estás en la lista, ${r.nombre.split(' ')[0]}`,
        'Guarda tu pase y muéstralo en la entrada, desde el celular o impreso.');
      if (matchMedia('(max-width: 899px)').matches) contPase.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      mostrarPase(null);
      resultado.innerHTML = mensaje('aviso', 'No encontramos ese documento',
        `Revisa que esté bien escrito. Si eres de la UCEVA, tu dependencia puede no haber enviado la lista todavía; en ese caso, o si eres invitado, regístrate ahora.
         <br><a class="boton" href="registro.html?doc=${encodeURIComponent(doc)}">Registrarme</a>`);
    }
  } catch (err) {
    resultado.innerHTML = mensaje('error', 'No pudimos consultar en este momento',
      err.sinConexion ? 'Revisa tu conexión a internet e inténtalo de nuevo.' : err.message);
  } finally {
    boton.disabled = false; boton.textContent = 'Consultar';
  }
});

window.addEventListener('DOMContentLoaded', iniciar);
