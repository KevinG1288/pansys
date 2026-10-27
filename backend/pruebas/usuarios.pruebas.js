// Pruebas de integración de la gestión de cuentas (usuarios, panaderías, contraseña, verificación
// de cuenta activa en el middleware, permisos leídos de la base y revocación de sesiones).
//
// Aislamiento (pruebas/aislamiento.js): se ejecuta SOLO contra pansys_test, con el bloqueo de
// suite durante toda la ejecución. Todas las cuentas sobre las que actúa son temporales de esta
// ejecución (correo "prueba.usuarios.<runId>.<etiqueta>@pansys.test"); nunca usa ni modifica las
// cuentas de la semilla ni otras cuentas existentes. Las panaderías A y B también son temporales.
//  - Cuentas sin contraseña utilizable: ejecucion.crearCuenta() (escritura protegida del módulo).
//  - Cuentas que deben iniciar sesión: POST /api/auth/registrar con un correo marcado; su id se
//    registra con ejecucion.registrar() en cuanto la API lo devuelve.
// Al terminar, ejecucion.limpiar() borra solo lo registrado por esta ejecución (una vez, sin
// reintentos). Todo cambio de correo conserva la marca, para que la limpieza lo reconozca.
//
// La regla "debe quedar al menos un administrador activo" (409) no se alcanza por la API cuando
// hay otro administrador actuando: se prueba en pruebas/usuarios.unitarias.js sobre el servicio. Aquí
// se prueba la serialización real (FOR UPDATE) entre dos administradores temporales, contando solo
// esas dos cuentas.
//
// El servidor de la API arranca en un puerto asignado por el sistema (PORT=0) y la suite obtiene
// su dirección real; antes de enviar ningún token comprueba que responde con el runId propio.
//
// Requiere el SQL 004 (usuarios.version_sesion) aplicado en pansys_test: si falta, aborta.
// Código de salida 0 solo si todas las pruebas pasan y la limpieza es correcta.
//
// Uso (desde backend/):  node pruebas/usuarios.pruebas.js

// ---------- Barreras previas a cualquier carga o conexión ----------
const opcionesProhibidas = () => ['PANSYS_MODO_DEMO', 'PANSYS_SERVIR_FRONTEND'].filter(v => process.env[v] !== undefined);
if (opcionesProhibidas().length) {
  console.error(`Suite de Cuentas cancelada: ${opcionesProhibidas().join(', ')} está definida. No se ha conectado nada ni escrito nada.`);
  process.exit(1);
}

process.env.DB_NAME = 'pansys_test';
process.env.PORT = '0'; // puerto asignado por el sistema: nunca coincide con otro proceso
require('dotenv').config({ quiet: true }); // no sobrescribe DB_NAME ni PORT
if (opcionesProhibidas().length) {
  console.error(`Suite de Cuentas cancelada: ${opcionesProhibidas().join(', ')} está definida en el .env. No se ha conectado nada ni escrito nada.`);
  process.exit(1);
}

const jwt = require('jsonwebtoken');
const { sequelize, Usuario } = require('../src/models/index');
const { iniciarEjecucion, limpiezaCorrecta, describirPendientes } = require('./aislamiento');
const { crearObservadorSolapamiento } = require('./solapamiento');

// Id que no debe existir (máximo de INT): antes de usarlo en una escritura se comprueba que no existe
const ID_INEXISTENTE = 2147483647;

const resultados = [];
const registrar = (ok, descripcion, detalle = '') => {
  resultados.push({ ok, descripcion });
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${descripcion}${!ok && detalle ? ` -> ${detalle}` : ''}`);
};

// Estado de la ejecución: solo se envían peticiones con URL y tokens una vez confirmada la identidad
let ejecucion = null;
let servidor = null;
let URL = null;
const TOKENS = {};
const cuentas = {};
let panaderiaA = null;
let panaderiaB = null;

// Ninguna respuesta puede contener contraseñas ni hashes
const sinSecretos = (datos) => {
  const texto = JSON.stringify(datos ?? null);
  return !/contrasena"\s*:/.test(texto.replace(/"contrasena_(actual|nueva)"/g, '')) && !/\$2[aby]\$/.test(texto);
};
let respuestasConSecretos = 0;

// usuario: clave de TOKENS (cuenta temporal o token de prueba) o null para una petición sin token
const pedir = async (metodo, ruta, usuario, body) => {
  if (!URL) throw new Error('No se envían peticiones: la identidad del servidor no está confirmada');
  const headers = { 'Content-Type': 'application/json' };
  if (usuario !== null) {
    if (!TOKENS[usuario]) throw new Error(`No se envían peticiones: "${usuario}" no es un token de esta ejecución`);
    headers.Authorization = `Bearer ${TOKENS[usuario]}`;
  }
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

// ---------- Lecturas de la base, limitadas a las cuentas registradas por esta ejecución ----------
const propias = () => (ejecucion.ids('usuarios').length ? ejecucion.ids('usuarios') : [0]);

const fila = async (id) => (await sequelize.query(
  'SELECT id, email, rol_id, panaderia_id, estado FROM pansys_test.usuarios WHERE id = ? AND id IN (?)',
  { replacements: [id ?? 0, propias()] }))[0][0];

const versionDe = async (id) => (await sequelize.query(
  'SELECT version_sesion AS v FROM pansys_test.usuarios WHERE id = ? AND id IN (?)',
  { replacements: [id ?? 0, propias()] }))[0][0]?.v;

// Hash de una cuenta propia: solo se compara, nunca se muestra
const hashDe = async (id) => (await sequelize.query(
  'SELECT contrasena AS c FROM pansys_test.usuarios WHERE id = ? AND id IN (?)',
  { replacements: [id ?? 0, propias()] }))[0][0]?.c;

// Administradores activos entre las cuentas indicadas (siempre propias)
const adminsActivosEntre = async (ids) => Number((await sequelize.query(
  'SELECT COUNT(*) AS n FROM pansys_test.usuarios WHERE id IN (?) AND id IN (?) AND rol_id = 1 AND estado = 1',
  { replacements: [ids, propias()] }))[0][0].n);

// Cuentas con alguno de estos correos exactos (correos marcados de esta ejecución)
const contarCorreos = async (correos) => (correos.length ? Number((await sequelize.query(
  'SELECT COUNT(*) AS n FROM pansys_test.usuarios WHERE email IN (?)', { replacements: [correos] }))[0][0].n) : 0);

// Antes de usar ID_INEXISTENTE en una petición que escribiría si existiera, se exige que no exista
const CONSULTA_EXISTE = {
  usuarios: 'SELECT COUNT(*) AS n FROM pansys_test.usuarios WHERE id = ?',
  panaderias: 'SELECT COUNT(*) AS n FROM pansys_test.panaderias WHERE id = ?'
};
const exigirInexistente = async (tabla) => {
  const n = Number((await sequelize.query(CONSULTA_EXISTE[tabla], { replacements: [ID_INEXISTENTE] }))[0][0].n);
  if (n !== 0) throw new Error(`El id ${ID_INEXISTENTE} existe en ${tabla}: no se envía la petición`);
};

// Correos que ninguna petición rechazada debe haber creado (se comprueban al final del bloque)
const correosNoCreados = [];

const login = (email, contrasena) => pedir('POST', '/api/auth/login', null, { email, contrasena });

// ÚNICA vía de la suite hacia POST /api/auth/registrar: toda cuenta que la API llegue a crear
// (aunque la prueba esperara un rechazo) queda registrada para la limpieza en cuanto existe
const pedirRegistro = async (usuario, cuerpo) => {
  const r = await pedir('POST', '/api/auth/registrar', usuario, cuerpo);
  if (r.status === 201 && Number.isSafeInteger(r.datos?.id)) ejecucion.registrar('usuarios', r.datos.id);
  return r;
};

// Cuenta con contraseña real, creada por la API como administrador y registrada en cuanto existe
const crearCuentaApi = async (etiqueta, contrasena, rolId, panaderiaId) => {
  const email = ejecucion.correo(etiqueta);
  const r = await pedirRegistro('admin', { email, contrasena, rol_id: rolId, panaderia_id: panaderiaId });
  if (r.status === 201 && Number.isSafeInteger(r.datos?.id)) {
    cuentas[etiqueta] = r.datos.id;
    return r.datos.id;
  }
  throw new Error(`No se pudo crear la cuenta temporal ${etiqueta}: HTTP ${r.status}`);
};

// Tokens de cuentas temporales: el middleware lee rol, panadería, estado y versión de la base
const firmar = (id, etiqueta, rol, rolId, panaderiaId, extra = {}) => jwt.sign({
  id, email: ejecucion.correo(etiqueta), rol, rol_id: rolId, panaderia_id: panaderiaId, version_sesion: 0, ...extra
}, process.env.JWT_SECRET, { expiresIn: '10m' });

// Cuenta temporal sin contraseña utilizable ('!') y su token
const cuentaConToken = async (etiqueta, rol, rolId, panaderiaId, activa = true) => {
  cuentas[etiqueta] = await ejecucion.crearCuenta({ etiqueta, rol, ...(panaderiaId ? { panaderiaId } : {}), activa });
  TOKENS[etiqueta] = firmar(cuentas[etiqueta], etiqueta, rol, rolId, panaderiaId);
  return cuentas[etiqueta];
};

// ---------- Servidor de la API (mismo ciclo de vida que inventario.pruebas.js) ----------
// app.js llama a app.listen() de forma asíncrona (después de sequelize.authenticate()). Sustituir
// app.listen en el mismo turno síncrono que el require garantiza capturar el servidor real.
const arrancarServidor = async () => {
  const app = require('../src/app');
  const listenOriginal = app.listen;
  app.listen = function (...args) {
    servidor = listenOriginal.apply(this, args);
    return servidor;
  };
  // Ruta de identidad: solo este proceso conoce el runId
  app.get(`/api/__aislamiento/${ejecucion.runId}`, (req, res) => res.json({ runId: ejecucion.runId }));

  for (let i = 0; i < 40 && !servidor?.listening; i++) await new Promise(r => setTimeout(r, 250));
  if (!servidor?.listening) throw new Error('El servidor de pruebas no llegó a escuchar (ver el error de arranque de app.js)');
  const direccion = servidor.address();
  if (!direccion || typeof direccion !== 'object' || !Number.isInteger(direccion.port) || direccion.port <= 0) {
    throw new Error('No se pudo obtener la dirección real del servidor de pruebas');
  }
  // Bucle local de la misma familia en la que escucha el servidor propio
  const base = direccion.family === 'IPv6' || direccion.family === 6 ? `http://[::1]:${direccion.port}` : `http://127.0.0.1:${direccion.port}`;

  // Identidad: petición sin token ni cuerpo; solo si devuelve el runId propio se habilitan las pruebas
  let identidad = null;
  try {
    const r = await fetch(`${base}/api/__aislamiento/${ejecucion.runId}`);
    identidad = r.status === 200 ? await r.json() : null;
  } catch { /* identidad no confirmada */ }
  if (identidad?.runId !== ejecucion.runId) throw new Error('El servidor no confirmó el runId de esta ejecución: no se ejecutan las pruebas');
  URL = base;
  console.log(`Servidor de pruebas propio confirmado en el puerto ${direccion.port}`);
};

const cerrarServidor = () => new Promise((resolve, reject) => {
  if (!servidor?.listening) return resolve();
  const limite = setTimeout(() => reject(new Error('el servidor no se cerró en 5 s')), 5000);
  servidor.close((error) => { clearTimeout(limite); error ? reject(error) : resolve(); });
  servidor.closeAllConnections?.();
});

const main = async () => {
  // ---------- Protección: solo pansys_test y con el SQL 004 (lecturas) ----------
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

  // ---------- Bloqueo de suite y datos propios ----------
  // iniciarEjecucion comprueba DB_NAME, la conexión dedicada y la de Sequelize, y toma el bloqueo
  ejecucion = await iniciarEjecucion({ suite: 'usuarios', sequelize });
  console.log(`      runId de esta ejecución: ${ejecucion.runId} (filas marcadas con "prueba.usuarios.${ejecucion.runId}." y "PRUEBA ${ejecucion.runId}")`);
  // Administradora ACTIVA que actúa en casi todas las pruebas y es propietaria de A y B
  cuentas.admin = await ejecucion.crearCuenta({ etiqueta: 'admin', rol: 'administrador', activa: true });
  panaderiaA = await ejecucion.crearPanaderia({ etiqueta: 'A', propietariaId: cuentas.admin });
  panaderiaB = await ejecucion.crearPanaderia({ etiqueta: 'B', propietariaId: cuentas.admin });
  TOKENS.admin = firmar(cuentas.admin, 'admin', 'administrador', 1, null);

  // Cuentas de los distintos bloques (cada bloque usa las suyas: ninguno depende de cómo dejó otro las cuentas)
  await cuentaConToken('mwpanadero', 'panadero', 2, panaderiaA);
  await cuentaConToken('mwvecino', 'panadero', 2, panaderiaB);
  await cuentaConToken('panaderoa', 'panadero', 2, panaderiaA);
  await cuentaConToken('gerentea', 'gerente', 3, panaderiaA);
  await cuentaConToken('objetivo', 'panadero', 2, panaderiaB);
  await cuentaConToken('admina', 'administrador', 1, null);
  await cuentaConToken('adminb', 'administrador', 1, null);
  await cuentaConToken('admine', 'administrador', 1, null);
  await cuentaConToken('adminf', 'administrador', 1, null);
  await cuentaConToken('edpan', 'panadero', 2, panaderiaA);
  await cuentaConToken('edvecino', 'panadero', 2, panaderiaB);
  await cuentaConToken('edger', 'gerente', 3, panaderiaA);
  await cuentaConToken('estger', 'gerente', 3, panaderiaA);
  await cuentaConToken('sinclave', 'panadero', 2, panaderiaA);
  await cuentaConToken('perpan', 'panadero', 2, panaderiaA);
  await cuentaConToken('perpanb', 'panadero', 2, panaderiaB);
  await cuentaConToken('perger', 'gerente', 3, panaderiaA);
  await cuentaConToken('perascenso', 'panadero', 2, panaderiaB);
  await cuentaConToken('sinversion', 'panadero', 2, panaderiaB);

  // Tokens especiales, todos de cuentas temporales
  TOKENS.invalido = 'esto.no.es.un.jwt';
  TOKENS.caducado = jwt.sign({
    id: cuentas.mwpanadero, email: ejecucion.correo('mwpanadero'), rol: 'panadero', rol_id: 2, panaderia_id: panaderiaA,
    version_sesion: 0, exp: Math.floor(Date.now() / 1000) - 60
  }, process.env.JWT_SECRET);
  TOKENS.otraClave = jwt.sign({ id: cuentas.admin, rol_id: 1 }, 'clave-que-no-es-la-del-servidor', { expiresIn: '10m' });
  // Token que dice "administrador" para una cuenta que en la base es panadero
  TOKENS.perpanComoAdmin = firmar(cuentas.perpan, 'perpan', 'administrador', 1, null);
  // Token anterior al SQL 004 (sin version_sesion) de una cuenta que nunca cambia de versión
  TOKENS.sinversion = jwt.sign({
    id: cuentas.sinversion, email: ejecucion.correo('sinversion'), rol: 'panadero', rol_id: 2, panaderia_id: panaderiaB
  }, process.env.JWT_SECRET, { expiresIn: '10m' });

  await arrancarServidor();

  // ---------- Middleware: cuenta activa ----------
  await ejecucion.exigirBloqueo();
  console.log('\n== Middleware: token válido de cuenta activa vs desactivada');
  await esperar('sin token -> 401', 401, 'GET', `/api/inventario?panaderia_id=${panaderiaA}`, null);
  await esperar('token mal formado -> 401', 401, 'GET', '/api/inventario', 'invalido');
  await esperar('token firmado con otra clave -> 401', 401, 'GET', '/api/inventario', 'otraClave');
  const caducado = await esperar('token caducado -> 401', 401, 'GET', '/api/inventario', 'caducado');
  igual('mensaje de sesión expirada', caducado?.error, 'La sesión expiró. Inicia sesión nuevamente.');
  await exigirInexistente('usuarios');
  TOKENS.inexistente = jwt.sign({ id: ID_INEXISTENTE, email: ejecucion.correo('inexistente'), rol: 'administrador', rol_id: 1, panaderia_id: null },
    process.env.JWT_SECRET, { expiresIn: '10m' });
  await esperar('token válido de cuenta inexistente -> 401', 401, 'GET', '/api/inventario', 'inexistente');
  await esperar('panadero activo lee inventario -> 200', 200, 'GET', '/api/inventario', 'mwpanadero');

  const desactivado = await esperar('admin desactiva al panadero -> 200', 200, 'PATCH', `/api/usuarios/${cuentas.mwpanadero}/estado`, 'admin', { estado: false });
  igual('respuesta con estado false', desactivado?.estado, false);
  const r401 = await esperar('token aún vigente de cuenta desactivada: inventario -> 401', 401, 'GET', '/api/inventario', 'mwpanadero');
  igual('mensaje de cuenta no activa', r401?.error, 'La cuenta no está activa. Inicia sesión con una cuenta activa.');
  await esperar('cuenta desactivada: ventas -> 401', 401, 'GET', '/api/ventas', 'mwpanadero');
  await esperar('cuenta desactivada: producción -> 401', 401, 'GET', '/api/produccion/ordenes', 'mwpanadero');
  await esperar('cuenta desactivada: cambio de contraseña -> 401', 401, 'PATCH', '/api/auth/contrasena', 'mwpanadero',
    { contrasena_actual: '!', contrasena_nueva: 'Nueva1234' });
  await esperar('otro panadero (activo) no se ve afectado -> 200', 200, 'GET', '/api/inventario', 'mwvecino');
  await esperar('admin reactiva al panadero -> 200', 200, 'PATCH', `/api/usuarios/${cuentas.mwpanadero}/estado`, 'admin', { estado: true });
  const tras = await esperar('token anterior a la desactivación, tras reactivar -> 401', 401, 'GET', '/api/inventario', 'mwpanadero');
  igual('mensaje de sesión no válida', tras?.error, 'La sesión ya no es válida. Inicia sesión nuevamente.');
  igual('desactivar subió la versión de sesión a 1', await versionDe(cuentas.mwpanadero), 1);
  TOKENS.mwpanadero = firmar(cuentas.mwpanadero, 'mwpanadero', 'panadero', 2, panaderiaA, { version_sesion: 1 });
  await esperar('con un token de la versión actual -> 200', 200, 'GET', '/api/inventario', 'mwpanadero');

  // Login real: una cuenta desactivada no puede iniciar sesión
  const idLogin = await crearCuentaApi('login', 'Clave1234', 2, panaderiaA);
  const okLogin = await login(ejecucion.correo('login'), 'Clave1234');
  igual('login de cuenta activa -> 200', okLogin.status, 200);
  await pedir('PATCH', `/api/usuarios/${idLogin}/estado`, 'admin', { estado: false });
  igual('login de cuenta desactivada -> 401', (await login(ejecucion.correo('login'), 'Clave1234')).status, 401);
  TOKENS.loginPrueba = okLogin.datos?.token;
  await esperar('token emitido por login antes de desactivar -> 401', 401, 'GET', '/api/ventas', 'loginPrueba');

  // ---------- Acceso denegado a no administradores ----------
  await ejecucion.exigirBloqueo();
  console.log('\n== Acceso denegado a no administradores');
  const objetivoAntes = await fila(cuentas.objetivo);
  for (const usuario of ['panaderoa', 'gerentea']) {
    await esperar(`${usuario}: GET /api/usuarios -> 403`, 403, 'GET', '/api/usuarios', usuario);
    await esperar(`${usuario}: PATCH /api/usuarios/:id -> 403`, 403, 'PATCH', `/api/usuarios/${cuentas.objetivo}`, usuario, { rol_id: 3 });
    await esperar(`${usuario}: PATCH /api/usuarios/:id/estado -> 403`, 403, 'PATCH', `/api/usuarios/${cuentas.objetivo}/estado`, usuario, { estado: false });
    await esperar(`${usuario}: GET /api/panaderias -> 403`, 403, 'GET', '/api/panaderias', usuario);
    const correo = ejecucion.correo(`x${usuario}`);
    correosNoCreados.push(correo);
    const rechazado = await pedirRegistro(usuario, { email: correo, contrasena: 'Clave1234', rol_id: 2, panaderia_id: panaderiaA });
    registrar(rechazado.status === 403, `${usuario}: POST /api/auth/registrar -> 403`, `HTTP ${rechazado.status}: ${JSON.stringify(rechazado.datos)}`);
  }
  await esperar('sin token: GET /api/usuarios -> 401', 401, 'GET', '/api/usuarios', null);
  await esperar('sin token: GET /api/panaderias -> 401', 401, 'GET', '/api/panaderias', null);
  igual('la cuenta objetivo sigue activa y sin cambios', await fila(cuentas.objetivo), objetivoAntes);
  igual('los registros rechazados no crearon cuentas', await contarCorreos(correosNoCreados), 0);

  // ---------- Listados del administrador ----------
  await ejecucion.exigirBloqueo();
  console.log('\n== Listados del administrador');
  const lista = await esperar('admin: GET /api/usuarios -> 200', 200, 'GET', '/api/usuarios', 'admin');
  igual('incluye las cuentas temporales de esta ejecución', [cuentas.admin, cuentas.panaderoa, cuentas.gerentea].every(id => lista?.some(u => u.id === id)), true);
  const p1 = lista?.find(u => u.id === cuentas.panaderoa);
  igual('campos expuestos de una cuenta', p1 && Object.keys(p1).sort(),
    ['createdAt', 'email', 'estado', 'id', 'panaderia', 'panaderia_id', 'rol', 'rol_id', 'updatedAt']);
  igual('rol y panadería legibles', [p1?.rol, p1?.panaderia], ['panadero', { id: panaderiaA, nombre: ejecucion.nombre('A') }]);
  igual('administrador sin panadería', lista?.find(u => u.id === cuentas.admin)?.panaderia, null);
  igual('el listado no contiene contraseñas ni hashes', sinSecretos(lista), true);
  const panaderias = await esperar('admin: GET /api/panaderias -> 200', 200, 'GET', '/api/panaderias', 'admin');
  igual('incluye las panaderías temporales con campos mínimos (id y nombre)',
    [panaderiaA, panaderiaB].map(id => panaderias?.find(p => p.id === id)),
    [{ id: panaderiaA, nombre: ejecucion.nombre('A') }, { id: panaderiaB, nombre: ejecucion.nombre('B') }]);
  igual('ninguna panadería expone más campos que id y nombre',
    Array.isArray(panaderias) && panaderias.every(p => JSON.stringify(Object.keys(p).sort()) === '["id","nombre"]'), true);

  // ---------- Autoelevación y autoprotección ----------
  await ejecucion.exigirBloqueo();
  console.log('\n== Autoelevación de privilegios y autoprotección');
  await esperar('panadero intenta hacerse administrador -> 403', 403, 'PATCH', `/api/usuarios/${cuentas.panaderoa}`, 'panaderoa', { rol_id: 1, panaderia_id: null });
  await esperar('gerente intenta hacerse administrador -> 403', 403, 'PATCH', `/api/usuarios/${cuentas.gerentea}`, 'gerentea', { rol_id: 1 });
  igual('roles sin cambios', [(await fila(cuentas.panaderoa))?.rol_id, (await fila(cuentas.gerentea))?.rol_id], [2, 3]);
  await esperar('admin cambia su propio rol -> 403', 403, 'PATCH', `/api/usuarios/${cuentas.admin}`, 'admin', { rol_id: 2, panaderia_id: panaderiaA });
  await esperar('admin se desactiva a sí mismo -> 403', 403, 'PATCH', `/api/usuarios/${cuentas.admin}/estado`, 'admin', { estado: false });
  await esperar('admin reenvía su mismo rol -> 200', 200, 'PATCH', `/api/usuarios/${cuentas.admin}`, 'admin', { rol_id: 1 });
  igual('admin sigue activo y administrador', await fila(cuentas.admin),
    { id: cuentas.admin, email: ejecucion.correo('admin'), rol_id: 1, panaderia_id: null, estado: 1 });

  // Token de administrador desactualizado: la cuenta fue degradada después de emitirlo
  await cuentaConToken('degradado', 'administrador', 1, null);
  await esperar('admin degrada a la cuenta a panadero -> 200', 200, 'PATCH', `/api/usuarios/${cuentas.degradado}`, 'admin', { rol_id: 2, panaderia_id: panaderiaA });
  await esperar('token antiguo de admin degradado: GET /api/usuarios -> 403', 403, 'GET', '/api/usuarios', 'degradado');
  await esperar('token antiguo de admin degradado: se reasciende -> 403', 403, 'PATCH', `/api/usuarios/${cuentas.degradado}`, 'degradado', { rol_id: 1 });
  await esperar('token antiguo de admin degradado: desactiva a otro -> 403', 403, 'PATCH', `/api/usuarios/${cuentas.objetivo}/estado`, 'degradado', { estado: false });
  igual('la cuenta degradada sigue siendo panadero', (await fila(cuentas.degradado))?.rol_id, 2);

  // ---------- Último administrador activo: serialización real ----------
  // Dos administradores temporales intentan degradarse (o desactivarse) mutuamente a la vez. El
  // servicio bloquea (FOR UPDATE) a los administradores activos y a quien actúa: la segunda
  // operación, al entrar, encuentra que su autor ya no es administrador activo y se rechaza. Sin esa
  // serialización, las dos se aplicarían. Se cuentan solo esas dos cuentas, nunca las demás.
  //
  // Solapamiento demostrado (pruebas/solapamiento.js): durante cada par de peticiones se envuelven
  // Usuario.findAll (el bloqueo de administradores activos, dentro de la transacción) y
  // Usuario.findByPk. La transacción que obtiene antes el bloqueo se detiene antes de leer a su
  // autor hasta que la otra lo ha pedido, y 500 ms más; durante esa pausa la otra debe seguir
  // esperando en MySQL. Todas las esperas tienen límite: ninguna puede quedarse bloqueada. Los
  // métodos originales se restauran en un finally.
  await ejecucion.exigirBloqueo();
  console.log('\n== Último administrador activo (operaciones simultáneas entre dos administradores temporales)');
  const esBloqueoAdministradores = (opciones) =>
    Boolean(opciones?.lock) && opciones?.where?.rol_id === 1 && opciones?.where?.estado === true;
  for (const [tipo, primero, segundo, cuerpo, ruta] of [
    ['degradación', 'admina', 'adminb', { rol_id: 2, panaderia_id: panaderiaA }, ''],
    ['desactivación', 'admine', 'adminf', { estado: false }, '/estado']
  ]) {
    const pareja = [cuentas[primero], cuentas[segundo]];
    igual(`${tipo}: las dos cuentas temporales son administradoras activas al empezar`, await adminsActivosEntre(pareja), 2);
    const observador = crearObservadorSolapamiento({ esBloqueo: esBloqueoAdministradores, pausaMs: 500, limiteMs: 5000 });
    const findAllOriginal = Usuario.findAll;
    const findByPkOriginal = Usuario.findByPk;
    let a;
    let b;
    try {
      Usuario.findAll = observador.envolverBloqueo(findAllOriginal);
      Usuario.findByPk = observador.envolverSiguiente(findByPkOriginal);
      [a, b] = await Promise.all([
        pedir('PATCH', `/api/usuarios/${cuentas[segundo]}${ruta}`, primero, cuerpo),
        pedir('PATCH', `/api/usuarios/${cuentas[primero]}${ruta}`, segundo, cuerpo)
      ]);
    } finally {
      Usuario.findAll = findAllOriginal;
      Usuario.findByPk = findByPkOriginal;
    }
    const solapamiento = observador.resultado();
    igual(`${tipo}: las dos transacciones pidieron el bloqueo y se solaparon de verdad (sin agotar la espera)`,
      [solapamiento.transacciones, solapamiento.solapadas, solapamiento.tiempoAgotado], [2, true, false]);
    igual(`${tipo}: mientras la primera retenía el bloqueo, la segunda siguió esperando en MySQL`, solapamiento.otraEsperabaTrasPausa, true);
    igual(`${tipo}: tras la pausa, la segunda llegó a obtener el bloqueo (no quedó sin respuesta)`, solapamiento.otraObtuvoDespues, true);
    const estados = [a?.status, b?.status].sort();
    registrar(estados[0] === 200 && [401, 403].includes(estados[1]),
      `${tipo} simultánea: una se aplica y la otra se rechaza`, `estados ${JSON.stringify([a?.status, b?.status])}`);
    igual(`${tipo} simultánea: de las dos, queda exactamente 1 administradora activa`, await adminsActivosEntre(pareja), 1);
    igual(`${tipo}: Usuario.findAll y Usuario.findByPk quedan restaurados`,
      [Usuario.findAll === findAllOriginal, Usuario.findByPk === findByPkOriginal], [true, true]);
  }

  // ---------- Validación de rol y panadería ----------
  await ejecucion.exigirBloqueo();
  console.log('\n== Validación de edición (rol, panadería, email, campos)');
  await esperar('id no numérico -> 400', 400, 'PATCH', '/api/usuarios/abc', 'admin', { rol_id: 2 });
  await exigirInexistente('usuarios');
  await esperar('id inexistente -> 404', 404, 'PATCH', `/api/usuarios/${ID_INEXISTENTE}`, 'admin', { rol_id: 2, panaderia_id: panaderiaA });
  await esperar('cuerpo vacío -> 400', 400, 'PATCH', `/api/usuarios/${cuentas.edpan}`, 'admin', {});
  await esperar('contraseña no editable aquí -> 400', 400, 'PATCH', `/api/usuarios/${cuentas.edpan}`, 'admin', { contrasena: 'Clave1234' });
  await esperar('estado no editable aquí -> 400', 400, 'PATCH', `/api/usuarios/${cuentas.edpan}`, 'admin', { estado: false });
  await esperar('rol inexistente (7) -> 400', 400, 'PATCH', `/api/usuarios/${cuentas.edpan}`, 'admin', { rol_id: 7 });
  await esperar('rol duplicado inactivo (4) -> 400', 400, 'PATCH', `/api/usuarios/${cuentas.edpan}`, 'admin', { rol_id: 4 });
  await esperar('rol como lista -> 400', 400, 'PATCH', `/api/usuarios/${cuentas.edpan}`, 'admin', { rol_id: [2] });
  await exigirInexistente('panaderias');
  await esperar('panadería inexistente -> 404', 404, 'PATCH', `/api/usuarios/${cuentas.edpan}`, 'admin', { panaderia_id: ID_INEXISTENTE });
  await esperar('panadería no numérica -> 400', 400, 'PATCH', `/api/usuarios/${cuentas.edpan}`, 'admin', { panaderia_id: 'uno' });
  await esperar('panadero sin panadería -> 400', 400, 'PATCH', `/api/usuarios/${cuentas.edpan}`, 'admin', { panaderia_id: null });
  await esperar('administrador con panadería -> 400', 400, 'PATCH', `/api/usuarios/${cuentas.edvecino}`, 'admin', { rol_id: 1, panaderia_id: panaderiaB });
  igual('sin cambios tras los rechazos', [await fila(cuentas.edpan), await fila(cuentas.edvecino)], [
    { id: cuentas.edpan, email: ejecucion.correo('edpan'), rol_id: 2, panaderia_id: panaderiaA, estado: 1 },
    { id: cuentas.edvecino, email: ejecucion.correo('edvecino'), rol_id: 2, panaderia_id: panaderiaB, estado: 1 }
  ]);

  const gerente = await esperar('panadero -> gerente (conserva panadería) -> 200', 200, 'PATCH', `/api/usuarios/${cuentas.edpan}`, 'admin', { rol_id: 3 });
  igual('rol gerente y panadería A', [gerente?.rol, gerente?.panaderia_id], ['gerente', panaderiaA]);
  const movido = await esperar('cambio de panadería a B -> 200', 200, 'PATCH', `/api/usuarios/${cuentas.edpan}`, 'admin', { panaderia_id: panaderiaB });
  igual('panadería actualizada', movido?.panaderia, { id: panaderiaB, nombre: ejecucion.nombre('B') });
  const promovido = await esperar('panadero -> administrador sin panadería -> 200', 200, 'PATCH', `/api/usuarios/${cuentas.edvecino}`, 'admin', { rol_id: 1 });
  igual('administrador queda sin panadería', [promovido?.rol_id, promovido?.panaderia_id], [1, null]);
  await esperar('administrador -> panadero sin indicar panadería -> 400', 400, 'PATCH', `/api/usuarios/${cuentas.edvecino}`, 'admin', { rol_id: 2 });
  await esperar('administrador -> panadero con panadería B -> 200', 200, 'PATCH', `/api/usuarios/${cuentas.edvecino}`, 'admin', { rol_id: 2, panaderia_id: panaderiaB });

  await esperar('email inválido -> 400', 400, 'PATCH', `/api/usuarios/${cuentas.edger}`, 'admin', { email: 'no-es-email' });
  await esperar('email vacío -> 400', 400, 'PATCH', `/api/usuarios/${cuentas.edger}`, 'admin', { email: '   ' });
  await esperar('email de otra cuenta -> 409', 409, 'PATCH', `/api/usuarios/${cuentas.edger}`, 'admin', { email: ejecucion.correo('edvecino') });
  // El correo nuevo conserva la marca de la ejecución (la limpieza la exige)
  const conEmail = await esperar('email nuevo (con espacios) -> 200', 200, 'PATCH', `/api/usuarios/${cuentas.edger}`, 'admin',
    { email: `  ${ejecucion.correo('edgernuevo')} ` });
  igual('email recortado', conEmail?.email, ejecucion.correo('edgernuevo'));

  // ---------- Endpoint de estado ----------
  await ejecucion.exigirBloqueo();
  console.log('\n== Endpoint de estado');
  await esperar('estado como texto -> 400', 400, 'PATCH', `/api/usuarios/${cuentas.estger}/estado`, 'admin', { estado: 'false' });
  await esperar('estado ausente -> 400', 400, 'PATCH', `/api/usuarios/${cuentas.estger}/estado`, 'admin', {});
  await exigirInexistente('usuarios');
  await esperar('estado de cuenta inexistente -> 404', 404, 'PATCH', `/api/usuarios/${ID_INEXISTENTE}/estado`, 'admin', { estado: false });
  await esperar('desactivar gerente -> 200', 200, 'PATCH', `/api/usuarios/${cuentas.estger}/estado`, 'admin', { estado: false });
  const repetido = await esperar('desactivar de nuevo (idempotente) -> 200', 200, 'PATCH', `/api/usuarios/${cuentas.estger}/estado`, 'admin', { estado: false });
  igual('sigue desactivado', repetido?.estado, false);
  await esperar('editar una cuenta desactivada -> 200', 200, 'PATCH', `/api/usuarios/${cuentas.estger}`, 'admin', { panaderia_id: panaderiaB });
  igual('la edición no la reactiva', (await fila(cuentas.estger))?.estado, 0);

  // ---------- Cambio de contraseña ----------
  await ejecucion.exigirBloqueo();
  console.log('\n== Cambio de contraseña');
  const idClave = await crearCuentaApi('clave', 'Inicial123', 3, panaderiaA);
  TOKENS.clave = (await login(ejecucion.correo('clave'), 'Inicial123')).datos?.token;
  const hashAntes = await hashDe(idClave);

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
  igual('los rechazos no cambian el hash', (await hashDe(idClave)) === hashAntes, true);

  const cambio = await esperar('cambio correcto -> 200', 200, 'PATCH', '/api/auth/contrasena', 'clave',
    { contrasena_actual: 'Inicial123', contrasena_nueva: 'Nueva12345' });
  igual('respuesta: mensaje y token nuevo, sin datos sensibles',
    [Object.keys(cambio ?? {}).sort(), cambio?.mensaje, typeof cambio?.token], [['mensaje', 'token'], 'Contraseña actualizada correctamente', 'string']);
  await esperar('el token anterior al cambio deja de valer -> 401', 401, 'GET', '/api/inventario', 'clave');
  TOKENS.clave = cambio?.token;
  await esperar('el token nuevo funciona -> 200', 200, 'GET', '/api/ventas', 'clave');
  const hashDespues = await hashDe(idClave);
  igual('se guarda un hash bcrypt nuevo', [hashDespues !== hashAntes, /^\$2[aby]\$10\$/.test(hashDespues ?? '')], [true, true]);
  igual('login con la contraseña anterior -> 401', (await login(ejecucion.correo('clave'), 'Inicial123')).status, 401);
  igual('login con la contraseña nueva -> 200', (await login(ejecucion.correo('clave'), 'Nueva12345')).status, 200);
  await esperar('la cuenta sin contraseña válida (\'!\') no puede cambiarla -> 400', 400, 'PATCH', '/api/auth/contrasena', 'sinclave',
    { contrasena_actual: '!', contrasena_nueva: 'Nueva12345' });
  igual('solo cambia la contraseña propia (la otra cuenta conserva la suya)', await hashDe(cuentas.sinclave), '!');

  // ---------- Permisos actualizados: rol y panadería salen de la base, no del token ----------
  await ejecucion.exigirBloqueo();
  console.log('\n== Permisos actualizados desde la base de datos');
  // Una materia prima en cada panadería temporal, creada por la API (sin escrituras directas)
  const nombreA = ejecucion.nombre('Sesion A');
  const nombreB = ejecucion.nombre('Sesion B');
  const insumo = (nombreInsumo) => ({ nombre: nombreInsumo, unidad_medida: 'kg', cantidad_disponible: 1, stock_minimo: 0, precio_unitario: 1 });
  const insumoA = await esperar('materia prima de prueba en A -> 201', 201, 'POST', '/api/inventario', 'perpan', insumo(nombreA));
  const insumoB = await esperar('materia prima de prueba en B -> 201', 201, 'POST', '/api/inventario', 'perpanb', insumo(nombreB));
  igual('cada materia prima en su panadería temporal', [insumoA?.panaderia_id, insumoB?.panaderia_id], [panaderiaA, panaderiaB]);
  const deEstaPrueba = (datos) => (Array.isArray(datos) ? datos : []).map(i => i.nombre).filter(n => n === nombreA || n === nombreB);
  const nombresInventario = async (usuario, consulta = '') => deEstaPrueba((await pedir('GET', `/api/inventario${consulta}`, usuario)).datos);

  // Un token que dice "administrador" no da privilegios a una cuenta que es panadero
  await esperar('token con rol_id 1 de un panadero: GET /api/usuarios -> 403', 403, 'GET', '/api/usuarios', 'perpanComoAdmin');
  await esperar('token con rol_id 1 de un panadero: PATCH estado -> 403', 403, 'PATCH', `/api/usuarios/${cuentas.perpanb}/estado`, 'perpanComoAdmin', { estado: false });
  await esperar('token con rol_id 1 de un panadero: GET /api/panaderias -> 403', 403, 'GET', '/api/panaderias', 'perpanComoAdmin');
  igual('y opera solo sobre su panadería real (sin panaderia_id)', await nombresInventario('perpanComoAdmin'), [nombreA]);
  igual('aunque pida otra panadería, se ignora', await nombresInventario('perpanComoAdmin', `?panaderia_id=${panaderiaB}`), [nombreA]);

  // Cambio de panadería con el token anterior
  igual('el panadero ve su panadería A', await nombresInventario('perpan'), [nombreA]);
  await pedir('PATCH', `/api/usuarios/${cuentas.perpan}`, 'admin', { panaderia_id: panaderiaB });
  igual('tras moverlo a B, el mismo token ve la panadería B (inventario)', await nombresInventario('perpan'), [nombreB]);
  const recetasB = await pedir('GET', '/api/produccion/recetas', 'perpan');
  igual('recetas: responde con la panadería actual', recetasB.status, 200);
  await pedir('PATCH', `/api/usuarios/${cuentas.perpan}`, 'admin', { panaderia_id: panaderiaA });

  // Degradación de panadero a gerente con el token anterior (gerente = solo lectura)
  await esperar('el panadero puede escribir en ventas (llega a la validación) -> 400', 400, 'POST', '/api/ventas', 'perpan', {});
  await pedir('PATCH', `/api/usuarios/${cuentas.perpan}`, 'admin', { rol_id: 3 });
  await esperar('ya gerente, mismo token: venta -> 403', 403, 'POST', '/api/ventas', 'perpan', {});
  await esperar('ya gerente, mismo token: insumo nuevo -> 403', 403, 'POST', '/api/inventario', 'perpan', {});
  await esperar('ya gerente, mismo token: orden de producción -> 403', 403, 'POST', '/api/produccion/ordenes', 'perpan', {});
  await esperar('ya gerente, mismo token: receta -> 403', 403, 'POST', `/api/produccion/recetas/${ID_INEXISTENTE}`, 'perpan', {});
  await esperar('ya gerente, mismo token: lectura de ventas -> 200', 200, 'GET', '/api/ventas', 'perpan');

  // Ascenso de gerente a panadero con el token anterior
  await esperar('el gerente no puede vender -> 403', 403, 'POST', '/api/ventas', 'perger', {});
  await pedir('PATCH', `/api/usuarios/${cuentas.perger}`, 'admin', { rol_id: 2 });
  await esperar('ya panadero, mismo token: venta llega a la validación -> 400', 400, 'POST', '/api/ventas', 'perger', {});

  // Ascenso a administrador y vuelta atrás
  await pedir('PATCH', `/api/usuarios/${cuentas.perascenso}`, 'admin', { rol_id: 1 });
  await esperar('panadero ascendido, mismo token: GET /api/usuarios -> 200', 200, 'GET', '/api/usuarios', 'perascenso');
  await esperar('como administrador debe indicar panadería -> 400', 400, 'GET', '/api/inventario', 'perascenso');
  await pedir('PATCH', `/api/usuarios/${cuentas.perascenso}`, 'admin', { rol_id: 2, panaderia_id: panaderiaB });
  await esperar('panadero degradado, mismo token: GET /api/usuarios -> 403', 403, 'GET', '/api/usuarios', 'perascenso');

  // Cambio de contraseña con un token cuyo email quedó desactualizado (el correo nuevo conserva la marca)
  await pedir('PATCH', `/api/usuarios/${idClave}`, 'admin', { email: ejecucion.correo('claverenombrada') });
  await esperar('cuenta renombrada: su sesión sigue operando -> 200', 200, 'PATCH', '/api/auth/contrasena', 'clave',
    { contrasena_actual: 'Nueva12345', contrasena_nueva: 'Otra12345' });

  // ---------- Registro con validación en el backend ----------
  await ejecucion.exigirBloqueo();
  console.log('\n== Validación de /registrar');
  // Toda cuenta que la API llegara a crear queda registrada para la limpieza (pedirRegistro)
  const registro = (cuerpo) => pedirRegistro('admin', { rol_id: 2, panaderia_id: panaderiaA, ...cuerpo });
  const marca = ejecucion.correo('x').replace(/x@pansys\.test$/, '');
  const casosInvalidos = [
    ['email sin formato', { email: `${marca}sinarroba`, contrasena: 'Clave1234' }, 'El email no es válido'],
    ['email solo espacios', { email: '   ', contrasena: 'Clave1234' }, 'El email es obligatorio'],
    ['email como lista', { email: [ejecucion.correo('lista')], contrasena: 'Clave1234' }, 'El email es obligatorio'],
    ['email de más de 255 caracteres', { email: `${marca}${'a'.repeat(250)}@pansys.test`, contrasena: 'Clave1234' }, 'El email no es válido'],
    ['contraseña corta', { email: ejecucion.correo('r1'), contrasena: 'Ab1' }, 'La contraseña debe tener al menos 8 caracteres'],
    ['contraseña sin números', { email: ejecucion.correo('r2'), contrasena: 'SoloLetras' }, 'La contraseña debe incluir al menos una letra y un número'],
    ['contraseña sin letras', { email: ejecucion.correo('r3'), contrasena: '12345678' }, 'La contraseña debe incluir al menos una letra y un número'],
    ['contraseña de más de 72 bytes', { email: ejecucion.correo('r4'), contrasena: `A1${'ñ'.repeat(36)}` }, 'La contraseña es demasiado larga (máximo 72 bytes)'],
    ['contraseña numérica (no texto)', { email: ejecucion.correo('r5'), contrasena: 123456789 }, 'La contraseña es obligatoria']
  ];
  const correosInvalidos = casosInvalidos.map(([, cuerpo]) => cuerpo.email).filter(e => typeof e === 'string' && e.trim()).map(e => e.trim());
  for (const [descripcion, cuerpo, mensaje] of casosInvalidos) {
    const r = await registro(cuerpo);
    registrar(r.status === 400 && r.datos?.error === mensaje, `registro: ${descripcion} -> 400`, `HTTP ${r.status}: ${JSON.stringify(r.datos)}`);
  }
  const correoFaltan = ejecucion.correo('faltan');
  correosInvalidos.push(correoFaltan, ejecucion.correo('lista'));
  // Sin los valores por defecto de registro(): el cuerpo debe llegar incompleto
  const faltan = await pedirRegistro('admin', { email: correoFaltan });
  igual('registro: faltan campos -> 400 (mensaje de siempre)', [faltan.status, faltan.datos?.error], [400, 'Todos los campos son requeridos']);
  igual('ningún registro inválido creó cuentas (por correo exacto)', await contarCorreos(correosInvalidos), 0);

  const valido = await registro({ email: `  ${ejecucion.correo('nuevoregistro')} `, contrasena: 'ñandú2026' });
  igual('registro válido -> 201 con el contrato de siempre', [valido.status, Object.keys(valido.datos ?? {}).sort()], [201, ['id', 'mensaje']]);
  igual('el email se guarda recortado', (await fila(valido.datos?.id))?.email, ejecucion.correo('nuevoregistro'));
  igual('puede iniciar sesión con letras no ASCII en la contraseña', (await login(ejecucion.correo('nuevoregistro'), 'ñandú2026')).status, 200);
  const repetido2 = await registro({ email: ejecucion.correo('nuevoregistro'), contrasena: 'Clave1234' });
  igual('email repetido -> 400 (contrato de siempre)', [repetido2.status, repetido2.datos?.error], [400, 'El email ya está registrado']);

  // ---------- Revocación de sesiones (version_sesion) ----------
  await ejecucion.exigirBloqueo();
  console.log('\n== Revocación de sesiones (version_sesion)');
  const idR = await crearCuentaApi('revocacion', 'Inicial123', 2, panaderiaA);
  const idOtra = await crearCuentaApi('otracuenta', 'Otra12345', 3, panaderiaA);
  const correoR = ejecucion.correo('revocacion');
  TOKENS.dispA = (await login(correoR, 'Inicial123')).datos?.token;
  TOKENS.dispB = (await login(correoR, 'Inicial123')).datos?.token;
  TOKENS.legado = jwt.sign({ id: idR, email: correoR, rol: 'panadero', rol_id: 2, panaderia_id: panaderiaA }, process.env.JWT_SECRET, { expiresIn: '10m' });
  TOKENS.otra = (await login(ejecucion.correo('otracuenta'), 'Otra12345')).datos?.token;
  const cargaA = TOKENS.dispA ? jwt.verify(TOKENS.dispA, process.env.JWT_SECRET) : {};
  igual('el login firma la versión actual (0) en el token', cargaA.version_sesion, 0);
  const respLogin = (await login(correoR, 'Inicial123')).datos;
  igual('la respuesta del login no expone la versión', 'version_sesion' in (respLogin?.usuario ?? {}), false);
  for (const t of ['dispA', 'dispB', 'legado', 'otra']) {
    await esperar(`antes del cambio: token ${t} -> 200`, 200, 'GET', '/api/inventario', t);
  }
  const versionesAjenasAntes = [await versionDe(idOtra), await versionDe(cuentas.sinversion), await versionDe(cuentas.panaderoa), await versionDe(cuentas.admin)];

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
  igual('versiones de las demás cuentas temporales sin cambios',
    [await versionDe(idOtra), await versionDe(cuentas.sinversion), await versionDe(cuentas.panaderoa), await versionDe(cuentas.admin)], versionesAjenasAntes);
  await esperar('los tokens sin versión de otras cuentas siguen valiendo -> 200', 200, 'GET', '/api/inventario', 'sinversion');
  igual('login con la contraseña anterior -> 401', (await login(correoR, 'Inicial123')).status, 401);
  TOKENS.dispC = (await login(correoR, 'Nueva12345')).datos?.token;
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
    TOKENS.falso = firmar(idR, 'revocacion', 'panadero', 2, panaderiaA, { version_sesion: version });
    await esperar(`versión ${descripcion} en el token -> 401`, 401, 'GET', '/api/inventario', 'falso');
  }

  // Dos cambios simultáneos con la misma contraseña actual: uno gana, la versión sube una vez
  TOKENS.simA = (await login(correoR, 'Tercera123')).datos?.token;
  TOKENS.simB = (await login(correoR, 'Tercera123')).datos?.token;
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
  TOKENS.reactivada = (await login(correoR, contrasenaGanadora)).datos?.token;
  await esperar('nuevo login tras reactivar -> 200', 200, 'GET', '/api/inventario', 'reactivada');

  // Editar rol o email no revoca la sesión (los permisos ya se leen de la base); el correo nuevo conserva la marca
  const versionAntesEditar = await versionDe(idR);
  await esperar('admin cambia rol y email -> 200', 200, 'PATCH', `/api/usuarios/${idR}`, 'admin', { rol_id: 3, email: ejecucion.correo('revocacion2') });
  igual('editar no cambia la versión', await versionDe(idR), versionAntesEditar);
  await esperar('la sesión sigue activa con el rol nuevo (lectura) -> 200', 200, 'GET', '/api/inventario', 'reactivada');
  await esperar('y con los permisos del rol nuevo (gerente no vende) -> 403', 403, 'POST', '/api/ventas', 'reactivada', {});

  // La versión nunca se expone en los listados
  const listado = (await pedir('GET', '/api/usuarios', 'admin')).datos ?? [];
  igual('GET /api/usuarios no expone version_sesion', listado.some(c => 'version_sesion' in c), false);

  // ---------- Contratos existentes ----------
  await ejecucion.exigirBloqueo();
  console.log('\n== Contratos existentes');
  const correoRolInvalido = ejecucion.correo('rolinvalido');
  const rolInvalido = await pedirRegistro('admin', { email: correoRolInvalido, contrasena: 'Clave1234', rol_id: 9 });
  registrar(rolInvalido.status === 400, 'registrar con rol inválido sigue respondiendo 400', `HTTP ${rolInvalido.status}: ${JSON.stringify(rolInvalido.datos)}`);
  igual('el registro con rol inválido no creó ninguna cuenta', await contarCorreos([correoRolInvalido]), 0);
  await esperar('login con campos vacíos sigue respondiendo 400', 400, 'POST', '/api/auth/login', null, {});

  igual('ninguna respuesta incluyó contraseñas ni hashes', respuestasConSecretos, 0);
};

main()
  .catch(error => registrar(false, 'Ejecución abortada', error.message))
  .finally(async () => {
    // Cierre ordenado: (1) el servidor deja de aceptar peticiones; (2) una sola limpieza, por la
    // conexión dedicada; (3) solo después se libera el bloqueo y se cierra la conexión dedicada;
    // (4) Sequelize. Los fallos de cierre se informan además de los errores anteriores.
    const problemasCierre = [];
    try { await cerrarServidor(); } catch (error) { problemasCierre.push(`servidor: ${error.message}`); }

    let limpieza = null;
    if (ejecucion) {
      limpieza = await ejecucion.limpiar(); // nunca lanza; no se reintenta
      const correcta = limpiezaCorrecta(limpieza);
      registrar(correcta, 'limpieza de lo propio con ejecucion.limpiar()', `resultado: ${limpieza?.resultado}`);
      if (!correcta) describirPendientes(limpieza).forEach(l => console.log(`      ${l}`));
      try { await ejecucion.cerrar(); } catch (error) { problemasCierre.push(`conexión dedicada: ${error.message}`); }
    } else {
      registrar(false, 'no hubo ejecución aislada (no se escribió nada en pansys_test)');
    }
    try { await sequelize.close(); } catch (error) { problemasCierre.push(`Sequelize: ${error.message}`); }
    problemasCierre.forEach(p => registrar(false, `cierre: ${p}`));

    const fallidas = resultados.filter(r => !r.ok).length;
    const codigo = fallidas === 0 && limpiezaCorrecta(limpieza) ? 0 : 1;
    console.log(`\n${resultados.length - fallidas}/${resultados.length} pruebas correctas`);
    if (codigo !== 0 && ejecucion) console.log(`runId de esta ejecución: ${ejecucion.runId}`);
    process.exit(codigo);
  });
