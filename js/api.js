// Capa de datos. Las páginas solo hablan con este archivo, así que da igual
// si detrás está Supabase o el modo demostración.

import { CONFIG, MODO_DEMO } from './config.js';

const EVENTO = CONFIG.evento.slug;

export class ErrorApi extends Error {
  constructor(mensaje, { sinConexion = false, permiso = false } = {}) {
    super(mensaje);
    this.sinConexion = sinConexion;
    this.permiso = permiso;
  }
}

export const normalizarDoc = (d) => String(d ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
export const limpiarToken = (t) => String(t ?? '').trim().replace(/^UCV:/i, '').toUpperCase();

const nombrePublico = (n, a) => {
  const pila = String(n || '').trim().split(/\s+/)[0] || '';
  const ini = String(a || '').trim().charAt(0);
  return ini ? `${pila} ${ini}.` : pila;
};
const titulo = (s) => String(s || '').trim().toLowerCase().replace(/(^|\s)(\p{L})/gu, (m, e, l) => e + l.toUpperCase());

// =====================================================================
//  Supabase
// =====================================================================

function crearSupabase() {
  const cliente = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true },
  });

  async function rpc(nombre, args = {}, { timeoutMs = 12000 } = {}) {
    if (!navigator.onLine) throw new ErrorApi('Sin conexión a internet.', { sinConexion: true });
    const ctrl = new AbortController();
    const reloj = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const { data, error } = await cliente.rpc(nombre, args).abortSignal(ctrl.signal);
      if (error) {
        if (error.code === '42501') throw new ErrorApi(error.message, { permiso: true });
        if (/fetch|network|abort/i.test(error.message || '')) throw new ErrorApi('No hay respuesta del servidor.', { sinConexion: true });
        throw new ErrorApi(error.message || 'No se pudo completar la operación.');
      }
      return data;
    } catch (e) {
      if (e instanceof ErrorApi) throw e;
      throw new ErrorApi('No hay respuesta del servidor.', { sinConexion: true });
    } finally {
      clearTimeout(reloj);
    }
  }

  return {
    demo: false,
    consultar: (documento) => rpc('consultar_persona', { p_documento: documento }),
    registrarPersona: (d) => rpc('registrar_persona', {
      p_tipo_asistente: d.tipo_asistente || 'externo', p_dependencia: d.dependencia || null,
      p_tipo_documento: d.tipo_documento, p_documento: d.documento, p_nombres: d.nombres,
      p_apellidos: d.apellidos, p_correo: d.correo, p_celular: d.celular, p_entidad: d.entidad,
      p_poblacion: d.poblacion?.length ? d.poblacion : null,
      p_acepta_tratamiento: d.acepta_tratamiento, p_acepta_datos_sensibles: d.acepta_datos_sensibles,
    }),

    estadoAsistencia: (codigo) => rpc('estado_asistencia', { p_evento: EVENTO, p_codigo: codigo }),
    registrarAsistencia: (codigo, documento) => rpc('registrar_asistencia', { p_evento: EVENTO, p_codigo: codigo, p_documento: documento }, { timeoutMs: 8000 }),
    configAsistencia: (abierta = null, renovar = false) => rpc('config_asistencia', { p_evento: EVENTO, p_abierta: abierta, p_renovar: renovar }),

    async iniciarSesion(correo, clave) {
      const { error } = await cliente.auth.signInWithPassword({ email: correo, password: clave });
      if (error) throw new ErrorApi('Correo o contraseña incorrectos.');
      const perfil = await rpc('mi_perfil_staff');
      if (!perfil) { await cliente.auth.signOut(); throw new ErrorApi('Tu usuario no está habilitado como personal del evento.'); }
      return perfil;
    },
    async cerrarSesion() { await cliente.auth.signOut(); },
    async perfil() {
      const { data } = await cliente.auth.getSession();
      if (!data.session) return null;
      try { return await rpc('mi_perfil_staff'); }
      catch (e) { if (e.sinConexion) return JSON.parse(localStorage.getItem('uceva-perfil') || 'null'); return null; }
    },

    registrarIngreso: ({ token, documento, punto }) => rpc('registrar_ingreso', {
      p_evento: EVENTO, p_token: token || null, p_documento: documento || null, p_punto: punto || null,
    }, { timeoutMs: 4000 }),
    registrarLote: (lote) => rpc('registrar_ingresos_lote', { p_evento: EVENTO, p_lote: lote }, { timeoutMs: 20000 }),
    buscar: (texto) => rpc('buscar_personas', { p_evento: EVENTO, p_texto: texto }, { timeoutMs: 5000 }),
    padron: () => rpc('descargar_padron', { p_evento: EVENTO }, { timeoutMs: 30000 }),
    estadisticas: () => rpc('estadisticas', { p_evento: EVENTO }),
    importar: (filas) => rpc('importar_personas', { p_filas: filas }, { timeoutMs: 60000 }),
    exportar: () => rpc('exportar_asistencia', { p_evento: EVENTO }, { timeoutMs: 60000 }),
  };
}

// =====================================================================
//  Modo demostración (todo en este navegador)
// =====================================================================

function crearDemo() {
  const CLAVE = 'uceva-demo-v1';
  const ALFABETO = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  const nuevoToken = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => ALFABETO[b % ALFABETO.length]).join('');

  const semilla = () => {
    const gente = [
      ['1116254789', 'Valentina', 'Rojas Arango', 'estudiante', 'Ingeniería de Sistemas'],
      ['1116987412', 'Santiago', 'Mejía Londoño', 'estudiante', 'Enfermería'],
      ['1115078543', 'Daniela', 'Ospina Cárdenas', 'estudiante', 'Derecho'],
      ['94371258', 'Carlos Andrés', 'Restrepo Gil', 'docente', 'Facultad de Ingeniería'],
      ['31201457', 'Martha Lucía', 'Holguín Vélez', 'docente', 'Facultad de Ciencias de la Salud'],
      ['16359874', 'Jorge Iván', 'Salazar Muñoz', 'investigador', 'Grupo de investigación GIDE'],
      ['29875412', 'Patricia', 'Cifuentes Rendón', 'directivo', 'Rectoría'],
      ['1116300200', 'Andrés Felipe', 'García Toro', 'administrativo', 'Bienestar Universitario'],
      ['38791245', 'Luz Adriana', 'Marín Quintero', 'egresado', 'Contaduría Pública'],
    ];
    return {
      personas: gente.map(([documento, nombres, apellidos, tipo, dependencia], i) => ({
        id: `p${i}`, token: nuevoToken(), tipo_documento: 'CC', documento, nombres, apellidos,
        tipo_asistente: tipo, dependencia, origen: 'institucional', creado_en: new Date().toISOString(),
      })),
      asistencias: [],
    };
  };

  const leer = () => {
    try { const d = JSON.parse(localStorage.getItem(CLAVE)); if (d?.personas) return d; } catch {}
    const d = semilla(); guardar(d); return d;
  };
  const guardar = (d) => { try { localStorage.setItem(CLAVE, JSON.stringify(d)); } catch {} };
  const espera = (ms = 180) => new Promise((r) => setTimeout(r, ms));

  const sesion = {
    get: () => { try { return JSON.parse(sessionStorage.getItem('uceva-demo-sesion')); } catch { return null; } },
    set: (v) => { try { v ? sessionStorage.setItem('uceva-demo-sesion', JSON.stringify(v)) : sessionStorage.removeItem('uceva-demo-sesion'); } catch {} },
  };
  const exigir = (admin = false) => {
    const s = sesion.get();
    if (!s || (admin && s.rol !== 'admin')) throw new ErrorApi('No tienes permiso.', { permiso: true });
    return s;
  };

  const pasePublico = (p) => ({
    encontrado: true, nombre: nombrePublico(p.nombres, p.apellidos), tipo_asistente: p.tipo_asistente,
    documento_fin: p.documento.slice(-4), token: p.token,
  });

  return {
    demo: true,

    async consultar(documento) {
      await espera();
      const p = leer().personas.find((x) => x.documento === normalizarDoc(documento));
      return p ? pasePublico(p) : { encontrado: false };
    },

    async registrarPersona(d) {
      await espera(300);
      const doc = normalizarDoc(d.documento);
      const tipo = d.tipo_asistente || 'externo';
      if (!Object.keys(TIPOS).includes(tipo)) throw new ErrorApi('Elige tu relación con la UCEVA.');
      if (tipo !== 'externo' && String(d.dependencia || '').trim().length < 2) throw new ErrorApi('Escribe tu programa, facultad u oficina.');
      if (!d.acepta_tratamiento) throw new ErrorApi('Debes aceptar el tratamiento de datos para registrarte.');
      if (doc.length < 4 || doc.length > 20) throw new ErrorApi('El número de documento no es válido.');
      const db = leer();
      if (db.personas.some((x) => x.documento === doc)) return { estado: 'ya_registrado' };
      const p = {
        id: `p${Date.now()}`, token: nuevoToken(), tipo_documento: d.tipo_documento || 'CC', documento: doc,
        nombres: titulo(d.nombres), apellidos: titulo(d.apellidos), correo: d.correo || null, celular: d.celular || null,
        tipo_asistente: tipo, dependencia: tipo !== 'externo' ? d.dependencia : null, entidad: tipo === 'externo' ? (d.entidad || null) : null,
        poblacion: d.acepta_datos_sensibles ? d.poblacion : null, origen: 'registro', creado_en: new Date().toISOString(),
      };
      db.personas.push(p); guardar(db);
      return { estado: 'creado', ...pasePublico(p) };
    },

    async estadoAsistencia(codigo) {
      await espera(100); const ev = leer().evento || { codigo: 'DEMO2026', abierta: true };
      return { abierta: ev.abierta, codigo_valido: String(codigo || '').trim().toUpperCase() === ev.codigo, nombre: CONFIG.evento.nombre };
    },
    async registrarAsistencia(codigo, documento) {
      await espera(250);
      const db = leer(); const ev = db.evento || { codigo: 'DEMO2026', abierta: true };
      if (String(codigo || '').trim().toUpperCase() !== ev.codigo) return { estado: 'codigo_invalido' };
      if (!ev.abierta) return { estado: 'cerrado' };
      const p = db.personas.find((x) => x.documento === normalizarDoc(documento));
      if (!p) return { estado: 'no_encontrado' };
      const previo = db.asistencias.find((a) => a.persona_id === p.id);
      const base = { nombre: nombrePublico(p.nombres, p.apellidos), tipo_asistente: p.tipo_asistente };
      if (previo) return { estado: 'repetido', ...base, hora: previo.registrado_en };
      const a = { persona_id: p.id, registrado_en: new Date().toISOString(), punto: 'Celular (autoregistro)', metodo: 'autoregistro', sin_conexion: false };
      db.asistencias.push(a); guardar(db);
      return { estado: 'ok', ...base, hora: a.registrado_en };
    },
    async configAsistencia(abierta = null, renovar = false) {
      exigir(true); const db = leer(); db.evento ||= { codigo: 'DEMO2026', abierta: true };
      if (abierta !== null) db.evento.abierta = abierta;
      if (renovar) db.evento.codigo = nuevoToken();
      guardar(db); return { abierta: db.evento.abierta, codigo: db.evento.codigo };
    },

    async iniciarSesion(correo, clave) {
      await espera(250);
      if (clave !== 'demo') throw new ErrorApi('En modo demostración la contraseña es "demo".');
      const perfil = { nombre: correo.split('@')[0] || 'Personal', rol: 'admin' };
      sesion.set(perfil); return perfil;
    },
    async cerrarSesion() { sesion.set(null); },
    async perfil() { return sesion.get(); },

    async registrarIngreso({ token, documento, punto, hora, sin_conexion }) {
      exigir(); await espera(120);
      const db = leer();
      const t = limpiarToken(token);
      const p = t ? db.personas.find((x) => x.token === t) : db.personas.find((x) => x.documento === normalizarDoc(documento));
      if (!p) return { estado: 'no_encontrado' };
      const previo = db.asistencias.find((a) => a.persona_id === p.id);
      const base = { nombre: `${p.nombres} ${p.apellidos}`, tipo_asistente: p.tipo_asistente, dependencia: p.dependencia || p.entidad, documento: p.documento, origen: p.origen };
      if (previo) return { estado: 'repetido', ...base, hora_previa: previo.registrado_en, punto_previo: previo.punto };
      const a = { persona_id: p.id, registrado_en: hora || new Date().toISOString(), punto, metodo: t ? 'qr' : 'documento', sin_conexion: !!sin_conexion };
      db.asistencias.push(a); guardar(db);
      return { estado: 'ok', ...base, hora: a.registrado_en };
    },
    async registrarLote(lote) {
      const r = [];
      for (const item of lote) r.push({ ...(await this.registrarIngreso({ ...item, sin_conexion: true })), id_local: item.id_local });
      return r;
    },

    async buscar(texto) {
      exigir(); await espera(120);
      const db = leer(); const doc = normalizarDoc(texto); const t = texto.trim().toLowerCase();
      if (t.length < 3) return [];
      return db.personas
        .filter((p) => (doc && p.documento.startsWith(doc)) || `${p.nombres} ${p.apellidos}`.toLowerCase().includes(t))
        .slice(0, 12)
        .map((p) => ({ documento: p.documento, nombre: `${p.nombres} ${p.apellidos}`, tipo_asistente: p.tipo_asistente,
          dependencia: p.dependencia || p.entidad, ingreso: db.asistencias.find((a) => a.persona_id === p.id)?.registrado_en || null }));
    },

    async padron() {
      exigir(); const db = leer();
      return db.personas.map((p) => [p.token, p.documento, `${p.nombres} ${p.apellidos}`, p.tipo_asistente,
        p.dependencia || p.entidad || null, db.asistencias.find((a) => a.persona_id === p.id)?.registrado_en || null, p.origen]);
    },

    async estadisticas() {
      exigir(); await espera(100);
      const db = leer(); const porId = Object.fromEntries(db.personas.map((p) => [p.id, p]));
      const contar = (f) => db.asistencias.reduce((m, a) => { const k = f(a); m[k] = (m[k] || 0) + 1; return m; }, {});
      const hace15 = Date.now() - 15 * 60e3;
      const bloques = contar((a) => { const d = new Date(a.registrado_en); d.setMinutes(Math.floor(d.getMinutes() / 15) * 15, 0, 0); return d.toISOString(); });
      return {
        ingresos: db.asistencias.length, base: db.personas.length,
        externos_registrados: db.personas.filter((p) => p.origen === 'registro' && p.tipo_asistente === 'externo').length,
        uceva_autorregistro: db.personas.filter((p) => p.origen === 'registro' && p.tipo_asistente !== 'externo').length,
        ultimos_15_min: db.asistencias.filter((a) => new Date(a.registrado_en).getTime() > hace15).length,
        por_tipo: contar((a) => porId[a.persona_id]?.tipo_asistente || 'externo'),
        por_punto: contar((a) => a.punto || 'Sin punto'),
        por_hora: Object.entries(bloques).sort().map(([hora, n]) => ({ hora, n })),
      };
    },

    async importar(filas) {
      exigir(true); await espera(200);
      const TIPOS = ['estudiante', 'docente', 'investigador', 'directivo', 'administrativo', 'egresado', 'externo'];
      const db = leer(); let nuevos = 0, actualizados = 0; const errores = [];
      filas.forEach((f, i) => {
        const doc = normalizarDoc(f.documento); const tipo = String(f.tipo_asistente || '').trim().toLowerCase();
        if (doc.length < 4 || !String(f.nombres || '').trim()) return errores.push({ fila: i + 1, documento: f.documento, error: 'Falta documento o nombres' });
        if (!TIPOS.includes(tipo)) return errores.push({ fila: i + 1, documento: f.documento, error: `Tipo de asistente no válido: "${f.tipo_asistente || '(vacío)'}"` });
        const p = db.personas.find((x) => x.documento === doc);
        const datos = { nombres: titulo(f.nombres), apellidos: titulo(f.apellidos), dependencia: f.dependencia || p?.dependencia || null,
          correo: f.correo || p?.correo || null, celular: f.celular || p?.celular || null };
        if (p) { Object.assign(p, datos, { tipo_asistente: tipo, origen: 'institucional' }); actualizados++; }
        else { db.personas.push({ id: `p${Date.now()}${i}`, token: nuevoToken(), tipo_documento: (f.tipo_documento || 'CC').toUpperCase(),
          documento: doc, tipo_asistente: tipo, origen: 'institucional', creado_en: new Date().toISOString(), ...datos }); nuevos++; }
      });
      guardar(db);
      return { nuevos, actualizados, errores };
    },

    async exportar() {
      exigir(true); const db = leer(); const porId = Object.fromEntries(db.personas.map((p) => [p.id, p]));
      return db.asistencias.map((a) => { const p = porId[a.persona_id] || {}; return {
        hora_ingreso: a.registrado_en, punto: a.punto, metodo: a.metodo, sin_conexion: a.sin_conexion,
        tipo_documento: p.tipo_documento, documento: p.documento, nombres: p.nombres, apellidos: p.apellidos,
        tipo_asistente: p.tipo_asistente, dependencia: p.dependencia, entidad: p.entidad, correo: p.correo,
        celular: p.celular, origen: p.origen, poblacion: (p.poblacion || []).join('; ') }; });
    },

    reiniciar() { localStorage.removeItem(CLAVE); },
  };
}

export const api = MODO_DEMO ? crearDemo() : crearSupabase();

export const TIPOS = {
  estudiante: 'Estudiante', docente: 'Docente', investigador: 'Investigador', directivo: 'Directivo',
  administrativo: 'Administrativo', egresado: 'Egresado', externo: 'Invitado',
};
