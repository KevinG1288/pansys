// Pruebas de integración de R-b (restablecimiento de contraseña) contra MySQL real en pansys_test:
// tablas y restricciones del SQL 005, transacciones, endpoints públicos y asistido, estados del
// enlace, límites, revocación de sesiones, invalidaciones y aislamiento por panadería.
//
// Aislamiento (pruebas/aislamiento.js): SOLO pansys_test, con el bloqueo de suite durante toda la
// ejecución. Todas las cuentas son temporales de esta ejecución (correo
// "prueba.restablecimiento.<runId>.<etiqueta>@pansys.test") y las panaderías A y B también. Nunca usa
// ni modifica las cuentas de la semilla ni otras cuentas. Los enlaces y eventos que crea la
// aplicación pertenecen a cuentas propias; ejecucion.limpiar() los retira con todo lo demás (una
// vez, sin reintentos).
//
// Correo: no debe salir del proceso. Barreras de la suite:
//  1. PANSYS_CORREO_MODO=json con NODE_ENV=test: la aplicación solo crea un jsonTransport (sin red).
//  2. Segunda barrera: nodemailer.createTransport se sustituye, antes de cargar la aplicación, por un
//     jsonTransport que guarda los mensajes en memoria (de ahí se leen los tokens).
//  3. Red: solo se permiten conexiones por net y tls a una lista de destinos (MySQL en DB_HOST:3306 y,
//     una vez comprobado, el servidor de pruebas en 127.0.0.1:<puerto>). Los puertos 25, 465, 587,
//     1025 y 2525 nunca se permiten. fetch, WebSocket y dgram quedan desactivados (fetch/undici no
//     pasa por net); las peticiones de la suite usan http.request, que no sigue redirecciones. Unos
//     controles negativos hacia 127.0.0.1:9, antes de conectar a MySQL, demuestran el bloqueo.
//  4. Las consultas DNS por la API pública de dns se interceptan: solo se permite resolver "localhost"
//     (host de MySQL) hacia el bucle local; cualquier otro intento se bloquea y hace fallar la suite.
// El servidor de pruebas escucha solo en 127.0.0.1 (sin dirección, listen usaría todas las interfaces).
// ALCANCE: las barreras 3 y 4 actúan solo sobre las llamadas que pasan por los módulos net, tls, dgram
// y dns y por los globales fetch y WebSocket de ESTE proceso de Node. NO equivalen a un cortafuegos
// del sistema operativo: no cubren módulos nativos que resuelvan o conecten por su cuenta, procesos
// hijos ni otros procesos del equipo.
// La configuración de R-b solo existe en este proceso y es ficticia (https://pansys.invalid); las
// variables PANSYS_SMTP_* que pudiera traer el .env se eliminan del proceso.
//
// Escrituras solo de prueba (autorizadas), por Sequelize tras comprobar SELECT DATABASE() y el bloqueo:
//  - 3 sondas que DEBEN fallar (CHECK 3819, FK 1452 o 1216 con fk_evento_usuario verificada, UNIQUE 1062);
//  - UPDATE de envejecimiento de enlaces propios (createdAt, expira_en y enviado_en desplazados
//    hacia atrás), por id y cuenta propia, para probar la caducidad y la recuperación de reservas.
//
// Límites en memoria del servidor (compartidos por todas las peticiones, que salen de la misma IP):
// el orden de los bloques respeta los cupos (5 solicitudes públicas y 5 fallos de token por IP).
// Las contraseñas de las administradoras temporales se fijan con el propio flujo de R-b (no hay
// otra vía sin escrituras directas): la primera con la solicitud pública, las demás asistidas.
//
// Uso (desde backend/, PowerShell), con la demo detenida y una foto antes y otra después:
//   $env:DB_NAME = 'pansys_test'
//   node pruebas/restablecimiento.pruebas.js --confirmar-pansys-test
// Código de salida 0 solo si todas las pruebas pasan y la limpieza es correcta.

// ---------- Barreras previas a cualquier carga o conexión ----------
if (!process.argv.slice(2).includes('--confirmar-pansys-test')) {
  console.error('Suite de restablecimiento cancelada: falta --confirmar-pansys-test. No se ha conectado nada ni escrito nada.');
  process.exit(1);
}
if (process.env.DB_NAME !== 'pansys_test') {
  console.error('Suite de restablecimiento cancelada: DB_NAME debe fijarse en la terminal exactamente como pansys_test. No se ha conectado nada ni escrito nada.');
  process.exit(1);
}
const opcionesProhibidas = () => ['PANSYS_MODO_DEMO', 'PANSYS_SERVIR_FRONTEND'].filter(v => process.env[v] !== undefined);
if (opcionesProhibidas().length) {
  console.error(`Suite de restablecimiento cancelada: ${opcionesProhibidas().join(', ')} está definida. No se ha conectado nada ni escrito nada.`);
  process.exit(1);
}
// NODE_ENV=test (lo exige el modo json del correo). Si la terminal trae otro valor, no se sobrescribe:
// la suite se cancela.
if (process.env.NODE_ENV !== undefined && process.env.NODE_ENV !== 'test') {
  console.error('Suite de restablecimiento cancelada: NODE_ENV está definida con un valor distinto de test. No se ha conectado nada ni escrito nada.');
  process.exit(1);
}
process.env.NODE_ENV = 'test';
process.env.PORT = '0';
require('dotenv').config({ quiet: true }); // no sobrescribe DB_NAME, PORT ni NODE_ENV
if (opcionesProhibidas().length || process.env.DB_NAME !== 'pansys_test' || process.env.NODE_ENV !== 'test') {
  console.error('Suite de restablecimiento cancelada tras leer el .env. No se ha conectado nada ni escrito nada.');
  process.exit(1);
}
// Configuración ficticia de R-b, solo en este proceso: correo en modo json (sin red). Se eliminan las
// variables de correo que pudiera traer el .env (PANSYS_SMTP_SOLO_LOCAL haría rechazar la
// configuración y ningún SMTP debe quedar configurado en el proceso).
for (const variable of ['PANSYS_SMTP_HOST', 'PANSYS_SMTP_PUERTO', 'PANSYS_SMTP_TLS', 'PANSYS_SMTP_USUARIO', 'PANSYS_SMTP_CONTRASENA',
  'PANSYS_SMTP_SOLO_LOCAL', 'PANSYS_PERMITIR_CORREO_JSON', 'PANSYS_PERMITIR_HTTP_LOCAL']) {
  delete process.env[variable];
}
Object.assign(process.env, {
  PANSYS_URL_PUBLICA: 'https://pansys.invalid',
  PANSYS_CORREO_MODO: 'json',
  PANSYS_CORREO_REMITENTE: 'no-responder@pansys.invalid'
});

// Toda la salida del proceso, para comprobar al final que no contiene datos sensibles
const salida = [];
for (const flujo of [process.stdout, process.stderr]) {
  const escribir = flujo.write.bind(flujo);
  flujo.write = (fragmento, ...resto) => { salida.push(String(fragmento)); return escribir(fragmento, ...resto); };
}

// ---------- Red: solo destinos permitidos ----------
// Lista de destinos permitidos ("host|puerto"), no de puertos prohibidos. Al principio solo MySQL
// (se añade tras validar DB_HOST, más abajo); el servidor de pruebas se añade cuando se ha comprobado
// que escucha en 127.0.0.1. Los puertos de correo nunca se permiten y se siguen anotando en
// intentosSmtp. Todo intento rechazado lanza un error con código propio, se anota en redBloqueados
// y hace fallar la suite. Lo que llega al Socket.prototype.connect original (por donde pasa toda
// apertura TCP de net, http y tls) se anota en redAlcanzados.
const net = require('net');
const tls = require('tls');
const dgram = require('dgram');
const PUERTOS_SMTP = new Set([25, 465, 587, 1025, 2525]);
const CODIGO_BARRERA = 'PANSYS_RED_BLOQUEADA';
const errorRed = (mensaje) => Object.assign(new Error(mensaje), { code: CODIGO_BARRERA });
const intentosSmtp = [];
const redBloqueados = [];      // "<api> <host|puerto>" de cada intento rechazado
const redAlcanzados = [];      // "host|puerto" de cada apertura real
const destinosPermitidos = new Set();
const claveDestino = (host, puerto) => `${String(host).toLowerCase()}|${Number(puerto)}`;
const destinoDe = (args) => {
  let a = args;
  if (Array.isArray(a[0])) a = a[0]; // forma normalizada interna de net: [opciones, callback]
  const primero = a[0];
  if (primero && typeof primero === 'object') {
    if (primero.path) return { puerto: NaN, clave: 'ipc' };
    return { puerto: Number(primero.port), clave: claveDestino(primero.host ?? 'localhost', primero.port) };
  }
  if (typeof primero === 'string' && Number.isNaN(Number(primero))) return { puerto: NaN, clave: 'ipc' };
  return { puerto: Number(primero), clave: claveDestino(typeof a[1] === 'string' ? a[1] : 'localhost', primero) };
};
const proteger = (objeto, nombre, etiqueta, alPasar) => {
  const original = objeto[nombre];
  objeto[nombre] = function (...args) {
    const { puerto, clave } = destinoDe(args);
    if (PUERTOS_SMTP.has(puerto)) {
      intentosSmtp.push(puerto);
      redBloqueados.push(`${etiqueta} ${clave}`);
      throw errorRed(`Conexión SMTP bloqueada por la suite (puerto ${puerto})`);
    }
    if (!destinosPermitidos.has(clave)) {
      redBloqueados.push(`${etiqueta} ${clave}`);
      throw errorRed('Conexión bloqueada por la suite (destino no permitido)');
    }
    if (alPasar) alPasar(clave);
    return original.apply(this, args);
  };
};
proteger(net, 'connect', 'net.connect');
proteger(net, 'createConnection', 'net.createConnection');
proteger(net.Socket.prototype, 'connect', 'Socket.connect', clave => redAlcanzados.push(clave));
proteger(tls, 'connect', 'tls.connect');
// Mecanismos que la suite no necesita: su uso provoca un error explícito y hace fallar la suite
dgram.createSocket = () => { redBloqueados.push('dgram.createSocket'); throw errorRed('UDP bloqueado por la suite'); };
for (const nombre of ['fetch', 'WebSocket', 'EventSource']) {
  if (typeof globalThis[nombre] !== 'function') continue;
  const desactivado = function () {
    redBloqueados.push(`${nombre} (desactivado)`);
    const error = errorRed(`${nombre} desactivado por la suite`);
    if (nombre === 'fetch') return Promise.reject(error);
    throw error;
  };
  Object.defineProperty(globalThis, nombre, { value: desactivado, writable: false, configurable: false });
}
const http = require('http'); // después de las barreras

// ---------- DNS: consultas interceptadas por la suite (no es un cortafuegos) ----------
// En Node 22, net.connect no resuelve si el host es una IP literal y, si no, llama en ese momento a
// require('dns').lookup (a veces con all: true). La suite se conecta a su propio servidor por IP
// literal (127.0.0.1); la ÚNICA resolución que necesita es la del host de MySQL (DB_HOST)
// cuando es exactamente "localhost". Solo se permite esa, y solo si devuelve AL MENOS una dirección
// y TODAS son de bucle local. Además, net.Server.listen(puerto, host) pasa el host por dns.lookup
// aunque sea una IP literal: solo la IP exacta del servidor de pruebas (127.0.0.1) se responde aquí,
// sin consultar ningún DNS. Toda otra llamada a la API pública de dns (también por dns.promises y
// dns.Resolver) se bloquea y se anota (solo la API, nunca el nombre ni otros datos). Un intento
// bloqueado hace fallar la suite aunque quien lo hizo capturara el error: se comprueba al principio
// del finally y, como última garantía, en process.on('exit').
// Solo cubre las llamadas a la API de dns de ESTE proceso: no es un cortafuegos del sistema operativo
// (no alcanza módulos nativos, procesos hijos ni otros procesos).
const fs = require('fs');
const dns = require('dns');
const HOSTS_BASE_LOCALES = new Set(['localhost', '127.0.0.1', '::1']);
const hostBase = String(process.env.DB_HOST ?? '').toLowerCase();
if (!HOSTS_BASE_LOCALES.has(hostBase)) {
  console.error('Suite de restablecimiento cancelada: DB_HOST debe ser localhost, 127.0.0.1 o ::1 (pansys_test local). No se ha conectado nada ni escrito nada.');
  process.exit(1);
}
// MySQL: el host de DB_HOST (ya limitado a localhost, 127.0.0.1 o ::1) y el puerto 3306. Ni
// src/config/database.js ni la conexión dedicada de aislamiento.js fijan un puerto, y Sequelize y
// mysql2 usan entonces 3306; mysql2 abre la conexión con net.connect(3306, DB_HOST).
const PUERTO_MYSQL = 3306;
destinosPermitidos.add(claveDestino(hostBase, PUERTO_MYSQL));
const NOMBRE_DNS_PERMITIDO = hostBase === 'localhost' ? 'localhost' : null; // una IP literal no se resuelve
// IP del servidor de pruebas: única IP literal que dns.lookup responde (comparación exacta, sin variantes)
const IP_SERVIDOR_PRUEBAS = '127.0.0.1';
const dnsBloqueados = [];   // API de cada intento bloqueado
let dnsPermitidos = 0;      // resoluciones de "localhost" hacia el bucle local
let ipsLiteralesResueltas = 0; // respuestas directas para IP_SERVIDOR_PRUEBAS (sin DNS)
const esBucleLocal = (direccion) => typeof direccion === 'string'
  && (direccion === '::1' || /^127\./.test(direccion) || /^::ffff:127\./i.test(direccion));
const errorDns = () => Object.assign(new Error('Resolución DNS bloqueada por la suite'), { code: 'EAI_FAIL' });
const nombrePermitido = (nombre) => NOMBRE_DNS_PERMITIDO !== null && String(nombre ?? '').toLowerCase() === NOMBRE_DNS_PERMITIDO;
const direccionesDe = (resultado) => (Array.isArray(resultado) ? resultado.map(r => r?.address ?? r) : [resultado?.address ?? resultado]);
// Resolución local válida: AL MENOS una dirección y TODAS de bucle local ([].every(...) sería true)
const resultadoLocalValido = (resultado) => {
  const direcciones = direccionesDe(resultado);
  return direcciones.length > 0 && direcciones.every(esBucleLocal);
};

// Evidencia de los intentos bloqueados: se informa una sola vez por intento (al principio del finally
// y, para los que ocurran después o si el finally no llega a ejecutarse, en el evento exit)
let dnsInformados = 0;
const textoDns = (desde) => `Intentos DNS bloqueados por la suite: ${dnsBloqueados.slice(desde).join(', ')}`;
// Última garantía: con algún intento bloqueado, el proceso nunca termina con código 0. Todo es
// síncrono (fs.writeSync); el evento exit no admite trabajo asíncrono.
process.on('exit', () => {
  if (redBloqueados.length > 0) process.exitCode = 1; // lo mismo con un intento de red bloqueado
  if (dnsBloqueados.length === 0) return;
  process.exitCode = 1;
  if (dnsBloqueados.length > dnsInformados) {
    try { fs.writeSync(2, `\nFALLA ${textoDns(dnsInformados)} (registrado al salir; código de salida forzado a 1)\n`); } catch { /* sin salida disponible */ }
    dnsInformados = dnsBloqueados.length;
  }
});

const lookupOriginal = dns.lookup;
dns.lookup = function (nombre, opciones, callback) {
  if (typeof opciones === 'function') { callback = opciones; opciones = {}; }
  if (typeof callback !== 'function') throw new TypeError('dns.lookup sin callback');
  // IP literal del servidor de pruebas: se responde como lo hace Node con las IP literales (en el
  // siguiente tick, familia de la propia IP sea cual sea la pedida; con all: true, una lista), sin
  // llamar al lookup original ni consultar ningún DNS
  if (nombre === IP_SERVIDOR_PRUEBAS) {
    ipsLiteralesResueltas++;
    const todas = opciones !== null && typeof opciones === 'object' && opciones.all === true;
    process.nextTick(() => (todas
      ? callback(null, [{ address: IP_SERVIDOR_PRUEBAS, family: 4 }])
      : callback(null, IP_SERVIDOR_PRUEBAS, 4)));
    return {};
  }
  if (!nombrePermitido(nombre)) {
    dnsBloqueados.push('dns.lookup');
    process.nextTick(() => callback(errorDns()));
    return {};
  }
  return lookupOriginal.call(dns, nombre, opciones, (error, direccion, familia) => {
    if (error) return callback(error, direccion, familia);
    if (!resultadoLocalValido(direccion)) {
      dnsBloqueados.push('dns.lookup (resultado vacío o no local)');
      return callback(errorDns());
    }
    dnsPermitidos++;
    return callback(null, direccion, familia);
  });
};
const lookupPromesaOriginal = dns.promises.lookup;
dns.promises.lookup = async function (nombre, opciones) {
  if (!nombrePermitido(nombre)) {
    dnsBloqueados.push('dns.promises.lookup');
    throw errorDns();
  }
  const resultado = await lookupPromesaOriginal.call(dns.promises, nombre, opciones);
  if (!resultadoLocalValido(resultado)) {
    dnsBloqueados.push('dns.promises.lookup (resultado vacío o no local)');
    throw errorDns();
  }
  dnsPermitidos++;
  return resultado;
};
// Sin excepción: lookupService, resolve*, reverse (callbacks, promesas y Resolver)
const API_DNS_BLOQUEADAS = ['lookupService', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveCaa', 'resolveCname', 'resolveMx',
  'resolveNaptr', 'resolveNs', 'resolvePtr', 'resolveSoa', 'resolveSrv', 'resolveTlsa', 'resolveTxt', 'reverse'];
const bloquearDns = (objeto, metodo, etiqueta, conPromesa) => {
  if (typeof objeto?.[metodo] !== 'function') return;
  objeto[metodo] = function (...args) {
    dnsBloqueados.push(etiqueta);
    if (conPromesa) return Promise.reject(errorDns());
    const callback = args.reverse().find(a => typeof a === 'function');
    if (!callback) throw errorDns();
    process.nextTick(() => callback(errorDns()));
    return undefined;
  };
};
for (const metodo of API_DNS_BLOQUEADAS) {
  bloquearDns(dns, metodo, `dns.${metodo}`, false);
  bloquearDns(dns.Resolver?.prototype, metodo, `dns.Resolver.${metodo}`, false);
  bloquearDns(dns.promises, metodo, `dns.promises.${metodo}`, true);
  bloquearDns(dns.promises.Resolver?.prototype, metodo, `dns.promises.Resolver.${metodo}`, true);
}

// ---------- jsonTransport en lugar de SMTP ----------
const nodemailer = require('nodemailer');
const crearTransporteOriginal = nodemailer.createTransport;
const transportesPedidos = [];
const mensajes = [];          // { para, token, entregado }
const tokensVistos = [];
const retenciones = new Map(); // correo -> envío retenido hasta liberar()
const fallosSmtp = new Map();  // correo -> error simulado del servidor
const json = crearTransporteOriginal.call(nodemailer, { jsonTransport: true });
const transporteEspia = {
  sendMail: async (mensaje) => {
    const para = String(mensaje.to);
    const info = await json.sendMail(mensaje);
    const token = /#token=([A-Za-z0-9_-]{43})/.exec(JSON.parse(info.message).text ?? '')?.[1] ?? null;
    if (token) tokensVistos.push(token);
    if (fallosSmtp.has(para)) {
      mensajes.push({ para, token, entregado: false });
      throw fallosSmtp.get(para);
    }
    const retenido = retenciones.get(para);
    if (retenido) {
      retenido.token = token;
      retenido.llego();
      await retenido.promesa;
      retenciones.delete(para);
    }
    mensajes.push({ para, token, entregado: true });
    return info;
  }
};
nodemailer.createTransport = (opciones) => {
  transportesPedidos.push(opciones?.jsonTransport ? 'json' : 'smtp');
  return transporteEspia;
};

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { sequelize } = require('../src/models/index');
const { iniciarEjecucion, limpiezaCorrecta, describirPendientes } = require('./aislamiento');
const { construirLineaBase, validarLineaBase, idsParaSql, compararConLineaBase, describirDiferencias,
  errnoAceptado, ERRNO_FK_EVENTO_USUARIO, validarFkEventoUsuario } = require('./lineabase005');

const ID_INEXISTENTE = 2147483647;
const resultados = [];
const grupos = {};
let grupoActual = '--';
const grupo = (nombre) => { grupoActual = nombre; grupos[nombre] = grupos[nombre] ?? { ok: 0, fallas: 0 }; console.log(`\n== ${nombre}`); };
const registrar = (ok, descripcion, detalle = '') => {
  resultados.push({ ok, descripcion });
  if (grupos[grupoActual]) grupos[grupoActual][ok ? 'ok' : 'fallas']++;
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${descripcion}${!ok && detalle ? ` -> ${detalle}` : ''}`);
};
const igual = (descripcion, real, esperado) =>
  registrar(JSON.stringify(real) === JSON.stringify(esperado), descripcion, `obtenido ${JSON.stringify(real)}, esperado ${JSON.stringify(esperado)}`);

let ejecucion = null;
let lineaBase005 = null; // filas previas (legítimas e inertes) de las tablas del SQL 005: se conservan intactas
let servidor = null;
let PUERTO_SERVIDOR = null; // puerto del servidor de pruebas, solo tras confirmar su identidad
const TOKENS = {};
const CLAVES = {};
const cuentas = {};
let panaderiaA = null;
let panaderiaB = null;
let fallosToken = 0; // fallos de token por IP provocados a propósito (cupo: 5)

// Ninguna respuesta puede contener contraseñas, hashes ni tokens de enlace
let respuestasConSecretos = 0;
const conSecretos = (datos) => {
  const texto = JSON.stringify(datos ?? null);
  return /contrasena"\s*:/.test(texto) || /\$2[aby]\$/.test(texto) || /[0-9a-f]{64}/.test(texto) || tokensVistos.some(t => texto.includes(t));
};

// ---------- Peticiones al servidor de pruebas (http.request, solo 127.0.0.1) ----------
// http.request pasa por la barrera de net y no sigue redirecciones: un 3xx se devuelve tal cual.
const HOST_PRUEBAS = IP_SERVIDOR_PRUEBAS; // la misma IP que responde el interceptor DNS
const LIMITE_RESPUESTA = 1024 * 1024; // bytes
const LIMITE_TIEMPO = 60000;          // ms: algunos envíos se retienen a propósito varios segundos
const peticionLocal = (puerto, metodo, ruta, headers, body) => new Promise((resolver, rechazar) => {
  if (typeof ruta !== 'string' || !ruta.startsWith('/') || ruta.startsWith('//')) throw new Error('Ruta de prueba no válida');
  const cuerpo = body === undefined ? null : Buffer.from(JSON.stringify(body));
  const peticion = http.request({
    host: HOST_PRUEBAS, port: puerto, path: ruta, method: metodo, agent: false,
    headers: { ...headers, 'Content-Length': cuerpo ? cuerpo.length : 0 }
  }, (respuesta) => {
    const trozos = [];
    let tamano = 0;
    respuesta.on('data', (trozo) => {
      tamano += trozo.length;
      if (tamano > LIMITE_RESPUESTA) { peticion.destroy(new Error('respuesta del servidor de pruebas demasiado grande')); return; }
      trozos.push(trozo);
    });
    respuesta.on('end', () => {
      let datos = null;
      try { datos = JSON.parse(Buffer.concat(trozos).toString('utf8')); } catch { /* sin cuerpo */ }
      resolver({ status: respuesta.statusCode, datos, retryAfter: respuesta.headers['retry-after'] ?? null });
    });
    respuesta.on('error', rechazar);
  });
  peticion.setTimeout(LIMITE_TIEMPO, () => peticion.destroy(new Error(`el servidor de pruebas no respondió en ${LIMITE_TIEMPO / 1000} s`)));
  peticion.on('error', rechazar);
  peticion.end(cuerpo ?? undefined);
});

const pedir = async (metodo, ruta, usuario, body) => {
  if (!PUERTO_SERVIDOR) throw new Error('No se envían peticiones: la identidad del servidor no está confirmada');
  const headers = { 'Content-Type': 'application/json' };
  if (usuario !== null) {
    if (!TOKENS[usuario]) throw new Error(`No se envían peticiones: "${usuario}" no es un token de esta ejecución`);
    headers.Authorization = `Bearer ${TOKENS[usuario]}`;
  }
  const r = await peticionLocal(PUERTO_SERVIDOR, metodo, ruta, headers, body);
  if (conSecretos(r.datos)) respuestasConSecretos++;
  return r;
};
const esperar = async (descripcion, status, metodo, ruta, usuario, body) => {
  const r = await pedir(metodo, ruta, usuario, body);
  registrar(r.status === status, descripcion, `HTTP ${r.status}: ${JSON.stringify(r.datos)}`);
  return r;
};

// ---------- Lecturas, siempre limitadas a las cuentas propias ----------
const propias = () => (ejecucion.ids('usuarios').length ? ejecucion.ids('usuarios') : [0]);
const consulta = async (sql, replacements) => (await sequelize.query(sql, { replacements }))[0];
// Filas COMPLETAS de las dos tablas del SQL 005 (todas las columnas) para la línea base (pruebas/lineabase005.js)
const capturarTablas005 = async () => ({
  restablecimientos: await consulta('SELECT * FROM pansys_test.restablecimientos_contrasena ORDER BY id'),
  eventos: await consulta('SELECT * FROM pansys_test.eventos_seguridad ORDER BY id')
});
const enlacesDe = async (etiqueta) => (await consulta(
  'SELECT id, estado, motivo, origen, solicitado_por, intentos_fallidos FROM pansys_test.restablecimientos_contrasena WHERE usuario_id = ? AND usuario_id IN (?) ORDER BY id',
  [cuentas[etiqueta], propias()])).map(e => ({ ...e, intentos_fallidos: Number(e.intentos_fallidos) }));
const estadosDe = async (etiqueta) => (await enlacesDe(etiqueta)).map(e => (e.motivo ? `${e.estado}/${e.motivo}` : e.estado));
const eventosDe = async (etiqueta) => consulta(
  'SELECT tipo, actor_id, panaderia_id, restablecimiento_id, detalle FROM pansys_test.eventos_seguridad WHERE usuario_id = ? AND usuario_id IN (?) ORDER BY id',
  [cuentas[etiqueta], propias()]);
const versionDe = async (etiqueta) => Number((await consulta('SELECT version_sesion AS v FROM pansys_test.usuarios WHERE id = ? AND id IN (?)', [cuentas[etiqueta], propias()]))[0]?.v);

// ---------- Escrituras solo de prueba (autorizadas) ----------
const SENTENCIA_PRUEBA = /^(INSERT INTO|UPDATE) pansys_test\.(restablecimientos_contrasena|eventos_seguridad) /;
const escrituraDePrueba = async (sql, replacements) => {
  if (!SENTENCIA_PRUEBA.test(sql)) throw new Error(`Escritura de prueba no permitida: ${sql.slice(0, 60)}`);
  const [[{ base }]] = await sequelize.query('SELECT DATABASE() AS base');
  if (base !== 'pansys_test') throw new Error(`Base "${base}": no se escribe`);
  await ejecucion.exigirBloqueo();
  return sequelize.query(sql, { replacements });
};
// errnoEsperado: código exacto (número) o lista explícita de códigos admitidos (ver lineabase005.errnoAceptado).
// antesDeAceptar (opcional): comprobación de solo lectura que debe devolver [] para dar por válida la sonda.
const sonda = async (descripcion, sql, replacements, errnoEsperado, { antesDeAceptar } = {}) => {
  try {
    await escrituraDePrueba(sql, replacements);
    registrar(false, descripcion, 'la escritura NO falló');
  } catch (error) {
    const errno = error?.parent?.errno ?? error?.original?.errno ?? null;
    let ok = errnoAceptado(errno, errnoEsperado);
    let detalle = `errno ${errno}`;
    if (ok && antesDeAceptar) {
      const errores = await antesDeAceptar();
      if (errores.length) { ok = false; detalle += `; ${errores.join('; ')}`; }
    }
    registrar(ok, descripcion, detalle);
  }
};
// Estructura real de fk_evento_usuario (solo lectura en information_schema)
const comprobarFkEventoUsuario = async () => validarFkEventoUsuario(
  await consulta("SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_SCHEMA, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE CONSTRAINT_SCHEMA = 'pansys_test' AND CONSTRAINT_NAME = 'fk_evento_usuario'"),
  await consulta("SELECT CONSTRAINT_SCHEMA, TABLE_NAME, REFERENCED_TABLE_NAME FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = 'pansys_test' AND CONSTRAINT_NAME = 'fk_evento_usuario'"));
// Desplaza hacia atrás las fechas de un enlace propio (por id y cuenta propia): exactamente 1 fila
const envejecer = async (enlaceId, etiqueta, segundos) => {
  const [r] = await escrituraDePrueba(
    'UPDATE pansys_test.restablecimientos_contrasena SET createdAt = DATE_SUB(createdAt, INTERVAL ? SECOND), ' +
    'expira_en = DATE_SUB(expira_en, INTERVAL ? SECOND), enviado_en = IF(enviado_en IS NULL, NULL, DATE_SUB(enviado_en, INTERVAL ? SECOND)) ' +
    'WHERE id = ? AND usuario_id = ? AND usuario_id IN (?)',
    [segundos, segundos, segundos, enlaceId, cuentas[etiqueta], propias()]);
  if (r?.affectedRows !== 1) throw new Error(`El envejecimiento del enlace ${enlaceId} no afectó a exactamente 1 fila`);
};

// ---------- Correo en memoria ----------
const correoDe = (etiqueta) => ejecucion.correo(etiqueta);
const entregadosA = (email) => mensajes.filter(m => m.para === email && m.entregado).length;
const esperarToken = async (email, previos, ms = 8000) => {
  for (let i = 0; i < ms / 100; i++) {
    const entregados = mensajes.filter(m => m.para === email && m.entregado);
    if (entregados.length > previos) return entregados.at(-1).token;
    await new Promise(r => setTimeout(r, 100));
  }
  return null;
};
const retener = (email) => {
  const r = { token: null };
  r.promesa = new Promise(res => { r.liberar = res; });
  r.llegada = new Promise(res => { r.llego = res; });
  retenciones.set(email, r);
  return r;
};

// ---------- Cuentas ----------
const firmar = (id, etiqueta, rol, rolId, panaderiaId) => jwt.sign({
  id, email: correoDe(etiqueta), rol, rol_id: rolId, panaderia_id: panaderiaId, version_sesion: 0
}, process.env.JWT_SECRET, { expiresIn: '10m' });
const login = (etiqueta, contrasena = CLAVES[etiqueta]) => pedir('POST', '/api/auth/login', null, { email: correoDe(etiqueta), contrasena });
const iniciarSesion = async (etiqueta) => {
  const r = await login(etiqueta);
  if (r.status !== 200 || !r.datos?.token) throw new Error(`No se pudo iniciar sesión con la cuenta temporal ${etiqueta}: HTTP ${r.status}`);
  TOKENS[etiqueta] = r.datos.token;
};
const crearCuentaApi = async (etiqueta, contrasena, rolId) => {
  const r = await pedir('POST', '/api/auth/registrar', 'admin', { email: correoDe(etiqueta), contrasena, rol_id: rolId });
  if (r.status === 201 && Number.isSafeInteger(r.datos?.id)) {
    ejecucion.registrar('usuarios', r.datos.id);
    cuentas[etiqueta] = r.datos.id;
    CLAVES[etiqueta] = contrasena;
    return;
  }
  throw new Error(`No se pudo crear la cuenta temporal ${etiqueta}: HTTP ${r.status}`);
};
const asistida = (admin, etiqueta, contrasena = CLAVES[admin]) =>
  pedir('POST', `/api/usuarios/${cuentas[etiqueta] ?? etiqueta}/restablecimiento`, admin, { contrasena });
const confirmar = (token, contrasena) => pedir('POST', '/api/auth/restablecimiento/confirmar', null, { token, contrasena_nueva: contrasena });
const validar = (token) => pedir('POST', '/api/auth/restablecimiento/validar', null, { token });

// Fija la contraseña de una cuenta propia con el flujo de R-b (pública o asistida) e inicia sesión
const fijarClave = async (etiqueta, nueva, via) => {
  const email = correoDe(etiqueta);
  const previos = entregadosA(email);
  const r = via === 'publica'
    ? await pedir('POST', '/api/auth/restablecimiento/solicitar', null, { email })
    : await asistida(via, etiqueta);
  registrar(r.status === (via === 'publica' ? 202 : 200), `${etiqueta}: solicitud ${via === 'publica' ? 'pública' : `asistida por ${via}`} aceptada`, `HTTP ${r.status}`);
  const token = await esperarToken(email, previos);
  if (!token) throw new Error(`No llegó el correo de ${etiqueta}`);
  const c = await confirmar(token, nueva);
  registrar(c.status === 200, `${etiqueta}: contraseña fijada con el enlace`, `HTTP ${c.status}`);
  CLAVES[etiqueta] = nueva;
  await iniciarSesion(etiqueta);
};

// ---------- Servidor de la API (mismo ciclo de vida que usuarios.pruebas.js) ----------
const arrancarServidor = async () => {
  const app = require('../src/app');
  const listenOriginal = app.listen;
  // Solo en el bucle local IPv4: sin dirección, listen escucharía en todas las interfaces
  app.listen = function (puerto, ...resto) {
    servidor = listenOriginal.call(this, puerto, HOST_PRUEBAS, ...resto);
    return servidor;
  };
  app.get(`/api/__aislamiento/${ejecucion.runId}`, (req, res) => res.json({ runId: ejecucion.runId }));
  for (let i = 0; i < 40 && !servidor?.listening; i++) await new Promise(r => setTimeout(r, 250));
  if (!servidor?.listening) throw new Error('El servidor de pruebas no llegó a escuchar');
  // Dirección EFECTIVA, antes de cualquier petición: exactamente 127.0.0.1 (IPv4) y un puerto válido
  const direccion = servidor.address();
  if (!direccion || typeof direccion !== 'object' || direccion.address !== HOST_PRUEBAS
    || !(direccion.family === 'IPv4' || direccion.family === 4) || !Number.isInteger(direccion.port) || direccion.port <= 0) {
    throw new Error('El servidor de pruebas no escucha solo en 127.0.0.1: no se envía ninguna petición');
  }
  if (PUERTOS_SMTP.has(direccion.port) || direccion.port === PUERTO_MYSQL) {
    throw new Error(`El servidor de pruebas obtuvo un puerto reservado (${direccion.port}): no se envía ninguna petición`);
  }
  destinosPermitidos.add(claveDestino(HOST_PRUEBAS, direccion.port));
  let identidad = null;
  try {
    const r = await peticionLocal(direccion.port, 'GET', `/api/__aislamiento/${ejecucion.runId}`, {}, undefined);
    identidad = r.status === 200 ? r.datos : null;
  } catch { /* identidad no confirmada */ }
  if (identidad?.runId !== ejecucion.runId) throw new Error('El servidor no confirmó el runId de esta ejecución');
  PUERTO_SERVIDOR = direccion.port;
  console.log(`Servidor de pruebas propio confirmado en ${HOST_PRUEBAS}:${direccion.port}`);
};

// ---------- Controles negativos de la barrera de red (antes de cualquier conexión a MySQL) ----------
// Destino de bucle local NO permitido (127.0.0.1:9): aunque la barrera fallara, no saldría del equipo.
// Para atribuir el rechazo a la barrera y no a un puerto cerrado, cada control exige: el código
// propio de la barrera (un puerto cerrado daría ECONNREFUSED), exactamente un intento anotado con
// el destino esperado, ninguna llegada al Socket.prototype.connect original y ningún handle TCP nuevo.
const contarTcp = () => process.getActiveResourcesInfo().filter(t => t.startsWith('TCP')).length;
const control = (abrir, esperados) => new Promise((resolver) => {
  const antes = { bloqueados: redBloqueados.length, alcanzados: redAlcanzados.length, tcp: contarTcp() };
  let terminado = false;
  const fin = (forma, error) => {
    if (terminado) return;
    terminado = true;
    clearTimeout(reloj);
    const nuevos = redBloqueados.slice(antes.bloqueados);
    const llegaron = redAlcanzados.length - antes.alcanzados;
    const tcpNuevos = contarTcp() - antes.tcp;
    const correcto = error?.code === CODIGO_BARRERA && nuevos.length === 1 && esperados.includes(nuevos[0])
      && llegaron === 0 && tcpNuevos <= 0;
    resolver({ correcto, detalle: `${forma}; código ${error?.code ?? '-'}; anotado [${nuevos.join(', ')}]; connect original ${llegaron}; handles TCP nuevos ${tcpNuevos}` });
  };
  const reloj = setTimeout(() => fin('sin respuesta en 3 s'), 3000);
  try { abrir(error => fin('evento error', error), () => fin('conectado')); }
  catch (error) { fin('excepción síncrona', error); }
});
const controlesDeRed = async () => {
  grupo('0. Aislamiento de red: controles negativos (antes de conectar a MySQL)');
  const antes = redBloqueados.length;
  igual('antes de los controles: ninguna apertura TCP real ni intento bloqueado', [redAlcanzados.length, redBloqueados.length], [0, 0]);
  const destino = claveDestino(HOST_PRUEBAS, 9);
  const casos = [
    ['net.connect', (alError, alConectar) => {
      const s = net.connect({ host: HOST_PRUEBAS, port: 9 });
      s.on('error', alError); s.on('connect', () => { s.destroy(); alConectar(); });
    }, [`net.connect ${destino}`]],
    ['http.request', (alError, alConectar) => {
      const p = http.request({ host: HOST_PRUEBAS, port: 9, path: '/', method: 'GET', agent: false });
      p.on('error', alError); p.on('response', (r) => { r.resume(); alConectar(); }); p.end();
    }, [`net.createConnection ${destino}`, `Socket.connect ${destino}`]],
    ['tls.connect', (alError, alConectar) => {
      const s = tls.connect({ host: HOST_PRUEBAS, port: 9 });
      s.on('error', alError); s.on('secureConnect', () => { s.destroy(); alConectar(); });
    }, [`tls.connect ${destino}`]],
    ['fetch', (alError, alConectar) => {
      globalThis.fetch(`http://${HOST_PRUEBAS}:9/`).then(alConectar, alError);
    }, ['fetch (desactivado)']]
  ];
  let validos = 0;
  for (const [nombre, abrir, esperados] of casos) {
    const r = await control(abrir, esperados);
    registrar(r.correcto, `${nombre} hacia ${HOST_PRUEBAS}:9: rechazado por la propia barrera, sin abrir ningún socket`, r.detalle);
    if (r.correcto) validos++;
  }
  if (validos !== casos.length || redAlcanzados.length !== 0) throw new Error('Controles negativos de red no válidos: no se conecta a MySQL');
  redBloqueados.splice(antes); // los controles no cuentan como intentos reales
};
const cerrarServidor = () => new Promise((resolve, reject) => {
  if (!servidor?.listening) return resolve();
  const limite = setTimeout(() => reject(new Error('el servidor no se cerró en 5 s')), 5000);
  servidor.close((error) => { clearTimeout(limite); error ? reject(error) : resolve(); });
  servidor.closeAllConnections?.();
});

const main = async () => {
  await controlesDeRed();
  // ---------- Protección: pansys_test, SQL 005 presente y línea base de sus tablas (filas previas inertes) ----------
  await sequelize.authenticate();
  const [[{ base }]] = await sequelize.query('SELECT DATABASE() AS base');
  if (base !== 'pansys_test') throw new Error(`Base conectada "${base}": las pruebas solo se ejecutan sobre pansys_test`);
  const tablas005 = (await consulta("SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'pansys_test' AND TABLE_NAME IN ('restablecimientos_contrasena', 'eventos_seguridad')")).length;
  if (tablas005 !== 2) throw new Error('Falta el SQL 005 en pansys_test: no se ejecuta nada');
  // Filas previas (p. ej. un restablecimiento real probado a mano): se admiten SOLO si son inertes (enlaces
  // en estado terminal y caducados; expira_en está en UTC) y no pertenecen a cuentas de prueba. Se capturan
  // completas ANTES de cualquier escritura y al final deben seguir exactamente iguales. No se tocan nunca.
  const estadoPrevio = {
    restablecimientos: await consulta(`SELECT r.id, r.estado, (r.expira_en < UTC_TIMESTAMP()) AS caducado,
      EXISTS (SELECT 1 FROM pansys_test.usuarios u WHERE u.id IN (r.usuario_id, r.solicitado_por) AND u.email LIKE 'prueba.%') AS cuenta_prueba
      FROM pansys_test.restablecimientos_contrasena r ORDER BY r.id`),
    eventos: await consulta(`SELECT e.id, EXISTS (SELECT 1 FROM pansys_test.usuarios u WHERE u.id IN (e.usuario_id, e.actor_id) AND u.email LIKE 'prueba.%') AS cuenta_prueba
      FROM pansys_test.eventos_seguridad e ORDER BY e.id`)
  };
  const erroresLineaBase = validarLineaBase(estadoPrevio);
  if (erroresLineaBase.length) throw new Error(`Las tablas del SQL 005 tienen filas previas no inertes o de pruebas (${erroresLineaBase.join('; ')}): no se escribe nada`);
  lineaBase005 = construirLineaBase(await capturarTablas005());
  const previasN = { r: Object.keys(lineaBase005.restablecimientos).length, e: Object.keys(lineaBase005.eventos).length };
  if (previasN.r !== estadoPrevio.restablecimientos.length || previasN.e !== estadoPrevio.eventos.length) {
    throw new Error('Las tablas del SQL 005 cambiaron mientras se capturaba la línea base: no se escribe nada');
  }
  console.log(`      línea base del SQL 005: ${previasN.r} enlaces y ${previasN.e} eventos previos, inertes; se conservarán sin cambios`);

  ejecucion = await iniciarEjecucion({ suite: 'restablecimiento', sequelize });
  console.log(`      runId de esta ejecución: ${ejecucion.runId} (filas marcadas con "prueba.restablecimiento.${ejecucion.runId}." y "PRUEBA ${ejecucion.runId}")`);

  // Administradora principal: propietaria de A y B y asignada a A
  cuentas.admin = await ejecucion.crearCuenta({ etiqueta: 'admin', rol: 'administrador', activa: true });
  panaderiaA = await ejecucion.crearPanaderia({ etiqueta: 'A', propietariaId: cuentas.admin });
  panaderiaB = await ejecucion.crearPanaderia({ etiqueta: 'B', propietariaId: cuentas.admin });
  await ejecucion.asignarPanaderia({ cuentaId: cuentas.admin, panaderiaId: panaderiaA });
  TOKENS.admin = firmar(cuentas.admin, 'admin', 'administrador', 1, panaderiaA);
  // Más administradoras de A (cupo del límite A: 5 reservas por administradora)
  for (const etiqueta of ['a2', 'a3', 'a4', 'a5']) {
    cuentas[etiqueta] = await ejecucion.crearCuenta({ etiqueta, rol: 'administrador', panaderiaId: panaderiaA, activa: true });
  }
  // Cuentas objetivo, una por bloque (los límites por cuenta no se mezclan entre bloques)
  for (const etiqueta of ['t2', 't6', 't7', 't8', 't9', 'tb1', 'ta', 't10a', 't10b', 't12a', 't12b']) {
    cuentas[etiqueta] = await ejecucion.crearCuenta({ etiqueta, rol: 'panadero', panaderiaId: panaderiaA, activa: true });
  }
  cuentas.inactiva = await ejecucion.crearCuenta({ etiqueta: 'inactiva', rol: 'panadero', panaderiaId: panaderiaA, activa: false });
  cuentas.vecino = await ejecucion.crearCuenta({ etiqueta: 'vecino', rol: 'panadero', panaderiaId: panaderiaB, activa: true });

  await arrancarServidor();
  await ejecucion.exigirBloqueo();
  // Cuentas con contraseña real, creadas por la API (antes de que cambie la versión de sesión de admin)
  await crearCuentaApi('propia', 'Propia12345', 2);
  await crearCuentaApi('t10c', 'Inicial12345', 3);

  // ================= 1. Esquema real =================
  grupo('1. Esquema real del SQL 005');
  const checks = await consulta("SELECT TABLE_NAME AS t, CONSTRAINT_NAME AS c, ENFORCED AS e FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = 'pansys_test' AND CONSTRAINT_TYPE = 'CHECK' AND TABLE_NAME IN ('restablecimientos_contrasena', 'eventos_seguridad') ORDER BY t, c");
  igual('7 CHECK en restablecimientos_contrasena y 1 en eventos_seguridad, todos aplicados',
    [checks.filter(c => c.t === 'restablecimientos_contrasena').length, checks.filter(c => c.t === 'eventos_seguridad').length, checks.every(c => c.e === 'YES')], [7, 1, true]);
  const fks = await consulta("SELECT TABLE_NAME AS t, CONSTRAINT_NAME AS c, UPDATE_RULE AS u, DELETE_RULE AS d FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = 'pansys_test' AND TABLE_NAME IN ('restablecimientos_contrasena', 'eventos_seguridad') ORDER BY t, c");
  igual('5 claves foráneas, todas RESTRICT/RESTRICT', [fks.length, fks.every(f => f.u === 'RESTRICT' && f.d === 'RESTRICT')], [5, true]);
  const unicos = (await consulta("SELECT DISTINCT INDEX_NAME AS i FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = 'pansys_test' AND TABLE_NAME = 'restablecimientos_contrasena' AND NON_UNIQUE = 0 ORDER BY i")).map(f => f.i);
  igual('UNIQUE de PRIMARY, token_hash, un activo y un enviando por cuenta', unicos, ['PRIMARY', 'uq_rest_activo_por_cuenta', 'uq_rest_enviando_por_cuenta', 'uq_rest_token_hash']);
  // Nombres exactos, sin coincidencias parciales (LIKE '%ip%' coincidiría con "tipo"): la tabla tiene
  // exactamente sus 8 columnas y ninguna contiene, como palabra completa separada por "_", un término
  // sensible (así se detectaría también una columna nueva como ip_origen o token_hash)
  const columnasEventos = (await consulta("SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'pansys_test' AND TABLE_NAME = 'eventos_seguridad' ORDER BY ORDINAL_POSITION")).map(f => f.c);
  igual('eventos_seguridad tiene exactamente sus 8 columnas', columnasEventos,
    ['id', 'tipo', 'usuario_id', 'panaderia_id', 'actor_id', 'restablecimiento_id', 'detalle', 'createdAt']);
  const TERMINOS_SENSIBLES = ['ip', 'token', 'hash', 'contrasena', 'password', 'secreto', 'secret'];
  igual('eventos_seguridad no tiene columnas de IP, token, hash, contraseña ni secreto (palabras completas)',
    columnasEventos.filter(c => c.toLowerCase().split('_').some(p => TERMINOS_SENSIBLES.includes(p))), []);

  // ================= 2. Restricciones reales (sondas que deben fallar) =================
  grupo('2. Restricciones reales (sondas que deben fallar)');
  await sonda('CHECK: enlace «activo» sin enviado_en -> 3819',
    "INSERT INTO pansys_test.restablecimientos_contrasena (usuario_id, origen, solicitado_por, token_hash, estado, expira_en, createdAt, updatedAt) VALUES (?, 'propio', NULL, SHA2(?, 256), 'activo', DATE_ADD(UTC_TIMESTAMP(), INTERVAL 30 MINUTE), UTC_TIMESTAMP(), UTC_TIMESTAMP())",
    [cuentas.t2, `${ejecucion.runId} sonda check`], 3819);
  const inexistente = Number((await consulta('SELECT COUNT(*) AS n FROM pansys_test.usuarios WHERE id = ?', [ID_INEXISTENTE]))[0].n);
  if (inexistente !== 0) throw new Error(`El id ${ID_INEXISTENTE} existe en usuarios: no se envía la sonda`);
  // 1452 (con detalle) o 1216 (genérico: depende de los privilegios de la sesión sobre la tabla padre; la
  // cuenta limitada de integración recibe 1216). Solo esos dos, y solo si fk_evento_usuario es la esperada.
  await sonda('FK: evento de una cuenta inexistente -> 1452 o 1216 (fk_evento_usuario)',
    "INSERT INTO pansys_test.eventos_seguridad (tipo, usuario_id, panaderia_id, actor_id, restablecimiento_id, detalle, createdAt) VALUES ('email_cambiado', ?, NULL, NULL, NULL, NULL, UTC_TIMESTAMP())",
    [ID_INEXISTENTE], ERRNO_FK_EVENTO_USUARIO, { antesDeAceptar: comprobarFkEventoUsuario });
  igual('las sondas no dejaron filas', [(await enlacesDe('t2')).length,
    Number((await consulta('SELECT COUNT(*) AS n FROM pansys_test.eventos_seguridad WHERE usuario_id = ?', [ID_INEXISTENTE]))[0].n)], [0, 0]);

  // ================= Contraseñas de las administradoras (con el propio flujo) =================
  grupo('Preparación: contraseñas de las administradoras con el flujo de R-b');
  await fijarClave('admin', 'AdminNueva123', 'publica');            // solicitud pública 1 de 5
  for (const [etiqueta, clave] of [['a2', 'Admin2Nueva123'], ['a3', 'Admin3Nueva123'], ['a4', 'Admin4Nueva123'], ['a5', 'Admin5Nueva123']]) {
    await fijarClave(etiqueta, clave, 'admin');                     // reservas de admin: 4 de 5
  }

  // ================= 3. Solicitud pública =================
  grupo('3. Solicitud pública: misma respuesta exista o no la cuenta');
  await iniciarSesion('propia');
  TOKENS.propiaAnterior = TOKENS.propia;                            // sesión previa al restablecimiento (grupo 5)
  const previosPropia = entregadosA(correoDe('propia'));
  const rExiste = await pedir('POST', '/api/auth/restablecimiento/solicitar', null, { email: correoDe('propia') });           // 2 de 5
  const rNoExiste = await pedir('POST', '/api/auth/restablecimiento/solicitar', null, { email: correoDe('noexiste') });      // 3 de 5
  const rInactiva = await pedir('POST', '/api/auth/restablecimiento/solicitar', null, { email: correoDe('inactiva') });      // 4 de 5
  igual('cuenta activa, correo inexistente y cuenta desactivada -> el mismo 202 y el mismo cuerpo',
    [rExiste.status, rNoExiste.status, rInactiva.status, JSON.stringify(rExiste.datos) === JSON.stringify(rNoExiste.datos) && JSON.stringify(rNoExiste.datos) === JSON.stringify(rInactiva.datos)],
    [202, 202, 202, true]);
  await esperar('formato de correo no válido -> 400', 400, 'POST', '/api/auth/restablecimiento/solicitar', null, { email: 'no-es-un-correo' });
  const tokenPropia = await esperarToken(correoDe('propia'), previosPropia);
  await new Promise(r => setTimeout(r, 1500)); // el trabajo de las otras dos solicitudes ya terminó
  igual('solo la cuenta activa recibe correo; la desactivada no tiene enlaces ni eventos',
    [Boolean(tokenPropia), mensajes.filter(m => m.para === correoDe('noexiste') || m.para === correoDe('inactiva')).length, (await enlacesDe('inactiva')).length, (await eventosDe('inactiva')).length],
    [true, 0, 0, 0]);
  const filaPropia = (await enlacesDe('propia'))[0];
  igual('enlace propio: activo, origen propio y sin solicitante', [filaPropia?.estado, filaPropia?.origen, filaPropia?.solicitado_por], ['activo', 'propio', null]);
  const hashGuardado = (await consulta('SELECT token_hash AS h FROM pansys_test.restablecimientos_contrasena WHERE id = ? AND usuario_id IN (?)', [filaPropia?.id ?? 0, propias()]))[0]?.h;
  igual('la base guarda el SHA-256 del token (nunca el token)', hashGuardado === crypto.createHash('sha256').update(tokenPropia ?? '').digest('hex'), true);

  // ================= 4. Enlace activo y de un solo uso =================
  grupo('4. Enlace activo y de un solo uso');
  const v = await esperar('validar el enlace -> 200', 200, 'POST', '/api/auth/restablecimiento/validar', null, { token: tokenPropia });
  igual('estado activo', v.datos, { estado: 'activo' });
  const usado = await esperar('confirmar con una contraseña nueva -> 200', 200, 'POST', '/api/auth/restablecimiento/confirmar', null, { token: tokenPropia, contrasena_nueva: 'PropiaNueva123' });
  igual('la respuesta no inicia sesión (sin token)', 'token' in (usado.datos ?? {}), false);
  igual('en la base: enlace usado y version_sesion 1', [await estadosDe('propia'), await versionDe('propia')], [['usado'], 1]);
  await esperar('reutilizar el enlace -> 400', 400, 'POST', '/api/auth/restablecimiento/confirmar', null, { token: tokenPropia, contrasena_nueva: 'OtraClave123' });
  fallosToken++;
  igual('eventos: solicitado (propio), activado y usado', (await eventosDe('propia')).map(e => e.tipo),
    ['restablecimiento_propio_solicitado', 'restablecimiento_activado', 'restablecimiento_usado']);

  // ================= 5. Revocación de sesiones =================
  grupo('5. Revocación de sesiones');
  await esperar('el JWT anterior al restablecimiento -> 401', 401, 'GET', '/api/inventario', 'propiaAnterior');
  await esperar('login con la contraseña anterior -> 401', 401, 'POST', '/api/auth/login', null, { email: correoDe('propia'), contrasena: 'Propia12345' });
  CLAVES.propia = 'PropiaNueva123';
  await esperar('login con la contraseña nueva -> 200', 200, 'POST', '/api/auth/login', null, { email: correoDe('propia'), contrasena: 'PropiaNueva123' });
  await iniciarSesion('propia');

  // ================= 7. Asistida y aislamiento por panadería =================
  grupo('7. Solicitud asistida y aislamiento por panadería');
  const ok7 = await esperar('admin para una cuenta activa de A -> 200', 200, 'POST', `/api/usuarios/${cuentas.t7}/restablecimiento`, 'admin', { contrasena: CLAVES.admin }); // reserva 5 de 5 de admin
  igual('enlace activo con origen administrador y solicitante', (await enlacesDe('t7')).map(e => [e.estado, e.origen, e.solicitado_por === cuentas.admin]), [['activo', 'administrador', true]]);
  igual('eventos: solicitado con actor admin y panadería A, y activado', (await eventosDe('t7')).map(e => [e.tipo, e.actor_id === cuentas.admin, e.panaderia_id === panaderiaA]),
    [['restablecimiento_solicitado', true, true], ['restablecimiento_activado', false, true]]);
  void ok7;
  await esperar('cuenta de la panadería B -> 404', 404, 'POST', `/api/usuarios/${cuentas.vecino}/restablecimiento`, 'a2', { contrasena: CLAVES.a2 });
  await esperar('la propia cuenta -> 403', 403, 'POST', `/api/usuarios/${cuentas.a2}/restablecimiento`, 'a2', { contrasena: CLAVES.a2 });
  await esperar('cuenta desactivada -> 409', 409, 'POST', `/api/usuarios/${cuentas.inactiva}/restablecimiento`, 'a2', { contrasena: CLAVES.a2 });
  await esperar('contraseña de la administradora errónea -> 400', 400, 'POST', `/api/usuarios/${cuentas.t6}/restablecimiento`, 'a2', { contrasena: 'Incorrecta123' });
  igual('evento reconfirmacion_fallida de la administradora (sin enlace)', (await eventosDe('a2')).filter(e => e.tipo === 'reconfirmacion_fallida').map(e => [e.actor_id === cuentas.a2, e.restablecimiento_id]), [[true, null]]);
  await esperar('un panadero -> 403', 403, 'POST', `/api/usuarios/${cuentas.t6}/restablecimiento`, 'propia', { contrasena: CLAVES.propia });
  await esperar('id no numérico -> 400', 400, 'POST', '/api/usuarios/abc/restablecimiento', 'a2', { contrasena: CLAVES.a2 });
  igual('los rechazos no crearon enlaces', [(await enlacesDe('vecino')).length, (await enlacesDe('inactiva')).length, (await enlacesDe('t6')).length], [0, 0, 0]);
  // Sonda UNIQUE (grupo 2): t7 ya tiene un enlace activo
  grupoActual = '2. Restricciones reales (sondas que deben fallar)';
  await sonda('UNIQUE: un segundo enlace «activo» para la misma cuenta -> 1062',
    "INSERT INTO pansys_test.restablecimientos_contrasena (usuario_id, origen, solicitado_por, token_hash, estado, expira_en, enviado_en, createdAt, updatedAt) VALUES (?, 'propio', NULL, SHA2(?, 256), 'activo', DATE_ADD(UTC_TIMESTAMP(), INTERVAL 30 MINUTE), UTC_TIMESTAMP(), UTC_TIMESTAMP(), UTC_TIMESTAMP())",
    [cuentas.t7, `${ejecucion.runId} sonda unique`], 1062);
  igual('la sonda UNIQUE no dejó filas', (await enlacesDe('t7')).length, 1);
  grupoActual = '7. Solicitud asistida y aislamiento por panadería';

  // ================= 6. Estado «enviando» =================
  grupo('6. Estado «enviando» (envío retenido)');
  const retenido = retener(correoDe('t6'));
  const enCurso = asistida('a2', 't6');                               // reserva 1 de 5 de a2
  await Promise.race([retenido.llegada, new Promise(r => setTimeout(r, 8000))]);
  igual('durante el envío la fila está «enviando»', await estadosDe('t6'), ['enviando']);
  const v202 = await validar(retenido.token);
  igual('validar -> 202 procesando', [v202.status, v202.datos], [202, { estado: 'procesando' }]);
  const c409 = await confirmar(retenido.token, 'NuevaClave123');
  igual('confirmar -> 409 PROCESANDO', [c409.status, c409.datos?.codigo], [409, 'PROCESANDO']);
  const otra = await asistida('a2', 't6');
  igual('otra solicitud para la cuenta -> 409', otra.status, 409);
  retenido.liberar();
  const fin6 = await enCurso;
  igual('al liberar el envío -> 200 y el enlace pasa a activo', [fin6.status, await estadosDe('t6')], [200, ['activo']]);

  // ================= 8. Fallo SMTP =================
  grupo('8. Fallo SMTP: el enlace anterior sigue válido');
  const previos8 = entregadosA(correoDe('t8'));
  await esperar('primer enlace -> 200', 200, 'POST', `/api/usuarios/${cuentas.t8}/restablecimiento`, 'a2', { contrasena: CLAVES.a2 }); // a2: 2 de 5
  const tokenAnterior8 = await esperarToken(correoDe('t8'), previos8);
  fallosSmtp.set(correoDe('t8'), Object.assign(new Error('550 rechazado (simulado)'), { code: 'EENVELOPE', responseCode: 550 }));
  await esperar('envío rechazado por el servidor -> 502', 502, 'POST', `/api/usuarios/${cuentas.t8}/restablecimiento`, 'a2', { contrasena: CLAVES.a2 }); // a2: 3 de 5
  fallosSmtp.delete(correoDe('t8'));
  igual('el nuevo queda envio_fallido/rechazado y el anterior sigue activo', await estadosDe('t8'), ['activo', 'envio_fallido/rechazado']);
  await esperar('el enlace anterior sigue siendo válido', 200, 'POST', '/api/auth/restablecimiento/validar', null, { token: tokenAnterior8 });

  // ================= 9. Sustitución =================
  grupo('9. Sustitución por un enlace nuevo');
  const previos9 = entregadosA(correoDe('t9'));
  await asistida('a2', 't9');                                          // a2: 4 de 5
  const primero9 = await esperarToken(correoDe('t9'), previos9);
  await asistida('a2', 't9');                                          // a2: 5 de 5
  const segundo9 = await esperarToken(correoDe('t9'), previos9 + 1);
  igual('el anterior queda invalidado/nuevo_enlace y el nuevo activo', await estadosDe('t9'), ['invalidado/nuevo_enlace', 'activo']);
  await esperar('el anterior ya no es válido -> 400', 400, 'POST', '/api/auth/restablecimiento/validar', null, { token: primero9 });
  fallosToken++;
  await esperar('el nuevo es válido -> 200', 200, 'POST', '/api/auth/restablecimiento/validar', null, { token: segundo9 });

  // ================= 11 (a). Límite por cuenta: 3 envíos aceptados por hora =================
  grupo('11. Límites');
  const b1 = [];
  for (let i = 0; i < 3; i++) b1.push((await asistida('a3', 'tb1')).status); // a3: 3 de 5
  const cuartoB1 = await asistida('a3', 'tb1');
  igual('por cuenta: 3 envíos aceptados y el 4.º -> 429 con Retry-After, sin crear fila',
    [b1, cuartoB1.status, Number(cuartoB1.retryAfter) > 0, (await enlacesDe('tb1')).length], [[200, 200, 200], 429, true, 3]);

  // ================= 10. Invalidaciones =================
  grupo('10. Invalidaciones en la misma transacción');
  await asistida('a3', 't10a');                                        // a3: 4 de 5
  await esperar('cambio de correo -> 200', 200, 'PATCH', `/api/usuarios/${cuentas.t10a}`, 'admin', { email: correoDe('t10anuevo') });
  igual('cambio de correo: enlace invalidado/email_cambiado y evento email_cambiado',
    [await estadosDe('t10a'), (await eventosDe('t10a')).some(e => e.tipo === 'email_cambiado' && e.actor_id === cuentas.admin)], [['invalidado/email_cambiado'], true]);
  await asistida('a3', 't10b');                                        // a3: 5 de 5
  await esperar('desactivar la cuenta -> 200', 200, 'PATCH', `/api/usuarios/${cuentas.t10b}/estado`, 'admin', { estado: false });
  igual('desactivación: enlace invalidado/cuenta_desactivada', await estadosDe('t10b'), ['invalidado/cuenta_desactivada']);
  await asistida('a5', 't10c');                                        // a5: 1 de 5
  await iniciarSesion('t10c');
  await esperar('cambio de contraseña desde Mi cuenta -> 200', 200, 'PATCH', '/api/auth/contrasena', 't10c', { contrasena_actual: CLAVES.t10c, contrasena_nueva: 'MiCuenta12345' });
  igual('Mi cuenta: enlace invalidado/contrasena_cambiada', await estadosDe('t10c'), ['invalidado/contrasena_cambiada']);

  // ================= 12. Caducidad y reservas huérfanas =================
  grupo('12. Caducidad y reservas huérfanas');
  const previos12 = entregadosA(correoDe('t12a'));
  await asistida('a5', 't12a');                                        // a5: 2 de 5
  const token12 = await esperarToken(correoDe('t12a'), previos12);
  await envejecer((await enlacesDe('t12a'))[0].id, 't12a', 31 * 60);
  await esperar('enlace con más de 30 minutos: validar -> 400', 400, 'POST', '/api/auth/restablecimiento/validar', null, { token: token12 });
  fallosToken++;
  await esperar('enlace con más de 30 minutos: confirmar -> 400', 400, 'POST', '/api/auth/restablecimiento/confirmar', null, { token: token12, contrasena_nueva: 'NuevaClave123' });
  fallosToken++;
  igual('el enlace caducado no cambió la contraseña', await versionDe('t12a'), 0);

  const huerfano = retener(correoDe('t12b'));
  const primeraHuerfana = asistida('a5', 't12b');                      // a5: 3 de 5
  await Promise.race([huerfano.llegada, new Promise(r => setTimeout(r, 8000))]);
  await envejecer((await enlacesDe('t12b'))[0].id, 't12b', 61);
  retenciones.delete(correoDe('t12b'));                                // el envío nuevo no se retiene
  const recupera = await asistida('a5', 't12b');                       // a5: 4 de 5
  igual('la siguiente solicitud recupera la reserva vencida (proceso_interrumpido) y activa la nueva',
    [recupera.status, await estadosDe('t12b')], [200, ['envio_fallido/proceso_interrumpido', 'activo']]);
  huerfano.liberar();
  const finHuerfana = await primeraHuerfana;
  igual('el envío retenido termina sin activar nada (503) y el enlace nuevo sigue activo', [finHuerfana.status, await estadosDe('t12b')], [503, ['envio_fallido/proceso_interrumpido', 'activo']]);

  // ================= 11 (b). Límite A, solicitudes públicas por IP y fallos de token por IP =================
  grupoActual = '11. Límites';
  fallosSmtp.set(correoDe('ta'), Object.assign(new Error('sin conexión (simulado)'), { code: 'ESOCKET', command: 'CONN' }));
  const reservasA = [];
  for (let i = 0; i < 5; i++) reservasA.push((await asistida('a4', 'ta')).status);
  const sextaA = await asistida('a4', 'ta');
  fallosSmtp.delete(correoDe('ta'));
  igual('límite A: 5 reservas con el SMTP caído (502) y la 6.ª -> 429 con Retry-After, sin crear fila',
    [reservasA, sextaA.status, Number(sextaA.retryAfter) > 0, (await enlacesDe('ta')).length], [[502, 502, 502, 502, 502], 429, true, 5]);
  const quintaPublica = await pedir('POST', '/api/auth/restablecimiento/solicitar', null, { email: correoDe('noexiste2') }); // 5 de 5
  const sextaPublica = await pedir('POST', '/api/auth/restablecimiento/solicitar', null, { email: correoDe('noexiste3') });
  igual('solicitudes públicas por IP: la 5.ª -> 202 y la 6.ª -> 429 con Retry-After',
    [quintaPublica.status, sextaPublica.status, Number(sextaPublica.retryAfter) > 0], [202, 429, true]);
  const restantes = [];
  while (fallosToken < 5) { restantes.push((await confirmar(crypto.randomBytes(32).toString('base64url'), 'NuevaClave123')).status); fallosToken++; }
  const bloqueoIp = await validar(segundo9);
  igual(`fallos de token por IP: ${restantes.length} más hasta 5 (400) y después, incluso con un token válido -> 429 con Retry-After`,
    [restantes.every(s => s === 400), bloqueoIp.status, Number(bloqueoIp.retryAfter) > 0], [true, 429, true]);

  // ================= 13. Datos sensibles =================
  grupo('13. Datos sensibles');
  const eventos = await consulta('SELECT tipo, detalle FROM pansys_test.eventos_seguridad WHERE usuario_id IN (?)', [propias()]);
  const DETALLES = [null, 'nuevo_enlace', 'email_cambiado', 'cuenta_desactivada', 'contrasena_cambiada', 'intentos', 'emergencia_local',
    'sin_conexion', 'rechazado', 'tiempo_agotado', 'activacion_fallida', 'proceso_interrumpido'];
  igual('los eventos solo llevan detalles de la lista de motivos (sin tokens, hashes, IP ni contraseñas)',
    eventos.filter(e => !DETALLES.includes(e.detalle)).map(e => e.detalle), []);
  igual('ninguna respuesta de la API incluyó contraseñas, hashes ni tokens de enlace', respuestasConSecretos, 0);
  igual('la aplicación solo pidió transportes jsonTransport (modo json), interceptados por la suite, y no hubo ningún intento de conexión a puertos de correo',
    [transportesPedidos.length > 0, transportesPedidos.every(t => t === 'json'), intentosSmtp], [true, true, []]);
  igual('todos los mensajes salieron por el jsonTransport en memoria (ninguno por la red)', mensajes.length > 0, true);
  const aperturas = new Set(redAlcanzados);
  igual('aperturas TCP reales solo hacia destinos permitidos, y se vieron MySQL local y el servidor de pruebas',
    [redAlcanzados.filter(d => !destinosPermitidos.has(d)), aperturas.has(claveDestino(hostBase, PUERTO_MYSQL)), aperturas.has(claveDestino(HOST_PRUEBAS, PUERTO_SERVIDOR))],
    [[], true, true]);
};

main()
  .catch(error => registrar(false, 'Ejecución abortada', error.message))
  .finally(async () => {
    // PRIMERO, antes de cualquier operación que pueda lanzar: los intentos DNS bloqueados hasta aquí
    // (los posteriores, si los hubiera, los informa el evento exit)
    grupoActual = '13. Datos sensibles';
    igual(`ningún intento DNS bloqueado por los interceptores de la suite (resoluciones locales permitidas de "localhost": ${dnsPermitidos}; respuestas directas para ${IP_SERVIDOR_PRUEBAS}: ${ipsLiteralesResueltas})`, dnsBloqueados, []);
    dnsInformados = dnsBloqueados.length;
    const problemasCierre = [];
    // Ningún envío queda retenido ni hay trabajo en segundo plano pendiente antes de limpiar
    for (const r of retenciones.values()) r.liberar();
    if (ejecucion && PUERTO_SERVIDOR) {
      for (let i = 0; i < 50; i++) {
        const n = Number((await consulta("SELECT COUNT(*) AS n FROM pansys_test.restablecimientos_contrasena WHERE estado = 'enviando' AND usuario_id IN (?)", [propias()]).catch(() => [{ n: 0 }]))[0].n);
        if (n === 0) break;
        await new Promise(r => setTimeout(r, 200));
      }
    }
    try { await cerrarServidor(); } catch (error) { problemasCierre.push(`servidor: ${error.message}`); }

    let limpieza = null;
    if (ejecucion) {
      // Sin filas ajenas NUEVAS: toda fila de las tablas del SQL 005 que no sea de la línea base referencia
      // solo cuentas propias (las de la línea base son previas, inertes y se comparan aparte)
      grupo('Limpieza y filas residuales');
      try {
        const [{ n }] = await consulta(
          'SELECT (SELECT COUNT(*) FROM pansys_test.restablecimientos_contrasena WHERE id NOT IN (?) AND (usuario_id NOT IN (?) OR (solicitado_por IS NOT NULL AND solicitado_por NOT IN (?)))) + ' +
          '(SELECT COUNT(*) FROM pansys_test.eventos_seguridad WHERE id NOT IN (?) AND (usuario_id NOT IN (?) OR (actor_id IS NOT NULL AND actor_id NOT IN (?)))) AS n',
          [idsParaSql(lineaBase005, 'restablecimientos'), propias(), propias(), idsParaSql(lineaBase005, 'eventos'), propias(), propias()]);
        igual('antes de limpiar: ninguna fila nueva de las tablas del SQL 005 referencia cuentas ajenas', Number(n), 0);
      } catch (error) { registrar(false, 'comprobación de filas ajenas', error.message); }
      limpieza = await ejecucion.limpiar(); // nunca lanza; no se reintenta
      const correcta = limpiezaCorrecta(limpieza);
      registrar(correcta, 'limpieza de lo propio con ejecucion.limpiar()', `resultado: ${limpieza?.resultado}`);
      if (!correcta) describirPendientes(limpieza).forEach(l => console.log(`      ${l}`));
      if (correcta) {
        try {
          const ids = propias();
          const [r] = await consulta(
            'SELECT (SELECT COUNT(*) FROM pansys_test.usuarios WHERE id IN (?)) AS u, (SELECT COUNT(*) FROM pansys_test.panaderias WHERE id IN (?)) AS p',
            [ids, ejecucion.ids('panaderias').length ? ejecucion.ids('panaderias') : [0]]);
          igual('después: 0 cuentas y panaderías propias', [Number(r.u), Number(r.p)], [0, 0]);
          // Las tablas del SQL 005 contienen EXACTAMENTE la línea base: ni filas nuevas (propias sin limpiar o
          // ajenas), ni filas previas borradas o modificadas (huella SHA-256 de todas las columnas)
          const cmp = compararConLineaBase(lineaBase005, await capturarTablas005());
          igual('después: las tablas del SQL 005 coinciden exactamente con la línea base (sin filas añadidas, borradas ni modificadas)',
            cmp.ok ? 'idénticas' : describirDiferencias(cmp).join('; '), 'idénticas');
        } catch (error) { registrar(false, 'comprobación posterior a la limpieza', error.message); }
      }
      try { await ejecucion.cerrar(); } catch (error) { problemasCierre.push(`conexión dedicada: ${error.message}`); }
    } else {
      registrar(false, 'no hubo ejecución aislada (no se escribió nada en pansys_test)');
    }
    try { await sequelize.close(); } catch (error) { problemasCierre.push(`Sequelize: ${error.message}`); }
    problemasCierre.forEach(p => registrar(false, `cierre: ${p}`));

    // La salida del proceso no contiene tokens, sus hashes ni las contraseñas usadas
    const texto = salida.join('');
    const sensibles = [...tokensVistos, ...tokensVistos.map(t => crypto.createHash('sha256').update(t).digest('hex')), ...Object.values(CLAVES)];
    grupoActual = '13. Datos sensibles';
    igual('la salida completa del proceso no contiene tokens, hashes de token ni contraseñas', sensibles.filter(s => texto.includes(s)).length, 0);
    // Intentos DNS bloqueados DURANTE el finally (después de la comprobación inicial): también fallan
    if (dnsBloqueados.length > dnsInformados) {
      registrar(false, 'intentos DNS bloqueados durante el cierre', textoDns(dnsInformados));
      dnsInformados = dnsBloqueados.length;
    }
    // Después del cierre: ningún intento de red rechazado en toda la ejecución (aparte de los controles)
    igual('ningún intento de conexión bloqueado por la barrera de red (aparte de los controles negativos)', redBloqueados, []);

    console.log('\n== Resumen por grupo');
    for (const [nombre, g] of Object.entries(grupos)) console.log(`${g.fallas ? 'FALLA' : 'OK   '} ${nombre}: ${g.ok} OK, ${g.fallas} fallos`);
    const fallidas = resultados.filter(r => !r.ok).length;
    const codigo = fallidas === 0 && limpiezaCorrecta(limpieza) ? 0 : 1;
    console.log(`\n${resultados.length - fallidas}/${resultados.length} pruebas correctas`);
    if (codigo !== 0 && ejecucion) console.log(`runId de esta ejecución: ${ejecucion.runId}`);
    process.exit(codigo);
  });
