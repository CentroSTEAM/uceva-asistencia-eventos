// Panel de administración: asistencia en vivo, carga de bases institucionales
// y exportación del listado de asistentes.

import { api, TIPOS } from './api.js';
import { CONFIG } from './config.js';
import { montarBarra, mensaje, esc, ICONOS, $, svgDeTexto, qrDeTexto } from './comun.js';
import { ENLACES_PERSONAL } from './comun.js';
import { exigirSesion, salir } from './sesion.js';

const raiz = $('#contenido');
montarBarra('panel.html', ENLACES_PERSONAL);
const perfil = await exigirSesion(raiz, { soloAdmin: true });
const num = (n) => Number(n || 0).toLocaleString('es-CO');

raiz.innerHTML = `
  <div class="panel-cabeza">
    <div>
      <h1>${esc(CONFIG.evento.nombre)}</h1>
      <p class="entrada">Asistencia en vivo. Se actualiza cada 10 segundos.</p>
    </div>
    <p class="panel-cabeza__quien">${esc(perfil.nombre)} <button type="button" class="enlace" id="btn-salir">Cerrar sesión</button></p>
  </div>

  <section class="cifras" aria-label="Resumen">
    <div class="cifra cifra--mayor"><span class="cifra__valor" id="c-ingresos">…</span><span class="cifra__texto">personas han ingresado</span></div>
    <div class="cifra"><span class="cifra__valor" id="c-15">…</span><span class="cifra__texto">en los últimos 15 minutos</span></div>
    <div class="cifra"><span class="cifra__valor" id="c-base">…</span><span class="cifra__texto">personas en la base</span></div>
    <div class="cifra"><span class="cifra__valor" id="c-externos">…</span><span class="cifra__texto" id="c-externos-texto">registrados en línea</span></div>
  </section>

  <section class="bloque cartel" aria-labelledby="t-cartel">
    <div class="cartel__info">
      <h2 id="t-cartel">Registro de asistencia</h2>
      <p>Cada persona registra su asistencia con su cédula desde su celular: escaneando este código en la entrada o entrando a la página "Asistencia". Solo funciona mientras el registro esté abierto: ábrelo cuando empiece el evento y ciérralo al terminar.</p>
      <p class="cartel__estado" id="cartel-estado" role="status">…</p>
      <div class="cartel__botones">
        <button class="boton boton--verde" type="button" id="btn-abrir" disabled>…</button>
        <button class="boton boton--claro" type="button" id="btn-cartel" disabled>${ICONOS.descargar} Descargar cartel</button>
        <button class="boton boton--claro" type="button" id="btn-copiar" disabled>Copiar enlace</button>
      </div>
      <div id="cartel-msg" aria-live="polite"></div>
    </div>
    <div class="cartel__qr" id="cartel-qr"></div>
  </section>

  <div class="rejilla">
    <section class="bloque" aria-labelledby="t-tipo">
      <h2 id="t-tipo">Ingresos por tipo de asistente</h2>
      <div id="por-tipo" class="barras"></div>
    </section>
    <section class="bloque" aria-labelledby="t-punto">
      <h2 id="t-punto">Ingresos por punto</h2>
      <div id="por-punto" class="barras"></div>
    </section>
    <section class="bloque bloque--ancho" aria-labelledby="t-flujo">
      <h2 id="t-flujo">Llegadas cada 15 minutos</h2>
      <div id="flujo" class="flujo"></div>
    </section>
  </div>

  <div class="rejilla">
    <section class="bloque" aria-labelledby="t-importar">
      <h2 id="t-importar">Cargar base institucional</h2>
      <p>Sube el archivo CSV que envía cada dependencia. Si una persona ya existe, se actualizan sus datos y conserva su mismo código QR.</p>
      <form id="form-importar" novalidate>
        <div class="campo">
          <label for="archivo">Archivo CSV</label>
          <input id="archivo" type="file" accept=".csv,text/csv">
          <p class="ayuda">Columnas: documento, nombres, apellidos, tipo_asistente, dependencia, correo, celular. Separadas por coma o punto y coma. <a href="#" id="btn-plantilla">Descargar plantilla</a></p>
        </div>
        <div class="campo">
          <label for="tipo-defecto">Si el archivo no trae el tipo de asistente, usar</label>
          <select id="tipo-defecto">
            <option value="">El que venga en el archivo</option>
            ${Object.entries(TIPOS).filter(([k]) => k !== 'externo').map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}
          </select>
        </div>
        <div id="vista-previa"></div>
        <button class="boton" type="submit" id="btn-importar" disabled>Cargar personas</button>
      </form>
      <div id="importar-resultado" aria-live="polite"></div>
    </section>

    <section class="bloque" aria-labelledby="t-exportar">
      <h2 id="t-exportar">Descargar asistencia</h2>
      <p>Listado de quienes ingresaron, con hora, punto y datos de contacto. Se abre en Excel.</p>
      <button class="boton" type="button" id="btn-exportar">${ICONOS.descargar} Descargar listado</button>
      <div id="exportar-resultado" aria-live="polite"></div>
    </section>
  </div>`;

$('#btn-salir').addEventListener('click', salir);

// ---------------------------------------------------------------------
//  Cifras en vivo
// ---------------------------------------------------------------------

function barras(obj, etiqueta = (k) => k, colorPorTipo = false) {
  const filas = Object.entries(obj || {}).sort((a, b) => b[1] - a[1]);
  if (!filas.length) return '<p class="ayuda">Aún no hay ingresos.</p>';
  const max = Math.max(...filas.map((f) => f[1]));
  return filas.map(([k, n]) => `
    <div class="barra-fila">
      <span class="barra-fila__nombre">${esc(etiqueta(k))}</span>
      <span class="barra-fila__pista"><span class="barra-fila__valor" style="width:${(n / max) * 100}%; --c: ${colorPorTipo ? `var(--t-${esc(k)}, var(--verde))` : 'var(--verde)'}"></span></span>
      <span class="barra-fila__n">${num(n)}</span>
    </div>`).join('');
}

function flujo(lista) {
  if (!lista?.length) return '<p class="ayuda">Aún no hay ingresos.</p>';
  const ult = lista.slice(-16); const max = Math.max(...ult.map((x) => x.n));
  return `<div class="flujo__barras" role="img" aria-label="${ult.map((x) => `${new Date(x.hora).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })}: ${x.n}`).join('; ')}">
    ${ult.map((x) => `<div class="flujo__col"><span class="flujo__n">${num(x.n)}</span><span class="flujo__barra" style="height:${Math.max(4, (x.n / max) * 100)}%"></span>
    <span class="flujo__hora">${new Date(x.hora).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })}</span></div>`).join('')}</div>`;
}

async function refrescar() {
  try {
    const e = await api.estadisticas();
    $('#c-ingresos').textContent = num(e.ingresos);
    $('#c-15').textContent = num(e.ultimos_15_min);
    $('#c-base').textContent = num(e.base);
    $('#c-externos').textContent = num((e.externos_registrados || 0) + (e.uceva_autorregistro || 0));
    $('#c-externos-texto').textContent = `registrados en línea: ${num(e.externos_registrados)} invitados y ${num(e.uceva_autorregistro)} de la UCEVA sin listar`;
    $('#por-tipo').innerHTML = barras(e.por_tipo, (k) => TIPOS[k] || k, true);
    $('#por-punto').innerHTML = barras(e.por_punto);
    $('#flujo').innerHTML = flujo(e.por_hora);
  } catch (err) {
    if (err.permiso) location.reload();
  }
}
refrescar();
setInterval(refrescar, 10000);

// ---------------------------------------------------------------------
//  CSV
// ---------------------------------------------------------------------

function leerCSV(texto) {
  texto = texto.replace(/^﻿/, '');
  const primera = texto.split(/\r?\n/)[0] || '';
  const sep = (primera.match(/;/g) || []).length > (primera.match(/,/g) || []).length ? ';' : ',';
  const filas = []; let fila = [], campo = '', comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') comillas = false;
      else campo += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) { fila.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      fila.push(campo); filas.push(fila); fila = []; campo = '';
    } else campo += c;
  }
  if (campo || fila.length) { fila.push(campo); filas.push(fila); }
  return filas.filter((f) => f.some((x) => x.trim()));
}

const ALIAS = {
  documento: ['documento', 'numero_documento', 'no_documento', 'cedula', 'identificacion', 'num_documento', 'nro_documento', 'doc'],
  tipo_documento: ['tipo_documento', 'tipo_doc', 'tipodoc'],
  nombres: ['nombres', 'nombre', 'primer_nombre'],
  apellidos: ['apellidos', 'apellido'],
  correo: ['correo', 'email', 'correo_electronico', 'correo_institucional', 'e_mail'],
  celular: ['celular', 'telefono', 'movil', 'telefono_celular'],
  tipo_asistente: ['tipo_asistente', 'tipo', 'rol', 'estamento', 'vinculacion'],
  dependencia: ['dependencia', 'programa', 'facultad', 'area', 'oficina', 'programa_academico'],
};
const clave = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const SINONIMOS_TIPO = { profesor: 'docente', estudiantes: 'estudiante', funcionario: 'administrativo', administrativos: 'administrativo',
  docentes: 'docente', investigadores: 'investigador', directivos: 'directivo', egresados: 'egresado', graduado: 'egresado' };

let filasListas = [];

$('#archivo').addEventListener('change', async (e) => {
  const f = e.target.files[0]; filasListas = [];
  $('#btn-importar').disabled = true; $('#importar-resultado').innerHTML = '';
  if (!f) { $('#vista-previa').innerHTML = ''; return; }
  const buf = await f.arrayBuffer();
  let texto = new TextDecoder('utf-8').decode(buf);
  if (texto.includes('�')) texto = new TextDecoder('windows-1252').decode(buf); // archivos guardados desde Excel
  const tabla = leerCSV(texto);
  if (tabla.length < 2) { $('#vista-previa').innerHTML = mensaje('error', 'El archivo está vacío o no tiene encabezados'); return; }
  const cab = tabla[0].map(clave);
  const indice = {};
  for (const [campo, alias] of Object.entries(ALIAS)) { const i = cab.findIndex((c) => alias.includes(c)); if (i >= 0) indice[campo] = i; }
  const faltan = ['documento', 'nombres'].filter((c) => !(c in indice));
  if (faltan.length) {
    $('#vista-previa').innerHTML = mensaje('error', `Falta la columna ${faltan.join(' y ')}`, `Encabezados encontrados: ${esc(tabla[0].join(', '))}`);
    return;
  }
  filasListas = tabla.slice(1).map((r) => Object.fromEntries(Object.entries(indice).map(([k, i]) => [k, (r[i] || '').trim()])));
  const sinTipo = !('tipo_asistente' in indice);
  $('#vista-previa').innerHTML = mensaje(sinTipo && !$('#tipo-defecto').value ? 'aviso' : 'ok',
    `${num(filasListas.length)} personas listas para cargar`,
    `Columnas reconocidas: ${Object.keys(indice).join(', ')}.${sinTipo ? ' El archivo no trae tipo de asistente: elige uno arriba.' : ''}`);
  $('#btn-importar').disabled = false;
});

$('#form-importar').addEventListener('submit', async (e) => {
  e.preventDefault();
  const defecto = $('#tipo-defecto').value;
  const filas = filasListas.map((f) => {
    let t = clave(f.tipo_asistente || '') || defecto;
    t = SINONIMOS_TIPO[t] || t;
    return { ...f, tipo_asistente: defecto && !f.tipo_asistente ? defecto : t };
  });
  const btn = $('#btn-importar'); btn.disabled = true;
  const res = { nuevos: 0, actualizados: 0, errores: [] };
  const LOTE = 500;
  try {
    for (let i = 0; i < filas.length; i += LOTE) {
      btn.textContent = `Cargando ${num(Math.min(i + LOTE, filas.length))} de ${num(filas.length)}…`;
      const r = await api.importar(filas.slice(i, i + LOTE));
      res.nuevos += r.nuevos; res.actualizados += r.actualizados;
      res.errores.push(...r.errores.map((x) => ({ ...x, fila: x.fila + i + 1 })));
    }
    $('#importar-resultado').innerHTML = mensaje(res.errores.length ? 'aviso' : 'ok', 'Carga terminada',
      `${num(res.nuevos)} nuevas, ${num(res.actualizados)} actualizadas${res.errores.length ? `, ${num(res.errores.length)} con errores:` : '.'}
      ${res.errores.length ? `<ul class="lista-errores">${res.errores.slice(0, 15).map((x) => `<li>Fila ${x.fila}: ${esc(x.error)}</li>`).join('')}</ul>${res.errores.length > 15 ? `<p>Y ${res.errores.length - 15} más.</p>` : ''}` : ''}`);
    refrescar();
  } catch (err) {
    $('#importar-resultado').innerHTML = mensaje('error', 'La carga se detuvo', `${esc(err.message)} Se alcanzaron a cargar ${num(res.nuevos + res.actualizados)} personas; puedes volver a subir el mismo archivo sin duplicar.`);
  } finally {
    btn.disabled = false; btn.textContent = 'Cargar personas';
  }
});

function descargarCSV(nombre, filas, columnas) {
  const celda = (v) => { const s = v == null ? '' : String(v); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = '﻿' + [columnas.join(';'), ...filas.map((f) => columnas.map((c) => celda(f[c])).join(';'))].join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = nombre; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$('#btn-plantilla').addEventListener('click', (e) => {
  e.preventDefault();
  descargarCSV('plantilla-base-institucional.csv',
    [{ tipo_documento: 'CC', documento: '1116254789', nombres: 'Valentina', apellidos: 'Rojas Arango', tipo_asistente: 'estudiante', dependencia: 'Ingeniería de Sistemas', correo: 'valentina.rojas@uceva.edu.co', celular: '3001234567' }],
    ['tipo_documento', 'documento', 'nombres', 'apellidos', 'tipo_asistente', 'dependencia', 'correo', 'celular']);
});

$('#btn-exportar').addEventListener('click', async () => {
  const btn = $('#btn-exportar'); btn.disabled = true;
  try {
    const filas = (await api.exportar()).map((f) => ({
      ...f, hora_ingreso: f.hora_ingreso ? new Date(f.hora_ingreso).toLocaleString('es-CO') : '',
      tipo_asistente: TIPOS[f.tipo_asistente] || f.tipo_asistente, sin_conexion: f.sin_conexion ? 'sí' : 'no',
      origen: f.origen === 'registro' ? 'Autorregistro' : 'Base oficial',
    }));
    if (!filas.length) { $('#exportar-resultado').innerHTML = mensaje('aviso', 'Todavía no hay ingresos para descargar'); return; }
    descargarCSV(`asistencia-${CONFIG.evento.slug}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv`, filas,
      ['hora_ingreso', 'punto', 'metodo', 'sin_conexion', 'tipo_documento', 'documento', 'nombres', 'apellidos', 'tipo_asistente',
        'dependencia', 'entidad', 'correo', 'celular', 'origen', 'poblacion']);
    $('#exportar-resultado').innerHTML = mensaje('ok', `Descargaste ${num(filas.length)} registros`);
  } catch (err) {
    $('#exportar-resultado').innerHTML = mensaje('error', 'No se pudo descargar', esc(err.message));
  } finally { btn.disabled = false; }
});

// ---------------------------------------------------------------------
//  Cartel de autoregistro de asistencia
// ---------------------------------------------------------------------

let cartel = null;
const enlaceAsistir = () => new URL('asistir.html', location.href).href;

function pintarCartel() {
  const abierto = cartel.abierta;
  $('#cartel-estado').className = `cartel__estado ${abierto ? 'cartel__estado--abierto' : ''}`;
  $('#cartel-estado').innerHTML = `${abierto ? ICONOS.ok : ICONOS.aviso}<span><strong>${abierto ? 'Abierto' : 'Cerrado'}.</strong> ${abierto ? 'Las personas ya pueden registrar su asistencia con su cédula.' : 'Nadie puede registrar asistencia todavía. Ábrelo cuando empiece el evento.'}</span>`;
  $('#btn-abrir').textContent = abierto ? 'Cerrar registro' : 'Abrir registro de asistencia';
  $('#btn-abrir').classList.toggle('boton--verde', !abierto);
  $('#btn-abrir').classList.toggle('boton--claro', abierto);
  $('#cartel-qr').innerHTML = `${svgDeTexto(enlaceAsistir(), 'Código QR para registrar asistencia')}<p class="cartel__codigo">${esc(enlaceAsistir().replace(/^https?:\/\//, ''))}</p>`;
  ['#btn-abrir', '#btn-cartel', '#btn-copiar'].forEach((s) => { $(s).disabled = false; });
}

async function cargarCartel(abierta = null, renovar = false) {
  try { cartel = await api.configAsistencia(abierta, renovar); pintarCartel(); }
  catch (err) { $('#cartel-msg').innerHTML = mensaje('error', 'No se pudo cargar el registro de asistencia', esc(err.message)); }
}

$('#btn-abrir').addEventListener('click', async (e) => { e.currentTarget.disabled = true; await cargarCartel(!cartel.abierta); });
$('#btn-copiar').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(enlaceAsistir()); $('#cartel-msg').innerHTML = mensaje('ok', 'Enlace copiado'); }
  catch { $('#cartel-msg').innerHTML = mensaje('info', 'Copia este enlace', esc(enlaceAsistir())); }
});
$('#btn-cartel').addEventListener('click', async () => {
  try { await document.fonts?.ready; } catch {}
  const W = 1240, H = 1754; const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d'); const css = getComputedStyle(document.documentElement);
  const col = (v) => css.getPropertyValue(v).trim(); const display = col('--display'), fuente = col('--fuente');
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  const franja = g.createLinearGradient(0, 0, W, 0);
  ['--e-verde', '--e-turquesa', '--e-azul', '--e-violeta', '--e-magenta', '--e-ambar'].forEach((v, i, a) => franja.addColorStop(i / (a.length - 1), col(v)));
  g.fillStyle = franja; g.fillRect(0, 0, W, 36); g.fillRect(0, H - 36, W, 36);
  g.textAlign = 'center'; g.fillStyle = col('--verde'); g.font = `700 40px ${fuente}`;
  g.fillText(CONFIG.institucion.nombre, W / 2, 150, W - 160);
  g.fillStyle = col('--tinta'); g.font = `800 112px ${display}`;
  g.fillText(CONFIG.evento.nombre, W / 2, 290, W - 140);
  g.font = `800 84px ${display}`; g.fillStyle = col('--verde-hondo');
  g.fillText('Registra tu asistencia', W / 2, 420, W - 140);
  const qr = qrDeTexto(enlaceAsistir()); const n = qr.getModuleCount();
  const celda = Math.floor(820 / n); const lado = celda * n; const x0 = (W - lado) / 2, y0 = 500;
  g.fillStyle = col('--tinta');
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) g.fillRect(x0 + c * celda, y0 + r * celda, celda, celda);
  let y = y0 + lado + 110;
  g.font = `400 44px ${fuente}`; g.fillStyle = col('--tinta');
  ['Abre la cámara de tu celular y apunta a este código.', 'Escribe tu cédula y toca Registrar. ¡Listo!'].forEach((t) => { g.fillText(t, W / 2, y, W - 160); y += 66; });
  g.font = `400 30px ${fuente}`; g.fillStyle = col('--tinta-2');
  g.fillText(enlaceAsistir().replace(/^https?:\/\//, ''), W / 2, H - 90, W - 160);
  const a = document.createElement('a'); a.download = `cartel-asistencia-${CONFIG.evento.slug}.png`; a.href = cv.toDataURL('image/png');
  document.body.append(a); a.click(); a.remove();
});

cargarCartel();
