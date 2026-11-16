// Pruebas del arranque (modo demo y frontend servido desde Express). No usan MySQL:
// las conexiones son dobles en memoria y, por seguridad, DB_HOST apunta a un dominio .invalid
// (reservado, nunca resuelve). Fase 1: la base de producción solo con --entorno=produccion,
// NODE_ENV=production y PANSYS_AUTORIZAR_BASE_PRODUCCION, y el correo validado antes de conectar.
// La prueba final carga el app.js real en modo demo con DB_NAME=pansys_db y comprueba que el
// arranque se cancela ANTES de intentar conectar.
// OJO: levanta dos servidores HTTP DENTRO de este proceso, solo en 127.0.0.1 y en un puerto libre
// (una app Express de prueba y el app.js real sin base de datos), y los cierra al terminar.
//
// Uso (desde backend/):  node pruebas/arranque.unitarias.js

process.env.DB_HOST = 'base-inexistente.invalid';
require('dotenv').config({ quiet: true });

const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const {
  BASE_DEMO, ErrorArranque, leerOpciones, validarConfiguracion, comprobarBuild, montarFrontend, iniciarServidor
} = require('../src/config/arranque');

const resultados = [];
const igual = (descripcion, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  resultados.push(ok);
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${descripcion}${ok ? '' : ` -> obtenido ${JSON.stringify(real)}, esperado ${JSON.stringify(esperado)}`}`);
};
const lanza = (fn) => { try { fn(); return null; } catch (e) { return e instanceof ErrorArranque ? 'ErrorArranque' : e.name; } };

// Doble de Sequelize y de app.listen que registra el orden de las llamadas
const dobles = ({ base = BASE_DEMO, fallaConexion = false, fallaConsulta = false } = {}) => {
  const eventos = [];
  const sequelize = {
    authenticate: async () => { eventos.push('conexion'); if (fallaConexion) throw new Error('sin conexión'); },
    query: async (sql) => { eventos.push(`consulta:${sql}`); if (fallaConsulta) throw new Error('consulta fallida'); return [[{ base }]]; }
  };
  const app = {
    listen: (puerto, alEscuchar) => {
      eventos.push(`listen:${puerto}`);
      const servidor = { on: () => servidor };
      setImmediate(alEscuchar);
      return servidor;
    }
  };
  return { eventos, sequelize, app };
};
const intentar = (promesa) => promesa.then(() => 'arrancó', e => (e instanceof ErrorArranque ? `cancelado: ${e.message}` : `error: ${e.message}`));

const main = async () => {
  // ---------- Lectura de opciones ----------
  console.log('\n== Opciones de entorno');
  for (const v of ['1', 'true', 'TRUE', ' si ', 'sí', 'Sí']) igual(`PANSYS_MODO_DEMO="${v}" activa el modo demo`, leerOpciones({ PANSYS_MODO_DEMO: v }).modoDemo, true);
  for (const v of [undefined, '', '0', 'false', 'no', 'demo', 'yes']) igual(`PANSYS_MODO_DEMO=${JSON.stringify(v)} no lo activa`, leerOpciones({ PANSYS_MODO_DEMO: v }).modoDemo, false);
  igual('PANSYS_SERVIR_FRONTEND="1" activa servir el frontend', leerOpciones({ PANSYS_SERVIR_FRONTEND: '1' }).servirFrontend, true);
  igual('sin variables: modo normal y sin frontend (el entorno lo da config/entorno.js)',
    leerOpciones({}, { nombre: 'desarrollo', cargado: true }),
    { modoDemo: false, servirFrontend: false, dirFrontend: path.resolve(__dirname, '../../frontend/build'), entorno: 'desarrollo', entornoCargado: true });
  igual('el entorno real cargado en esta prueba es el de desarrollo (sin --entorno=produccion)', leerOpciones({}).entorno, 'desarrollo');

  // ---------- Validación de la configuración (antes de conectar) ----------
  console.log('\n== Validación de DB_NAME en modo demo');
  const demo = { modoDemo: true, servirFrontend: false };
  igual('modo demo con pansys_test -> se permite', lanza(() => validarConfiguracion({ DB_NAME: 'pansys_test' }, demo)), null);
  for (const nombre of ['pansys_db', 'PANSYS_TEST', 'pansys_test ', ' pansys_test', 'pansys_test2', 'pansys', '', undefined]) {
    igual(`modo demo con DB_NAME=${JSON.stringify(nombre)} -> se rechaza`, lanza(() => validarConfiguracion({ DB_NAME: nombre }, demo)), 'ErrorArranque');
  }
  // ---------- Fase 1: base de producción solo con autorización explícita y coherente ----------
  console.log('\n== Base de producción (fase 1): --entorno=produccion + NODE_ENV=production + PANSYS_AUTORIZAR_BASE_PRODUCCION');
  const DES = { modoDemo: false, entorno: 'desarrollo', entornoCargado: true };
  const PRO = { modoDemo: false, entorno: 'produccion', entornoCargado: true };
  // Producción exige además un JWT_SECRET fuerte (I2): valor de prueba aleatorio, no un secreto real
  const JWT_PRUEBA = 'Xq7mZ2vR9tL4wK8pN3bH6yJ1cF5dG0sA-pruebas-arranque';
  const AUT = { NODE_ENV: 'production', PANSYS_AUTORIZAR_BASE_PRODUCCION: 'pansys_db', JWT_SECRET: JWT_PRUEBA };
  const mensajeDe = (fn) => { try { fn(); return null; } catch (e) { return e instanceof ErrorArranque ? e.message : `otro: ${e.name}`; } };
  igual('producción completa (argumento, NODE_ENV y autorización) -> se permite', lanza(() => validarConfiguracion({ DB_NAME: 'pansys_db', ...AUT }, PRO)), null);
  for (const [descripcion, env, opciones] of [
    ['desarrollo con pansys_db', { DB_NAME: 'pansys_db' }, DES],
    ['opciones sin entorno (como antes) con pansys_db', { DB_NAME: 'pansys_db' }, { modoDemo: false }],
    ['desarrollo con PANSYS_DB (MySQL en Windows no distingue mayúsculas)', { DB_NAME: 'PANSYS_DB' }, DES],
    ['desarrollo con " pansys_db " (espacios)', { DB_NAME: ' pansys_db ' }, DES],
    ['desarrollo con pansys_db, NODE_ENV=production y autorización, pero sin --entorno=produccion', { DB_NAME: 'pansys_db', ...AUT }, DES],
    ['NODE_ENV=test con pansys_db (pruebas)', { DB_NAME: 'pansys_db', NODE_ENV: 'test' }, DES],
    ['producción sin PANSYS_AUTORIZAR_BASE_PRODUCCION', { DB_NAME: 'pansys_db', NODE_ENV: 'production' }, PRO],
    ['producción completa sin JWT_SECRET', { DB_NAME: 'pansys_db', NODE_ENV: 'production', PANSYS_AUTORIZAR_BASE_PRODUCCION: 'pansys_db' }, PRO],
    ['producción completa con el JWT_SECRET de .env.example', { DB_NAME: 'pansys_db', ...AUT, JWT_SECRET: 'genera_una_cadena_larga_y_aleatoria' }, PRO],
    ['producción con una autorización distinta', { DB_NAME: 'pansys_db', NODE_ENV: 'production', PANSYS_AUTORIZAR_BASE_PRODUCCION: 'si' }, PRO],
    ['--entorno=produccion sin NODE_ENV=production', { DB_NAME: 'pansys_db', PANSYS_AUTORIZAR_BASE_PRODUCCION: 'pansys_db' }, PRO],
    ['--entorno=produccion sin poder leer .env.produccion', { DB_NAME: 'pansys_db', ...AUT }, { ...PRO, entornoCargado: false }],
    ['--entorno=produccion con el modo demo', { DB_NAME: 'pansys_db', ...AUT }, { ...PRO, modoDemo: true }],
    ['NODE_ENV=production sin --entorno=produccion (aunque la base sea pansys_test)', { DB_NAME: 'pansys_test', NODE_ENV: 'production' }, DES],
    ['autorización de producción con otra base', { DB_NAME: 'pansys_test', PANSYS_AUTORIZAR_BASE_PRODUCCION: 'pansys_db' }, DES],
    ['demo con pansys_db', { DB_NAME: 'pansys_db', ...AUT }, { ...DES, modoDemo: true }]
  ]) {
    igual(`${descripcion} -> se rechaza antes de conectar`, lanza(() => validarConfiguracion(env, opciones)), 'ErrorArranque');
  }
  igual('desarrollo con pansys_test -> se permite', lanza(() => validarConfiguracion({ DB_NAME: 'pansys_test' }, DES)), null);

  console.log('\n== Correo validado en el arranque (fase 1), sin revelar valores');
  const CENTINELAS = ['usuario-centinela-arranque', 'clave-centinela-arranque'];
  const SMTP = { DB_NAME: 'pansys_test', PANSYS_CORREO_MODO: 'smtp', PANSYS_CORREO_REMITENTE: 'no-responder@pansys.invalid', PANSYS_SMTP_HOST: 'smtp.ejemplo.com',
    PANSYS_SMTP_TLS: 'starttls', PANSYS_SMTP_USUARIO: CENTINELAS[0], PANSYS_SMTP_CONTRASENA: CENTINELAS[1] };
  const sinAut = mensajeDe(() => validarConfiguracion(SMTP, DES));
  igual('SMTP real en desarrollo sin autorización -> se rechaza, con un mensaje sin credenciales',
    [typeof sinAut === 'string' && sinAut.startsWith('Correo: ') && sinAut.includes('PANSYS_PERMITIR_SMTP_REAL'), CENTINELAS.some(c => String(sinAut).includes(c))], [true, false]);
  igual('SMTP real en desarrollo autorizado pero sin destinos -> se rechaza',
    lanza(() => validarConfiguracion({ ...SMTP, PANSYS_PERMITIR_SMTP_REAL: '1' }, DES)), 'ErrorArranque');
  igual('SMTP real en desarrollo con autorización y destinos -> se permite',
    lanza(() => validarConfiguracion({ ...SMTP, PANSYS_PERMITIR_SMTP_REAL: '1', PANSYS_CORREO_DESTINOS_PERMITIDOS: 'destino@pansys.invalid' }, DES)), null);
  igual('SMTP real en el modo demo sin autorización -> se rechaza', lanza(() => validarConfiguracion(SMTP, { ...DES, modoDemo: true })), 'ErrorArranque');
  igual('SMTP real en producción completa -> se permite sin autorización extra',
    lanza(() => validarConfiguracion({ ...SMTP, DB_NAME: 'pansys_db', ...AUT }, PRO)), null);
  igual('Mailpit en desarrollo y en la demo -> se permite',
    [lanza(() => validarConfiguracion({ DB_NAME: 'pansys_test', PANSYS_CORREO_MODO: 'mailpit', PANSYS_CORREO_REMITENTE: 'no-responder@pansys.local', PANSYS_SMTP_HOST: '127.0.0.1' }, DES)),
      lanza(() => validarConfiguracion({ DB_NAME: 'pansys_test', PANSYS_CORREO_MODO: 'mailpit', PANSYS_CORREO_REMITENTE: 'no-responder@pansys.local' }, { ...DES, modoDemo: true }))], [null, null]);
  const remoto = mensajeDe(() => validarConfiguracion({ DB_NAME: 'pansys_test', PANSYS_CORREO_MODO: 'mailpit', PANSYS_CORREO_REMITENTE: 'no-responder@pansys.local', PANSYS_SMTP_HOST: 'host-centinela-arranque.ejemplo' }, DES));
  igual('Mailpit con un host remoto -> se rechaza sin mostrar el host', [typeof remoto === 'string' && remoto.startsWith('Correo: '), String(remoto).includes('host-centinela-arranque')], [true, false]);
  igual('servir frontend sin build -> se rechaza',
    lanza(() => comprobarBuild({ servirFrontend: true, dirFrontend: path.join(os.tmpdir(), 'no-existe-pansys-build') })), 'ErrorArranque');

  // ---------- Orden del arranque ----------
  console.log('\n== Orden del arranque (dobles, sin MySQL)');
  let d = dobles();
  igual('demo + pansys_test: conecta, verifica la base real y DESPUÉS escucha',
    [await intentar(iniciarServidor({ ...d, env: { DB_NAME: 'pansys_test', PORT: '3999' }, opciones: demo })), d.eventos],
    ['arrancó', ['conexion', 'consulta:SELECT DATABASE() AS base', 'listen:3999']]);

  d = dobles();
  const r1 = await intentar(iniciarServidor({ ...d, env: { DB_NAME: 'pansys_db', PORT: '3999' }, opciones: demo }));
  igual('demo + DB_NAME=pansys_db: se cancela sin conectar ni escuchar', [r1.startsWith('cancelado'), d.eventos], [true, []]);

  d = dobles({ base: 'pansys_db' });
  const r2 = await intentar(iniciarServidor({ ...d, env: { DB_NAME: 'pansys_test', PORT: '3999' }, opciones: demo }));
  igual('demo + la conexión real apunta a pansys_db: se cancela antes de escuchar',
    [r2.startsWith('cancelado'), r2.includes('"pansys_db"'), d.eventos.includes('listen:3999')], [true, true, false]);

  d = dobles({ base: null });
  igual('demo + conexión sin base seleccionada: se cancela antes de escuchar',
    [(await intentar(iniciarServidor({ ...d, env: { DB_NAME: 'pansys_test', PORT: '3999' }, opciones: demo }))).startsWith('cancelado'), d.eventos.includes('listen:3999')], [true, false]);

  d = dobles({ fallaConsulta: true });
  igual('demo + falla la comprobación de la base: no escucha',
    [(await intentar(iniciarServidor({ ...d, env: { DB_NAME: 'pansys_test', PORT: '3999' }, opciones: demo }))).startsWith('error'), d.eventos.includes('listen:3999')], [true, false]);

  d = dobles({ fallaConexion: true });
  igual('falla la conexión: no escucha',
    [(await intentar(iniciarServidor({ ...d, env: { DB_NAME: 'pansys_test', PORT: '3999' }, opciones: demo }))).startsWith('error'), d.eventos], [true, ['conexion']]);

  d = dobles({ base: 'pansys_test' });
  igual('modo normal (desarrollo, pansys_test): conecta y escucha sin consultar la base',
    [await intentar(iniciarServidor({ ...d, env: { DB_NAME: 'pansys_test', PORT: '3999' }, opciones: { modoDemo: false, servirFrontend: false, entorno: 'desarrollo', entornoCargado: true } })), d.eventos],
    ['arrancó', ['conexion', 'listen:3999']]);

  // Fase 1: la configuración insegura se rechaza ANTES de sequelize.authenticate()
  for (const [descripcion, env, opciones] of [
    ['desarrollo con DB_NAME=pansys_db', { DB_NAME: 'pansys_db', PORT: '3999' }, { modoDemo: false, servirFrontend: false, entorno: 'desarrollo', entornoCargado: true }],
    ['producción sin autorización de la base', { DB_NAME: 'pansys_db', NODE_ENV: 'production', PORT: '3999' }, { modoDemo: false, servirFrontend: false, entorno: 'produccion', entornoCargado: true }],
    ['SMTP real en desarrollo sin autorización', { DB_NAME: 'pansys_test', PORT: '3999', PANSYS_CORREO_MODO: 'smtp', PANSYS_CORREO_REMITENTE: 'no-responder@pansys.invalid',
      PANSYS_SMTP_HOST: 'smtp.ejemplo.com', PANSYS_SMTP_TLS: 'starttls' }, { modoDemo: false, servirFrontend: false, entorno: 'desarrollo', entornoCargado: true }]
  ]) {
    d = dobles();
    const r = await intentar(iniciarServidor({ ...d, env, opciones }));
    igual(`${descripcion}: se cancela sin llamar a sequelize.authenticate() ni escuchar`, [r.startsWith('cancelado'), d.eventos], [true, []]);
  }
  d = dobles({ base: 'pansys_db' });
  igual('producción completa: conecta y escucha',
    [await intentar(iniciarServidor({ ...d, env: { DB_NAME: 'pansys_db', ...AUT, PORT: '3999' },
      opciones: { modoDemo: false, servirFrontend: false, entorno: 'produccion', entornoCargado: true } })), d.eventos],
    ['arrancó', ['conexion', 'listen:3999']]);

  d = dobles();
  igual('servir frontend sin build: se cancela antes de conectar',
    [(await intentar(iniciarServidor({ ...d, env: { DB_NAME: 'pansys_test', PORT: '3999' },
      opciones: { modoDemo: true, servirFrontend: true, dirFrontend: path.join(os.tmpdir(), 'no-existe-pansys-build') } }))).startsWith('cancelado'), d.eventos], [true, []]);

  // ---------- Rutas con el frontend servido (Express real, build temporal) ----------
  console.log('\n== Rutas con el frontend servido');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pansys-build-'));
  fs.mkdirSync(path.join(dir, 'static', 'js'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>Pansys</title><div id="root"></div>');
  fs.writeFileSync(path.join(dir, 'static', 'js', 'main.abc.js'), 'console.log("pansys");');
  fs.writeFileSync(path.join(dir, '.env'), 'SECRETO=no-debe-servirse');
  const app = express();
  const api = express.Router();
  api.get('/inventario', (req, res) => res.json({ desde: 'api' }));
  app.use('/api', api);
  montarFrontend(app, dir);
  const servidor = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const pedir = async (ruta, metodo = 'GET') => {
    const r = await fetch(base + ruta, { method: metodo });
    return { status: r.status, tipo: (r.headers.get('content-type') || '').split(';')[0], cuerpo: metodo === 'HEAD' ? '' : await r.text() };
  };
  const esIndex = (r) => r.status === 200 && r.tipo === 'text/html' && r.cuerpo.includes('<div id="root">');
  try {
    for (const ruta of ['/', '/login', '/dashboard', '/dashboard/inventario', '/cualquier/ruta?x=1']) {
      igual(`GET ${ruta} -> index.html`, esIndex(await pedir(ruta)), true);
    }
    const head = await pedir('/login', 'HEAD');
    igual('HEAD /login -> 200 text/html', [head.status, head.tipo], [200, 'text/html']);
    const asset = await pedir('/static/js/main.abc.js');
    // Express 5 usa text/javascript (RFC 9239); versiones anteriores, application/javascript
    igual('archivo estático existente -> se sirve como JavaScript',
      [asset.status, ['text/javascript', 'application/javascript'].includes(asset.tipo), asset.cuerpo], [200, true, 'console.log("pansys");']);
    igual('archivo estático inexistente -> 404 (no index.html)', (await pedir('/static/js/falta.js')).status, 404);
    const apiOk = await pedir('/api/inventario');
    igual('/api/inventario -> responde la API, no el frontend', [apiOk.status, apiOk.tipo, apiOk.cuerpo], [200, 'application/json', '{"desde":"api"}']);
    for (const ruta of ['/api/no-existe', '/api', '/api/']) {
      const r = await pedir(ruta);
      igual(`${ruta} inexistente -> 404 sin index.html`, [r.status, r.cuerpo.includes('<div id="root">')], [404, false]);
    }
    igual('POST /dashboard -> 404 (index.html solo para GET/HEAD)', (await pedir('/dashboard', 'POST')).status, 404);
    const punto = await pedir('/.env');
    igual('/.env del build no se sirve', punto.cuerpo.includes('no-debe-servirse'), false);
    const trav = await pedir('/..%2f..%2fpackage.json');
    igual('ruta con ../ no sale del build', [trav.cuerpo.includes('"dependencies"'), trav.cuerpo.includes('no-debe-servirse')], [false, false]);
  } finally {
    await new Promise(resolve => servidor.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // ---------- app.js real en modo demo apuntando a pansys_db ----------
  console.log('\n== app.js real: modo demo con DB_NAME=pansys_db');
  const buildReal = fs.existsSync(path.join(__dirname, '../../frontend/build/index.html'));
  process.env.PANSYS_MODO_DEMO = '1';
  process.env.PANSYS_SERVIR_FRONTEND = buildReal ? '1' : '0';
  process.env.DB_NAME = 'pansys_db';
  process.env.PORT = '0';
  const { sequelize } = require('../src/models/index');
  let conexiones = 0;
  const autenticarOriginal = sequelize.authenticate.bind(sequelize);
  sequelize.authenticate = (...a) => { conexiones++; return autenticarOriginal(...a); };
  const errores = [];
  const errorOriginal = console.error;
  console.error = (...a) => errores.push(a.join(' '));
  const appReal = require('../src/app');
  await new Promise(resolve => setTimeout(resolve, 300));
  console.error = errorOriginal;
  // Fase 1: con DB_NAME=pansys_db, la protección de la base de producción salta antes que la del modo demo
  igual('el arranque se cancela con un mensaje claro', errores.some(e => e.startsWith('Arranque cancelado: DB_NAME apunta a la base de producción')), true);
  igual('no se intentó ninguna conexión a MySQL', conexiones, 0);
  igual('el proceso queda marcado como fallido (exitCode 1)', process.exitCode, 1);
  process.exitCode = 0;

  if (buildReal) {
    // Solo para comprobar el montaje real de rutas: se escucha a mano en un puerto local libre
    const s = await new Promise(resolve => { const x = appReal.listen(0, '127.0.0.1', () => resolve(x)); });
    const u = `http://127.0.0.1:${s.address().port}`;
    try {
      const front = await fetch(u + '/dashboard');
      igual('app real: /dashboard -> index.html del build', [front.status, (await front.text()).includes('<div id="root">')], [200, true]);
      const sinToken = await fetch(u + '/api/inventario');
      igual('app real: /api/inventario sin token -> 401 JSON de la API (no el frontend)',
        [sinToken.status, (sinToken.headers.get('content-type') || '').split(';')[0], (await sinToken.json()).error], [401, 'application/json', 'Token no proporcionado']);
      const noExiste = await fetch(u + '/api/ruta-inexistente');
      igual('app real: /api/ruta-inexistente -> 404 sin index.html', [noExiste.status, (await noExiste.text()).includes('<div id="root">')], [404, false]);
    } finally {
      await new Promise(resolve => s.close(resolve));
    }
  } else {
    console.log('(sin frontend/build: se omiten las comprobaciones de rutas del app.js real)');
  }
  igual('ninguna conexión a MySQL en toda la prueba', conexiones, 0);
};

main()
  .catch(error => { resultados.push(false); console.log('FALLA ejecución abortada ->', error.message); })
  .finally(() => {
    const fallidas = resultados.filter(ok => !ok).length;
    console.log(`\n${resultados.length - fallidas}/${resultados.length} pruebas correctas`);
    process.exit(fallidas ? 1 : 0);
  });
