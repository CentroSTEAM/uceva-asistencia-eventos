// Pantalla del personal en la puerta: escáner QR, búsqueda por documento
// y respaldo sin conexión (padrón local + cola de sincronización).

import { api, TIPOS, limpiarToken, normalizarDoc } from './api.js';
import { CONFIG, MODO_DEMO } from './config.js';
import { montarBarra, mensaje, esc, ICONOS, $ } from './comun.js';
import { exigirSesion, salir } from './sesion.js';

const raiz = $('#contenido');
const LS = { padron: 'uceva-padron', cola: 'uceva-cola', punto: 'uceva-punto', conteo: 'uceva-conteo' };
const leerLS = (k, def) => { try { return JSON.parse(localStorage.getItem(k)) ?? def; } catch { return def; } };
const guardarLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const horaCorta = (iso) => iso ? new Date(iso).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' }) : '';

montarBarra('ingreso.html', [['ingreso.html', 'Ingreso'], ['panel.html', 'Panel']]);
const perfil = await exigirSesion(raiz);

// ---------------------------------------------------------------------
//  Estado
// ---------------------------------------------------------------------

let padron = leerLS(LS.padron, { fecha: null, filas: [] });
let porToken = new Map(), porDoc = new Map();
const indexar = () => {
  porToken = new Map(padron.filas.map((f) => [f[0], f]));
  porDoc = new Map(padron.filas.map((f) => [f[1], f]));
};
indexar();
let cola = leerLS(LS.cola, []);
let conteo = leerLS(LS.conteo, { fecha: new Date().toDateString(), n: 0 });
if (conteo.fecha !== new Date().toDateString()) conteo = { fecha: new Date().toDateString(), n: 0 };
let punto = localStorage.getItem(LS.punto) || CONFIG.puntos[0];

// ---------------------------------------------------------------------
//  Interfaz
// ---------------------------------------------------------------------

raiz.innerHTML = `
  <div class="puesto">
    <div class="puesto__fila">
      <div class="campo campo--compacto">
        <label for="punto">Punto de ingreso</label>
        <select id="punto">${CONFIG.puntos.map((p) => `<option${p === punto ? ' selected' : ''}>${esc(p)}</option>`).join('')}</select>
      </div>
      <p class="puesto__conteo"><strong id="conteo">${conteo.n}</strong><span>ingresos aquí</span></p>
    </div>
    <p class="puesto__estado" id="estado" role="status"></p>
  </div>

  <div class="pestanas" role="tablist" aria-label="Forma de registrar">
    <button role="tab" id="tab-qr" aria-controls="panel-qr" aria-selected="true">${ICONOS.camara} Escanear QR</button>
    <button role="tab" id="tab-doc" aria-controls="panel-doc" aria-selected="false" tabindex="-1">${ICONOS.buscar} Por documento</button>
  </div>

  <section id="panel-qr" role="tabpanel" aria-labelledby="tab-qr" class="panel-ingreso">
    <div class="visor" id="visor">
      <video id="video" playsinline muted></video>
      <div class="visor__inactivo" id="visor-inactivo">
        <p>La cámara está apagada.</p>
        <button class="boton" type="button" id="btn-camara">${ICONOS.camara} Activar cámara</button>
      </div>
    </div>
    <p class="ayuda visor__ayuda">Apunta al código QR del pase. El resultado aparece solo; no hace falta tocar nada.</p>
  </section>

  <section id="panel-doc" role="tabpanel" aria-labelledby="tab-doc" class="panel-ingreso" hidden>
    <form id="form-buscar" class="buscar" novalidate>
      <label for="q">Documento o nombre</label>
      <div class="buscar__fila">
        <input id="q" type="search" inputmode="search" autocomplete="off" placeholder="1116254789 o Valentina Rojas">
        <button class="boton" type="submit">Buscar</button>
      </div>
      <p class="ayuda">Si escribes el documento completo, el ingreso se registra de una vez.</p>
    </form>
    <div id="resultados" aria-live="polite"></div>
  </section>

  <div class="puesto__pie">
    <span>${esc(perfil.nombre)}${MODO_DEMO ? ' (demostración)' : ''}</span>
    <button type="button" class="enlace" id="btn-padron">Actualizar padrón</button>
    <button type="button" class="enlace" id="btn-salir">Cerrar sesión</button>
  </div>

  <div class="veredicto" id="veredicto" hidden role="alertdialog" aria-modal="true" aria-labelledby="veredicto-titulo" tabindex="-1">
    <div class="veredicto__caja">
      <div class="veredicto__icono" id="veredicto-icono"></div>
      <p class="veredicto__titulo" id="veredicto-titulo"></p>
      <p class="veredicto__nombre" id="veredicto-nombre"></p>
      <p class="veredicto__detalle" id="veredicto-detalle"></p>
      <button class="boton boton--bloque veredicto__seguir" type="button" id="btn-seguir">Siguiente</button>
    </div>
  </div>`;

const el = {
  estado: $('#estado'), conteo: $('#conteo'), video: $('#video'), inactivo: $('#visor-inactivo'),
  veredicto: $('#veredicto'), resultados: $('#resultados'), q: $('#q'),
};

$('#punto').addEventListener('change', (e) => { punto = e.target.value; localStorage.setItem(LS.punto, punto); });
$('#btn-salir').addEventListener('click', salir);
$('#btn-padron').addEventListener('click', () => actualizarPadron(true));

// Pestañas
const tabs = [$('#tab-qr'), $('#tab-doc')];
function mostrarPestana(t) {
  tabs.forEach((x) => {
    const activa = x === t;
    x.setAttribute('aria-selected', activa); x.tabIndex = activa ? 0 : -1;
    $('#' + x.getAttribute('aria-controls')).hidden = !activa;
  });
  if (t.id === 'tab-doc') { pausarCamara(); el.q.focus(); } else if (camaraEncendida) reanudarCamara();
}
tabs.forEach((t) => t.addEventListener('click', () => mostrarPestana(t)));
$('.pestanas').addEventListener('keydown', (e) => {
  if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  const i = tabs.indexOf(document.activeElement); const sig = tabs[(i + 1) % 2];
  sig.focus(); mostrarPestana(sig);
});

// ---------------------------------------------------------------------
//  Estado de conexión, padrón y cola
// ---------------------------------------------------------------------

function pintarEstado() {
  const enLinea = navigator.onLine;
  const pendientes = cola.length;
  const padronTxt = padron.fecha ? `Padrón de ${padron.filas.length.toLocaleString('es-CO')} personas, actualizado a las ${horaCorta(padron.fecha)}` : 'Padrón aún sin descargar.';
  el.estado.className = `puesto__estado ${enLinea ? 'en-linea' : 'sin-linea'}`;
  el.estado.innerHTML = `${enLinea ? ICONOS.ok : ICONOS.aviso}
    <span><strong>${enLinea ? 'En línea' : 'Sin internet'}</strong>${pendientes ? `, ${pendientes} ingreso${pendientes > 1 ? 's' : ''} por sincronizar` : ''}. ${padronTxt}</span>`;
  el.conteo.textContent = conteo.n.toLocaleString('es-CO');
}

async function actualizarPadron(manual = false) {
  try {
    const filas = await api.padron();
    padron = { fecha: new Date().toISOString(), filas };
    // Conserva las marcas locales que aún no se sincronizan
    cola.forEach((c) => {
      const f = filas.find((x) => (c.token && x[0] === c.token) || (c.documento && x[1] === c.documento));
      if (f && !f[5]) f[5] = c.hora;
    });
    indexar(); guardarLS(LS.padron, padron);
    if (manual) alertaBreve(`Padrón actualizado: ${filas.length.toLocaleString('es-CO')} personas.`);
  } catch (e) {
    if (manual) alertaBreve('No se pudo actualizar el padrón. Se sigue usando la última copia.');
  }
  pintarEstado();
}

async function sincronizar() {
  if (!cola.length || !navigator.onLine) return pintarEstado();
  const lote = cola.slice(0, 200);
  try {
    const r = await api.registrarLote(lote);
    const listos = new Set(r.map((x) => x.id_local));
    cola = cola.filter((c) => !listos.has(c.id_local));
    guardarLS(LS.cola, cola);
  } catch {}
  pintarEstado();
}

function alertaBreve(texto) {
  const n = document.createElement('div');
  n.className = 'brindis'; n.setAttribute('role', 'status'); n.textContent = texto;
  document.body.append(n); setTimeout(() => n.remove(), 4000);
}

window.addEventListener('online', () => { pintarEstado(); sincronizar(); });
window.addEventListener('offline', pintarEstado);
setInterval(sincronizar, 8000);
setInterval(() => navigator.onLine && actualizarPadron(), 3 * 60e3);
pintarEstado();
actualizarPadron();
sincronizar();

// ---------------------------------------------------------------------
//  Registrar un ingreso (en línea, o con el padrón local si no hay red)
// ---------------------------------------------------------------------

function registrarLocal({ token, documento }) {
  const f = token ? porToken.get(token) : porDoc.get(documento);
  if (!f) return { estado: 'no_encontrado', local: true };
  const base = { nombre: f[2], tipo_asistente: f[3], dependencia: f[4], documento: f[1], local: true };
  if (f[5]) return { estado: 'repetido', ...base, hora_previa: f[5] };
  const hora = new Date().toISOString();
  f[5] = hora; guardarLS(LS.padron, padron);
  cola.push({ id_local: Date.now() + Math.random(), token: token || null, documento: token ? null : documento, hora, punto });
  guardarLS(LS.cola, cola);
  return { estado: 'ok', ...base, hora };
}

async function registrar({ token, documento }) {
  let r;
  try {
    r = await api.registrarIngreso({ token, documento, punto });
    const f = token ? porToken.get(token) : porDoc.get(r.documento || documento);
    if (f && r.estado === 'ok') { f[5] = r.hora; guardarLS(LS.padron, padron); }
  } catch (e) {
    if (e.permiso) { alertaBreve('Tu sesión venció. Vuelve a entrar.'); setTimeout(() => location.reload(), 1500); throw e; }
    r = registrarLocal({ token, documento });
  }
  if (r.estado === 'ok') { conteo.n++; guardarLS(LS.conteo, conteo); }
  pintarEstado();
  return r;
}

// ---------------------------------------------------------------------
//  Veredicto a pantalla completa
// ---------------------------------------------------------------------

let audio;
function sonar(ok) {
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    const tonos = ok ? [[880, 0, .12]] : [[220, 0, .16], [220, .22, .16]];
    tonos.forEach(([f, t, d]) => {
      const o = audio.createOscillator(); const g = audio.createGain();
      o.frequency.value = f; o.type = 'sine'; g.gain.value = .18;
      o.connect(g).connect(audio.destination);
      o.start(audio.currentTime + t); o.stop(audio.currentTime + t + d);
    });
  } catch {}
  try { navigator.vibrate?.(ok ? 80 : [120, 80, 120]); } catch {}
}

let cerrarVeredicto = null;
function mostrarVeredicto(r) {
  const tipos = {
    ok: ['ok', 'Puede entrar', ICONOS.ok],
    repetido: ['aviso', 'Ya había ingresado', ICONOS.aviso],
    no_encontrado: ['error', 'No está en la lista', ICONOS.error],
  };
  const [clase, titulo, icono] = tipos[r.estado] || tipos.no_encontrado;
  const v = el.veredicto;
  v.className = `veredicto veredicto--${clase}`;
  $('#veredicto-icono').innerHTML = icono;
  $('#veredicto-titulo').textContent = titulo;
  $('#veredicto-nombre').textContent = r.nombre || '';
  const det = [];
  if (r.tipo_asistente) det.push(TIPOS[r.tipo_asistente] || r.tipo_asistente);
  if (r.dependencia) det.push(r.dependencia);
  let detalle = det.join(', ');
  if (r.estado === 'repetido') detalle += `<br>Entró a las ${horaCorta(r.hora_previa)}${r.punto_previo ? ` por ${esc(r.punto_previo)}` : ''}. Verifica su documento.`;
  if (r.estado === 'no_encontrado') detalle = 'Búscalo por documento. Si no aparece, pídele que se registre como invitado en el celular y vuelve a escanear.';
  if (r.local && r.estado === 'ok') detalle += '<br><span class="veredicto__marca">Registrado sin internet: se enviará al volver la conexión.</span>';
  $('#veredicto-detalle').innerHTML = r.estado === 'repetido' || r.estado === 'no_encontrado' || r.local ? detalle : esc(detalle);
  v.hidden = false;
  sonar(r.estado === 'ok');

  return new Promise((resolver) => {
    let reloj;
    const cerrar = () => { clearTimeout(reloj); v.hidden = true; cerrarVeredicto = null; resolver(); };
    cerrarVeredicto = cerrar;
    $('#btn-seguir').onclick = cerrar;
    if (r.estado === 'ok') { reloj = setTimeout(cerrar, 1700); v.onclick = cerrar; }
    else { v.onclick = null; $('#btn-seguir').focus(); }
  });
}
document.addEventListener('keydown', (e) => { if (cerrarVeredicto && (e.key === 'Escape' || e.key === 'Enter')) { e.preventDefault(); cerrarVeredicto(); } });

// ---------------------------------------------------------------------
//  Cámara
// ---------------------------------------------------------------------

let escaner = null, camaraEncendida = false, ocupado = false, ultimo = { codigo: '', t: 0 };

async function procesarCodigo(texto) {
  const token = limpiarToken(texto);
  if (ocupado) return;
  if (token === ultimo.codigo && Date.now() - ultimo.t < 4000) return;
  ultimo = { codigo: token, t: Date.now() };
  if (!/^[0-9A-Z]{6,16}$/.test(token)) {
    ocupado = true;
    await mostrarVeredicto({ estado: 'no_encontrado' });
    ocupado = false; return;
  }
  ocupado = true;
  escaner?.pause?.(false);
  try { await mostrarVeredicto(await registrar({ token })); }
  catch {}
  finally { ocupado = false; if (camaraEncendida && !$('#panel-qr').hidden) reanudarCamara(); }
}

async function encenderCamara() {
  const btn = $('#btn-camara');
  btn.disabled = true; btn.textContent = 'Activando…';
  try {
    const { default: QrScanner } = await import('../vendor/qr-scanner.min.js');
    escaner ||= new QrScanner(el.video, (r) => procesarCodigo(r.data), {
      preferredCamera: 'environment', maxScansPerSecond: 10,
      highlightScanRegion: true, highlightCodeOutline: true, returnDetailedScanResult: true,
    });
    await escaner.start();
    camaraEncendida = true; el.inactivo.hidden = true;
  } catch (e) {
    el.inactivo.innerHTML = mensaje('error', 'No se pudo usar la cámara',
      'Revisa que el navegador tenga permiso de cámara y que la página abra con https. Mientras tanto usa la búsqueda por documento.');
  }
}
function pausarCamara() { escaner?.pause?.(true); }
function reanudarCamara() { escaner?.start?.().catch(() => {}); }
$('#btn-camara').addEventListener('click', encenderCamara);

// ---------------------------------------------------------------------
//  Búsqueda por documento o nombre
// ---------------------------------------------------------------------

$('#form-buscar').addEventListener('submit', async (e) => {
  e.preventDefault();
  const texto = el.q.value.trim();
  if (texto.length < 3) { el.resultados.innerHTML = mensaje('aviso', 'Escribe al menos 3 caracteres'); return; }
  const doc = normalizarDoc(texto);
  const esDocumento = /^[0-9]{5,}$/.test(doc) || /^[A-Z]{1,3}[0-9]{5,}$/.test(doc);

  // Documento completo y conocido: registra de una vez.
  if (esDocumento && (porDoc.has(doc) || !padron.fecha)) {
    const r = await registrar({ documento: doc });
    await mostrarVeredicto(r);
    if (r.estado !== 'no_encontrado') { el.q.value = ''; el.resultados.innerHTML = ''; }
    el.q.focus();
    if (r.estado !== 'no_encontrado') return;
  }

  el.resultados.innerHTML = '<p class="ayuda">Buscando…</p>';
  let lista;
  try { lista = await api.buscar(texto); }
  catch {
    const t = texto.toLowerCase();
    lista = padron.filas.filter((f) => f[1].startsWith(doc) || f[2].toLowerCase().includes(t)).slice(0, 12)
      .map((f) => ({ documento: f[1], nombre: f[2], tipo_asistente: f[3], dependencia: f[4], ingreso: f[5] }));
  }
  if (!lista.length) {
    el.resultados.innerHTML = mensaje('error', 'Nadie coincide con esa búsqueda',
      'Si es invitado, pídele que se registre en <strong>registro.html</strong> desde su celular y vuelve a buscarlo.');
    return;
  }
  el.resultados.innerHTML = `<ul class="lista-personas">${lista.map((p) => `
    <li>
      <div>
        <strong>${esc(p.nombre)}</strong>
        <span>${esc(TIPOS[p.tipo_asistente] || p.tipo_asistente)}${p.dependencia ? `, ${esc(p.dependencia)}` : ''}. Documento ${esc(p.documento)}</span>
      </div>
      ${p.ingreso
        ? `<span class="etiqueta etiqueta--aviso">${ICONOS.aviso} Entró ${horaCorta(p.ingreso)}</span>`
        : `<button class="boton" type="button" data-doc="${esc(p.documento)}">Registrar ingreso</button>`}
    </li>`).join('')}</ul>`;
});

el.resultados.addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-doc]');
  if (!b) return;
  b.disabled = true;
  const r = await registrar({ documento: b.dataset.doc });
  await mostrarVeredicto(r);
  if (r.estado === 'ok' || r.estado === 'repetido') b.outerHTML = `<span class="etiqueta etiqueta--aviso">${ICONOS.aviso} Entró ${horaCorta(r.hora || r.hora_previa)}</span>`;
  else b.disabled = false;
  el.q.focus(); el.q.select();
});

if (MODO_DEMO) window.__simularEscaneo = procesarCodigo;
