// Pruebas unitarias de R-b (restablecimiento de contraseña): correo, servicio, repositorio,
// controlador, rutas e invalidaciones. No usan MySQL ni la red:
//  - el servicio se ejecuta con el repositorio REAL (src/modules/auth/restablecimiento.repositorio.js)
//    y los modelos de Sequelize sustituidos por tablas en memoria que reproducen las restricciones
//    del SQL 005 (UNIQUE de un 'activo' y un 'enviando' por cuenta, CHECK de estado, motivo,
//    fechas, intentos y token_hash) y transacciones con COMMIT/ROLLBACK simulados;
//  - el correo se envía con jsonTransport de nodemailer (sin red), a través del módulo real.
// Estas pruebas NO validan el SQL real que genera Sequelize contra MySQL: eso queda para la suite
// de integración en pansys_test (pendiente de autorización).
//
// Uso (desde backend/):  node pruebas/restablecimiento.servicio.unitarias.js

// Seguridad: host inexistente y red bloqueada antes de cargar nada
process.env.DB_HOST = 'base-inexistente.invalid';
process.env.DB_NAME = 'sin_base_pruebas_unitarias';
process.env.JWT_SECRET = 'secreto-solo-para-pruebas-unitarias-de-restablecimiento';
const net = require('net');
const tls = require('tls');
const redBloqueada = () => { throw new Error('Red bloqueada en las pruebas unitarias'); };
net.connect = net.createConnection = redBloqueada;
net.Socket.prototype.connect = redBloqueada;
tls.connect = redBloqueada;
require('dotenv').config({ quiet: true });

const crypto = require('crypto');
const bcryptReal = require('bcrypt');
const nodemailer = require('nodemailer');
const jwt = require('jsonwebtoken');
const { Op } = require('sequelize');

const resultados = [];
const igual = (descripcion, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  resultados.push(ok);
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${descripcion}${ok ? '' : ` -> obtenido ${JSON.stringify(real)}, esperado ${JSON.stringify(esperado)}`}`);
};
const resultado = (promesa) => promesa.then(r => ({ ok: true, r }), e => ({ ok: false, e }));

// Toda la salida de consola de la ejecución, para comprobar que no se filtra nada sensible
const salidaConsola = [];
for (const metodo of ['log', 'error', 'warn', 'info']) {
  const original = console[metodo];
  console[metodo] = (...args) => {
    const texto = args.map(a => (typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })())).join(' ');
    if (!/^(OK   |FALLA|\n==|\d+\/\d+ pruebas)/.test(texto)) salidaConsola.push(texto);
    original.apply(console, args);
  };
}

const main = async () => {
  const { sequelize, Usuario, RestablecimientoContrasena: RC, EventoSeguridad } = require('../src/models/index');
  const repositorio = require('../src/modules/auth/restablecimiento.repositorio');
  const tokens = require('../src/utils/tokens');
  const correoModulo = require('../src/utils/correo');
  const servicioModulo = require('../src/modules/auth/restablecimiento.service');
  const { crearServicio, crearLimitadores, VIGENCIA_ENLACE_MS, RESERVA_MS, MENSAJE_SOLICITUD, MENSAJE_ENLACE_NO_VALIDO } = servicioModulo;
  const { ErrorNegocio } = require('../src/utils/errores');
  const { firmarSesion } = require('../src/utils/sesion');

  // ================= correo.js =================
  // La configuración (modos, TLS, autenticación) se prueba en pruebas/correo.unitarias.js. Aquí, el
  // envío a través del módulo real con un transporte inyectado (modo mailpit en la configuración).
  const ENV_CORREO = { PANSYS_CORREO_MODO: 'mailpit', PANSYS_CORREO_REMITENTE: 'no-responder@pansys.local' };
  const { clasificarError, crearCorreo } = correoModulo;
  igual('configurado(): true en modo mailpit y false sin modo (desactivado por defecto)',
    [crearCorreo({ env: ENV_CORREO }).configurado(), crearCorreo({ env: {} }).configurado()], [true, false]);

  console.log('\n== correo: envío con jsonTransport (sin red)');
  const capturados = [];
  const transporteJson = (() => {
    const json = nodemailer.createTransport({ jsonTransport: true });
    return { sendMail: async (mensaje) => { const info = await json.sendMail(mensaje); capturados.push(JSON.parse(info.message)); return info; } };
  })();
  const correoJson = crearCorreo({ env: ENV_CORREO, transporte: transporteJson });
  const enlacePrueba = `https://pansys.test/restablecer#token=${'A'.repeat(43)}`;
  await correoJson.enviarEnlaceRestablecimiento({ para: 'destino@pansys.test', enlace: enlacePrueba });
  const m = capturados[0];
  igual('mensaje: remitente, destinatario, asunto, enlace en el texto y sin HTML',
    [m.from?.address ?? m.from, m.to?.[0]?.address, m.subject, m.text.includes(enlacePrueba), 'html' in m, /30 minutos/.test(m.text)],
    ['no-responder@pansys.local', 'destino@pansys.test', 'Restablecer su contraseña de Pansys', true, false, true]);
  const colgado = crearCorreo({ env: ENV_CORREO, transporte: { sendMail: () => new Promise(() => {}) }, tiempoMaximoMs: 30 });
  const tope = await resultado(colgado.enviarEnlaceRestablecimiento({ para: 'x@pansys.test', enlace: enlacePrueba }));
  igual('un envío que no termina se corta en el tope global -> tiempo_agotado', [tope.ok, tope.e?.name, clasificarError(tope.e)], [false, 'ErrorTiempoCorreo', 'tiempo_agotado']);
  igual('clasificación de fallos', [
    clasificarError(Object.assign(new Error(), { code: 'ESOCKET', command: 'CONN' })),
    clasificarError(Object.assign(new Error(), { code: 'ECONNECTION' })),
    clasificarError(Object.assign(new Error(), { code: 'EDNS' })),
    clasificarError(Object.assign(new Error(), { code: 'EENVELOPE' })),
    clasificarError(Object.assign(new Error(), { code: 'EMESSAGE', responseCode: 550 })),
    clasificarError(Object.assign(new Error(), { code: 'ETIMEDOUT' })),
    clasificarError(Object.assign(new Error(), { code: 'ESOCKET', command: 'DATA' })),
    clasificarError(new Error('desconocido'))
  ], ['sin_conexion', 'sin_conexion', 'sin_conexion', 'rechazado', 'rechazado', 'tiempo_agotado', 'tiempo_agotado', 'tiempo_agotado']);

  // ================= Doble de la base (modelos de Sequelize en memoria) =================
  const originales = {
    transaction: sequelize.transaction,
    usuario: { findAll: Usuario.findAll, findOne: Usuario.findOne, findByPk: Usuario.findByPk, update: Usuario.update },
    rc: { findAll: RC.findAll, findOne: RC.findOne, findByPk: RC.findByPk, count: RC.count, create: RC.create, update: RC.update },
    evento: { create: EventoSeguridad.create }
  };

  let db;
  let ahora;
  let abiertas;               // transacciones abiertas en este momento
  let violaciones;            // envío SMTP o bcrypt con una transacción abierta, escrituras fuera de transacción...
  let bloqueosCuentas;        // listas de id bloqueadas (en el orden en que se pidieron)
  let inyeccion;              // fallos simulados de la activación
  let lecturasPorEmail;
  const T0 = Date.UTC(2026, 9, 28, 12, 0, 0);
  const reloj = () => ahora;
  const avanzar = (ms) => { ahora += ms; };
  const ms = (v) => (v instanceof Date ? v.getTime() : v);
  const clonar = () => JSON.parse(JSON.stringify({ usuarios: db.usuarios, enlaces: db.enlaces, eventos: db.eventos, ids: db.ids }));
  const restaurar = (copia) => { Object.assign(db, copia); };

  const MOTIVOS_INVALIDADO = ['nuevo_enlace', 'email_cambiado', 'cuenta_desactivada', 'contrasena_cambiada', 'intentos', 'emergencia_local'];
  const MOTIVOS_FALLIDO = ['sin_conexion', 'rechazado', 'tiempo_agotado', 'activacion_fallida', 'proceso_interrumpido'];
  const TIPOS_CON_ENLACE = ['restablecimiento_solicitado', 'restablecimiento_propio_solicitado', 'restablecimiento_activado',
    'restablecimiento_fallido', 'restablecimiento_usado', 'restablecimiento_invalidado'];
  const errorMysql = (mensaje, name = 'SequelizeDatabaseError') => Object.assign(new Error(mensaje), { name });

  // Las restricciones del SQL 005 (UNIQUE y CHECK), comprobadas tras cada escritura
  const comprobarRestricciones = () => {
    for (const estado of ['activo', 'enviando']) {
      const vistos = new Set();
      for (const e of db.enlaces.filter(x => x.estado === estado)) {
        if (vistos.has(e.usuario_id)) throw errorMysql(`Duplicate entry for uq_rest_${estado}`, 'SequelizeUniqueConstraintError');
        vistos.add(e.usuario_id);
      }
    }
    for (const e of db.enlaces) {
      const n = (c) => e[c] === null || e[c] === undefined;
      const ok = {
        enviando: e.motivo === null && n('enviado_en') && n('usado_en') && n('invalidado_en') && n('fallido_en'),
        activo: e.motivo === null && !n('enviado_en') && n('usado_en') && n('invalidado_en') && n('fallido_en'),
        usado: e.motivo === null && !n('enviado_en') && !n('usado_en') && n('invalidado_en') && n('fallido_en'),
        invalidado: !n('invalidado_en') && n('usado_en') && n('fallido_en') && MOTIVOS_INVALIDADO.includes(e.motivo),
        envio_fallido: !n('fallido_en') && n('enviado_en') && n('usado_en') && n('invalidado_en') && MOTIVOS_FALLIDO.includes(e.motivo)
      }[e.estado];
      const fechas = ['enviado_en', 'usado_en', 'invalidado_en', 'fallido_en'].every(c => n(c) || ms(new Date(e[c])) >= ms(new Date(e.createdAt)));
      if (!ok || !fechas || e.intentos_fallidos > 5 || !/^[0-9a-f]{64}$/.test(e.token_hash)
        || ms(new Date(e.expira_en)) <= ms(new Date(e.createdAt))
        || !((e.origen === 'propio' && e.solicitado_por === null) || (e.origen === 'administrador' && e.solicitado_por !== null))
        || (e.solicitado_por !== null && e.solicitado_por === e.usuario_id)) {
        throw errorMysql(`Check constraint violated (enlace ${e.id}, estado ${e.estado})`);
      }
    }
    for (const ev of db.eventos) {
      if (TIPOS_CON_ENLACE.includes(ev.tipo) !== (ev.restablecimiento_id !== null)) throw errorMysql('Check constraint chk_evento_restablecimiento');
    }
  };
  const exigirTransaccion = (opciones, que) => {
    if (!opciones?.transaction || abiertas === 0) violaciones.push(`escritura fuera de transacción: ${que}`);
  };

  const cumple = (fila, where = {}) => Object.entries(where).every(([campo, cond]) => {
    const v = fila[campo] instanceof Date || typeof fila[campo] === 'string' && /^\d{4}-\d\d-\d\dT/.test(fila[campo]) ? ms(new Date(fila[campo])) : fila[campo];
    if (Array.isArray(cond)) return cond.includes(v);
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      return Object.getOwnPropertySymbols(cond).every(op => {
        const b = ms(cond[op]);
        if (op === Op.lte) return v !== null && v !== undefined && v <= b;
        if (op === Op.gte) return v !== null && v !== undefined && v >= b;
        if (op === Op.gt) return v !== null && v !== undefined && v > b;
        if (op === Op.ne) return v !== b;
        throw new Error('Operador no previsto por el doble');
      });
    }
    return v === ms(cond);
  });
  const copia = (fila) => (fila ? JSON.parse(JSON.stringify(fila)) : null);

  sequelize.transaction = async (fn) => {
    const previa = clonar();
    abiertas++;
    const t = { LOCK: { UPDATE: 'UPDATE' }, trasCommit: null };
    let r;
    try {
      r = await fn(t);
    } catch (error) {
      restaurar(previa);
      abiertas--;
      throw error;
    }
    abiertas--;
    if (t.trasCommit) throw t.trasCommit; // COMMIT aplicado, pero el cliente recibe un error (ambiguo)
    return r;
  };
  Usuario.findAll = async (opciones) => {
    const ids = opciones.where.id;
    if (opciones.lock !== 'UPDATE' || !opciones.transaction) violaciones.push('bloqueo de cuentas sin FOR UPDATE o fuera de transacción');
    bloqueosCuentas.push([...ids]);
    return db.usuarios.filter(u => ids.includes(u.id)).sort((a, b) => a.id - b.id).map(copia);
  };
  Usuario.findOne = async (opciones) => {
    lecturasPorEmail++;
    const { email, estado } = opciones.where;
    return copia(db.usuarios.find(u => u.email.toLowerCase() === String(email).toLowerCase() && Boolean(u.estado) === estado));
  };
  Usuario.findByPk = async (id) => copia(db.usuarios.find(u => u.id === id));
  Usuario.update = async (cambios, opciones) => {
    exigirTransaccion(opciones, 'usuarios');
    let n = 0;
    for (const u of db.usuarios.filter(x => cumple(x, opciones.where))) {
      for (const [k, v] of Object.entries(cambios)) {
        u[k] = v && typeof v === 'object' && v.val === 'version_sesion + 1' ? u.version_sesion + 1 : v;
      }
      n++;
    }
    return [n];
  };
  RC.findAll = async (opciones) => {
    let filas = db.enlaces.filter(e => cumple(e, opciones.where));
    if (opciones.order) {
      const [[campo]] = opciones.order;
      filas = filas.sort((a, b) => ms(new Date(a[campo])) - ms(new Date(b[campo])));
    }
    return filas.map(copia);
  };
  RC.findOne = async (opciones) => copia(db.enlaces.find(e => cumple(e, opciones.where)));
  RC.findByPk = async (id) => copia(db.enlaces.find(e => e.id === id));
  RC.count = async (opciones) => db.enlaces.filter(e => cumple(e, opciones.where)).length;
  RC.create = async (datos, opciones) => {
    exigirTransaccion(opciones, 'restablecimientos_contrasena');
    const fila = {
      id: ++db.ids.enlace, motivo: null, intentos_fallidos: 0, enviado_en: null, usado_en: null, invalidado_en: null, fallido_en: null,
      ...datos, createdAt: new Date(ahora).toISOString(), updatedAt: new Date(ahora).toISOString()
    };
    fila.expira_en = new Date(datos.expira_en).toISOString();
    db.enlaces.push(fila);
    comprobarRestricciones();
    return copia(fila);
  };
  RC.update = async (cambios, opciones) => {
    exigirTransaccion(opciones, 'restablecimientos_contrasena');
    if (cambios.estado === 'activo' && inyeccion.activacion.length) {
      const fallo = inyeccion.activacion.shift();
      if (fallo === 'antes-del-commit') throw errorMysql('Fallo simulado antes del COMMIT');
      if (fallo === 'commit-ambiguo') opciones.transaction.trasCommit = errorMysql('Conexión perdida durante el COMMIT');
    }
    let n = 0;
    for (const e of db.enlaces.filter(x => cumple(x, opciones.where))) {
      for (const [k, v] of Object.entries(cambios)) e[k] = v instanceof Date ? v.toISOString() : v;
      e.updatedAt = new Date(ahora).toISOString();
      n++;
    }
    comprobarRestricciones();
    return [n];
  };
  EventoSeguridad.create = async (datos) => {
    db.eventos.push({ id: ++db.ids.evento, ...datos, createdAt: new Date(ahora).toISOString() });
    comprobarRestricciones();
  };

  // ---------- Cuentas y escenario ----------
  const CLAVES = { 10: 'Admin12345', 11: 'AdminB12345', 12: 'Panadero123', 13: 'Gerente123', 14: 'Otra123456', 15: 'Global12345', 16: 'Panadero456' };
  const hashes = {};
  for (const [id, clave] of Object.entries(CLAVES)) hashes[id] = await bcryptReal.hash(clave, 4);
  const cuentasIniciales = () => [
    { id: 10, email: 'admin.a@pansys.test', rol_id: 1, panaderia_id: 20, estado: true, version_sesion: 0 },
    { id: 11, email: 'admin.b@pansys.test', rol_id: 1, panaderia_id: 20, estado: true, version_sesion: 0 },
    { id: 12, email: 'panadero@pansys.test', rol_id: 2, panaderia_id: 20, estado: true, version_sesion: 0 },
    { id: 13, email: 'gerente.inactivo@pansys.test', rol_id: 3, panaderia_id: 20, estado: false, version_sesion: 0 },
    { id: 14, email: 'otra.panaderia@pansys.test', rol_id: 2, panaderia_id: 21, estado: true, version_sesion: 0 },
    { id: 15, email: 'global@pansys.test', rol_id: 1, panaderia_id: null, estado: true, version_sesion: 0 },
    { id: 16, email: 'panadero2@pansys.test', rol_id: 2, panaderia_id: 20, estado: true, version_sesion: 0 }
  ].map(c => ({ ...c, contrasena: hashes[c.id] }));

  const ENV = { PANSYS_URL_PUBLICA: 'https://pansys.test' };
  let correoEstado;   // { configurado, fallo, durante }
  let enviados;       // mensajes entregados por jsonTransport
  let generados;      // tokens generados
  let cola;           // trabajo programado tras responder
  let servicio;

  const correoDoble = () => {
    const transporte = (() => {
      const json = nodemailer.createTransport({ jsonTransport: true });
      return { sendMail: async (mensaje) => { const info = await json.sendMail(mensaje); enviados.push(JSON.parse(info.message)); return info; } };
    })();
    const real = crearCorreo({ env: ENV_CORREO, transporte });
    return {
      configurado: () => correoEstado.configurado,
      clasificarError: real.clasificarError,
      async enviarEnlaceRestablecimiento(datos) {
        if (abiertas !== 0) violaciones.push('envío SMTP con una transacción abierta');
        if (correoEstado.durante) await correoEstado.durante();
        if (correoEstado.fallo) throw correoEstado.fallo;
        await real.enviarEnlaceRestablecimiento(datos);
      }
    };
  };
  const bcryptDoble = {
    compare: async (clave, hash) => { if (abiertas !== 0) violaciones.push('bcrypt.compare con una transacción abierta'); return bcryptReal.compare(clave, hash); },
    hash: async (clave) => { if (abiertas !== 0) violaciones.push('bcrypt.hash con una transacción abierta'); return bcryptReal.hash(clave, 4); }
  };
  const tokensEspia = { ...tokens, generarToken: () => { generados++; return tokens.generarToken(); } };

  const preparar = ({ env = ENV } = {}) => {
    db = { usuarios: cuentasIniciales(), enlaces: [], eventos: [], ids: { enlace: 100, evento: 0 } };
    ahora = T0;
    abiertas = 0;
    violaciones = [];
    bloqueosCuentas = [];
    inyeccion = { activacion: [] };
    lecturasPorEmail = 0;
    correoEstado = { configurado: true, fallo: null, durante: null };
    enviados = [];
    generados = 0;
    cola = [];
    servicio = crearServicio({
      repo: repositorio, correo: correoDoble(), tokens: tokensEspia, bcrypt: bcryptDoble, reloj,
      programar: (fn) => { cola.push(fn); }, limitadores: crearLimitadores(reloj), env, registrar: () => {}
    });
  };
  const procesarCola = async () => { while (cola.length) await cola.shift()(); };
  const tokenDe = (mensaje) => /#token=([A-Za-z0-9_-]{43})$/m.exec(mensaje?.text ?? '')?.[1] ?? null;
  const enlacesDe = (usuarioId) => db.enlaces.filter(e => e.usuario_id === usuarioId).map(e => e.estado);
  const tipos = () => db.eventos.map(e => e.tipo);
  const IP = '203.0.113.5';
  const asistir = (actorId, id, contrasena = CLAVES[actorId]) => resultado(servicio.solicitarAsistido({ actorId, idTexto: String(id), contrasena }));
  const confirmar = (token, contrasena = 'NuevaClave123', ip = IP) => resultado(servicio.confirmar({ token, contrasena, ip }));
  const validar = (token, ip = IP) => resultado(servicio.validar({ token, ip }));
  const estadoDe = (r) => (r.ok ? r.r.status : r.e?.status);

  try {
    // ================= Solicitud propia (pública) =================
    console.log('\n== solicitud propia: 202 siempre, trabajo después de responder');
    preparar();
    const existente = await resultado(servicio.solicitarPropio({ email: 'panadero@pansys.test', ip: IP }));
    igual('cuenta activa -> 202 con el mensaje genérico, y aún sin búsqueda, filas ni correo al responder',
      [existente.r?.status, existente.r?.cuerpo, lecturasPorEmail, db.enlaces.length, enviados.length, cola.length],
      [202, { mensaje: MENSAJE_SOLICITUD }, 0, 0, 0, 1]);
    await procesarCola();
    const tokenPropio = tokenDe(enviados[0]);
    igual('tras responder: un correo a la cuenta con el enlace de PANSYS_URL_PUBLICA y el enlace activo',
      [enviados.length, enviados[0]?.to?.[0]?.address, enviados[0]?.text.includes(`https://pansys.test/restablecer#token=${tokenPropio}`), enlacesDe(12)],
      [1, 'panadero@pansys.test', true, ['activo']]);
    const filaPropia = db.enlaces[0];
    igual('la base guarda solo el SHA-256 del token, origen propio, sin solicitante, caduca a los 30 min',
      [filaPropia.token_hash === tokens.hashToken(tokenPropio), JSON.stringify(db).includes(tokenPropio), filaPropia.origen, filaPropia.solicitado_por,
        ms(new Date(filaPropia.expira_en)) - ms(new Date(filaPropia.createdAt))],
      [true, false, 'propio', null, VIGENCIA_ENLACE_MS]);
    igual('eventos: solicitado (propio, sin actor, con la panadería de la cuenta) y activado',
      db.eventos.map(e => [e.tipo, e.usuario_id, e.actor_id, e.panaderia_id, e.restablecimiento_id]),
      [['restablecimiento_propio_solicitado', 12, null, 20, filaPropia.id], ['restablecimiento_activado', 12, null, 20, filaPropia.id]]);

    for (const [descripcion, email] of [['correo inexistente', 'nadie@pansys.test'], ['cuenta desactivada', 'gerente.inactivo@pansys.test']]) {
      preparar();
      const r = await resultado(servicio.solicitarPropio({ email, ip: IP }));
      await procesarCola();
      igual(`${descripcion} -> la misma respuesta (202 y cuerpo) y nada escrito ni enviado`,
        [r.r?.status, r.r?.cuerpo, db.enlaces.length, db.eventos.length, enviados.length], [202, { mensaje: MENSAJE_SOLICITUD }, 0, 0, 0]);
    }
    preparar();
    const malFormato = await resultado(servicio.solicitarPropio({ email: 'no-es-un-correo', ip: IP }));
    igual('formato de correo no válido -> 400 (no depende de la cuenta) sin programar trabajo', [estadoDe(malFormato), cola.length], [400, 0]);

    preparar();
    const respuestasIp = [];
    for (let i = 0; i < 6; i++) respuestasIp.push(await resultado(servicio.solicitarPropio({ email: `x${i}@pansys.test`, ip: IP })));
    igual('límite por IP: 5 solicitudes y la 6.ª -> 429 con Retry-After', [respuestasIp.map(estadoDe), respuestasIp[5].e?.retryAfterS > 0], [[202, 202, 202, 202, 202, 429], true]);
    igual('otra IP no está limitada', estadoDe(await resultado(servicio.solicitarPropio({ email: 'x@pansys.test', ip: '198.51.100.7' }))), 202);

    preparar();
    for (let i = 0; i < 4; i++) {
      await resultado(servicio.solicitarPropio({ email: i % 2 ? 'NADIE@pansys.test' : 'nadie@pansys.test', ip: `198.51.100.${i}` }));
    }
    await procesarCola();
    igual('límite por correo (3/h, sin distinguir mayúsculas): la 4.ª no llega a buscar la cuenta, y responde igualmente 202', lecturasPorEmail, 3);

    preparar();
    correoEstado.configurado = false;
    igual('sin SMTP configurado -> 503 (estado global) sin programar trabajo',
      [estadoDe(await resultado(servicio.solicitarPropio({ email: 'panadero@pansys.test', ip: IP }))), cola.length], [503, 0]);
    preparar({ env: { PANSYS_URL_PUBLICA: 'http://pansys.test' } });
    igual('PANSYS_URL_PUBLICA no válida (http sin permiso) -> 503 y nada escrito',
      [estadoDe(await resultado(servicio.solicitarPropio({ email: 'panadero@pansys.test', ip: IP }))), estadoDe(await asistir(10, 12)), db.enlaces.length], [503, 503, 0]);

    // ================= Solicitud asistida =================
    console.log('\n== solicitud asistida: administrador, otra cuenta activa de su panadería');
    preparar();
    const asistida = await asistir(10, 12);
    const tokenAsistido = tokenDe(enviados[0]);
    igual('éxito -> 200, correo a la cuenta y enlace activo con origen administrador y solicitante',
      [asistida.r?.status, enviados[0]?.to?.[0]?.address, enlacesDe(12), db.enlaces[0].origen, db.enlaces[0].solicitado_por], [200, 'panadero@pansys.test', ['activo'], 'administrador', 10]);
    igual('eventos: solicitado (actor = administrador) y activado', db.eventos.map(e => [e.tipo, e.usuario_id, e.actor_id, e.panaderia_id]),
      [['restablecimiento_solicitado', 12, 10, 20], ['restablecimiento_activado', 12, null, 20]]);
    igual('bloqueo de cuentas en una sola sentencia y en orden ascendente de id', bloqueosCuentas[0], [10, 12]);
    igual('validar el enlace -> 200 activo', (await validar(tokenAsistido)).r, { status: 200, cuerpo: { estado: 'activo' } });

    const permisos = [
      ['la propia cuenta', 10, 10, 403],
      ['cuenta de otra panadería', 10, 14, 404],
      ['cuenta inexistente', 10, 99, 404],
      ['cuenta desactivada', 10, 13, 409],
      ['actor panadero (sin permiso)', 12, 16, 403],
      ['administrador sin panadería', 15, 12, 403],
      ['id no numérico', 10, 'abc', 400]
    ];
    for (const [descripcion, actor, objetivo, esperado] of permisos) {
      preparar();
      const r = await asistir(actor, objetivo);
      igual(`${descripcion} -> ${esperado} sin enlaces ni correo`, [estadoDe(r), db.enlaces.length, enviados.length], [esperado, 0, 0]);
    }

    console.log('\n== reconfirmación de la contraseña del administrador (límite C, en memoria)');
    preparar();
    const fallos = [];
    for (let i = 0; i < 5; i++) fallos.push(estadoDe(await asistir(10, 12, 'Incorrecta123')));
    igual('contraseña incorrecta -> 400 sin reserva, y un evento reconfirmacion_fallida por intento (cuenta y actor = administrador)',
      [fallos, db.enlaces.length, db.eventos.map(e => [e.tipo, e.usuario_id, e.actor_id, e.restablecimiento_id])],
      [[400, 400, 400, 400, 400], 0, Array(5).fill(['reconfirmacion_fallida', 10, 10, null])]);
    const sextaC = await asistir(10, 12);
    igual('tras 5 fallos, incluso con la contraseña correcta -> 429 con Retry-After y sin reserva', [estadoDe(sextaC), sextaC.e?.retryAfterS > 0, db.enlaces.length], [429, true, 0]);
    avanzar(15 * 60 * 1000);
    const trasC = await asistir(10, 12);
    igual('pasados 15 minutos vuelve a permitirse', [estadoDe(trasC), trasC.e?.message], [200, undefined]);

    // ================= Límites en la base =================
    console.log('\n== límite A: 5 reservas por administrador cada 15 min (aunque el SMTP falle)');
    preparar();
    correoEstado.fallo = Object.assign(new Error('sin servidor'), { code: 'ESOCKET', command: 'CONN' });
    const reservasA = [];
    for (let i = 0; i < 5; i++) reservasA.push(estadoDe(await asistir(10, i % 2 ? 16 : 12)));
    const sextaA = await asistir(10, 12);
    igual('5 reservas con el SMTP caído (502) y la 6.ª -> 429 sin crear fila',
      [reservasA, estadoDe(sextaA), sextaA.e?.retryAfterS > 0, db.enlaces.length], [[502, 502, 502, 502, 502], 429, true, 5]);
    correoEstado.fallo = null;
    igual('otro administrador no comparte el límite', estadoDe(await asistir(11, 12)), 200);
    avanzar(15 * 60 * 1000 - 1);
    igual('1 ms antes de los 15 minutos sigue limitado', estadoDe(await asistir(10, 16)), 429);
    avanzar(1);
    igual('a los 15 minutos exactos vuelve a permitirse (mismo borde que el limitador en memoria)', estadoDe(await asistir(10, 16)), 200);

    console.log('\n== límite por cuenta: 3 envíos aceptados cada 60 min');
    preparar();
    const envios = [];
    for (let i = 0; i < 3; i++) { envios.push(estadoDe(await asistir(i % 2 ? 11 : 10, 12))); avanzar(1000); }
    const cuartoAsistido = await asistir(10, 12);
    await resultado(servicio.solicitarPropio({ email: 'panadero@pansys.test', ip: IP }));
    await procesarCola();
    igual('3 envíos aceptados; el 4.º asistido -> 429, y el propio no envía nada (sigue respondiendo 202)',
      [envios, estadoDe(cuartoAsistido), enviados.length, db.enlaces.length], [[200, 200, 200], 429, 3, 3]);
    avanzar(60 * 60 * 1000);
    igual('pasada la hora vuelve a permitirse', estadoDe(await asistir(10, 12)), 200);

    // ================= Estados, activación y fallos de envío =================
    console.log('\n== estados: reserva «enviando», activación y envío fallido');
    preparar();
    let duranteEnvio = null;
    correoEstado.durante = async () => {
      const fila = db.enlaces.find(e => e.estado === 'enviando');
      const otra = await asistir(11, 12);
      duranteEnvio = { estado: fila?.estado, otraSolicitud: estadoDe(otra), mensajeOtra: otra.e?.message };
    };
    await asistir(10, 12);
    igual('durante el envío la fila está «enviando» y otra solicitud para la cuenta -> 409',
      duranteEnvio, { estado: 'enviando', otraSolicitud: 409, mensajeOtra: 'Ya hay un envío en curso para esta cuenta. Espere unos segundos.' });

    // Un enlace «enviando» no se puede consumir: se fabrica una reserva con un token conocido
    preparar();
    const tokenReserva = tokens.generarToken();
    await repositorio.transaccion(async (t) => {
      await repositorio.bloquearCuentas(t, [12]);
      await repositorio.insertarReserva(t, { usuarioId: 12, origen: 'propio', solicitadoPor: null, tokenHash: tokens.hashToken(tokenReserva), expiraEn: ahora + VIGENCIA_ENLACE_MS });
    });
    const consumoEnviando = await confirmar(tokenReserva);
    const validacionEnviando = await validar(tokenReserva);
    igual('enlace «enviando»: confirmar -> 409 PROCESANDO, validar -> 202 procesando, sin cambiar la contraseña',
      [estadoDe(consumoEnviando), consumoEnviando.e?.detalle, validacionEnviando.r, enlacesDe(12), db.usuarios.find(u => u.id === 12).version_sesion],
      [409, { codigo: 'PROCESANDO' }, { status: 202, cuerpo: { estado: 'procesando' } }, ['enviando'], 0]);
    const ipTrasEnviando = [];
    for (let i = 0; i < 5; i++) ipTrasEnviando.push(estadoDe(await validar(tokenReserva)));
    igual('las consultas de un enlace «enviando» no cuentan como fallos de token', ipTrasEnviando, [202, 202, 202, 202, 202]);
    avanzar(RESERVA_MS + 6000);
    igual('pasada la reserva (+5 s), el enlace «enviando» ya no es válido -> 400', estadoDe(await validar(tokenReserva, '198.51.100.9')), 400);

    console.log('\n== recuperación de reservas huérfanas (proceso interrumpido)');
    await asistir(10, 12);
    igual('la reserva vencida pasa a envio_fallido/proceso_interrumpido y la nueva se activa',
      [db.enlaces.map(e => [e.estado, e.motivo]), tipos().filter(x => x === 'restablecimiento_fallido').length],
      [[['envio_fallido', 'proceso_interrumpido'], ['activo', null]], 1]);

    console.log('\n== envío fallido: el enlace anterior sigue válido');
    for (const [codigo, extra, motivo] of [['ESOCKET', { command: 'CONN' }, 'sin_conexion'], ['EENVELOPE', {}, 'rechazado'], ['ETIMEDOUT', {}, 'tiempo_agotado']]) {
      preparar();
      await asistir(10, 12);
      const tokenAnterior = tokenDe(enviados[0]);
      avanzar(1000);
      correoEstado.fallo = Object.assign(new Error('fallo simulado'), { code: codigo, ...extra });
      const fallida = await asistir(10, 12);
      correoEstado.fallo = null;
      igual(`SMTP ${codigo} -> 502; el nuevo queda envio_fallido/${motivo} y el anterior sigue activo y utilizable`,
        [estadoDe(fallida), db.enlaces.map(e => [e.estado, e.motivo]), estadoDe(await validar(tokenAnterior))],
        [502, [['activo', null], ['envio_fallido', motivo]], 200]);
    }

    console.log('\n== activación: sustituye al anterior en el mismo COMMIT; idempotente');
    preparar();
    await asistir(10, 12);
    const primero = tokenDe(enviados[0]);
    avanzar(1000);
    await asistir(11, 12);
    const segundo = tokenDe(enviados[1]);
    igual('un segundo enlace activado invalida el anterior (nuevo_enlace) y solo el nuevo es válido',
      [db.enlaces.map(e => [e.estado, e.motivo]), estadoDe(await validar(primero)), estadoDe(await validar(segundo))],
      [[['invalidado', 'nuevo_enlace'], ['activo', null]], 400, 200]);
    const eventosAntes = db.eventos.length;
    const repetida = await repositorio.activar({ id: db.enlaces[1].id, usuarioId: 12, ahora, reservaMs: RESERVA_MS });
    igual('repetir una activación ya hecha -> false, sin invalidar nada ni registrar eventos',
      [repetida, db.enlaces.map(e => e.estado), db.eventos.length - eventosAntes], [false, ['invalidado', 'activo'], 0]);

    console.log('\n== COMMIT ambiguo y reintentos de activación (mismo id, sin token ni envío nuevos)');
    for (const [descripcion, fallosActivacion, esperado] of [
      ['COMMIT ambiguo que sí se aplicó', ['commit-ambiguo'], 200],
      ['fallo antes del COMMIT y reintento', ['antes-del-commit'], 200],
      ['tres fallos seguidos', ['antes-del-commit', 'antes-del-commit', 'antes-del-commit'], 503]
    ]) {
      preparar();
      await asistir(10, 12);
      const anterior = tokenDe(enviados[0]);
      avanzar(1000);
      inyeccion.activacion = [...fallosActivacion];
      const r = await asistir(11, 12);
      const final = esperado === 200 ? [['invalidado', 'nuevo_enlace'], ['activo', null]] : [['activo', null], ['envio_fallido', 'activacion_fallida']];
      igual(`${descripcion} -> ${esperado}; SMTP una sola vez y un solo token por solicitud; estados coherentes`,
        [estadoDe(r), enviados.length, generados, db.enlaces.map(e => [e.estado, e.motivo])], [esperado, 2, 2, final]);
      if (esperado === 503) igual('tras la activación fallida, el enlace anterior sigue utilizable', estadoDe(await validar(anterior)), 200);
    }
    preparar();
    correoEstado.durante = async () => { avanzar(RESERVA_MS + 1000); };
    const tardia = await asistir(10, 12);
    igual('si la reserva vence antes de activar, no se activa (503) y queda envio_fallido/activacion_fallida',
      [estadoDe(tardia), db.enlaces.map(e => [e.estado, e.motivo])], [503, [['envio_fallido', 'activacion_fallida']]]);

    // ================= Consumo =================
    console.log('\n== consumo: contraseña nueva, sesiones revocadas, un solo uso');
    preparar();
    await asistir(10, 12);
    const tokenUso = tokenDe(enviados[0]);
    const sesionAnterior = firmarSesion(db.usuarios.find(u => u.id === 12), 'panadero').token;
    // Una reserva «enviando» de la misma cuenta, que el consumo también invalida
    avanzar(1000);
    await repositorio.transaccion(async (t) => {
      await repositorio.bloquearCuentas(t, [12]);
      await repositorio.insertarReserva(t, { usuarioId: 12, origen: 'propio', solicitadoPor: null, tokenHash: tokens.hashToken(tokens.generarToken()), expiraEn: ahora + VIGENCIA_ENLACE_MS });
    });
    const uso = await confirmar(tokenUso, 'NuevaClave123');
    const cuenta12 = db.usuarios.find(u => u.id === 12);
    igual('confirmar -> 200 sin iniciar sesión (sin token en la respuesta)', [uso.r?.status, 'token' in (uso.r?.cuerpo ?? {})], [200, false]);
    igual('la contraseña cambió, version_sesion +1, el enlace usado y la reserva pendiente invalidada (contrasena_cambiada)',
      [await bcryptReal.compare('NuevaClave123', cuenta12.contrasena), cuenta12.version_sesion, db.enlaces.map(e => [e.estado, e.motivo])],
      [true, 1, [['usado', null], ['invalidado', 'contrasena_cambiada']]]);
    igual('eventos del consumo: invalidado y usado, sin actor', db.eventos.slice(-2).map(e => [e.tipo, e.actor_id]),
      [['restablecimiento_invalidado', null], ['restablecimiento_usado', null]]);
    const verificarToken = require('../src/middlewares/auth.middleware');
    const resDoble = () => ({ codigo: 200, status(c) { this.codigo = c; return this; }, json(b) { this.cuerpo = b; return this; } });
    const resAnterior = resDoble();
    let siguiente = false;
    await verificarToken({ headers: { authorization: `Bearer ${sesionAnterior}` } }, resAnterior, () => { siguiente = true; });
    const resNueva = resDoble();
    let siguienteNueva = false;
    await verificarToken({ headers: { authorization: `Bearer ${firmarSesion(cuenta12, 'panadero').token}` } }, resNueva, () => { siguienteNueva = true; });
    igual('el JWT anterior al restablecimiento -> 401; uno firmado con la versión nueva sí pasa', [resAnterior.codigo, siguiente, siguienteNueva], [401, false, true]);
    igual('el enlace es de un solo uso: reutilizarlo -> 400 genérico', [(await confirmar(tokenUso, 'OtraClave123')).e?.message], [MENSAJE_ENLACE_NO_VALIDO]);

    preparar();
    await asistir(10, 12);
    const tokenCaduca = tokenDe(enviados[0]);
    avanzar(VIGENCIA_ENLACE_MS);
    igual('a los 30 minutos el enlace caduca: validar y confirmar -> 400 sin cambiar la contraseña',
      [estadoDe(await validar(tokenCaduca)), estadoDe(await confirmar(tokenCaduca)), db.usuarios.find(u => u.id === 12).version_sesion], [400, 400, 0]);

    preparar();
    await asistir(10, 12);
    db.usuarios.find(u => u.id === 12).estado = false; // desactivada por otra vía después del envío
    const desactivadaDespues = await confirmar(tokenDe(enviados[0]));
    igual('cuenta desactivada después del envío -> 400 y el enlace queda invalidado (cuenta_desactivada)',
      [estadoDe(desactivadaDespues), db.enlaces.map(e => [e.estado, e.motivo])], [400, [['invalidado', 'cuenta_desactivada']]]);

    console.log('\n== intentos fallidos del enlace (5) y fallos de token por IP (5 cada 15 min)');
    preparar();
    await asistir(10, 12);
    const tokenIntentos = tokenDe(enviados[0]);
    const debiles = [];
    for (let i = 0; i < 5; i++) debiles.push((await confirmar(tokenIntentos, 'corta')).e?.status);
    igual('5 contraseñas que no cumplen la política -> 400 cada una y el enlace queda invalidado por «intentos»',
      [debiles, db.enlaces.map(e => [e.estado, e.motivo, e.intentos_fallidos]), tipos().at(-1)], [[400, 400, 400, 400, 400], [['invalidado', 'intentos', 5]], 'restablecimiento_invalidado']);
    igual('después, con una contraseña válida -> 400 genérico y la contraseña no cambia',
      [(await confirmar(tokenIntentos, 'NuevaClave123')).e?.message, db.usuarios.find(u => u.id === 12).version_sesion], [MENSAJE_ENLACE_NO_VALIDO, 0]);

    preparar();
    await asistir(10, 12);
    const tokenBueno = tokenDe(enviados[0]);
    const falsos = [];
    for (let i = 0; i < 5; i++) falsos.push(estadoDe(await confirmar(tokens.generarToken())));
    falsos.push(estadoDe(await validar('formato-no-valido')));
    const bloqueada = await confirmar(tokenBueno);
    igual('5 tokens desconocidos -> 400; después, en la misma IP, incluso el token válido -> 429 con Retry-After',
      [falsos, estadoDe(bloqueada), bloqueada.e?.retryAfterS > 0, db.usuarios.find(u => u.id === 12).version_sesion], [[400, 400, 400, 400, 400, 429], 429, true, 0]);
    igual('desde otra IP el token válido funciona', estadoDe(await confirmar(tokenBueno, 'NuevaClave123', '198.51.100.20')), 200);

    // ================= Invalidación (usada por cuentas y Mi cuenta) =================
    console.log('\n== invalidarPendientes: «activo» y «enviando» de la cuenta, con evento por enlace');
    preparar();
    await asistir(10, 12);
    avanzar(1000);
    await repositorio.transaccion(async (t) => {
      await repositorio.bloquearCuentas(t, [12]);
      await repositorio.insertarReserva(t, { usuarioId: 12, origen: 'propio', solicitadoPor: null, tokenHash: tokens.hashToken(tokens.generarToken()), expiraEn: ahora + VIGENCIA_ENLACE_MS });
    });
    await asistir(10, 16);
    const n = await repositorio.transaccion((t) => repositorio.invalidarPendientes(t, { usuarioId: 12, motivo: 'email_cambiado', actorId: 10, panaderiaId: 20, ahora }));
    igual('invalida los 2 pendientes de la cuenta (activo y enviando) y no toca los de otra cuenta',
      [n, enlacesDe(12), db.enlaces.filter(e => e.usuario_id === 12).map(e => e.motivo), enlacesDe(16)], [2, ['invalidado', 'invalidado'], ['email_cambiado', 'email_cambiado'], ['activo']]);
    igual('un evento restablecimiento_invalidado por enlace, con el actor, la panadería y el motivo',
      db.eventos.filter(e => e.tipo === 'restablecimiento_invalidado').map(e => [e.usuario_id, e.actor_id, e.panaderia_id, e.detalle]),
      [[12, 10, 20, 'email_cambiado'], [12, 10, 20, 'email_cambiado']]);

    // ================= Garantías transversales =================
    console.log('\n== garantías: sin transacciones abiertas durante SMTP ni bcrypt; datos sensibles');
    igual('en todas las pruebas: ningún envío SMTP ni bcrypt con una transacción abierta, ni escrituras fuera de transacción', violaciones, []);
    igual('ninguna transacción quedó abierta', abiertas, 0);
    // Control negativo: los dobles SÍ detectan un envío o un bcrypt dentro de una transacción
    const correoControl = correoDoble();
    await repositorio.transaccion(async () => {
      await correoControl.enviarEnlaceRestablecimiento({ para: 'control@pansys.test', enlace: enlacePrueba });
      await bcryptDoble.hash('Control12345');
    });
    igual('control: un envío y un bcrypt dentro de una transacción se detectan como infracciones',
      violaciones, ['envío SMTP con una transacción abierta', 'bcrypt.hash con una transacción abierta']);
  } finally {
    sequelize.transaction = originales.transaction;
    Object.assign(Usuario, originales.usuario);
    Object.assign(RC, originales.rc);
    Object.assign(EventoSeguridad, originales.evento);
  }

  // ================= Controlador y rutas =================
  console.log('\n== controlador: Retry-After, errores internos sin datos sensibles, sin Host');
  const { crearControlador, responder } = require('../src/modules/auth/restablecimiento.controller');
  const resCtl = () => ({ codigo: null, cabeceras: {}, status(c) { this.codigo = c; return this; }, json(b) { this.cuerpo = b; return this; }, set(k, v) { this.cabeceras[k] = v; return this; } });
  let recibido = null;
  const servicioFalso = {
    solicitarPropio: async (datos) => { recibido = datos; const e = new ErrorNegocio('Demasiadas solicitudes.', 429); e.retryAfterS = 120; throw e; },
    validar: async () => ({ status: 202, cuerpo: { estado: 'procesando' } }),
    confirmar: async () => { throw Object.assign(new Error('Query failed'), { name: 'SequelizeDatabaseError', sql: 'SELECT ... WHERE token_hash = ?', parameters: ['f'.repeat(64)], code: 'ER_X' }); },
    solicitarAsistido: async (datos) => { recibido = datos; return { status: 200, cuerpo: { mensaje: 'ok' } }; }
  };
  const ctl = crearControlador(servicioFalso);
  const r429 = resCtl();
  await ctl.solicitar({ body: { email: 'a@b.test' }, ip: '203.0.113.1', headers: { host: 'atacante.test', 'x-forwarded-host': 'atacante.test' }, protocol: 'http' }, r429);
  igual('429 -> Retry-After en la cabecera y el servicio solo recibe email e IP (nunca Host ni el protocolo)',
    [r429.codigo, r429.cabeceras['Retry-After'], recibido], [429, '120', { email: 'a@b.test', ip: '203.0.113.1' }]);
  const r500 = resCtl();
  const inicioSalida = salidaConsola.length;
  await ctl.confirmar({ body: { token: 'x', contrasena_nueva: 'y' }, ip: '203.0.113.1' }, r500);
  const registrado = salidaConsola.slice(inicioSalida).join('\n');
  igual('error interno -> 500 genérico; el registro solo lleva nombre y código, nunca el SQL ni sus parámetros',
    [r500.codigo, r500.cuerpo, /SequelizeDatabaseError ER_X/.test(registrado), registrado.includes('f'.repeat(64)), /token_hash|SELECT/.test(registrado)],
    [500, { error: 'Error interno del servidor' }, true, false, false]);
  const r202 = resCtl();
  await ctl.validar({ body: { token: 't' }, ip: '203.0.113.1' }, r202);
  igual('validar «procesando» -> 202', [r202.codigo, r202.cuerpo], [202, { estado: 'procesando' }]);
  const rAsist = resCtl();
  await ctl.solicitarAsistido({ body: { contrasena: 'Clave12345' }, params: { id: '12' }, usuario: { id: 10 }, ip: '203.0.113.1' }, rAsist);
  igual('asistida: el actor sale de la sesión (req.usuario) y el id de la ruta', recibido, { actorId: 10, idTexto: '12', contrasena: 'Clave12345' });
  const rConflicto = resCtl();
  responder(rConflicto, Object.assign(new Error('Duplicate'), { name: 'SequelizeUniqueConstraintError' }));
  igual('conflicto UNIQUE simultáneo -> 409 reintentable', [rConflicto.codigo, rConflicto.cuerpo.codigo], [409, 'CONFLICTO_CONCURRENCIA']);

  console.log('\n== rutas: públicas sin sesión y asistida solo para administradores');
  const verificarToken = require('../src/middlewares/auth.middleware');
  const rutas = (router) => router.stack.filter(c => c.route).map(c => ({
    ruta: c.route.path, metodo: Object.keys(c.route.methods)[0], conSesion: c.route.stack.some(s => s.handle === verificarToken), manejadores: c.route.stack.length
  }));
  const deAuth = rutas(require('../src/modules/auth/auth.routes')).filter(r => r.ruta.startsWith('/restablecimiento'));
  igual('auth: tres POST públicos de restablecimiento, sin verificarToken', deAuth, [
    { ruta: '/restablecimiento/solicitar', metodo: 'post', conSesion: false, manejadores: 1 },
    { ruta: '/restablecimiento/validar', metodo: 'post', conSesion: false, manejadores: 1 },
    { ruta: '/restablecimiento/confirmar', metodo: 'post', conSesion: false, manejadores: 1 }
  ]);
  const deUsuarios = rutas(require('../src/modules/usuarios/usuarios.routes')).filter(r => r.ruta.endsWith('/restablecimiento'));
  igual('usuarios: POST /:id/restablecimiento con sesión y permitirRoles (3 manejadores)', deUsuarios,
    [{ ruta: '/:id/restablecimiento', metodo: 'post', conSesion: true, manejadores: 3 }]);
  const { login } = require('../src/modules/auth/auth.controller');
  igual('el login no incorpora ningún limitador (fuera del alcance de R-b)', /limitador|crearLimitador/.test(login.toString()), false);

  // ================= Datos sensibles en la salida =================
  igual('la salida de consola de toda la ejecución no contiene tokens, hashes de 64 hex, contraseñas ni correos de las cuentas',
    salidaConsola.filter(l => /[A-Za-z0-9_-]{43}|[0-9a-f]{64}|Admin12345|NuevaClave123|@pansys\.test/.test(l)), []);
};

main()
  .catch(error => { resultados.push(false); console.log('FALLA ejecución abortada ->', error.stack); })
  .finally(() => {
    const fallidas = resultados.filter(ok => !ok).length;
    console.log(`\n${resultados.length - fallidas}/${resultados.length} pruebas correctas`);
    process.exit(fallidas ? 1 : 0);
  });
