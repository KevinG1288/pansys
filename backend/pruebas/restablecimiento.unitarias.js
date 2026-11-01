// Pruebas unitarias de utils/tokens.js (tokens, hash y enlace de recuperación) y de
// utils/limitador.js (limitador de intentos en memoria). No usan la base de datos, el servidor,
// la red ni el reloj real: el limitador recibe un reloj simulado. Se pueden ejecutar en
// cualquier momento.
//
// Uso (desde backend/):  node pruebas/restablecimiento.unitarias.js

// Seguridad: como en el resto de suites unitarias, la conexión apunta a un host inexistente y
// toda conexión de red queda bloqueada. Estos módulos no deberían necesitar ninguna de las dos.
process.env.DB_HOST = 'base-inexistente.invalid';
process.env.DB_NAME = 'sin_base_pruebas_unitarias';
const net = require('net');
const tls = require('tls');
const redBloqueada = () => { throw new Error('Red bloqueada en las pruebas unitarias'); };
net.connect = net.createConnection = redBloqueada;
net.Socket.prototype.connect = redBloqueada;
tls.connect = redBloqueada;

// Ningún módulo puede crear temporizadores (no deben mantener vivo el proceso)
const temporizadoresCreados = [];
const temporizadoresOriginales = { setTimeout, setInterval, setImmediate };
global.setTimeout = (...a) => { temporizadoresCreados.push('setTimeout'); return temporizadoresOriginales.setTimeout(...a); };
global.setInterval = (...a) => { temporizadoresCreados.push('setInterval'); return temporizadoresOriginales.setInterval(...a); };
global.setImmediate = (...a) => { temporizadoresCreados.push('setImmediate'); return temporizadoresOriginales.setImmediate(...a); };

const crypto = require('crypto');
const modulosAntes = new Set(Object.keys(require.cache));
const tokens = require('../src/utils/tokens');
const { crearLimitador, LONGITUD_MAXIMA_CLAVE } = require('../src/utils/limitador');
const modulosCargados = Object.keys(require.cache).filter(m => !modulosAntes.has(m));

const resultados = [];
const igual = (descripcion, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  resultados.push(ok);
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${descripcion}${ok ? '' : ` -> obtenido ${JSON.stringify(real)}, esperado ${JSON.stringify(esperado)}`}`);
};
// Ejecuta fn y devuelve { nombre, mensaje } del error, o null si no lanza
const errorDe = (fn) => {
  try { fn(); return null; } catch (e) { return { nombre: e.name, mensaje: e.message }; }
};

// ---------- Independencia de los módulos ----------
console.log('\n== Independencia');
igual('solo se cargan los dos módulos: sin Express, Sequelize, mysql2, nodemailer ni dotenv',
  modulosCargados.map(m => m.split(/[\\/]/).slice(-2).join('/')).sort(), ['utils/limitador.js', 'utils/tokens.js']);

// ---------- generarToken ----------
console.log('\n== generarToken');
const token = tokens.generarToken();
igual('formato base64url de 43 caracteres', /^[A-Za-z0-9_-]{43}$/.test(token), true);
igual('decodifica a 32 bytes', Buffer.from(token, 'base64url').length, tokens.BYTES_TOKEN);
igual('BYTES_TOKEN = 32', tokens.BYTES_TOKEN, 32);
const lote = Array.from({ length: 200 }, () => tokens.generarToken());
igual('200 tokens sucesivos son todos distintos', new Set(lote).size, 200);
igual('todos tienen el formato válido', lote.every(tokens.esFormatoToken), true);
igual('usa crypto.randomBytes(32)', (() => {
  const original = crypto.randomBytes;
  const pedidos = [];
  crypto.randomBytes = (n) => { pedidos.push(n); return Buffer.alloc(n, 7); };
  try { return [tokens.generarToken(), pedidos]; } finally { crypto.randomBytes = original; }
})(), [Buffer.alloc(32, 7).toString('base64url'), [32]]);

// ---------- hashToken ----------
console.log('\n== hashToken');
const hash = tokens.hashToken(token);
igual('SHA-256 en hexadecimal de 64 caracteres', /^[0-9a-f]{64}$/.test(hash), true);
igual('estable: el mismo token da el mismo hash', tokens.hashToken(token), hash);
igual('coincide con un SHA-256 calculado aparte', hash, crypto.createHash('sha256').update(token, 'utf8').digest('hex'));
igual('tokens distintos dan hashes distintos', tokens.hashToken(lote[0]) === tokens.hashToken(lote[1]), false);
igual('el hash no contiene el token', hash.includes(token), false);
const tokenFalso = 'A'.repeat(42) + '=';
for (const [descripcion, valor] of [
  ['vacío', ''], ['corto', 'abc'], ['42 caracteres', 'A'.repeat(42)], ['44 caracteres', 'A'.repeat(44)],
  ['con relleno =', tokenFalso], ['base64 normal (+ y /)', '+'.repeat(43)], ['número', 12345], ['null', null], ['objeto', {}]
]) {
  const e = errorDe(() => tokens.hashToken(valor));
  igual(`rechaza un token ${descripcion} sin incluirlo en el error`,
    [e?.nombre, e?.mensaje === 'Token con formato no válido'], ['TypeError', true]);
}

// ---------- leerUrlPublica y construirEnlace ----------
console.log('\n== URL pública y enlace');
const HTTPS = { PANSYS_URL_PUBLICA: 'https://pansys.example' };
igual('https sin barra final -> origen', tokens.leerUrlPublica(HTTPS), 'https://pansys.example');
igual('https con barra final -> mismo origen', tokens.leerUrlPublica({ PANSYS_URL_PUBLICA: 'https://pansys.example/' }), 'https://pansys.example');
igual('https con puerto', tokens.leerUrlPublica({ PANSYS_URL_PUBLICA: 'https://pansys.example:8443' }), 'https://pansys.example:8443');
igual('enlace = origen + /restablecer#token=<token>', tokens.construirEnlace(token, HTTPS), `https://pansys.example/restablecer#token=${token}`);
igual('RUTA_RESTABLECER = /restablecer', tokens.RUTA_RESTABLECER, '/restablecer');

// Lo que traiga la petición o el entorno aparte de PANSYS_URL_PUBLICA no cambia el enlace
const conCabeceras = {
  ...HTTPS, HOST: 'atacante.example', HTTP_HOST: 'atacante.example', X_FORWARDED_HOST: 'atacante.example',
  headers: { host: 'atacante.example', 'x-forwarded-host': 'atacante.example', 'x-forwarded-proto': 'http' },
  protocol: 'http', hostname: 'atacante.example'
};
igual('ignora Host, cabeceras reenviadas y protocolo de la petición', tokens.construirEnlace(token, conCabeceras), `https://pansys.example/restablecer#token=${token}`);
// construirEnlace(token, env = process.env): no recibe la petición (length 1: env tiene valor por defecto)
igual('construirEnlace solo recibe el token y la configuración, nunca la petición', tokens.construirEnlace.length, 1);

const URL_SECRETA = 'https://usuario:secreto@pansys.example';
const rechazos = [
  ['falta', {}],
  ['vacía', { PANSYS_URL_PUBLICA: '' }],
  ['solo espacios', { PANSYS_URL_PUBLICA: '   ' }],
  ['con espacios alrededor', { PANSYS_URL_PUBLICA: ' https://pansys.example ' }],
  ['no es URL', { PANSYS_URL_PUBLICA: 'pansys.example' }],
  ['relativa', { PANSYS_URL_PUBLICA: '/restablecer' }],
  ['con usuario y contraseña', { PANSYS_URL_PUBLICA: URL_SECRETA }],
  ['con ruta', { PANSYS_URL_PUBLICA: 'https://pansys.example/app' }],
  ['con consulta', { PANSYS_URL_PUBLICA: 'https://pansys.example/?a=1' }],
  ['con ? vacío', { PANSYS_URL_PUBLICA: 'https://pansys.example?' }],
  ['con fragmento', { PANSYS_URL_PUBLICA: 'https://pansys.example/#x' }],
  ['protocolo ftp', { PANSYS_URL_PUBLICA: 'ftp://pansys.example' }],
  ['protocolo javascript', { PANSYS_URL_PUBLICA: 'javascript:alert(1)' }],
  ['http público sin permiso', { PANSYS_URL_PUBLICA: 'http://pansys.example' }],
  ['http público con permiso', { PANSYS_URL_PUBLICA: 'http://pansys.example', PANSYS_PERMITIR_HTTP_LOCAL: '1' }],
  ['http local sin permiso', { PANSYS_URL_PUBLICA: 'http://localhost:3000' }],
  ['http local con permiso "true" (solo vale "1")', { PANSYS_URL_PUBLICA: 'http://localhost:3000', PANSYS_PERMITIR_HTTP_LOCAL: 'true' }],
  ['http local con permiso en producción', { PANSYS_URL_PUBLICA: 'http://localhost:3000', PANSYS_PERMITIR_HTTP_LOCAL: '1', NODE_ENV: 'production' }],
  ['http a una IP de la red local', { PANSYS_URL_PUBLICA: 'http://192.168.1.10:3000', PANSYS_PERMITIR_HTTP_LOCAL: '1' }],
  ['http a un nombre que empieza por localhost', { PANSYS_URL_PUBLICA: 'http://localhost.atacante.example', PANSYS_PERMITIR_HTTP_LOCAL: '1' }]
];
for (const [descripcion, env] of rechazos) {
  const e = errorDe(() => tokens.leerUrlPublica(env));
  igual(`URL pública ${descripcion} -> ErrorConfiguracionUrl`, e?.nombre, 'ErrorConfiguracionUrl');
}
igual('sin configuración (null) -> ErrorConfiguracionUrl', errorDe(() => tokens.leerUrlPublica(null))?.nombre, 'ErrorConfiguracionUrl');
const errorSecreta = errorDe(() => tokens.leerUrlPublica({ PANSYS_URL_PUBLICA: URL_SECRETA }));
igual('el error no muestra la URL ni sus credenciales', [errorSecreta?.mensaje.includes('secreto'), errorSecreta?.mensaje.includes('usuario:')], [false, false]);
igual('construirEnlace con configuración inválida falla sin mostrar el token',
  (() => { const e = errorDe(() => tokens.construirEnlace(token, {})); return [e?.nombre, e?.mensaje.includes(token)]; })(),
  ['ErrorConfiguracionUrl', false]);
igual('construirEnlace con token inválido falla antes de leer la configuración',
  errorDe(() => tokens.construirEnlace('no-es-un-token', {}))?.nombre, 'TypeError');

const LOCAL = { PANSYS_PERMITIR_HTTP_LOCAL: '1' };
igual('http://localhost con permiso explícito', tokens.leerUrlPublica({ ...LOCAL, PANSYS_URL_PUBLICA: 'http://localhost:3000' }), 'http://localhost:3000');
igual('http://127.0.0.1 con permiso explícito', tokens.leerUrlPublica({ ...LOCAL, PANSYS_URL_PUBLICA: 'http://127.0.0.1:3000' }), 'http://127.0.0.1:3000');
igual('http://[::1] con permiso explícito', tokens.leerUrlPublica({ ...LOCAL, PANSYS_URL_PUBLICA: 'http://[::1]:3000' }), 'http://[::1]:3000');
igual('https no necesita el permiso de http local', tokens.leerUrlPublica({ ...HTTPS, NODE_ENV: 'production' }), 'https://pansys.example');

// ---------- Limitador: configuración ----------
console.log('\n== Limitador: configuración');
let t = 1_000_000;
const reloj = () => t;
for (const [descripcion, opciones] of [
  ['sin opciones', undefined],
  ['maximo 0', { maximo: 0, ventanaMs: 1000 }],
  ['maximo decimal', { maximo: 1.5, ventanaMs: 1000 }],
  ['ventana 0', { maximo: 1, ventanaMs: 0 }],
  ['ventana como texto', { maximo: 1, ventanaMs: '1000' }],
  ['maxClaves 0', { maximo: 1, ventanaMs: 1000, maxClaves: 0 }],
  ['reloj que no es función', { maximo: 1, ventanaMs: 1000, reloj: 5 }],
  ['intervalo de limpieza 0', { maximo: 1, ventanaMs: 1000, intervaloLimpiezaMs: 0 }]
]) {
  igual(`rechaza ${descripcion}`, errorDe(() => crearLimitador(opciones))?.nombre, 'TypeError');
}
const conRelojRoto = crearLimitador({ maximo: 1, ventanaMs: 1000, reloj: () => NaN });
igual('un reloj que devuelve NaN hace fallar la operación (no la permite)', errorDe(() => conRelojRoto.intentar('k'))?.nombre, 'TypeError');
const basico = crearLimitador({ maximo: 2, ventanaMs: 1000, reloj });
for (const [descripcion, clave] of [['vacía', ''], ['número', 7], ['demasiado larga', 'x'.repeat(LONGITUD_MAXIMA_CLAVE + 1)]]) {
  igual(`clave ${descripcion} -> TypeError`, errorDe(() => basico.intentar(clave))?.nombre, 'TypeError');
}

// ---------- Limitador: ventana, máximo y Retry-After ----------
console.log('\n== Limitador: ventana, máximo y Retry-After');
t = 1_000_000;
const lim = crearLimitador({ maximo: 3, ventanaMs: 15 * 60 * 1000, reloj });
const r1 = lim.intentar('ip:1');
igual('1.er intento permitido, quedan 2', [r1.permitido, r1.restantes, r1.retryAfterS], [true, 2, 0]);
t += 1000;
igual('2.º intento permitido, queda 1', lim.intentar('ip:1').restantes, 1);
t += 1000;
const r3 = lim.intentar('ip:1');
igual('3.er intento (el máximo) permitido, quedan 0', [r3.permitido, r3.restantes], [true, 0]);
t += 1000;
const r4 = lim.intentar('ip:1');
igual('4.º intento rechazado por límite', [r4.permitido, r4.motivo], [false, 'limite']);
igual('Retry-After: hasta que venza el primer intento (15 min - 3 s)', [r4.retryAfterMs, r4.retryAfterS], [15 * 60 * 1000 - 3000, 897]);
igual('un intento rechazado no se anota (siguen 3 vigentes)', lim.consultar('ip:1').restantes, 0);
t += 500;
igual('Retry-After redondea hacia arriba a segundos', lim.intentar('ip:1').retryAfterS, Math.ceil((15 * 60 * 1000 - 3500) / 1000));
igual('otra clave no se ve afectada', lim.intentar('ip:2').permitido, true);

t = 1_000_000 + 15 * 60 * 1000; // vence justo el primer intento (instante 1.000.000)
const tras = lim.intentar('ip:1');
igual('ventana deslizante: al vencer el 1.er intento vuelve a haber hueco', [tras.permitido, tras.restantes], [true, 0]);
igual('y el siguiente se rechaza hasta que venza el 2.º', [lim.intentar('ip:1').permitido, lim.consultar('ip:1').retryAfterMs], [false, 1000]);

t = 5_000_000;
const consulta = crearLimitador({ maximo: 1, ventanaMs: 1000, reloj });
igual('consultar no anota intentos', [consulta.consultar('a').restantes, consulta.consultar('a').restantes, consulta.tamano()], [1, 1, 0]);
consulta.intentar('a');
const bloqueo = consulta.consultar('a');
igual('consultar informa del bloqueo con Retry-After mínimo de 1 s', [bloqueo.permitido, bloqueo.retryAfterS], [false, 1]);
consulta.reiniciar('a');
igual('reiniciar olvida los intentos de la clave', [consulta.consultar('a').permitido, consulta.tamano()], [true, 0]);

// registrar: cuenta intentos ya ocurridos (p. ej. fallos), aunque superen el máximo
t = 6_000_000;
const fallos = crearLimitador({ maximo: 2, ventanaMs: 10_000, reloj });
igual('registrar 1 fallo: sigue permitido, queda 1', [fallos.registrar('tok').permitido, fallos.consultar('tok').restantes], [true, 1]);
t += 1000;
igual('registrar el 2.º fallo: bloquea', fallos.registrar('tok').permitido, false);
t += 1000;
const tercero = fallos.registrar('tok');
igual('un 3.er fallo se anota y mantiene el bloqueo con la ventana de los 2 últimos', [tercero.permitido, tercero.retryAfterMs], [false, 9000]);

// ---------- Limitador: expiración y limpieza ----------
console.log('\n== Limitador: expiración y limpieza');
t = 10_000_000;
const exp = crearLimitador({ maximo: 5, ventanaMs: 1000, reloj, intervaloLimpiezaMs: 60_000 });
['a', 'b', 'c'].forEach(k => exp.intentar(k));
igual('3 claves guardadas', exp.tamano(), 3);
t += 1000;
igual('vencidas, pero la limpieza perezosa aún no toca (intervalo de 60 s)', exp.tamano(), 3);
igual('una clave vencida vuelve a estar libre al usarla', exp.consultar('a').restantes, 5);
exp.limpiar();
igual('limpiar() elimina todas las vencidas', exp.tamano(), 0);
exp.intentar('d');
t += 60_000;
exp.consultar('otra');
igual('la limpieza perezosa se hace sola al pasar el intervalo', exp.tamano(), 0);
t = 9_000_000; // reloj hacia atrás: las marcas «del futuro» se conservan (lado seguro)
const atras = crearLimitador({ maximo: 1, ventanaMs: 1000, reloj });
t = 9_000_000; atras.intentar('x');
t = 8_000_000;
igual('si el reloj retrocede, el intento sigue contando', atras.intentar('x').permitido, false);

// ---------- Limitador: capacidad (fallo cerrado) ----------
console.log('\n== Limitador: capacidad');
t = 20_000_000;
const cap = crearLimitador({ maximo: 2, ventanaMs: 1000, maxClaves: 3, reloj });
['k1', 'k2', 'k3'].forEach(k => cap.intentar(k));
t += 400;
const nueva = cap.intentar('k4');
igual('con la memoria llena, una clave nueva se rechaza (motivo capacidad)', [nueva.permitido, nueva.motivo, nueva.restantes], [false, 'capacidad', 0]);
igual('Retry-After: hasta que venza la entrada más próxima (600 ms -> 1 s)', [nueva.retryAfterMs, nueva.retryAfterS], [600, 1]);
igual('no se descarta ninguna clave vigente para hacer sitio', cap.tamano(), 3);
igual('consultar una clave nueva con la memoria llena también la rechaza', cap.consultar('k5').motivo, 'capacidad');
igual('registrar una clave nueva con la memoria llena no la anota y la rechaza', [cap.registrar('k6').permitido, cap.tamano()], [false, 3]);
const existente = cap.intentar('k1');
igual('las claves existentes siguen con su límite normal', [existente.permitido, existente.restantes], [true, 0]);
igual('y su máximo se sigue aplicando (sin fallo abierto)', cap.intentar('k1').permitido, false);
t += 1000; // vencen todas las entradas anteriores (la más reciente, de k1, cumple justo 1 s)
const trasVencer = cap.intentar('k4');
igual('al vencer entradas, la clave nueva ya cabe', [trasVencer.permitido, cap.tamano() <= 3], [true, true]);

// ---------- Sin temporizadores ni esperas reales ----------
console.log('\n== Sin temporizadores');
igual('ningún módulo creó temporizadores (no mantienen vivo el proceso)', temporizadoresCreados, []);
global.setTimeout = temporizadoresOriginales.setTimeout;
global.setInterval = temporizadoresOriginales.setInterval;
global.setImmediate = temporizadoresOriginales.setImmediate;

const fallidas = resultados.filter(ok => !ok).length;
console.log(`\n${resultados.length - fallidas}/${resultados.length} pruebas correctas`);
process.exit(fallidas ? 1 : 0);
