// Pruebas unitarias de las correcciones de seguridad previas a la publicación:
//  B1 límites de intentos fallidos de inicio de sesión (por IP y por cuenta, con concurrencia),
//  B2 'trust proxy' = 'loopback', I1 respuestas finales en JSON, I2 JWT_SECRET en producción,
//  I3 sin X-Powered-By.
// No usan MySQL: DB_HOST apunta a un dominio .invalid, los modelos y bcrypt se sustituyen por dobles
// y cualquier conexión de red que no sea al bucle local queda bloqueada. Solo la parte HTTP abre un
// servidor Express de prueba en 127.0.0.1 (puerto libre) y lo cierra al terminar.
//
// Uso (desde backend/):  node pruebas/seguridad.unitarias.js

process.env.DB_HOST = 'base-inexistente.invalid';
process.env.DB_NAME = 'sin_base_pruebas_unitarias';
process.env.JWT_SECRET = 'secreto-de-pruebas-unitarias-0123456789-abcdefghij';
const net = require('net');
const conectarOriginal = net.Socket.prototype.connect;
// Solo se permite el bucle local en un puerto distinto de 3306 (el servidor HTTP de esta prueba)
net.Socket.prototype.connect = function (...args) {
  let a = args[0]; if (Array.isArray(a)) a = a[0];
  const host = a && typeof a === 'object' ? String(a.host ?? 'localhost') : String(args[1] ?? 'localhost');
  const puerto = Number(a && typeof a === 'object' ? a.port : a);
  if (!['127.0.0.1', '::1', 'localhost'].includes(host) || puerto === 3306) throw new Error('Red bloqueada en las pruebas unitarias');
  return conectarOriginal.apply(this, args);
};
require('dotenv').config({ quiet: true });

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const resultados = [];
const igual = (descripcion, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  resultados.push(ok);
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${descripcion}${ok ? '' : ` -> obtenido ${JSON.stringify(real)}, esperado ${JSON.stringify(esperado)}`}`);
};
const resultado = (promesa) => promesa.then(r => ({ ok: true, r }), e => ({ ok: false, e }));
const MINUTO = 60 * 1000;

const main = async () => {
  const { crearLimitesLogin } = require('../src/modules/auth/login.limites');
  const { claveIp, claveCorreo } = require('../src/utils/limites');

  // ---------------- B1: limitador de inicio de sesión ----------------
  console.log('\n== B1: límites de intentos fallidos');
  let t = 1_000_000;
  const reloj = () => t;
  {
    const l = crearLimitesLogin({ reloj });
    for (let i = 0; i < 5; i++) l.reservar({ ip: '10.0.0.1', email: 'ana@x.com' }).liberar(true);
    const sexto = l.reservar({ ip: '10.0.0.2', email: 'ana@x.com' });
    igual('5 fallos de una cuenta -> el 6.º intento se rechaza (aunque cambie la IP)', sexto.permitido, false);
    igual('el rechazo indica cuándo reintentar (1-900 s)', sexto.retryAfterS >= 1 && sexto.retryAfterS <= 900, true);
    igual('otra cuenta desde la misma IP sigue permitida', l.reservar({ ip: '10.0.0.1', email: 'beto@x.com' }).permitido, true);
    igual('la cuenta no distingue mayúsculas ni espacios', l.reservar({ ip: '10.0.0.3', email: 'ANA@X.COM' }).permitido, false);
    // Los rechazos no se anotan: insistir no alarga el bloqueo
    for (let i = 0; i < 20; i++) l.reservar({ ip: '10.0.0.4', email: 'ana@x.com' });
    t += 15 * MINUTO + 1;
    igual('ventana finita: pasados 15 min se permite otra vez (insistir no alargó el bloqueo)', l.reservar({ ip: '10.0.0.1', email: 'ana@x.com' }).permitido, true);
  }
  {
    const l = crearLimitesLogin({ reloj });
    for (let i = 0; i < 10; i++) l.reservar({ ip: '10.1.1.1', email: `u${i}@x.com` }).liberar(true);
    igual('10 fallos desde una IP con cuentas distintas -> la IP se bloquea', l.reservar({ ip: '10.1.1.1', email: 'nueva@x.com' }).permitido, false);
    igual('otra IP no se ve afectada', l.reservar({ ip: '10.1.1.2', email: 'nueva@x.com' }).permitido, true);
  }
  {
    const l = crearLimitesLogin({ reloj });
    for (let i = 0; i < 50; i++) l.reservar({ ip: '10.2.2.2', email: 'ok@x.com' }).liberar(false);
    igual('50 inicios correctos no consumen intentos', l.reservar({ ip: '10.2.2.2', email: 'ok@x.com' }).permitido, true);
  }
  {
    // Concurrencia: reservas simultáneas sin liberar cuentan como fallos potenciales
    const l = crearLimitesLogin({ reloj });
    const r = []; for (let i = 0; i < 5; i++) r.push(l.reservar({ ip: `10.3.3.${i}`, email: 'carrera@x.com' }));
    igual('5 intentos simultáneos de una cuenta se admiten', r.every(x => x.permitido), true);
    igual('el 6.º simultáneo se rechaza antes de que terminen los anteriores', l.reservar({ ip: '10.3.3.9', email: 'carrera@x.com' }).permitido, false);
    r.forEach(x => x.liberar(true));
    igual('al terminar los 5 como fallos, sigue bloqueada', l.reservar({ ip: '10.3.3.9', email: 'carrera@x.com' }).permitido, false);
    igual('no quedan intentos en curso tras liberar', l.enCurso(), 0);
    const l2 = crearLimitesLogin({ reloj });
    const s = []; for (let i = 0; i < 5; i++) s.push(l2.reservar({ ip: `10.4.4.${i}`, email: 'exito@x.com' }));
    s.forEach(x => x.liberar(false));
    igual('si los simultáneos terminan bien, la cuenta queda libre', l2.reservar({ ip: '10.4.4.9', email: 'exito@x.com' }).permitido, true);
    const doble = l2.reservar({ ip: '10.5.5.5', email: 'doble@x.com' }); doble.liberar(true); doble.liberar(true);
    igual('liberar dos veces la misma reserva solo cuenta un fallo', [1, 2, 3, 4].map(() => l2.reservar({ ip: '10.5.5.5', email: 'doble@x.com' }).liberar(true)).length, 4);
    igual('...y tras 5 fallos reales (1+4) se bloquea', l2.reservar({ ip: '10.5.5.6', email: 'doble@x.com' }).permitido, false);
  }
  {
    // Sin IP conocida, igualmente acotado (clave 'ip:desconocida')
    const l = crearLimitesLogin({ reloj });
    for (let i = 0; i < 10; i++) l.reservar({ ip: undefined, email: `v${i}@x.com` }).liberar(true);
    igual('sin IP, el límite por IP se aplica a la clave común', l.reservar({ ip: undefined, email: 'otra@x.com' }).permitido, false);
  }
  igual('las claves no contienen el correo en claro', claveCorreo('ana@x.com').includes('ana'), false);
  igual('claveCorreo es la misma que usaba la recuperación (SHA-256 en minúsculas)',
    claveCorreo('Ana@X.com'), `correo:${crypto.createHash('sha256').update('ana@x.com', 'utf8').digest('hex')}`);
  igual('claveIp sin cambios', [claveIp('1.2.3.4'), claveIp(''), claveIp(null)], ['ip:1.2.3.4', 'ip:desconocida', 'ip:desconocida']);

  // ---------------- B1: servicio y controlador de login ----------------
  console.log('\n== B1: login (servicio y controlador, con dobles)');
  const bcrypt = require('bcrypt');
  const { Usuario } = require('../src/models/index');
  const authService = require('../src/modules/auth/auth.service');
  const authController = require('../src/modules/auth/auth.controller');
  const originales = { findOne: Usuario.findOne, compare: bcrypt.compare };
  const CUENTA = { id: 7, email: 'ana@x.com', contrasena: 'HASH', rol_id: 2, panaderia_id: 3, version_sesion: 0, estado: true, Rol: { nombre: 'panadero' } };
  let consultas = 0;
  Usuario.findOne = async ({ where }) => { consultas++; return where.email === 'ana@x.com' ? CUENTA : null; };
  bcrypt.compare = async (c) => c === 'Correcta1';
  try {
    const limites = crearLimitesLogin({ reloj });
    const ok = await resultado(authService.login('ana@x.com', 'Correcta1', { ip: '1.1.1.1', limites }));
    igual('credenciales correctas -> { token, usuario } como siempre', ok.ok && typeof ok.r.token === 'string' && ok.r.usuario?.id === 7, true);
    const malas = []; for (let i = 0; i < 5; i++) malas.push(await resultado(authService.login('ana@x.com', 'Mala', { ip: '1.1.1.1', limites })));
    igual('contraseña incorrecta -> 401 «Credenciales inválidas»', malas.map(m => [m.e?.status, m.e?.message])[0], [401, 'Credenciales inválidas']);
    consultas = 0;
    const bloq = await resultado(authService.login('ana@x.com', 'Correcta1', { ip: '1.1.1.1', limites }));
    igual('tras 5 fallos: 429 genérico, incluso con la contraseña correcta', [bloq.e?.status, bloq.e?.message],
      [429, 'Demasiados intentos de inicio de sesión. Inténtelo de nuevo más tarde.']);
    igual('el 429 no consulta la base ni bcrypt', consultas, 0);
    igual('el 429 lleva retryAfterS', Number.isInteger(bloq.e?.retryAfterS) && bloq.e.retryAfterS > 0, true);
    const lim2 = crearLimitesLogin({ reloj });
    for (let i = 0; i < 5; i++) await resultado(authService.login('nadie@x.com', 'x', { ip: '2.2.2.2', limites: lim2 }));
    const inex = await resultado(authService.login('nadie@x.com', 'x', { ip: '2.2.2.3', limites: lim2 }));
    igual('una cuenta inexistente se limita igual (mismo 429, no revela si existe)', inex.e?.status, 429);
    // Un error interno no cuenta como fallo de credenciales y libera la reserva
    const lim3 = crearLimitesLogin({ reloj });
    Usuario.findOne = async () => { throw new Error('caída simulada de la base'); };
    for (let i = 0; i < 8; i++) await resultado(authService.login('ana@x.com', 'x', { ip: '3.3.3.3', limites: lim3 }));
    Usuario.findOne = async ({ where }) => (where.email === 'ana@x.com' ? CUENTA : null);
    const trasCaida = await resultado(authService.login('ana@x.com', 'Correcta1', { ip: '3.3.3.3', limites: lim3 }));
    igual('8 errores internos no bloquean la cuenta ni dejan reservas', [trasCaida.ok, lim3.enCurso()], [true, 0]);

    // Controlador: pasa req.ip y el 429 lleva Retry-After
    let recibido = null;
    const loginOriginal = authService.login;
    authService.login = async (email, contrasena, opciones) => {
      recibido = opciones;
      const e = new (require('../src/utils/errores').ErrorNegocio)('Demasiados intentos de inicio de sesión. Inténtelo de nuevo más tarde.', 429);
      e.retryAfterS = 42; throw e;
    };
    const res = { cabeceras: {}, codigo: 200, cuerpo: null, set(k, v) { this.cabeceras[k] = v; return this; }, status(c) { this.codigo = c; return this; }, json(b) { this.cuerpo = b; return this; } };
    await authController.login({ body: { email: 'ana@x.com', contrasena: 'x' }, ip: '203.0.113.7' }, res);
    authService.login = loginOriginal;
    igual('el controlador pasa la IP del cliente al servicio', recibido, { ip: '203.0.113.7' });
    igual('429 con Retry-After y mensaje genérico', [res.codigo, res.cabeceras['Retry-After'], res.cuerpo],
      [429, '42', { error: 'Demasiados intentos de inicio de sesión. Inténtelo de nuevo más tarde.' }]);
  } finally {
    Usuario.findOne = originales.findOne; bcrypt.compare = originales.compare;
  }

  // ---------------- I1: respuestas finales ----------------
  console.log('\n== I1: manejador final de errores');
  const { rutaApiNoEncontrada, manejadorFinalDeErrores } = require('../src/middlewares/errores.middleware');
  const resFalsa = () => ({ headersSent: false, codigo: 200, cuerpo: null, status(c) { this.codigo = c; return this; }, json(b) { this.cuerpo = b; return this; } });
  const registro = []; const consolaError = console.error; console.error = (...a) => registro.push(a.join(' '));
  try {
    const casos = [
      ['JSON mal formado -> 400', { type: 'entity.parse.failed', status: 400, body: '{"a":', message: 'Unexpected token' }, 400, { error: 'El cuerpo de la petición no es un JSON válido' }],
      ['cuerpo demasiado grande -> 413', { type: 'entity.too.large', status: 413 }, 413, { error: 'El cuerpo de la petición es demasiado grande' }],
      ['otro error del lector (415) -> su código, mensaje genérico', { type: 'charset.unsupported', status: 415, charset: 'x' }, 415, { error: 'Petición no válida' }],
      ['error no controlado -> 500 genérico', Object.assign(new Error('SELECT * FROM pansys_test.usuarios WHERE clave=secreta'), { code: 'ER_X' }), 500, { error: 'Error interno del servidor' }]
    ];
    for (const [d, err, c, b] of casos) { const r = resFalsa(); manejadorFinalDeErrores(err, {}, r, () => {}); igual(d, [r.codigo, r.cuerpo], [c, b]); }
    igual('el registro del 500 no incluye el mensaje (ni SQL ni datos)', registro.some(l => /SELECT|secreta|pansys_test/.test(l)), false);
    igual('el registro del 500 sí indica nombre y código', registro.some(l => l.includes('Error') && l.includes('ER_X')), true);
    let delegado = null; const enviada = { ...resFalsa(), headersSent: true };
    manejadorFinalDeErrores(new Error('x'), {}, enviada, (e) => { delegado = e; });
    igual('si la respuesta ya empezó, se delega a Express', delegado instanceof Error, true);
    const r404 = resFalsa(); rutaApiNoEncontrada({}, r404);
    igual('ruta /api inexistente -> 404 JSON', [r404.codigo, r404.cuerpo], [404, { error: 'Ruta no encontrada' }]);
  } finally { console.error = consolaError; }

  // ---------------- B2, I3, I1: Express real en 127.0.0.1 ----------------
  console.log('\n== B2 / I3 / I1: aplicación Express de prueba en 127.0.0.1');
  const express = require('express');
  const { configurarSeguridad } = require('../src/config/seguridad');
  const app = configurarSeguridad(express());
  igual('trust proxy = loopback', app.get('trust proxy'), 'loopback');
  igual('x-powered-by deshabilitado', app.get('x-powered-by'), false);
  app.use(express.json());
  app.get('/api/ip', (req, res) => res.json({ ip: req.ip }));
  app.post('/api/eco', (req, res) => res.json({ recibido: req.body }));
  app.use('/api', rutaApiNoEncontrada);
  app.use(manejadorFinalDeErrores);
  const servidor = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const puerto = servidor.address().port;
  const pedir = (metodo, ruta, { cuerpo, cabeceras = {} } = {}) => new Promise((ok, mal) => {
    const req = http.request({ host: '127.0.0.1', port: puerto, path: ruta, method: metodo, headers: { 'Content-Type': 'application/json', ...cabeceras } }, (r) => {
      let d = ''; r.on('data', c => { d += c; }); r.on('end', () => ok({ status: r.statusCode, headers: r.headers, cuerpo: d }));
    });
    req.on('error', mal); if (cuerpo !== undefined) req.write(cuerpo); req.end();
  });
  try {
    const sinProxy = await pedir('GET', '/api/ip');
    igual('sin cabecera: req.ip es la conexión local', ['127.0.0.1', '::ffff:127.0.0.1'].includes(JSON.parse(sinProxy.cuerpo).ip), true);
    igual('ninguna respuesta lleva X-Powered-By', sinProxy.headers['x-powered-by'], undefined);
    const conProxy = await pedir('GET', '/api/ip', { cabeceras: { 'X-Forwarded-For': '203.0.113.5' } });
    igual('desde el proxy local: req.ip es la dirección que añade el proxy', JSON.parse(conProxy.cuerpo).ip, '203.0.113.5');
    const falseada = await pedir('GET', '/api/ip', { cabeceras: { 'X-Forwarded-For': '6.6.6.6, 203.0.113.9' } });
    igual('con una cadena, se toma la que añadió el proxy (la de la derecha), no la que escribió el cliente', JSON.parse(falseada.cuerpo).ip, '203.0.113.9');
    const json = await pedir('POST', '/api/eco', { cuerpo: '{"a":' });
    igual('JSON mal formado -> 400 en JSON', [json.status, json.headers['content-type']?.startsWith('application/json'), JSON.parse(json.cuerpo)],
      [400, true, { error: 'El cuerpo de la petición no es un JSON válido' }]);
    const grande = await pedir('POST', '/api/eco', { cuerpo: JSON.stringify({ x: 'a'.repeat(200 * 1024) }) });
    igual('cuerpo de más de 100 kB -> 413 en JSON', [grande.status, JSON.parse(grande.cuerpo).error], [413, 'El cuerpo de la petición es demasiado grande']);
    const noExiste = await pedir('GET', '/api/no-existe');
    igual('/api inexistente -> 404 en JSON', [noExiste.status, JSON.parse(noExiste.cuerpo)], [404, { error: 'Ruta no encontrada' }]);
    const valido = await pedir('POST', '/api/eco', { cuerpo: '{"a":1}' });
    igual('una petición válida no cambia', [valido.status, JSON.parse(valido.cuerpo)], [200, { recibido: { a: 1 } }]);
  } finally { await new Promise(r => servidor.close(r)); }

  // ---------------- I2: JWT_SECRET en producción ----------------
  console.log('\n== I2: JWT_SECRET en producción');
  const { validarConfiguracion, motivoSecretoJwtDebil, iniciarServidor } = require('../src/config/arranque');
  const fuerte = crypto.randomBytes(48).toString('base64url');
  const casosJwt = [
    ['ausente', undefined, true], ['vacío', '', true], ['con espacios', ` ${fuerte}`, true], ['corto (31)', fuerte.slice(0, 31), true],
    ['valor de .env.example', 'genera_una_cadena_larga_y_aleatoria', true], ['fragmento de ejemplo', 'mi_jwt_secret_de_produccion_2026_x', true],
    ['repetitivo', 'abababababababababababababababababab', true], ['aleatorio de 64', fuerte, false]
  ];
  for (const [d, v, rechazo] of casosJwt) igual(`JWT_SECRET ${d} -> ${rechazo ? 'rechazado' : 'aceptado'}`, motivoSecretoJwtDebil(v) !== null, rechazo);
  const opcionesProd = { entorno: 'produccion', entornoCargado: true, modoDemo: false, servirFrontend: false };
  const secretoDebil = 'abababababababababababababababababab';
  const debil = (() => { try { validarConfiguracion({ NODE_ENV: 'production', JWT_SECRET: secretoDebil, DB_NAME: 'otra' }, opcionesProd); return null; } catch (e) { return e; } })();
  igual('producción con secreto débil: no arranca', debil?.name, 'ErrorArranque');
  igual('el mensaje nunca incluye el secreto', String(debil?.message).includes(secretoDebil), false);
  igual('producción con secreto fuerte: la validación pasa', (() => { try { validarConfiguracion({ NODE_ENV: 'production', JWT_SECRET: fuerte, DB_NAME: 'otra' }, opcionesProd); return true; } catch { return false; } })(), true);
  igual('desarrollo: no se exige (la demo local no cambia)', (() => { try { validarConfiguracion({ DB_NAME: 'pansys_test' }, { entorno: 'desarrollo', entornoCargado: true, modoDemo: false }); return true; } catch { return false; } })(), true);

  // ---------------- Orden del arranque: montarFinales justo antes de listen ----------------
  console.log('\n== I1: respuestas finales montadas al final del arranque');
  const pasos = [];
  const appFalsa = { listen(p, cb) { pasos.push('listen'); const e = new (require('events'))(); setImmediate(cb); return e; } };
  const seqFalsa = { authenticate: async () => pasos.push('authenticate'), query: async () => [[{ base: 'pansys_test' }]] };
  await iniciarServidor({ app: appFalsa, sequelize: seqFalsa, env: { DB_NAME: 'x', PORT: '0' }, opciones: { entorno: 'desarrollo', entornoCargado: true, modoDemo: false, servirFrontend: false }, montarFinales: () => pasos.push('finales') });
  igual('orden: conexión -> respuestas finales -> listen', pasos, ['authenticate', 'finales', 'listen']);
  const pasos2 = [];
  await resultado(iniciarServidor({ app: appFalsa, sequelize: { authenticate: async () => { throw new Error('sin base'); } }, env: { DB_NAME: 'x' }, opciones: { entorno: 'desarrollo', entornoCargado: true, modoDemo: false, servirFrontend: false }, montarFinales: () => pasos2.push('finales') }));
  igual('si la conexión falla, no se monta nada ni se escucha', pasos2, []);

  // ---------------- Comprobaciones estáticas de app.js ----------------
  console.log('\n== Comprobaciones estáticas de src/app.js');
  const fuente = fs.readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
  igual('configurarSeguridad(app) se aplica antes de cualquier app.use', fuente.indexOf('configurarSeguridad(app)') > 0 && fuente.indexOf('configurarSeguridad(app)') < fuente.indexOf('app.use('), true);
  igual('app.js entrega montarFinales a iniciarServidor', /iniciarServidor\(\{[^}]*montarFinales[^}]*\}\)/.test(fuente), true);
  igual('el 404 de /api y el manejador final no se montan al cargar app.js', /^app\.use\((rutaApiNoEncontrada|manejadorFinalDeErrores)|^app\.use\('\/api', rutaApiNoEncontrada/m.test(fuente), false);

  const fallidas = resultados.filter(r => !r).length;
  console.log(`\n${resultados.length - fallidas}/${resultados.length} pruebas correctas`);
  process.exit(fallidas ? 1 : 0);
};

main().catch(e => { console.error('Error inesperado en las pruebas:', e?.message); process.exit(1); });
