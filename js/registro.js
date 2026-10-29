import { api, normalizarDoc } from './api.js';
import { CONFIG } from './config.js';
import { FACULTADES, DEPENDENCIAS, OTRA_DEPENDENCIA } from './unidades.js';
import { montarBarra, mensaje, htmlPase, htmlPaseVacio, descargarPase, guardarUltimoPase, activarTilt, vigilarPase, ICONOS, esc, $ } from './comun.js';

montarBarra('registro.html');

const form = $('#form-registro');
const errores = $('#errores');
const boton = $('#btn-registrar');
const contPase = $('#pase');
const acciones = $('#acciones-pase');
const docEstado = $('#documento-estado');
let paseActual = null;

$('#enlace-politica').href = CONFIG.institucion.politicaDatosUrl;
document.querySelectorAll('[data-icono]').forEach((el) => { el.innerHTML = ICONOS[el.dataset.icono] || ''; });
activarTilt($('.portada__pase'));
vigilarPase($('.portada__pase'));
$('#btn-descargar').innerHTML = `${ICONOS.descargar} Descargar pase`;
$('#btn-descargar').addEventListener('click', () => paseActual && descargarPase(paseActual));
$('#btn-imprimir').addEventListener('click', () => window.print());

const docInicial = new URLSearchParams(location.search).get('doc');
const codigoAsistir = (new URLSearchParams(location.search).get('asistir') || '').trim().toUpperCase();
const horaCorta = (iso) => new Date(iso).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });
if (codigoAsistir) {
  $('#btn-registrar').textContent = 'Registrarme y marcar mi asistencia';
}
if (docInicial) form.documento.value = docInicial;

window.addEventListener('DOMContentLoaded', () => { contPase.innerHTML = htmlPaseVacio(); });

// Avisa de inmediato si el documento ya está en la lista.
let ultimoRevisado = '';
form.documento.addEventListener('blur', async () => {
  const doc = normalizarDoc(form.documento.value);
  if (doc.length < 4 || doc === ultimoRevisado) return;
  ultimoRevisado = doc;
  try {
    const r = await api.consultar(doc);
    docEstado.innerHTML = r?.encontrado
      ? `<p class="error-campo">Este documento ya está en la lista. <a href="index.html?doc=${encodeURIComponent(doc)}">Ver mi pase</a></p>`
      : '';
  } catch { docEstado.innerHTML = ''; }
});

const esUceva = () => $('#vinculo-uceva').checked;
const esFacultad = () => FACULTADES.some((f) => f.nombre === form.unidad.value);
function dependenciaElegida() {
  const u = form.unidad.value;
  if (esFacultad()) return `${u} / ${form.programa.value}`;
  if (u === OTRA_DEPENDENCIA) return form.otra_dependencia.value.trim();
  return u;
}

// Listas desplegables: facultad o dependencia, y luego programa
form.unidad.insertAdjacentHTML('beforeend',
  `<optgroup label="Facultades">${FACULTADES.map((f) => `<option>${esc(f.nombre)}</option>`).join('')}</optgroup>` +
  `<optgroup label="Dependencias">${[...DEPENDENCIAS, OTRA_DEPENDENCIA].map((d) => `<option>${esc(d)}</option>`).join('')}</optgroup>`);
form.unidad.addEventListener('change', () => {
  const fac = FACULTADES.find((f) => f.nombre === form.unidad.value);
  $('#campo-programa').hidden = !fac;
  $('#campo-otra').hidden = form.unidad.value !== OTRA_DEPENDENCIA;
  form.programa.innerHTML = '<option value="">Elige tu programa</option>' +
    (fac ? fac.programas.map((p) => `<option>${esc(p)}</option>`).join('') : '');
  form.querySelectorAll('.error-campo[data-regla="unidad"]').forEach((e) => e.remove());
});
const esInvitado = () => $('#vinculo-invitado').checked;

const REGLAS = [
  ['vinculo-uceva', () => esUceva() || esInvitado(), 'Cuéntanos si eres de la UCEVA o invitado.'],
  ['rol', (v) => !esUceva() || v !== '', 'Elige qué eres en la UCEVA.'],
  ['unidad', (v) => !esUceva() || v !== '', 'Elige tu facultad o dependencia.'],
  ['programa', (v) => !esUceva() || !esFacultad() || v !== '', 'Elige tu programa académico.'],
  ['otra_dependencia', (v) => !esUceva() || form.unidad.value !== OTRA_DEPENDENCIA || v.trim().length >= 2, 'Escribe el nombre de tu dependencia.'],
  ['documento', (v) => normalizarDoc(v).length >= 4 && normalizarDoc(v).length <= 20, 'Escribe un número de documento válido.'],
  ['nombres', (v) => v.trim().length >= 2, 'Escribe tus nombres.'],
  ['apellidos', (v) => v.trim().length >= 2, 'Escribe tus apellidos.'],
  ['correo', (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim()), 'Escribe un correo válido, por ejemplo nombre@correo.com.'],
  ['celular', (v) => v.replace(/\D/g, '').length >= 7, 'Escribe un número de celular de al menos 7 dígitos.'],
  ['entidad', (v) => !esInvitado() || v.trim().length >= 2, 'Cuéntanos de dónde nos visitas.'],
];

function validar() {
  const fallas = [];
  form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  form.querySelectorAll('.error-campo[data-regla]').forEach((el) => el.remove());
  for (const [nombre, ok, texto] of REGLAS) {
    const el = form.elements[nombre] || $('#' + nombre);
    if (!ok(el.value)) {
      fallas.push([el, texto]);
      el.setAttribute('aria-invalid', 'true');
      const p = document.createElement('p'); p.className = 'error-campo'; p.dataset.regla = nombre; p.id = `err-${nombre}`; p.textContent = texto;
      (el.closest('.campo') || el.closest('.eleccion')).append(p);
      const ids = new Set((el.getAttribute('aria-describedby') || '').split(' ').filter(Boolean));
      ids.add(`err-${nombre}`); el.setAttribute('aria-describedby', [...ids].join(' '));
    }
  }
  const legal = $('#acepta_tratamiento');
  if (!legal.checked) fallas.push([legal, 'Para registrarte debes autorizar el tratamiento de tus datos.']);
  return fallas;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errores.innerHTML = '';
  const fallas = validar();
  if (fallas.length) {
    errores.innerHTML = mensaje('error', fallas.length === 1 ? 'Revisa un dato' : `Revisa ${fallas.length} datos`,
      `<ul class="lista-errores">${fallas.map(([el, t]) => `<li><a href="#${el.id}">${esc(t)}</a></li>`).join('')}</ul>`);
    fallas[0][0].focus();
    return;
  }

  const poblacion = [...form.querySelectorAll('input[name="poblacion"]:checked')].map((c) => c.value);
  const datos = {
    tipo_documento: form.tipo_documento.value,
    documento: normalizarDoc(form.documento.value),
    nombres: form.nombres.value.trim(),
    apellidos: form.apellidos.value.trim(),
    correo: form.correo.value.trim(),
    celular: form.celular.value.replace(/[^\d+]/g, ''),
    tipo_asistente: esUceva() ? form.rol.value : 'externo',
    dependencia: esUceva() ? dependenciaElegida() : null,
    entidad: esInvitado() ? form.entidad.value.trim() : null,
    poblacion,
    acepta_datos_sensibles: poblacion.length > 0 && $('#acepta_datos_sensibles').checked,
    acepta_tratamiento: true,
  };

  boton.disabled = true; boton.textContent = 'Registrando…';
  try {
    const r = await api.registrarPersona(datos);
    if (r.estado === 'ya_registrado' && codigoAsistir) {
      const a = await api.registrarAsistencia(codigoAsistir, datos.documento);
      if (a.estado === 'ok' || a.estado === 'repetido') {
        form.hidden = true; $('#entrada').hidden = true; $('#titulo').textContent = 'Asistencia registrada';
        $('#resultado').innerHTML = mensaje('ok', `¡Bienvenido, ${a.nombre.split(' ')[0]}!`,
          `Ya estabas en la lista y tu asistencia quedó registrada a las <strong>${horaCorta(a.hora)}</strong>`);
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
    }
    if (r.estado === 'ya_registrado') {
      errores.innerHTML = mensaje('aviso', 'Ese documento ya está en la lista',
        `No necesitas registrarte otra vez. <a href="index.html?doc=${encodeURIComponent(datos.documento)}">Ver mi pase</a>`);
      errores.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    paseActual = r;
    guardarUltimoPase({ ...r, documento: datos.documento });
    form.hidden = true;
    contPase.innerHTML = htmlPase(r);
    acciones.hidden = false;
    let asistencia = null;
    if (codigoAsistir) { try { asistencia = await api.registrarAsistencia(codigoAsistir, datos.documento); } catch {} }
    if (asistencia && (asistencia.estado === 'ok' || asistencia.estado === 'repetido')) {
      guardarUltimoPase({ ...r, documento: datos.documento, asistio: asistencia.hora });
      $('#resultado').innerHTML = mensaje('ok', `¡Bienvenido, ${r.nombre.split(' ')[0]}! Tu asistencia quedó registrada`,
        `Quedaste inscrito y tu asistencia se guardó a las <strong>${horaCorta(asistencia.hora)}</strong> (abajo está tu pase, por si el personal te lo pide).`);
    } else {
      $('#resultado').innerHTML = mensaje('ok', `Listo, ${r.nombre.split(' ')[0]}. Ya estás en la lista`,
        'Descarga tu pase o toma una captura de pantalla. Al llegar al evento, escanea el código QR de la entrada para registrar tu asistencia.');
    }
    $('#titulo').textContent = 'Registro completo';
    $('#entrada').hidden = true;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    errores.innerHTML = mensaje('error', 'No pudimos completar tu registro',
      err.sinConexion ? 'Revisa tu conexión a internet e inténtalo de nuevo. Tus datos siguen en el formulario.' : esc(err.message));
  } finally {
    boton.disabled = false; boton.textContent = codigoAsistir ? 'Registrarme y marcar mi asistencia' : 'Registrarme y obtener mi pase';
  }
});

// La autorización de dato sensible solo tiene sentido si marcó algún grupo.
const sensible = $('#acepta_datos_sensibles');
const actualizarSensible = () => {
  const alguno = form.querySelector('input[name="poblacion"]:checked');
  sensible.disabled = !alguno;
  if (!alguno) sensible.checked = false;
};
$('#poblacion').addEventListener('change', actualizarSensible);
actualizarSensible();

// Muestra los campos según la relación con la UCEVA.
function actualizarVinculo() {
  const uceva = esUceva(), invitado = esInvitado();
  $('#campos-uceva').hidden = !uceva;
  $('#campo-entidad').hidden = !invitado;
  $('#correo-ayuda').hidden = !uceva;
  if (uceva || invitado) form.querySelector('.error-campo[data-regla="vinculo-uceva"]')?.remove();
  if (uceva && !form.rol.value) form.rol.focus({ preventScroll: true });
}
$('#vinculo').addEventListener('change', actualizarVinculo);
actualizarVinculo();
