import { CONFIG, MODO_DEMO } from './config.js';
import { TIPOS } from './api.js';

export const ICONOS = {
  ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m7.5 12.5 3 3 6-6.5"/></svg>',
  aviso: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 7v5.5l3.5 2"/></svg>',
  error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m8.5 8.5 7 7m0-7-7 7"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 11v6M12 7.5v.01"/></svg>',
  descargar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14"/></svg>',
  camara: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M4 12h16"/></svg>',
  calendario: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  lugar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.4"/></svg>',
  boleta: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5V6.5a1.5 1.5 0 0 1 1.5-1.5h14a1.5 1.5 0 0 1 1.5 1.5v2a3.5 3.5 0 0 0 0 7v2a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5v-2a3.5 3.5 0 0 0 0-7Z"/><path d="M14 5v2.5M14 11v2M14 16.5V19"/></svg>',
  persona: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/></svg>',
  flecha: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14m-5-5 5 5-5 5"/></svg>',
  buscar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>',
};

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const $ = (sel, raiz = document) => raiz.querySelector(sel);

export const ENLACES_PUBLICOS = [['index.html', 'Mi pase'], ['registro.html', 'Registro'], ['asistir.html', 'Asistencia'], ['ingreso.html', 'Personal']];
export const ENLACES_PERSONAL = [['index.html', 'Portal'], ['asistir.html', 'Asistencia'], ['panel.html', 'Panel'], ['ingreso.html', 'Escáner']];

export function montarBarra(actual, enlaces = ENLACES_PUBLICOS) {
  // Si en este navegador hay alguien del personal con sesión, el menú público suma "Panel"
  let personal = false;
  try { personal = !!localStorage.getItem('uceva-perfil'); } catch {}
  const publico = enlaces === ENLACES_PUBLICOS;
  if (publico && personal) enlaces = [...ENLACES_PUBLICOS.slice(0, 3), ['panel.html', 'Panel']];
  const barra = document.createElement('header');
  barra.className = enlaces.length > 3 ? 'barra barra--densa' : 'barra';
  barra.innerHTML = `
    <div class="barra__dentro">
      <a class="marca" href="index.html" aria-label="${esc(CONFIG.evento.nombre)}, inicio">
        <span class="marca__logos">
          <img class="marca__55" src="img/uceva-55.png" alt="" width="175" height="159">
          <span class="marca__sep" aria-hidden="true"></span>
          <img class="marca__logo" src="img/logo-uceva.png" alt="UCEVA, Unidad Central del Valle del Cauca" width="511" height="163">
        </span>
      </a>
      <nav aria-label="Principal">
        ${enlaces.map(([href, txt]) => `<a href="${href}"${href === actual ? ' aria-current="page"' : ''}>${esc(txt)}</a>`).join('')}
      </nav>
    </div>`;
  document.body.prepend(barra);
  if (MODO_DEMO) {
    const aviso = document.createElement('div');
    aviso.className = 'aviso-demo';
    aviso.innerHTML = '<strong>Modo demostración.</strong> Los datos se guardan solo en este navegador.';
    barra.after(aviso);
  }
  let pie = document.querySelector('.pie__dentro');
  if (!pie) {
    const f = document.createElement('footer'); f.className = 'pie';
    f.innerHTML = '<div class="pie__dentro"></div>'; document.body.append(f); pie = f.firstChild;
  }
  // Acceso discreto para el personal en las páginas públicas
  if (publico) {
    const acceso = document.createElement('p');
    acceso.className = 'acceso-personal';
    acceso.innerHTML = 'Personal del evento: <a href="panel.html">Panel</a> y <a href="ingreso.html">Escanear QR</a>';
    pie.append(acceso);
  }
  // Créditos del desarrollo
  const creditos = document.createElement('div');
  creditos.className = 'creditos';
  creditos.innerHTML = `
    <span class="creditos__texto">Plataforma desarrollada por</span>
    <span class="creditos__logos">
      <img class="creditos__uceva" src="img/logo-uceva.png" alt="UCEVA, Unidad Central del Valle del Cauca" width="511" height="163">
      <span class="creditos__sep" aria-hidden="true"></span>
      <span class="creditos__steam creditos__vips"><img src="img/vips-logo.png" alt="" width="480" height="351"><span><strong>VIPS</strong><small>Vicerrectoría de Investigación<br>y Proyección Social</small></span></span>
      <span class="creditos__sep" aria-hidden="true"></span>
      <span class="creditos__steam"><img src="img/centro-steam.png" alt="" width="210" height="240"><span><strong>Centro STEAM+</strong><small>UCEVA</small></span></span>
    </span>
    <span class="creditos__contacto">Contacto: <a href="mailto:centrosteam@uceva.edu.co">centrosteam@uceva.edu.co</a></span>`;
  pie.append(creditos);
  const saltar = document.createElement('a');
  saltar.className = 'saltar'; saltar.href = '#contenido'; saltar.textContent = 'Saltar al contenido';
  document.body.prepend(saltar);
}

export function mensaje(tipo, titulo, texto = '') {
  return `<div class="mensaje mensaje--${tipo}" role="${tipo === 'error' ? 'alert' : 'status'}">
    ${ICONOS[tipo] || ICONOS.info}<div><strong>${esc(titulo)}</strong>${texto ? `<p>${texto}</p>` : ''}</div></div>`;
}

// ---------------------------------------------------------------------
//  Pase con QR (boleta digital)
// ---------------------------------------------------------------------

function crearQR(token) {
  const qr = window.qrcode(0, 'M');
  qr.addData(`UCV:${token}`);
  qr.make();
  return qr;
}

function svgQR(qr) {
  const n = qr.getModuleCount(); let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  return `<svg viewBox="0 0 ${n} ${n}" role="img" aria-label="Código QR de tu pase" shape-rendering="crispEdges"><path d="${d}" fill="#0f1a15"/></svg>`;
}

// QR de cualquier texto (por ejemplo, el enlace del cartel de asistencia).
export function qrDeTexto(texto) {
  const qr = window.qrcode(0, 'M'); qr.addData(texto); qr.make(); return qr;
}
export function svgDeTexto(texto, etiqueta = 'Código QR') {
  return svgQR(qrDeTexto(texto)).replace('aria-label="Código QR de tu pase"', `aria-label="${esc(etiqueta)}"`);
}

const lugarFecha = () => [CONFIG.evento.fecha, CONFIG.evento.lugar].filter(Boolean).join(', ');

export function htmlPase(p) {
  const tipo = p.tipo_asistente || 'externo';
  return `
  <div class="pase-marco">
    <article class="pase pase-entrada" style="--tipo: var(--t-${tipo})" aria-label="Tu pase de ingreso">
      <div class="pase__cabeza">
        <div class="pase__sup"><span class="pase__inst">${esc(CONFIG.institucion.sigla)}</span><span class="pase__tipo">${esc(TIPOS[tipo] || tipo)}</span></div>
        <p class="pase__evento">${esc(CONFIG.evento.nombre)}</p>
        <p class="pase__lugar">${esc(lugarFecha())}</p>
      </div>
      <div class="pase__qr">${svgQR(crearQR(p.token))}</div>
      <div class="pase__corte" aria-hidden="true"></div>
      <div class="pase__datos">
        <p class="pase__nombre">${esc(p.nombre)}</p>
        <p class="pase__meta">Documento<b>•••${esc(p.documento_fin)}</b></p>
        <p class="pase__meta pase__meta--der">Código<b>${esc(p.token)}</b></p>
      </div>
    </article>
  </div>`;
}

export const htmlPaseVacio = () => `
  <div class="pase-marco">
    <article class="pase pase--vacio pase-entrada" aria-hidden="true">
      <div class="pase__cabeza">
        <div class="pase__sup"><span class="pase__inst">${esc(CONFIG.institucion.sigla)}</span><span class="pase__tipo">Tu pase</span></div>
        <p class="pase__evento">${esc(CONFIG.evento.nombre)}</p>
        <p class="pase__lugar">${esc(lugarFecha())}</p>
      </div>
      <div class="pase__qr"><div class="pase__hueco">Tu código QR aparecerá aquí</div></div>
      <div class="pase__corte"></div>
      <div class="pase__datos">
        <p class="pase__nombre">Tu nombre</p>
        <p class="pase__meta">Documento<b>••••</b></p>
        <p class="pase__meta pase__meta--der">Código<b>··········</b></p>
      </div>
    </article>
  </div>`;

// Ubica los recortes laterales de la boleta justo en la línea punteada.
export function vigilarPase(contenedor) {
  const ajustar = () => contenedor.querySelectorAll('.pase').forEach((p) => {
    const c = p.querySelector('.pase__corte'); if (c) p.style.setProperty('--corte', `${c.offsetTop}px`);
  });
  new MutationObserver(ajustar).observe(contenedor, { childList: true, subtree: true });
  window.addEventListener('resize', ajustar);
  document.fonts?.ready.then(ajustar);
  ajustar();
}

// Inclinación 3D y brillo que siguen al puntero (solo mouse, sin movimiento reducido).
export function activarTilt(contenedor) {
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  contenedor.addEventListener('pointermove', (e) => {
    const pase = e.target.closest?.('.pase'); if (!pase) return;
    const r = pase.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    pase.classList.add('con-tilt');
    pase.style.setProperty('--ry', `${(x - .5) * 10}deg`);
    pase.style.setProperty('--rx', `${(.5 - y) * 8}deg`);
    pase.style.setProperty('--mx', `${x * 100}%`);
    pase.style.setProperty('--my', `${y * 100}%`);
  });
  contenedor.addEventListener('pointerleave', () => {
    contenedor.querySelectorAll('.pase').forEach((p) => { p.classList.remove('con-tilt'); ['--rx', '--ry'].forEach((v) => p.style.setProperty(v, '0deg')); });
  });
}

// Dibuja el pase en un PNG para guardarlo en el celular.
export async function descargarPase(p) {
  try { await document.fonts?.ready; } catch {}
  const W = 760, H = 1190, S = 2, R = 56, CORTE = 900;
  const cv = document.createElement('canvas'); cv.width = W * S; cv.height = H * S;
  const g = cv.getContext('2d'); g.scale(S, S);
  const css = getComputedStyle(document.documentElement);
  const col = (v) => css.getPropertyValue(v).trim();
  const display = col('--display'), fuente = col('--fuente');
  const tipo = p.tipo_asistente || 'externo';

  // silueta de boleta con recortes laterales
  g.fillStyle = '#f4f7f5'; g.fillRect(0, 0, W, H);
  g.save();
  g.beginPath(); g.roundRect(20, 20, W - 40, H - 40, R); g.clip();
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, W, H);

  // cabecera con espectro
  const CAB = 400;
  const base = g.createLinearGradient(0, 0, W, CAB);
  base.addColorStop(0, col('--e-turquesa')); base.addColorStop(1, col('--e-violeta'));
  g.fillStyle = base; g.fillRect(0, 0, W, CAB);
  [[0, 0, W * .9, col('--e-verde')], [W, 0, W * .8, col('--e-magenta')], [W * .6, CAB * 1.3, W * .8, col('--e-azul')]].forEach(([x, y, r, c]) => {
    const rg = g.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, c); rg.addColorStop(1, c + '00');
    g.fillStyle = rg; g.fillRect(0, 0, W, CAB);
  });
  g.fillStyle = '#fff'; g.font = `700 24px ${fuente}`; g.textAlign = 'left';
  g.fillText(CONFIG.institucion.sigla, 70, 96);
  const etiqueta = TIPOS[tipo] || tipo; g.font = `700 22px ${fuente}`;
  const anchoEt = g.measureText(etiqueta).width + 36;
  g.fillStyle = 'rgba(255,255,255,.95)'; g.beginPath(); g.roundRect(W - 70 - anchoEt, 64, anchoEt, 44, 22); g.fill();
  g.fillStyle = col(`--t-${tipo}`); g.fillText(etiqueta, W - 70 - anchoEt + 18, 94);
  g.fillStyle = '#fff'; g.font = `800 76px ${display}`;
  const palabras = CONFIG.evento.nombre.split(' '); const lineas = []; let l = '';
  palabras.forEach((w) => { const t = l ? `${l} ${w}` : w; if (g.measureText(t).width > W - 160 && l) { lineas.push(l); l = w; } else l = t; });
  lineas.push(l);
  lineas.slice(0, 2).forEach((t, i) => g.fillText(t, 70, 190 + i * 70));
  g.font = `400 26px ${fuente}`; g.fillStyle = 'rgba(255,255,255,.95)';
  g.fillText(CONFIG.evento.fecha, 70, CAB - 76, W - 140);
  g.fillText(CONFIG.evento.lugar, 70, CAB - 38, W - 140);

  // QR
  const qr = crearQR(p.token); const n = qr.getModuleCount();
  const lado = 440; const celda = Math.floor(lado / n); const ql = celda * n; const x0 = (W - ql) / 2, y0 = CAB + 50;
  g.fillStyle = col('--tinta');
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) g.fillRect(x0 + c * celda, y0 + r * celda, celda, celda);

  // línea de corte
  g.setLineDash([12, 10]); g.strokeStyle = col('--linea-2'); g.lineWidth = 3;
  g.beginPath(); g.moveTo(70, CORTE); g.lineTo(W - 70, CORTE); g.stroke(); g.setLineDash([]);

  g.fillStyle = col('--tinta'); g.font = `800 58px ${display}`; g.fillText(p.nombre, 70, CORTE + 100, W - 140);
  g.font = `400 24px ${fuente}`; g.fillStyle = col('--tinta-2');
  g.fillText('Documento', 70, CORTE + 160); g.textAlign = 'right'; g.fillText('Código', W - 70, CORTE + 160);
  g.font = `700 32px ${fuente}`; g.fillStyle = col('--tinta');
  g.textAlign = 'left'; g.fillText(`•••${p.documento_fin}`, 70, CORTE + 200);
  g.textAlign = 'right'; g.fillText(p.token, W - 70, CORTE + 200);
  g.restore();

  // recortes laterales
  g.globalCompositeOperation = 'destination-out';
  [20, W - 20].forEach((x) => { g.beginPath(); g.arc(x, CORTE, 26, 0, Math.PI * 2); g.fill(); });
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = '#f4f7f5'; [20, W - 20].forEach((x) => { g.beginPath(); g.arc(x, CORTE, 26, 0, Math.PI * 2); g.fill(); });

  const a = document.createElement('a');
  a.download = `pase-${CONFIG.evento.slug}-${p.token}.png`;
  a.href = cv.toDataURL('image/png');
  document.body.append(a); a.click(); a.remove();
}

export function guardarUltimoPase(p) { try { localStorage.setItem('uceva-mi-pase', JSON.stringify(p)); } catch {} }
export function ultimoPase() { try { return JSON.parse(localStorage.getItem('uceva-mi-pase')); } catch { return null; } }
