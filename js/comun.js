import { CONFIG, MODO_DEMO } from './config.js';
import { TIPOS } from './api.js';

export const ICONOS = {
  ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m7.5 12.5 3 3 6-6.5"/></svg>',
  aviso: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 7v5.5l3.5 2"/></svg>',
  error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m8.5 8.5 7 7m0-7-7 7"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 11v6M12 7.5v.01"/></svg>',
  descargar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14"/></svg>',
  camara: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M4 12h16"/></svg>',
  buscar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>',
};

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const $ = (sel, raiz = document) => raiz.querySelector(sel);

export function montarBarra(actual, enlaces = [['index.html', 'Consultar'], ['registro.html', 'Registrarme']]) {
  const barra = document.createElement('header');
  barra.className = 'barra';
  barra.innerHTML = `
    <div class="barra__dentro">
      <a class="marca" href="index.html">
        <span class="marca__sello" aria-hidden="true">U</span>
        <span class="marca__texto"><strong>${esc(CONFIG.institucion.sigla)}</strong><span>${esc(CONFIG.evento.nombre)}</span></span>
      </a>
      <nav aria-label="Principal">
        ${enlaces.map(([href, txt]) => `<a href="${href}"${href === actual ? ' aria-current="page"' : ''}>${esc(txt)}</a>`).join('')}
      </nav>
    </div>`;
  document.body.prepend(barra);
  if (MODO_DEMO) {
    const aviso = document.createElement('div');
    aviso.className = 'aviso-demo';
    aviso.textContent = 'Modo demostración: los datos se guardan solo en este navegador.';
    barra.after(aviso);
  }
  const saltar = document.createElement('a');
  saltar.className = 'saltar'; saltar.href = '#contenido'; saltar.textContent = 'Saltar al contenido';
  document.body.prepend(saltar);
}

export function mensaje(tipo, titulo, texto = '') {
  return `<div class="mensaje mensaje--${tipo}" role="${tipo === 'error' ? 'alert' : 'status'}">
    ${ICONOS[tipo] || ICONOS.info}<div><strong>${esc(titulo)}</strong>${texto ? `<p>${texto}</p>` : ''}</div></div>`;
}

// ---------------------------------------------------------------------
//  Pase con QR
// ---------------------------------------------------------------------

function crearQR(token) {
  const qr = window.qrcode(0, 'M');
  qr.addData(`UCV:${token}`);
  qr.make();
  return qr;
}

function svgQR(qr) {
  const n = qr.getModuleCount(); const m = 2; let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + m} ${r + m}h1v1h-1z`;
  return `<svg viewBox="0 0 ${n + m * 2} ${n + m * 2}" role="img" aria-label="Código QR de tu pase" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#13201a"/></svg>`;
}

export function htmlPase(p) {
  const tipo = p.tipo_asistente || 'externo';
  return `
  <article class="pase pase-entrada" style="--tipo: var(--t-${tipo})" aria-label="Tu pase de ingreso">
    <div class="pase__banda">${esc(TIPOS[tipo] || tipo)}</div>
    <div class="pase__cuerpo">
      <div class="pase__cielo">
        <p class="pase__evento">${esc(CONFIG.evento.nombre)}</p>
        <p class="pase__lugar">${esc([CONFIG.evento.fecha, CONFIG.evento.lugar].filter(Boolean).join(', '))}</p>
      </div>
      <div class="pase__qr">${svgQR(crearQR(p.token))}</div>
      <div class="pase__datos">
        <p class="pase__nombre">${esc(p.nombre)}</p>
        <p class="pase__meta">Documento terminado en ${esc(p.documento_fin)}</p>
        <p class="pase__meta">Código <span class="pase__codigo">${esc(p.token)}</span></p>
      </div>
    </div>
  </article>`;
}

export const htmlPaseVacio = () => `
  <article class="pase pase--vacio" aria-hidden="true">
    <div class="pase__banda">Tu pase</div>
    <div class="pase__cuerpo">
      <div class="pase__cielo">
        <p class="pase__evento">${esc(CONFIG.evento.nombre)}</p>
        <p class="pase__lugar">${esc([CONFIG.evento.fecha, CONFIG.evento.lugar].filter(Boolean).join(', '))}</p>
      </div>
      <div class="pase__qr"><span>Aquí aparecerá tu código QR</span></div>
      <div class="pase__datos"><p class="pase__nombre">&nbsp;</p><p class="pase__meta">&nbsp;</p></div>
    </div>
  </article>`;

// Dibuja el pase en un PNG para guardarlo en el celular.
export async function descargarPase(p) {
  try { await document.fonts?.ready; } catch {}
  const W = 720, H = 1180, S = 2;
  const cv = document.createElement('canvas'); cv.width = W * S; cv.height = H * S;
  const g = cv.getContext('2d'); g.scale(S, S);
  const css = getComputedStyle(document.documentElement);
  const col = (v) => css.getPropertyValue(v).trim();
  const fuente = col('--fuente');
  const tipo = p.tipo_asistente || 'externo';

  const redondo = (x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };
  g.fillStyle = '#ffffff'; redondo(0, 0, W, H, 44); g.fill();
  g.save(); redondo(0, 0, W, H, 44); g.clip();

  g.fillStyle = col(`--t-${tipo}`); g.fillRect(0, 0, 84, H);
  g.save(); g.translate(56, H / 2); g.rotate(-Math.PI / 2);
  g.fillStyle = '#fff'; g.font = `700 30px ${fuente}`; g.textAlign = 'center';
  g.fillText((TIPOS[tipo] || tipo), 0, 0); g.restore();

  const cielo = g.createLinearGradient(84, 0, W, 260);
  cielo.addColorStop(0, col('--noche')); cielo.addColorStop(1, col('--noche-2'));
  g.fillStyle = cielo; g.fillRect(84, 0, W - 84, 260);
  g.fillStyle = 'rgba(255,255,255,.75)';
  [[180, 70, 2.4], [330, 170, 1.6], [520, 52, 2.4], [640, 150, 1.6], [430, 30, 1.6]].forEach(([x, y, r]) => { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); });
  g.fillStyle = '#fff'; g.font = `800 46px ${fuente}`; g.textAlign = 'left';
  g.fillText(CONFIG.evento.nombre, 124, 112, W - 170);
  g.fillStyle = col('--luz'); redondo(124, 138, 64, 8, 4); g.fill();
  g.fillStyle = 'rgba(255,255,255,.9)'; g.font = `400 26px ${fuente}`;
  g.fillText([CONFIG.evento.fecha, CONFIG.evento.lugar].filter(Boolean).join(', '), 124, 200, W - 170);

  const qr = crearQR(p.token); const n = qr.getModuleCount();
  const lado = W - 84 - 96; const celda = Math.floor(lado / (n + 4)); const x0 = 84 + 48 + (lado - celda * (n + 4)) / 2 + celda * 2; const y0 = 300 + celda * 2;
  g.fillStyle = col('--tinta');
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) g.fillRect(x0 + c * celda, y0 + r * celda, celda, celda);

  let y = 300 + celda * (n + 4) + 60;
  g.fillStyle = col('--tinta'); g.font = `800 52px ${fuente}`; g.fillText(p.nombre, 124, y, W - 170);
  g.fillStyle = col('--tinta-2'); g.font = `400 28px ${fuente}`;
  g.fillText(`Documento terminado en ${p.documento_fin}`, 124, y + 52);
  g.fillText(`Código ${p.token}`, 124, y + 92);
  g.font = `700 24px ${fuente}`; g.fillStyle = col('--verde');
  g.fillText(CONFIG.institucion.nombre, 124, H - 48, W - 170);
  g.restore();

  const a = document.createElement('a');
  a.download = `pase-${CONFIG.evento.slug}-${p.token}.png`;
  a.href = cv.toDataURL('image/png');
  document.body.append(a); a.click(); a.remove();
}

export function guardarUltimoPase(p) { try { localStorage.setItem('uceva-mi-pase', JSON.stringify(p)); } catch {} }
export function ultimoPase() { try { return JSON.parse(localStorage.getItem('uceva-mi-pase')); } catch { return null; } }
