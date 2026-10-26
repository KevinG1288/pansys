// Pruebas de integración de la gestión de cuentas (usuarios, panaderías, contraseña y
// verificación de cuenta activa en el middleware).
// Se ejecutan SOLO contra la base pansys_test (ver database/pruebas/crear_pansys_test.sql):
// modifican cuentas, por lo que abortan si la base conectada es otra. Al empezar y al
// terminar restauran los usuarios 1-4 de la semilla y borran los creados por la prueba.
//
// Requiere el SQL 004 (usuarios.version_sesion) aplicado en pansys_test: si falta, aborta.
//
// Uso (desde backend/):  node pruebas/usuarios.pruebas.js

// ---------- DESHABILITADA TEMPORALMENTE POR SEGURIDAD ----------
// Esta suite borraba todas las cuentas con id > 4 de pansys_test (incluidas las de la demo y las
// cuentas temporales de otras suites), devolvía a '!' las contraseñas de las cuentas semilla y
// limpiaba insumos por patrón de nombre. Queda desactivada hasta su refactorización con
// pruebas/aislamiento.js. Termina aquí, como primera instrucción: antes de cargar dotenv, los
// modelos o el servidor, sin abrir conexiones ni escribir nada.
console.error('Suite de Cuentas DESHABILITADA temporalmente por seguridad: borraba cuentas ajenas y reiniciaba las cuentas semilla de pansys_test. ' +
  'No se ha conectado a ninguna base ni ha modificado datos. Se reactivará tras su refactorización.');
process.exit(1);

process.env.DB_NAME = 'pansys_test';
process.env.PORT = process.env.PORT_PRUEBAS || '3105';
require('dotenv').config({ quiet: true });

const jwt = require('jsonwebtoken');
const { sequelize } = require('../src/models/index');

const URL = `http://localhost:${process.env.PORT}`;

// Usuarios creados por crear_pansys_test.sql (contraseña '!', no pueden iniciar sesión)
const SEMILLA = [
  { id: 1, email: 'admin@pansys.test', rol_id: 1, panaderia_id: null },
  { id: 2, email: 'panadero1@pansys.test', rol_id: 2, panaderia_id: 1 },
  { id: 3, email: 'panadero2@pansys.test', rol_id: 2, panaderia_id: 2 },
  { id: 4, email: 'gerente1@pansys.test', rol_id: 3, panaderia_id: 1 }
];

const firmar = (datos) => jwt.sign(datos, process.env.JWT_SECRET, { expiresIn: '10m' });
const TOKENS = {
  admin: firmar({ id: 1, email: 'admin@pansys.test', rol: 'administrador', rol_id: 1, panaderia_id: null }),
  panadero1: firmar({ id: 2, email: 'panadero1@pansys.test', rol: 'panadero', rol_id: 2, panaderia_id: 1 }),
  panadero2: firmar({ id: 3, email: 'panadero2@pansys.test', rol: 'panadero', rol_id: 2, panaderia_id: 2 }),
  gerente1: firmar({ id: 4, email: 'gerente1@pansys.test', rol: 'gerente', rol_id: 3, panaderia_id: 1 }),
  inexistente: firmar({ id: 999999, email: 'nadie@pansys.test', rol: 'administrador', rol_id: 1, panaderia_id: null }),
  invalido: 'esto.no.es.un.jwt',
  caducado: jwt.sign({ id: 2, email: 'panadero1@pansys.test', rol: 'panadero', rol_id: 2, panaderia_id: 1, exp: Math.floor(Date.now() / 1000) - 60 }, process.env.JWT_SECRET),
  otraClave: jwt.sign({ id: 1, rol_id: 1 }, 'clave-que-no-es-la-del-servidor', { expiresIn: '10m' }),
  // Token que dice "administrador" para una cuenta que en la base es panadero (id 2)
  panadero1ComoAdmin: firmar({ id: 2, email: 'panadero1@pansys.test', rol: 'administrador', rol_id: 1, panaderia_id: null })
};

const resultados = [];
const registrar = (ok, descripcion, detalle = '') => {
  resultados.push({ ok, descripcion });
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${descripcion}${!ok && detalle ? ` -> ${detalle}` : ''}`);
};

// Ninguna respuesta puede contener contraseñas ni hashes
const sinSecretos = (datos) => {
  const texto = JSON.stringify(datos ?? null);
  return !/contrasena"\s*:/.test(texto.replace(/"contrasena_(actual|nueva)"/g, '')) && !/\$2[aby]\$/.test(texto);
};
let respuestasConSecretos = 0;

const pedir = async (metodo, ruta, usuario, body) => {
  const headers = { 'Content-Type': 'application/json' };
  if (usuario) headers.Authorization = `Bearer ${TOKENS[usuario] ?? usuario}`;
  const r = await fetch(URL + ruta, {
    method: metodo,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let datos = null;
  try { datos = await r.json(); } catch { /* sin cuerpo */ }
  if (!sinSecretos(datos)) respuestasConSecretos++;
  return { status: r.status, datos };
};

const esperar = async (descripcion, status, metodo, ruta, usuario, body) => {
  const r = await pedir(metodo, ruta, usuario, body);
  registrar(r.status === status, descripcion, `HTTP ${r.status}: ${JSON.stringify(r.datos)}`);
  return r.datos;
};

const igual = (descripcion, real, esperado) =>
  registrar(JSON.stringify(real) === JSON.stringify(esperado), descripcion,
    `obtenido ${JSON.stringify(real)}, esperado ${JSON.stringify(esperado)}`);

const fila = async (id) =>
  (await sequelize.query('SELECT id, email, rol_id, panaderia_id, estado FROM usuarios WHERE id = ?', { replacements: [id] }))[0][0];

const versionDe = async (id) =>
  (await sequelize.query('SELECT version_sesion AS v FROM usuarios WHERE id = ?', { replacements: [id] }))[0][0]?.v;

const adminsActivos = async () =>
  (await sequelize.query('SELECT COUNT(*) AS n FROM usuarios WHERE rol_id = 1 AND estado = 1'))[0][0].n;

const login = (email, contrasena) => pedir('POST', '/api/auth/login', null, { email, contrasena });

// Crea una cuenta con /registrar (como administrador) y devuelve su id
const crearCuenta = async (email, contrasena, rol_id, panaderia_id) => {
  const r = await pedir('POST', '/api/auth/registrar', 'admin', { email, contrasena, rol_id, panaderia_id });
  if (r.status !== 201) throw new Error(`No se pudo crear ${email}: HTTP ${r.status} ${JSON.stringify(r.datos)}`);
  return r.datos.id;
};

// ---------- Limpieza global eliminada ----------
// Aquí se borraban todas las cuentas con id > 4 y se devolvían las cuentas semilla a su estado
// inicial (contraseña '!'). Segunda barrera por si se quitara la salida del principio sin
// refactorizar la suite: se detiene antes de borrar o modificar ninguna cuenta.
const restaurarSemilla = async () => {
  throw new Error('Suite deshabilitada: falta refactorizarla con pruebas/aislamiento.js (el borrado global de cuentas y el reinicio de la semilla fueron eliminados)');
};

const esperarServidor = async () => {
  for (let i = 0; i < 40; i++) {
    try { await fetch(URL); return; } catch { await new Promise(r => setTimeout(r, 250)); }
  }
  throw new Error('El servidor de pruebas no arrancó');
};

let baseVerificada = false;

const main = async () => {
  // ---------- Protección: solo pansys_test ----------
  await sequelize.authenticate();
  const [[{ base }]] = await sequelize.query('SELECT DATABASE() AS base');
  if (base !== 'pansys_test') {
    throw new Error(`Base conectada "${base}": las pruebas solo se ejecutan sobre pansys_test`);
  }
  const [columna] = await sequelize.query(`
    SELECT COLUMN_TYPE AS t, IS_NULLABLE AS n, COLUMN_DEFAULT AS d FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = 'pansys_test' AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'version_sesion'`);
  if (columna.length !== 1 || columna[0].t !== 'int unsigned' || columna[0].n !== 'NO' || columna[0].d !== '0') {
    throw new Error('pansys_test no tiene usuarios.version_sesion INT UNSIGNED NOT NULL DEFAULT 0: aplique pruebas/004_version_sesion_pansys_test.sql');
  }
  baseVerificada = true;
  await restaurarSemilla();

  require('../src/app');
  await esperarServidor();

  // ---------- Middleware: cuenta activa ----------
  console.log('\n== Middleware: token válido de cuenta activa vs desactivada');
  await esperar('sin token -> 401', 401, 'GET', '/api/inventario?panaderia_id=1', null);
  await esperar('token mal formado -> 401', 401, 'GET', '/api/inventario', 'invalido');
  await esperar('token firmado con otra clave -> 401', 401, 'GET', '/api/inventario', 'otraClave');
  const caducado = await esperar('token caducado -> 401', 401, 'GET', '/api/inventario', 'caducado');
  igual('mensaje de sesión expirada', caducado?.error, 'La sesión expiró. Inicia sesión nuevamente.');
  await esperar('token válido de cuenta inexistente -> 401', 401, 'GET', '/api/inventario', 'inexistente');
  await esperar('panadero1 activo lee inventario -> 200', 200, 'GET', '/api/inventario', 'panadero1');

  const desactivado = await esperar('admin desactiva a panadero1 -> 200', 200, 'PATCH', '/api/usuarios/2/estado', 'admin', { estado: false });
  igual('respuesta con estado false', desactivado?.estado, false);
  const r401 = await esperar('token aún vigente de cuenta desactivada: inventario -> 401', 401, 'GET', '/api/inventario', 'panadero1');
  igual('mensaje de cuenta no activa', r401?.error, 'La cuenta no está activa. Inicia sesión con una cuenta activa.');
  await esperar('cuenta desactivada: ventas -> 401', 401, 'GET', '/api/ventas', 'panadero1');
  await esperar('cuenta desactivada: producción -> 401', 401, 'GET', '/api/produccion/ordenes', 'panadero1');
  await esperar('cuenta desactivada: cambio de contraseña -> 401', 401, 'PATCH', '/api/auth/contrasena', 'panadero1',
    { contrasena_actual: '!', contrasena_nueva: 'Nueva1234' });
  await esperar('panadero2 (activo) no se ve afectado -> 200', 200, 'GET', '/api/inventario', 'panadero2');
  await esperar('admin reactiva a panadero1 -> 200', 200, 'PATCH', '/api/usuarios/2/estado', 'admin', { estado: true });
  const tras = await esperar('token anterior a la desactivación, tras reactivar -> 401', 401, 'GET', '/api/inventario', 'panadero1');
  igual('mensaje de sesión no válida', tras?.error, 'La sesión ya no es válida. Inicia sesión nuevamente.');
  igual('desactivar subió la versión de sesión a 1', await versionDe(2), 1);
  TOKENS.panadero1 = firmar({ id: 2, email: 'panadero1@pansys.test', rol: 'panadero', rol_id: 2, panaderia_id: 1, version_sesion: 1 });
  await esperar('con un token de la versión actual -> 200', 200, 'GET', '/api/inventario', 'panadero1');
  await restaurarSemilla();
  TOKENS.panadero1 = firmar({ id: 2, email: 'panadero1@pansys.test', rol: 'panadero', rol_id: 2, panaderia_id: 1 });

  // Login real: una cuenta desactivada no puede iniciar sesión
  const idLogin = await crearCuenta('login.prueba@pansys.test', 'Clave1234', 2, 1);
  const okLogin = await login('login.prueba@pansys.test', 'Clave1234');
  igual('login de cuenta activa -> 200', okLogin.status, 200);
  await pedir('PATCH', `/api/usuarios/${idLogin}/estado`, 'admin', { estado: false });
  igual('login de cuenta desactivada -> 401', (await login('login.prueba@pansys.test', 'Clave1234')).status, 401);
  TOKENS.loginPrueba = okLogin.datos?.token;
  await esperar('token emitido por login antes de desactivar -> 401', 401, 'GET', '/api/ventas', 'loginPrueba');

  // ---------- Acceso denegado a no administradores ----------
  console.log('\n== Acceso denegado a no administradores');
  for (const usuario of ['panadero1', 'gerente1']) {
    await esperar(`${usuario}: GET /api/usuarios -> 403`, 403, 'GET', '/api/usuarios', usuario);
    await esperar(`${usuario}: PATCH /api/usuarios/3 -> 403`, 403, 'PATCH', '/api/usuarios/3', usuario, { rol_id: 3 });
    await esperar(`${usuario}: PATCH /api/usuarios/3/estado -> 403`, 403, 'PATCH', '/api/usuarios/3/estado', usuario, { estado: false });
    await esperar(`${usuario}: GET /api/panaderias -> 403`, 403, 'GET', '/api/panaderias', usuario);
    await esperar(`${usuario}: POST /api/auth/registrar -> 403`, 403, 'POST', '/api/auth/registrar', usuario,
      { email: `x.${usuario}@pansys.test`, contrasena: 'Clave1234', rol_id: 2, panaderia_id: 1 });
  }
  await esperar('sin token: GET /api/usuarios -> 401', 401, 'GET', '/api/usuarios', null);
  await esperar('sin token: GET /api/panaderias -> 401', 401, 'GET', '/api/panaderias', null);
  igual('panadero2 sigue activo y sin cambios', await fila(3), { id: 3, email: 'panadero2@pansys.test', rol_id: 2, panaderia_id: 2, estado: 1 });

  // ---------- Listados del administrador ----------
  console.log('\n== Listados del administrador');
  const lista = await esperar('admin: GET /api/usuarios -> 200', 200, 'GET', '/api/usuarios', 'admin');
  igual('incluye las cuentas de la semilla', SEMILLA.every(s => lista?.some(u => u.id === s.id)), true);
  const p1 = lista?.find(u => u.id === 2);
  igual('campos expuestos de una cuenta', p1 && Object.keys(p1).sort(),
    ['createdAt', 'email', 'estado', 'id', 'panaderia', 'panaderia_id', 'rol', 'rol_id', 'updatedAt']);
  igual('rol y panadería legibles', [p1?.rol, p1?.panaderia], ['panadero', { id: 1, nombre: 'Panadería Prueba Uno' }]);
  igual('administrador sin panadería', lista?.find(u => u.id === 1)?.panaderia, null);
  igual('el listado no contiene contraseñas ni hashes', sinSecretos(lista), true);
  const panaderias = await esperar('admin: GET /api/panaderias -> 200', 200, 'GET', '/api/panaderias', 'admin');
  igual('panaderías con campos mínimos', panaderias, [
    { id: 1, nombre: 'Panadería Prueba Uno' }, { id: 2, nombre: 'Panadería Prueba Dos' }
  ]);

  // ---------- Autoelevación y autoprotección ----------
  console.log('\n== Autoelevación de privilegios y autoprotección');
  await esperar('panadero1 intenta hacerse administrador -> 403', 403, 'PATCH', '/api/usuarios/2', 'panadero1', { rol_id: 1, panaderia_id: null });
  await esperar('gerente1 intenta hacerse administrador -> 403', 403, 'PATCH', '/api/usuarios/4', 'gerente1', { rol_id: 1 });
  igual('roles sin cambios', [(await fila(2)).rol_id, (await fila(4)).rol_id], [2, 3]);
  await esperar('admin cambia su propio rol -> 403', 403, 'PATCH', '/api/usuarios/1', 'admin', { rol_id: 2, panaderia_id: 1 });
  await esperar('admin se desactiva a sí mismo -> 403', 403, 'PATCH', '/api/usuarios/1/estado', 'admin', { estado: false });
  await esperar('admin reenvía su mismo rol -> 200', 200, 'PATCH', '/api/usuarios/1', 'admin', { rol_id: 1 });
  igual('admin sigue activo y administrador', await fila(1), { id: 1, email: 'admin@pansys.test', rol_id: 1, panaderia_id: null, estado: 1 });

  // Token de administrador desactualizado: la cuenta fue degradada después de emitirlo
  const idDegradado = await crearCuenta('degradado@pansys.test', 'Clave1234', 1, null);
  TOKENS.degradado = firmar({ id: idDegradado, email: 'degradado@pansys.test', rol: 'administrador', rol_id: 1, panaderia_id: null });
  await esperar('admin degrada a la cuenta nueva a panadero -> 200', 200, 'PATCH', `/api/usuarios/${idDegradado}`, 'admin', { rol_id: 2, panaderia_id: 1 });
  await esperar('token antiguo de admin degradado: GET /api/usuarios -> 403', 403, 'GET', '/api/usuarios', 'degradado');
  await esperar('token antiguo de admin degradado: se reasciende -> 403', 403, 'PATCH', `/api/usuarios/${idDegradado}`, 'degradado', { rol_id: 1 });
  await esperar('token antiguo de admin degradado: desactiva a otro -> 403', 403, 'PATCH', '/api/usuarios/3/estado', 'degradado', { estado: false });
  igual('la cuenta degradada sigue siendo panadero', (await fila(idDegradado)).rol_id, 2);

  // ---------- Último administrador activo ----------
  console.log('\n== Último administrador activo');
  const { asegurarOtroAdministradorActivo } = require('../src/modules/usuarios/usuarios.service');
  let codigo = null;
  try { asegurarOtroAdministradorActivo([1], 1); } catch (e) { codigo = e.status; }
  igual('regla: único administrador activo -> 409', codigo, 409);
  codigo = null;
  try { asegurarOtroAdministradorActivo([1, 7], 1); } catch (e) { codigo = e.status; }
  igual('regla: con otro administrador activo -> permitido', codigo, null);

  // Dos administradores intentan degradarse mutuamente a la vez
  for (const [tipo, cuerpo, ruta] of [
    ['degradación', { rol_id: 2, panaderia_id: 1 }, ''],
    ['desactivación', { estado: false }, '/estado']
  ]) {
    await restaurarSemilla();
    const idOtro = await crearCuenta(`otroadmin.${ruta ? 'e' : 'r'}@pansys.test`, 'Clave1234', 1, null);
    TOKENS.otroAdmin = firmar({ id: idOtro, email: 'otro', rol: 'administrador', rol_id: 1, panaderia_id: null });
    igual(`${tipo}: hay 2 administradores activos al empezar`, await adminsActivos(), 2);
    const [a, b] = await Promise.all([
      pedir('PATCH', `/api/usuarios/${idOtro}${ruta}`, 'admin', cuerpo),
      pedir('PATCH', `/api/usuarios/1${ruta}`, 'otroAdmin', cuerpo)
    ]);
    const estados = [a.status, b.status].sort();
    registrar(estados[0] === 200 && [401, 403].includes(estados[1]),
      `${tipo} simultánea: una se aplica y la otra se rechaza`, `estados ${JSON.stringify([a.status, b.status])}`);
    igual(`${tipo} simultánea: queda exactamente 1 administrador activo`, await adminsActivos(), 1);
  }
  await restaurarSemilla();

  // ---------- Validación de rol y panadería ----------
  console.log('\n== Validación de edición (rol, panadería, email, campos)');
  await esperar('id no numérico -> 400', 400, 'PATCH', '/api/usuarios/abc', 'admin', { rol_id: 2 });
  await esperar('id inexistente -> 404', 404, 'PATCH', '/api/usuarios/999999', 'admin', { rol_id: 2, panaderia_id: 1 });
  await esperar('cuerpo vacío -> 400', 400, 'PATCH', '/api/usuarios/2', 'admin', {});
  await esperar('contraseña no editable aquí -> 400', 400, 'PATCH', '/api/usuarios/2', 'admin', { contrasena: 'Clave1234' });
  await esperar('estado no editable aquí -> 400', 400, 'PATCH', '/api/usuarios/2', 'admin', { estado: false });
  await esperar('rol inexistente (7) -> 400', 400, 'PATCH', '/api/usuarios/2', 'admin', { rol_id: 7 });
  await esperar('rol duplicado inactivo (4) -> 400', 400, 'PATCH', '/api/usuarios/2', 'admin', { rol_id: 4 });
  await esperar('rol como lista -> 400', 400, 'PATCH', '/api/usuarios/2', 'admin', { rol_id: [2] });
  await esperar('panadería inexistente -> 404', 404, 'PATCH', '/api/usuarios/2', 'admin', { panaderia_id: 999 });
  await esperar('panadería no numérica -> 400', 400, 'PATCH', '/api/usuarios/2', 'admin', { panaderia_id: 'uno' });
  await esperar('panadero sin panadería -> 400', 400, 'PATCH', '/api/usuarios/2', 'admin', { panaderia_id: null });
  await esperar('administrador con panadería -> 400', 400, 'PATCH', '/api/usuarios/3', 'admin', { rol_id: 1, panaderia_id: 2 });
  igual('sin cambios tras los rechazos', [await fila(2), await fila(3)], [
    { id: 2, email: 'panadero1@pansys.test', rol_id: 2, panaderia_id: 1, estado: 1 },
    { id: 3, email: 'panadero2@pansys.test', rol_id: 2, panaderia_id: 2, estado: 1 }
  ]);

  const gerente = await esperar('panadero1 -> gerente (conserva panadería) -> 200', 200, 'PATCH', '/api/usuarios/2', 'admin', { rol_id: 3 });
  igual('rol gerente y panadería 1', [gerente?.rol, gerente?.panaderia_id], ['gerente', 1]);
  const movido = await esperar('cambio de panadería a la 2 -> 200', 200, 'PATCH', '/api/usuarios/2', 'admin', { panaderia_id: 2 });
  igual('panadería actualizada', movido?.panaderia, { id: 2, nombre: 'Panadería Prueba Dos' });
  const promovido = await esperar('panadero2 -> administrador sin panadería -> 200', 200, 'PATCH', '/api/usuarios/3', 'admin', { rol_id: 1 });
  igual('administrador queda sin panadería', [promovido?.rol_id, promovido?.panaderia_id], [1, null]);
  await esperar('administrador -> panadero sin indicar panadería -> 400', 400, 'PATCH', '/api/usuarios/3', 'admin', { rol_id: 2 });
  await esperar('administrador -> panadero con panadería 2 -> 200', 200, 'PATCH', '/api/usuarios/3', 'admin', { rol_id: 2, panaderia_id: 2 });

  await esperar('email inválido -> 400', 400, 'PATCH', '/api/usuarios/4', 'admin', { email: 'no-es-email' });
  await esperar('email vacío -> 400', 400, 'PATCH', '/api/usuarios/4', 'admin', { email: '   ' });
  await esperar('email de otra cuenta -> 409', 409, 'PATCH', '/api/usuarios/4', 'admin', { email: 'panadero2@pansys.test' });
  const conEmail = await esperar('email nuevo (con espacios) -> 200', 200, 'PATCH', '/api/usuarios/4', 'admin', { email: '  gerente.nuevo@pansys.test ' });
  igual('email recortado', conEmail?.email, 'gerente.nuevo@pansys.test');
  await restaurarSemilla();

  // ---------- Endpoint de estado ----------
  console.log('\n== Endpoint de estado');
  await esperar('estado como texto -> 400', 400, 'PATCH', '/api/usuarios/3/estado', 'admin', { estado: 'false' });
  await esperar('estado ausente -> 400', 400, 'PATCH', '/api/usuarios/3/estado', 'admin', {});
  await esperar('estado de cuenta inexistente -> 404', 404, 'PATCH', '/api/usuarios/999999/estado', 'admin', { estado: false });
  await esperar('desactivar gerente1 -> 200', 200, 'PATCH', '/api/usuarios/4/estado', 'admin', { estado: false });
  const repetido = await esperar('desactivar de nuevo (idempotente) -> 200', 200, 'PATCH', '/api/usuarios/4/estado', 'admin', { estado: false });
  igual('sigue desactivado', repetido?.estado, false);
  await esperar('editar una cuenta desactivada -> 200', 200, 'PATCH', '/api/usuarios/4', 'admin', { panaderia_id: 2 });
  igual('la edición no la reactiva', (await fila(4)).estado, 0);
  await restaurarSemilla();

  // ---------- Cambio de contraseña ----------
  console.log('\n== Cambio de contraseña');
  const idClave = await crearCuenta('clave.prueba@pansys.test', 'Inicial123', 3, 1);
  TOKENS.clave = (await login('clave.prueba@pansys.test', 'Inicial123')).datos?.token;
  const hashAntes = (await sequelize.query('SELECT contrasena AS c FROM usuarios WHERE id = ?', { replacements: [idClave] }))[0][0].c;

  await esperar('sin token -> 401', 401, 'PATCH', '/api/auth/contrasena', null, { contrasena_actual: 'Inicial123', contrasena_nueva: 'Nueva12345' });
  await esperar('sin cuerpo -> 400', 400, 'PATCH', '/api/auth/contrasena', 'clave');
  await esperar('sin contraseña actual -> 400', 400, 'PATCH', '/api/auth/contrasena', 'clave', { contrasena_nueva: 'Nueva12345' });
  const incorrecta = await esperar('contraseña actual incorrecta -> 400', 400, 'PATCH', '/api/auth/contrasena', 'clave',
    { contrasena_actual: 'Otra12345', contrasena_nueva: 'Nueva12345' });
  igual('mensaje de contraseña actual incorrecta', incorrecta?.error, 'La contraseña actual no es correcta');
  await esperar('nueva demasiado corta -> 400', 400, 'PATCH', '/api/auth/contrasena', 'clave', { contrasena_actual: 'Inicial123', contrasena_nueva: 'Ab1' });
  await esperar('nueva sin números -> 400', 400, 'PATCH', '/api/auth/contrasena', 'clave', { contrasena_actual: 'Inicial123', contrasena_nueva: 'SoloLetras' });
  await esperar('nueva sin letras -> 400', 400, 'PATCH', '/api/auth/contrasena', 'clave', { contrasena_actual: 'Inicial123', contrasena_nueva: '1234567890' });
  await esperar('nueva de más de 72 bytes -> 400', 400, 'PATCH', '/api/auth/contrasena', 'clave', { contrasena_actual: 'Inicial123', contrasena_nueva: `A1${'ñ'.repeat(36)}` });
  await esperar('nueva como número -> 400', 400, 'PATCH', '/api/auth/contrasena', 'clave', { contrasena_actual: 'Inicial123', contrasena_nueva: 12345678 });
  await esperar('nueva igual a la actual -> 400', 400, 'PATCH', '/api/auth/contrasena', 'clave', { contrasena_actual: 'Inicial123', contrasena_nueva: 'Inicial123' });
  const hashTrasRechazos = (await sequelize.query('SELECT contrasena AS c FROM usuarios WHERE id = ?', { replacements: [idClave] }))[0][0].c;
  igual('los rechazos no cambian el hash', hashTrasRechazos === hashAntes, true);

  const cambio = await esperar('cambio correcto -> 200', 200, 'PATCH', '/api/auth/contrasena', 'clave',
    { contrasena_actual: 'Inicial123', contrasena_nueva: 'Nueva12345' });
  igual('respuesta: mensaje y token nuevo, sin datos sensibles',
    [Object.keys(cambio ?? {}).sort(), cambio?.mensaje, typeof cambio?.token], [['mensaje', 'token'], 'Contraseña actualizada correctamente', 'string']);
  await esperar('el token anterior al cambio deja de valer -> 401', 401, 'GET', '/api/inventario', 'clave');
  TOKENS.clave = cambio?.token;
  await esperar('el token nuevo funciona -> 200', 200, 'GET', '/api/ventas', 'clave');
  const hashDespues = (await sequelize.query('SELECT contrasena AS c FROM usuarios WHERE id = ?', { replacements: [idClave] }))[0][0].c;
  igual('se guarda un hash bcrypt nuevo', [hashDespues !== hashAntes, /^\$2[aby]\$10\$/.test(hashDespues)], [true, true]);
  igual('login con la contraseña anterior -> 401', (await login('clave.prueba@pansys.test', 'Inicial123')).status, 401);
  igual('login con la contraseña nueva -> 200', (await login('clave.prueba@pansys.test', 'Nueva12345')).status, 200);
  await esperar('la cuenta sin contraseña válida (semilla) no puede cambiarla -> 400', 400, 'PATCH', '/api/auth/contrasena', 'panadero1',
    { contrasena_actual: '!', contrasena_nueva: 'Nueva12345' });
  igual('solo cambia la contraseña propia (panadero1 conserva la suya)',
    (await sequelize.query('SELECT contrasena AS c FROM usuarios WHERE id = 2'))[0][0].c, '!');

  // ---------- Permisos actualizados: rol y panadería salen de la base, no del token ----------
  console.log('\n== Permisos actualizados desde la base de datos');
  const { MateriaPrima } = require('../src/models/index');
  await MateriaPrima.destroy({ where: { nombre: ['PRUEBA-SESION-P1', 'PRUEBA-SESION-P2'] } });
  await MateriaPrima.bulkCreate([
    { nombre: 'PRUEBA-SESION-P1', unidad_medida: 'kg', cantidad_disponible: 1, stock_minimo: 0, precio_unitario: 1, panaderia_id: 1 },
    { nombre: 'PRUEBA-SESION-P2', unidad_medida: 'kg', cantidad_disponible: 1, stock_minimo: 0, precio_unitario: 1, panaderia_id: 2 }
  ]);
  const nombresInventario = async (usuario) =>
    ((await pedir('GET', '/api/inventario', usuario)).datos ?? []).map(i => i.nombre).filter(n => n.startsWith('PRUEBA-SESION'));

  // Un token que dice "administrador" no da privilegios a una cuenta que es panadero
  await esperar('token con rol_id 1 de un panadero: GET /api/usuarios -> 403', 403, 'GET', '/api/usuarios', 'panadero1ComoAdmin');
  await esperar('token con rol_id 1 de un panadero: PATCH /api/usuarios/3 -> 403', 403, 'PATCH', '/api/usuarios/3/estado', 'panadero1ComoAdmin', { estado: false });
  await esperar('token con rol_id 1 de un panadero: GET /api/panaderias -> 403', 403, 'GET', '/api/panaderias', 'panadero1ComoAdmin');
  igual('y opera solo sobre su panadería real (sin panaderia_id)', await nombresInventario('panadero1ComoAdmin'), ['PRUEBA-SESION-P1']);
  igual('aunque pida otra panadería, se ignora', ((await pedir('GET', '/api/inventario?panaderia_id=2', 'panadero1ComoAdmin')).datos ?? [])
    .map(i => i.nombre).filter(n => n.startsWith('PRUEBA-SESION')), ['PRUEBA-SESION-P1']);

  // Cambio de panadería con el token anterior
  igual('panadero1 ve su panadería 1', await nombresInventario('panadero1'), ['PRUEBA-SESION-P1']);
  await pedir('PATCH', '/api/usuarios/2', 'admin', { panaderia_id: 2 });
  igual('tras moverlo a la 2, el mismo token ve la panadería 2 (inventario)', await nombresInventario('panadero1'), ['PRUEBA-SESION-P2']);
  const recetasP2 = await pedir('GET', '/api/produccion/recetas', 'panadero1');
  igual('recetas: responde con la panadería actual', recetasP2.status, 200);
  await pedir('PATCH', '/api/usuarios/2', 'admin', { panaderia_id: 1 });

  // Degradación de panadero a gerente con el token anterior (gerente = solo lectura)
  await esperar('panadero1 puede escribir en ventas (llega a la validación) -> 400', 400, 'POST', '/api/ventas', 'panadero1', {});
  await pedir('PATCH', '/api/usuarios/2', 'admin', { rol_id: 3 });
  await esperar('ya gerente, mismo token: venta -> 403', 403, 'POST', '/api/ventas', 'panadero1', {});
  await esperar('ya gerente, mismo token: insumo nuevo -> 403', 403, 'POST', '/api/inventario', 'panadero1', {});
  await esperar('ya gerente, mismo token: orden de producción -> 403', 403, 'POST', '/api/produccion/ordenes', 'panadero1', {});
  await esperar('ya gerente, mismo token: receta -> 403', 403, 'POST', '/api/produccion/recetas/1', 'panadero1', {});
  await esperar('ya gerente, mismo token: lectura de ventas -> 200', 200, 'GET', '/api/ventas', 'panadero1');

  // Ascenso de gerente a panadero con el token anterior
  await esperar('gerente1 no puede vender -> 403', 403, 'POST', '/api/ventas', 'gerente1', {});
  await pedir('PATCH', '/api/usuarios/4', 'admin', { rol_id: 2 });
  await esperar('ya panadero, mismo token: venta llega a la validación -> 400', 400, 'POST', '/api/ventas', 'gerente1', {});

  // Ascenso a administrador y vuelta atrás
  await pedir('PATCH', '/api/usuarios/3', 'admin', { rol_id: 1 });
  await esperar('panadero2 ascendido, mismo token: GET /api/usuarios -> 200', 200, 'GET', '/api/usuarios', 'panadero2');
  await esperar('como administrador debe indicar panadería -> 400', 400, 'GET', '/api/inventario', 'panadero2');
  await pedir('PATCH', '/api/usuarios/3', 'admin', { rol_id: 2, panaderia_id: 2 });
  await esperar('panadero2 degradado, mismo token: GET /api/usuarios -> 403', 403, 'GET', '/api/usuarios', 'panadero2');

  // Cambio de contraseña con un token cuyo email quedó desactualizado
  await pedir('PATCH', `/api/usuarios/${idClave}`, 'admin', { email: 'clave.renombrada@pansys.test' });
  await esperar('cuenta renombrada: su sesión sigue operando -> 200', 200, 'PATCH', '/api/auth/contrasena', 'clave',
    { contrasena_actual: 'Nueva12345', contrasena_nueva: 'Otra12345' });
  await MateriaPrima.destroy({ where: { nombre: ['PRUEBA-SESION-P1', 'PRUEBA-SESION-P2'] } });
  await restaurarSemilla();

  // ---------- Registro con validación en el backend ----------
  console.log('\n== Validación de /registrar');
  const cuentasAntes = (await sequelize.query('SELECT COUNT(*) AS n FROM usuarios'))[0][0].n;
  const registro = (cuerpo) => pedir('POST', '/api/auth/registrar', 'admin', { rol_id: 2, panaderia_id: 1, ...cuerpo });
  const casosInvalidos = [
    ['email sin formato', { email: 'sin-arroba', contrasena: 'Clave1234' }, 'El email no es válido'],
    ['email solo espacios', { email: '   ', contrasena: 'Clave1234' }, 'El email es obligatorio'],
    ['email como lista', { email: ['a@b.co'], contrasena: 'Clave1234' }, 'El email es obligatorio'],
    ['email de más de 255 caracteres', { email: `${'a'.repeat(250)}@pansys.test`, contrasena: 'Clave1234' }, 'El email no es válido'],
    ['contraseña corta', { email: 'r1@pansys.test', contrasena: 'Ab1' }, 'La contraseña debe tener al menos 8 caracteres'],
    ['contraseña sin números', { email: 'r2@pansys.test', contrasena: 'SoloLetras' }, 'La contraseña debe incluir al menos una letra y un número'],
    ['contraseña sin letras', { email: 'r3@pansys.test', contrasena: '12345678' }, 'La contraseña debe incluir al menos una letra y un número'],
    ['contraseña de más de 72 bytes', { email: 'r4@pansys.test', contrasena: `A1${'ñ'.repeat(36)}` }, 'La contraseña es demasiado larga (máximo 72 bytes)'],
    ['contraseña numérica (no texto)', { email: 'r5@pansys.test', contrasena: 123456789 }, 'La contraseña es obligatoria']
  ];
  for (const [descripcion, cuerpo, mensaje] of casosInvalidos) {
    const r = await registro(cuerpo);
    registrar(r.status === 400 && r.datos?.error === mensaje, `registro: ${descripcion} -> 400`, `HTTP ${r.status}: ${JSON.stringify(r.datos)}`);
  }
  const faltan = await pedir('POST', '/api/auth/registrar', 'admin', { email: 'x@pansys.test' });
  igual('registro: faltan campos -> 400 (mensaje de siempre)', [faltan.status, faltan.datos?.error], [400, 'Todos los campos son requeridos']);
  igual('ningún registro inválido creó cuentas', (await sequelize.query('SELECT COUNT(*) AS n FROM usuarios'))[0][0].n, cuentasAntes);

  const valido = await registro({ email: '  nuevo.registro@pansys.test ', contrasena: 'ñandú2026' });
  igual('registro válido -> 201 con el contrato de siempre', [valido.status, Object.keys(valido.datos ?? {}).sort()], [201, ['id', 'mensaje']]);
  igual('el email se guarda recortado', (await fila(valido.datos?.id))?.email, 'nuevo.registro@pansys.test');
  igual('puede iniciar sesión con letras no ASCII en la contraseña', (await login('nuevo.registro@pansys.test', 'ñandú2026')).status, 200);
  const repetido2 = await registro({ email: 'nuevo.registro@pansys.test', contrasena: 'Clave1234' });
  igual('email repetido -> 400 (contrato de siempre)', [repetido2.status, repetido2.datos?.error], [400, 'El email ya está registrado']);

  // ---------- Revocación de sesiones (version_sesion) ----------
  console.log('\n== Revocación de sesiones (version_sesion)');
  await restaurarSemilla();
  const idR = await crearCuenta('revocacion@pansys.test', 'Inicial123', 2, 1);
  const idOtra = await crearCuenta('otra.cuenta@pansys.test', 'Otra12345', 3, 1);
  TOKENS.dispA = (await login('revocacion@pansys.test', 'Inicial123')).datos?.token;
  TOKENS.dispB = (await login('revocacion@pansys.test', 'Inicial123')).datos?.token;
  TOKENS.legado = firmar({ id: idR, email: 'revocacion@pansys.test', rol: 'panadero', rol_id: 2, panaderia_id: 1 });
  TOKENS.otra = (await login('otra.cuenta@pansys.test', 'Otra12345')).datos?.token;
  const cargaA = jwt.verify(TOKENS.dispA, process.env.JWT_SECRET);
  igual('el login firma la versión actual (0) en el token', cargaA.version_sesion, 0);
  const respLogin = (await login('revocacion@pansys.test', 'Inicial123')).datos;
  igual('la respuesta del login no expone la versión', 'version_sesion' in (respLogin?.usuario ?? {}), false);
  for (const t of ['dispA', 'dispB', 'legado', 'otra']) {
    await esperar(`antes del cambio: token ${t} -> 200`, 200, 'GET', '/api/inventario', t);
  }

  const malCambio = await pedir('PATCH', '/api/auth/contrasena', 'dispA', { contrasena_actual: 'Equivocada1', contrasena_nueva: 'Nueva12345' });
  igual('cambio fallido: 400 y la versión no sube', [malCambio.status, await versionDe(idR)], [400, 0]);
  await esperar('tras un cambio fallido el token sigue valiendo -> 200', 200, 'GET', '/api/inventario', 'dispA');

  const nuevo = await esperar('dispositivo A cambia la contraseña -> 200', 200, 'PATCH', '/api/auth/contrasena', 'dispA',
    { contrasena_actual: 'Inicial123', contrasena_nueva: 'Nueva12345' });
  TOKENS.dispA2 = nuevo?.token;
  igual('versión en la base = 1 y en el token nuevo = 1',
    [await versionDe(idR), jwt.decode(TOKENS.dispA2 ?? '')?.version_sesion ?? null], [1, 1]);
  igual('la respuesta no expone hash ni versión', ['version_sesion' in (nuevo ?? {}), /\$2[aby]\$/.test(JSON.stringify(nuevo))], [false, false]);
  for (const t of ['dispA', 'dispB', 'legado']) {
    const r = await esperar(`token ${t} anterior al cambio -> 401`, 401, 'GET', '/api/inventario', t);
    igual(`${t}: mensaje de sesión no válida`, r?.error, 'La sesión ya no es válida. Inicia sesión nuevamente.');
  }
  for (const [metodo, ruta] of [['GET', '/api/inventario'], ['GET', '/api/ventas'], ['GET', '/api/produccion/ordenes'], ['GET', '/api/produccion/recetas']]) {
    await esperar(`token nuevo: ${ruta} -> 200`, 200, metodo, ruta, 'dispA2');
  }
  await esperar('otra cuenta no se ve afectada -> 200', 200, 'GET', '/api/inventario', 'otra');
  igual('versiones de las demás cuentas sin cambios', [await versionDe(idOtra), await versionDe(1), await versionDe(2), await versionDe(3), await versionDe(4)], [0, 0, 0, 0, 0]);
  await esperar('los tokens sin versión de otras cuentas siguen valiendo -> 200', 200, 'GET', '/api/inventario', 'panadero2');
  igual('login con la contraseña anterior -> 401', (await login('revocacion@pansys.test', 'Inicial123')).status, 401);
  TOKENS.dispC = (await login('revocacion@pansys.test', 'Nueva12345')).datos?.token;
  await esperar('login nuevo (versión 1) -> 200', 200, 'GET', '/api/inventario', 'dispC');

  const segundo = await esperar('segundo cambio desde el token nuevo -> 200', 200, 'PATCH', '/api/auth/contrasena', 'dispA2',
    { contrasena_actual: 'Nueva12345', contrasena_nueva: 'Tercera123' });
  TOKENS.dispA3 = segundo?.token;
  igual('versión 2', await versionDe(idR), 2);
  await esperar('el token del primer cambio deja de valer -> 401', 401, 'GET', '/api/inventario', 'dispA2');
  await esperar('el login de la versión 1 deja de valer -> 401', 401, 'GET', '/api/inventario', 'dispC');
  await esperar('el token del segundo cambio funciona -> 200', 200, 'GET', '/api/inventario', 'dispA3');

  // Versiones falsificadas o con tipos no válidos
  for (const [descripcion, version] of [['mayor que la actual', 5], ['menor que la actual', 1], ['texto', '2'], ['negativa', -1], ['decimal', 2.5], ['null', null]]) {
    TOKENS.falso = firmar({ id: idR, email: 'revocacion@pansys.test', rol: 'panadero', rol_id: 2, panaderia_id: 1, version_sesion: version });
    await esperar(`versión ${descripcion} en el token -> 401`, 401, 'GET', '/api/inventario', 'falso');
  }

  // Dos cambios simultáneos con la misma contraseña actual: uno gana, la versión sube una vez
  TOKENS.simA = (await login('revocacion@pansys.test', 'Tercera123')).datos?.token;
  TOKENS.simB = (await login('revocacion@pansys.test', 'Tercera123')).datos?.token;
  const simultaneos = await Promise.all([
    pedir('PATCH', '/api/auth/contrasena', 'simA', { contrasena_actual: 'Tercera123', contrasena_nueva: 'CuartaA123' }),
    pedir('PATCH', '/api/auth/contrasena', 'simB', { contrasena_actual: 'Tercera123', contrasena_nueva: 'CuartaB123' })
  ]);
  igual('cambios simultáneos: un 200 y un 400', simultaneos.map(r => r.status).sort(), [200, 400]);
  igual('cambios simultáneos: la versión sube una sola vez (3)', await versionDe(idR), 3);
  const ganador = simultaneos.find(r => r.status === 200);
  TOKENS.ganador = ganador?.datos?.token;
  await esperar('solo vale el token del cambio que ganó -> 200', 200, 'GET', '/api/inventario', 'ganador');
  await esperar('los tokens previos a la carrera ya no valen -> 401', 401, 'GET', '/api/inventario', simultaneos[0].status === 200 ? 'simB' : 'simA');

  // Desactivación y reactivación
  const versionAntesDesactivar = await versionDe(idR);
  await esperar('admin desactiva la cuenta -> 200', 200, 'PATCH', `/api/usuarios/${idR}/estado`, 'admin', { estado: false });
  igual('desactivar sube la versión', await versionDe(idR), versionAntesDesactivar + 1);
  await esperar('desactivar de nuevo (idempotente) -> 200', 200, 'PATCH', `/api/usuarios/${idR}/estado`, 'admin', { estado: false });
  igual('desactivar una cuenta ya desactivada no vuelve a subir la versión', await versionDe(idR), versionAntesDesactivar + 1);
  await esperar('cuenta desactivada: su token -> 401', 401, 'GET', '/api/inventario', 'ganador');
  await esperar('admin reactiva la cuenta -> 200', 200, 'PATCH', `/api/usuarios/${idR}/estado`, 'admin', { estado: true });
  igual('reactivar no cambia la versión', await versionDe(idR), versionAntesDesactivar + 1);
  const trasReactivar = await esperar('tras reactivar, el token anterior no vuelve a valer -> 401', 401, 'GET', '/api/inventario', 'ganador');
  igual('mensaje de sesión no válida tras reactivar', trasReactivar?.error, 'La sesión ya no es válida. Inicia sesión nuevamente.');
  const contrasenaGanadora = simultaneos[0].status === 200 ? 'CuartaA123' : 'CuartaB123';
  TOKENS.reactivada = (await login('revocacion@pansys.test', contrasenaGanadora)).datos?.token;
  await esperar('nuevo login tras reactivar -> 200', 200, 'GET', '/api/inventario', 'reactivada');

  // Editar rol o email no revoca la sesión (los permisos ya se leen de la base)
  const versionAntesEditar = await versionDe(idR);
  await esperar('admin cambia rol y email -> 200', 200, 'PATCH', `/api/usuarios/${idR}`, 'admin', { rol_id: 3, email: 'revocacion2@pansys.test' });
  igual('editar no cambia la versión', await versionDe(idR), versionAntesEditar);
  await esperar('la sesión sigue activa con el rol nuevo (lectura) -> 200', 200, 'GET', '/api/inventario', 'reactivada');
  await esperar('y con los permisos del rol nuevo (gerente no vende) -> 403', 403, 'POST', '/api/ventas', 'reactivada', {});

  // La versión nunca se expone en los listados
  const listado = (await pedir('GET', '/api/usuarios', 'admin')).datos ?? [];
  igual('GET /api/usuarios no expone version_sesion', listado.some(c => 'version_sesion' in c), false);
  await restaurarSemilla();

  // ---------- Contratos existentes ----------
  console.log('\n== Contratos existentes');
  await esperar('registrar con rol inválido sigue respondiendo 400', 400, 'POST', '/api/auth/registrar', 'admin',
    { email: 'r@pansys.test', contrasena: 'Clave1234', rol_id: 9 });
  await esperar('login con campos vacíos sigue respondiendo 400', 400, 'POST', '/api/auth/login', null, {});

  igual('ninguna respuesta incluyó contraseñas ni hashes', respuestasConSecretos, 0);
};

main()
  .catch(error => registrar(false, 'Ejecución abortada', error.message))
  .finally(async () => {
    // Limpieza global eliminada: aquí se restauraba la semilla y se borraban insumos por patrón de
    // nombre (LIKE 'PRUEBA-SESION-%'). No se borra ni se restaura nada; si se llegara aquí con
    // datos creados, quedan para revisión manual.
    if (baseVerificada) registrar(false, 'Suite deshabilitada: no se ejecuta ninguna limpieza global');
    const fallidas = resultados.filter(r => !r.ok).length;
    console.log(`\n${resultados.length - fallidas}/${resultados.length} pruebas correctas`);
    await sequelize.close().catch(() => {});
    process.exit(fallidas > 0 ? 1 : 0);
  });
