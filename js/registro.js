import { api, normalizarDoc } from './api.js';
import { CONFIG } from './config.js';
import { montarBarra, mensaje, htmlPase, htmlPaseVacio, descargarPase, guardarUltimoPase, ICONOS, esc, $ } from './comun.js';

montarBarra('registro.html');

const form = $('#form-registro');
const errores = $('#errores');
const boton = $('#btn-registrar');
const contPase = $('#pase');
const acciones = $('#acciones-pase');
const docEstado = $('#documento-estado');
let paseActual = null;

$('#enlace-politica').href = CONFIG.institucion.politicaDatosUrl;
$('#btn-descargar').innerHTML = `${ICONOS.descargar} Descargar pase`;
$('#btn-descargar').addEventListener('click', () => paseActual && descargarPase(paseActual));
$('#btn-imprimir').addEventListener('click', () => window.print());

const docInicial = new URLSearchParams(location.search).get('doc');
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

const REGLAS = [
  ['documento', (v) => normalizarDoc(v).length >= 4 && normalizarDoc(v).length <= 20, 'Escribe un número de documento válido.'],
  ['nombres', (v) => v.trim().length >= 2, 'Escribe tus nombres.'],
  ['apellidos', (v) => v.trim().length >= 2, 'Escribe tus apellidos.'],
  ['correo', (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim()), 'Escribe un correo válido, por ejemplo nombre@correo.com.'],
  ['celular', (v) => v.replace(/\D/g, '').length >= 7, 'Escribe un número de celular de al menos 7 dígitos.'],
  ['entidad', (v) => v.trim().length >= 2, 'Cuéntanos de dónde nos visitas.'],
];

function validar() {
  const fallas = [];
  form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
  form.querySelectorAll('.error-campo[data-regla]').forEach((el) => el.remove());
  for (const [nombre, ok, texto] of REGLAS) {
    const el = form.elements[nombre];
    if (!ok(el.value)) {
      fallas.push([el, texto]);
      el.setAttribute('aria-invalid', 'true');
      const p = document.createElement('p'); p.className = 'error-campo'; p.dataset.regla = nombre; p.id = `err-${nombre}`; p.textContent = texto;
      el.closest('.campo').append(p);
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
    entidad: form.entidad.value.trim(),
    poblacion,
    acepta_datos_sensibles: poblacion.length > 0 && $('#acepta_datos_sensibles').checked,
    acepta_tratamiento: true,
  };

  boton.disabled = true; boton.textContent = 'Registrando…';
  try {
    const r = await api.registrarExterno(datos);
    if (r.estado === 'ya_registrado') {
      errores.innerHTML = mensaje('aviso', 'Ese documento ya está en la lista',
        `No necesitas registrarte otra vez. <a href="index.html?doc=${encodeURIComponent(datos.documento)}">Ver mi pase</a>`);
      errores.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    paseActual = r;
    guardarUltimoPase(r);
    form.hidden = true;
    contPase.innerHTML = htmlPase(r);
    acciones.hidden = false;
    $('#resultado').innerHTML = mensaje('ok', `Listo, ${r.nombre.split(' ')[0]}. Ya estás en la lista`,
      'Descarga tu pase o toma una captura de pantalla y muéstralo en la entrada. También puedes consultarlo cuando quieras con tu documento.');
    $('#titulo').textContent = 'Registro completo';
    document.querySelector('.entrada').hidden = true;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    errores.innerHTML = mensaje('error', 'No pudimos completar tu registro',
      err.sinConexion ? 'Revisa tu conexión a internet e inténtalo de nuevo. Tus datos siguen en el formulario.' : esc(err.message));
  } finally {
    boton.disabled = false; boton.textContent = 'Registrarme y obtener mi pase';
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
