// Pruebas unitarias de src/utils/correo.js (etapa S1): modos de PANSYS_CORREO_MODO, configuración
// TLS y de autenticación, errores saneados, tope de tiempo y ausencia de conexiones en el modo json.
// No usan la red ni envían correos: toda conexión (net, tls, dns) está bloqueada y se anota; los
// envíos van por transportes dobles o por el jsonTransport real de nodemailer.
//
// Uso (desde backend/):  node pruebas/correo.unitarias.js

// ---------- Red bloqueada y anotada antes de cargar nada ----------
const net = require('net');
const tls = require('tls');
const dns = require('dns');
const intentosRed = [];
const bloquear = (nombre) => function () { intentosRed.push(nombre); throw new Error(`Red bloqueada en las pruebas unitarias (${nombre})`); };
net.connect = net.createConnection = bloquear('net.connect');
net.Socket.prototype.connect = bloquear('Socket.connect');
tls.connect = bloquear('tls.connect');
dns.lookup = bloquear('dns.lookup');
dns.resolve = dns.resolve4 = dns.resolve6 = bloquear('dns.resolve');
dns.promises.lookup = bloquear('dns.promises.lookup');

const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const correo = require('../src/utils/correo');
const {
  MODOS, TIEMPO_MAXIMO_MS, ErrorConfiguracionCorreo, ErrorTiempoCorreo, ErrorEnvioCorreo,
  leerConfiguracionCorreo, construirOpcionesTransporte, clasificarError, crearCorreo, describirCorreo, limitarDestinos
} = correo;

const resultados = [];
const igual = (descripcion, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  resultados.push(ok);
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${descripcion}${ok ? '' : ` -> obtenido ${JSON.stringify(real)}, esperado ${JSON.stringify(esperado)}`}`);
};
const errorDe = (fn) => { try { fn(); return null; } catch (e) { return e; } };

// Valores centinela: ningún mensaje de error ni registro debe contenerlos
const SECRETOS = { usuario: 'usuario-centinela-7f3a', contrasena: 'clave-centinela-9b2c', host: 'host-centinela.ejemplo' };
const REMITENTE = 'no-responder@pansys.invalid';
const contieneCentinela = (texto) => Object.values(SECRETOS).some(s => String(texto ?? '').includes(s));

// Salida de consola del módulo: debe quedar vacía
const salidaModulo = [];
const conConsolaCapturada = async (fn) => {
  const originales = {};
  for (const m of ['log', 'error', 'warn', 'info', 'debug']) {
    originales[m] = console[m];
    console[m] = (...args) => salidaModulo.push(args.map(String).join(' '));
  }
  try { return await fn(); } finally { Object.assign(console, originales); }
};

const main = async () => {
  // ================= Modo desactivado (por defecto) =================
  console.log('\n== modo desactivado: por defecto, y una configuración SMTP antigua no envía nada');
  igual('sin PANSYS_CORREO_MODO -> desactivado', leerConfiguracionCorreo({}), { modo: 'desactivado' });
  igual('PANSYS_CORREO_MODO vacío -> desactivado', leerConfiguracionCorreo({ PANSYS_CORREO_MODO: '' }), { modo: 'desactivado' });
  const configAntigua = {
    PANSYS_SMTP_HOST: 'localhost', PANSYS_SMTP_PUERTO: '1025', PANSYS_CORREO_REMITENTE: REMITENTE, PANSYS_SMTP_SOLO_LOCAL: '0',
    PANSYS_SMTP_USUARIO: SECRETOS.usuario, PANSYS_SMTP_CONTRASENA: SECRETOS.contrasena
  };
  let transportesCreados = 0;
  const correoAntiguo = crearCorreo({ env: configAntigua, crearTransporte: () => { transportesCreados++; return { sendMail: async () => ({}) }; } });
  const envioAntiguo = await correoAntiguo.enviarEnlaceRestablecimiento({ para: 'a@b.test', enlace: 'https://x.invalid/restablecer#token=x' }).then(() => null, e => e);
  igual('configuración SMTP antigua sin modo -> desactivado: configurado() false, el envío falla y no se crea ningún transporte',
    [leerConfiguracionCorreo(configAntigua).modo, correoAntiguo.configurado(), envioAntiguo instanceof ErrorConfiguracionCorreo, transportesCreados], ['desactivado', false, true, 0]);
  for (const valor of ['SMTP', ' smtp', 'json ', 'Mailpit', 'local', 'smtps']) {
    const e = errorDe(() => leerConfiguracionCorreo({ PANSYS_CORREO_MODO: valor, PANSYS_CORREO_REMITENTE: REMITENTE }));
    igual(`modo ${JSON.stringify(valor)} -> rechazado (configuración no válida)`, e instanceof ErrorConfiguracionCorreo, true);
  }
  igual('modos admitidos', MODOS, ['desactivado', 'json', 'mailpit', 'smtp']);
  const obsoleta = errorDe(() => leerConfiguracionCorreo({ PANSYS_CORREO_MODO: 'mailpit', PANSYS_CORREO_REMITENTE: REMITENTE, PANSYS_SMTP_SOLO_LOCAL: '1' }));
  igual('PANSYS_SMTP_SOLO_LOCAL junto con un modo -> rechazado (variable obsoleta)', [obsoleta instanceof ErrorConfiguracionCorreo, /ya no se usa/.test(obsoleta?.message)], [true, true]);
  for (const modo of ['json', 'mailpit', 'smtp']) {
    const base = { PANSYS_CORREO_MODO: modo, NODE_ENV: 'test', PANSYS_SMTP_HOST: modo === 'smtp' ? 'smtp.ejemplo.com' : undefined, PANSYS_SMTP_TLS: modo === 'smtp' ? 'starttls' : undefined };
    const sin = errorDe(() => leerConfiguracionCorreo(base));
    const mal = errorDe(() => leerConfiguracionCorreo({ ...base, PANSYS_CORREO_REMITENTE: 'Pansys <x@y.z>' }));
    igual(`modo ${modo}: sin remitente o con uno no válido -> rechazado`, [sin instanceof ErrorConfiguracionCorreo, mal instanceof ErrorConfiguracionCorreo], [true, true]);
  }

  // ================= Modo json =================
  console.log('\n== modo json: solo en test (o con autorización local explícita) y sin red');
  const JSON_ENV = { PANSYS_CORREO_MODO: 'json', PANSYS_CORREO_REMITENTE: REMITENTE };
  igual('NODE_ENV=test -> admitido', leerConfiguracionCorreo({ ...JSON_ENV, NODE_ENV: 'test' }), { modo: 'json', remitente: REMITENTE });
  for (const [descripcion, env] of [
    ['sin NODE_ENV ni autorización', JSON_ENV],
    ['NODE_ENV=development sin autorización', { ...JSON_ENV, NODE_ENV: 'development' }],
    ['autorización con un valor distinto de "1"', { ...JSON_ENV, PANSYS_PERMITIR_CORREO_JSON: 'true' }],
    ['producción, aun con la autorización', { ...JSON_ENV, NODE_ENV: 'production', PANSYS_PERMITIR_CORREO_JSON: '1' }]
  ]) {
    igual(`${descripcion} -> rechazado`, errorDe(() => leerConfiguracionCorreo(env)) instanceof ErrorConfiguracionCorreo, true);
  }
  igual('fuera de producción con PANSYS_PERMITIR_CORREO_JSON=1 -> admitido', leerConfiguracionCorreo({ ...JSON_ENV, PANSYS_PERMITIR_CORREO_JSON: '1' }).modo, 'json');
  igual('opciones del transporte: exactamente { jsonTransport: true } (ningún host ni puerto)',
    construirOpcionesTransporte(leerConfiguracionCorreo({ ...JSON_ENV, NODE_ENV: 'test', PANSYS_SMTP_HOST: 'smtp.ejemplo.com' })), { jsonTransport: true });
  // Envío real con nodemailer (jsonTransport) y la red bloqueada y anotada
  const opcionesPedidas = [];
  const correoJson = crearCorreo({
    env: { ...JSON_ENV, NODE_ENV: 'test' },
    crearTransporte: (opciones) => { opcionesPedidas.push(opciones); return nodemailer.createTransport(opciones); }
  });
  const intentosAntes = intentosRed.length;
  const enlace = `https://pansys.invalid/restablecer#token=${'B'.repeat(43)}`;
  const envioJson = await conConsolaCapturada(() => correoJson.enviarEnlaceRestablecimiento({ para: 'destino@pansys.invalid', enlace }).then(() => 'ok', e => e?.name));
  igual('modo json: el envío termina sin ningún intento de red (net, tls ni dns) y con un solo transporte jsonTransport',
    [envioJson, intentosRed.length - intentosAntes, opcionesPedidas], ['ok', 0, [{ jsonTransport: true }]]);

  // ================= Modo mailpit =================
  console.log('\n== modo mailpit: solo el propio equipo, sin TLS ni autenticación');
  const MP = { PANSYS_CORREO_MODO: 'mailpit', PANSYS_CORREO_REMITENTE: REMITENTE };
  igual('por defecto localhost:1025', leerConfiguracionCorreo(MP), { modo: 'mailpit', host: 'localhost', puerto: 1025, remitente: REMITENTE, tls: null, autenticacion: false });
  igual('127.0.0.1 y ::1 admitidos', [leerConfiguracionCorreo({ ...MP, PANSYS_SMTP_HOST: '127.0.0.1' }).host, leerConfiguracionCorreo({ ...MP, PANSYS_SMTP_HOST: '::1' }).host], ['127.0.0.1', '::1']);
  const opcionesMp = construirOpcionesTransporte(leerConfiguracionCorreo(MP));
  igual('opciones: sin cifrado ni autenticación, registro y depuración desactivados, tiempos límite',
    [opcionesMp.host, opcionesMp.port, opcionesMp.secure, opcionesMp.ignoreTLS, 'auth' in opcionesMp, opcionesMp.logger, opcionesMp.debug,
      opcionesMp.connectionTimeout, opcionesMp.greetingTimeout, opcionesMp.socketTimeout],
    ['localhost', 1025, false, true, false, false, false, 10000, 10000, 15000]);
  for (const [descripcion, extra] of [
    ['host remoto', { PANSYS_SMTP_HOST: SECRETOS.host }],
    ['IP de la red local', { PANSYS_SMTP_HOST: '192.168.1.10' }],
    ['con usuario', { PANSYS_SMTP_USUARIO: SECRETOS.usuario }],
    ['con contraseña', { PANSYS_SMTP_CONTRASENA: SECRETOS.contrasena }],
    ['con PANSYS_SMTP_TLS', { PANSYS_SMTP_TLS: 'starttls' }],
    ['en producción', { NODE_ENV: 'production' }]
  ]) {
    const e = errorDe(() => leerConfiguracionCorreo({ ...MP, ...extra }));
    igual(`mailpit ${descripcion} -> rechazado sin revelar valores`, [e instanceof ErrorConfiguracionCorreo, contieneCentinela(e?.message)], [true, false]);
  }

  // ================= Modo smtp =================
  console.log('\n== modo smtp: siempre cifrado, certificados válidos y TLS 1.2 como mínimo');
  // Fuera de producción, el SMTP real exige la autorización explícita y una lista de destinos (fase 1)
  const AUTORIZADO = { PANSYS_PERMITIR_SMTP_REAL: '1', PANSYS_CORREO_DESTINOS_PERMITIDOS: 'destino@pansys.invalid' };
  const SM = { PANSYS_CORREO_MODO: 'smtp', PANSYS_CORREO_REMITENTE: REMITENTE, PANSYS_SMTP_HOST: 'smtp.ejemplo.com', ...AUTORIZADO };
  const implicito = construirOpcionesTransporte(leerConfiguracionCorreo({ ...SM, PANSYS_SMTP_TLS: 'implicito' }));
  igual('TLS implícito: puerto 465, secure, certificado validado, TLS 1.2 mínimo y nombre del servidor',
    [implicito.port, implicito.secure, implicito.requireTLS, implicito.ignoreTLS, implicito.tls], [465, true, false, false, { rejectUnauthorized: true, minVersion: 'TLSv1.2', servername: 'smtp.ejemplo.com' }]);
  const starttls = construirOpcionesTransporte(leerConfiguracionCorreo({ ...SM, PANSYS_SMTP_TLS: 'starttls' }));
  igual('STARTTLS: puerto 587, STARTTLS obligatorio (requireTLS), sin ignorar TLS, mismas garantías del certificado',
    [starttls.port, starttls.secure, starttls.requireTLS, starttls.ignoreTLS, starttls.tls], [587, false, true, false, { rejectUnauthorized: true, minVersion: 'TLSv1.2', servername: 'smtp.ejemplo.com' }]);
  igual('registro y depuración de nodemailer desactivados, y tiempos límite',
    [starttls.logger, starttls.debug, starttls.connectionTimeout, starttls.greetingTimeout, starttls.socketTimeout, starttls.disableFileAccess, starttls.disableUrlAccess],
    [false, false, 10000, 10000, 15000, true, true]);
  igual('host IP: sin servername (no se puede usar SNI con una IP); el certificado se sigue validando',
    construirOpcionesTransporte(leerConfiguracionCorreo({ ...SM, PANSYS_SMTP_HOST: '203.0.113.10', PANSYS_SMTP_TLS: 'implicito' })).tls, { rejectUnauthorized: true, minVersion: 'TLSv1.2' });
  igual('puerto explícito 2525 con STARTTLS', leerConfiguracionCorreo({ ...SM, PANSYS_SMTP_TLS: 'starttls', PANSYS_SMTP_PUERTO: '2525' }).puerto, 2525);
  const SM_PRODUCCION = { PANSYS_CORREO_MODO: 'smtp', PANSYS_CORREO_REMITENTE: REMITENTE, PANSYS_SMTP_HOST: 'smtp.ejemplo.com', PANSYS_SMTP_TLS: 'starttls', NODE_ENV: 'production' };
  igual('smtp se admite en producción sin autorización extra ni lista (destinos sin restringir)',
    [leerConfiguracionCorreo(SM_PRODUCCION).modo, leerConfiguracionCorreo(SM_PRODUCCION).destinos], ['smtp', null]);

  const conAuth = { ...SM, PANSYS_SMTP_TLS: 'starttls', PANSYS_SMTP_USUARIO: SECRETOS.usuario, PANSYS_SMTP_CONTRASENA: SECRETOS.contrasena };
  const configAuth = leerConfiguracionCorreo(conAuth);
  igual('con usuario y contraseña: la configuración solo indica que hay autenticación, sin los valores',
    [configAuth.autenticacion, contieneCentinela(JSON.stringify(configAuth))], [true, false]);
  igual('las credenciales solo llegan a las opciones del transporte', construirOpcionesTransporte(configAuth, conAuth).auth, { user: SECRETOS.usuario, pass: SECRETOS.contrasena });
  igual('sin credenciales: sin auth', 'auth' in starttls, false);

  for (const [descripcion, env] of [
    ['sin PANSYS_SMTP_TLS (sin cifrar)', { ...SM }],
    ['PANSYS_SMTP_TLS=ninguno', { ...SM, PANSYS_SMTP_TLS: 'ninguno' }],
    ['PANSYS_SMTP_TLS=none', { ...SM, PANSYS_SMTP_TLS: 'none' }],
    ['PANSYS_SMTP_TLS en mayúsculas', { ...SM, PANSYS_SMTP_TLS: 'STARTTLS' }],
    ['sin host', { ...SM, PANSYS_SMTP_HOST: undefined, PANSYS_SMTP_TLS: 'starttls' }],
    ['host con esquema', { ...SM, PANSYS_SMTP_HOST: `smtp://${SECRETOS.host}`, PANSYS_SMTP_TLS: 'starttls' }],
    ['host con espacios', { ...SM, PANSYS_SMTP_HOST: ` ${SECRETOS.host}`, PANSYS_SMTP_TLS: 'starttls' }],
    ['usuario sin contraseña', { ...SM, PANSYS_SMTP_TLS: 'starttls', PANSYS_SMTP_USUARIO: SECRETOS.usuario }],
    ['contraseña sin usuario', { ...SM, PANSYS_SMTP_TLS: 'starttls', PANSYS_SMTP_CONTRASENA: SECRETOS.contrasena }],
    ['puerto 0', { ...SM, PANSYS_SMTP_TLS: 'starttls', PANSYS_SMTP_PUERTO: '0' }],
    ['puerto con letras', { ...SM, PANSYS_SMTP_TLS: 'starttls', PANSYS_SMTP_PUERTO: '58x' }],
    ['puerto 70000', { ...SM, PANSYS_SMTP_TLS: 'starttls', PANSYS_SMTP_PUERTO: '70000' }]
  ]) {
    const e = errorDe(() => leerConfiguracionCorreo(env));
    igual(`smtp ${descripcion} -> rechazado sin revelar valores`, [e instanceof ErrorConfiguracionCorreo, contieneCentinela(e?.message)], [true, false]);
  }
  // nodemailer 10.2.1 acepta estas opciones: crear el transporte no conecta (nada en la red)
  const intentosCrear = intentosRed.length;
  const real = nodemailer.createTransport(construirOpcionesTransporte(configAuth, conAuth));
  const opcionesReales = real.transporter?.options ?? {};
  igual('nodemailer conserva requireTLS, la validación del certificado y TLS 1.2, sin abrir conexiones al crear el transporte',
    [opcionesReales.requireTLS, opcionesReales.tls?.rejectUnauthorized, opcionesReales.tls?.minVersion, intentosRed.length - intentosCrear], [true, true, 'TLSv1.2', 0]);
  real.close?.();

  // ================= Fase 1: autorización del SMTP real y destinos permitidos =================
  console.log('\n== smtp fuera de producción: autorización explícita y destinos permitidos');
  const SIN_AUT = { PANSYS_CORREO_MODO: 'smtp', PANSYS_CORREO_REMITENTE: REMITENTE, PANSYS_SMTP_HOST: 'smtp.ejemplo.com', PANSYS_SMTP_TLS: 'starttls',
    PANSYS_SMTP_USUARIO: SECRETOS.usuario, PANSYS_SMTP_CONTRASENA: SECRETOS.contrasena };
  for (const [descripcion, env] of [
    ['sin PANSYS_PERMITIR_SMTP_REAL', { ...SIN_AUT, PANSYS_CORREO_DESTINOS_PERMITIDOS: 'destino@pansys.invalid' }],
    ['PANSYS_PERMITIR_SMTP_REAL=true (solo vale "1")', { ...SIN_AUT, PANSYS_PERMITIR_SMTP_REAL: 'true', PANSYS_CORREO_DESTINOS_PERMITIDOS: 'destino@pansys.invalid' }],
    ['con NODE_ENV=test y sin autorización', { ...SIN_AUT, NODE_ENV: 'test' }],
    ['con NODE_ENV=development y sin autorización', { ...SIN_AUT, NODE_ENV: 'development' }],
    ['autorizado pero sin lista de destinos', { ...SIN_AUT, PANSYS_PERMITIR_SMTP_REAL: '1' }],
    ['autorizado con la lista vacía', { ...SIN_AUT, PANSYS_PERMITIR_SMTP_REAL: '1', PANSYS_CORREO_DESTINOS_PERMITIDOS: '' }]
  ]) {
    const e = errorDe(() => leerConfiguracionCorreo(env));
    igual(`smtp ${descripcion} -> rechazado sin revelar valores`, [e instanceof ErrorConfiguracionCorreo, contieneCentinela(e?.message)], [true, false]);
  }
  for (const lista of [`${SECRETOS.usuario}`, 'a@b', ' , ', 'destino@pansys.invalid,,', 'Nombre <destino@pansys.invalid>', '@', `@${SECRETOS.host.replace(/\./g, '')}`, 'a b@pansys.invalid']) {
    const e = errorDe(() => leerConfiguracionCorreo({ ...SIN_AUT, PANSYS_PERMITIR_SMTP_REAL: '1', PANSYS_CORREO_DESTINOS_PERMITIDOS: lista }));
    igual(`lista de destinos ${JSON.stringify(lista)} -> rechazada sin revelar valores`, [e instanceof ErrorConfiguracionCorreo, contieneCentinela(e?.message)], [true, false]);
  }
  const autorizado = leerConfiguracionCorreo({ ...SIN_AUT, PANSYS_PERMITIR_SMTP_REAL: '1', PANSYS_CORREO_DESTINOS_PERMITIDOS: ' Persona@Dominio.Ejemplo , @otro.ejemplo ' });
  igual('autorizado con lista: válido, y la lista se normaliza (sin espacios, en minúsculas)', [autorizado.modo, autorizado.destinos], ['smtp', ['persona@dominio.ejemplo', '@otro.ejemplo']]);
  igual('en producción, una lista definida también se aplica', leerConfiguracionCorreo({ ...SM_PRODUCCION, PANSYS_CORREO_DESTINOS_PERMITIDOS: '@otro.ejemplo' }).destinos, ['@otro.ejemplo']);
  igual('en producción, una lista mal formada se rechaza',
    errorDe(() => leerConfiguracionCorreo({ ...SM_PRODUCCION, PANSYS_CORREO_DESTINOS_PERMITIDOS: 'no-es-correo' })) instanceof ErrorConfiguracionCorreo, true);

  console.log('\n== límite común de envío (limitarDestinos): todo mensaje pasa por él antes del transporte');
  const DESTINOS = ['persona@dominio.ejemplo', '@otro.ejemplo'];
  const llamadas = [];
  const doble = { sendMail: async (m) => { llamadas.push(m.to ?? m.cc ?? m.bcc); return { accepted: [m.to] }; }, close: () => 'cerrado' };
  const limitado = limitarDestinos(doble, DESTINOS);
  const probar = async (mensaje) => limitado.sendMail(mensaje).then(() => 'enviado', (x) => x?.code);
  for (const [descripcion, mensaje, esperado] of [
    ['dirección exacta', { to: 'persona@dominio.ejemplo' }, 'enviado'],
    ['dirección exacta en mayúsculas', { to: 'Persona@Dominio.Ejemplo' }, 'enviado'],
    ['subdirección de una dirección exacta', { to: 'persona+prueba123@dominio.ejemplo' }, 'enviado'],
    ['«Nombre <dirección>»', { to: 'Persona <persona@dominio.ejemplo>' }, 'enviado'],
    ['objeto { address } en una lista', { to: [{ name: 'P', address: 'persona@dominio.ejemplo' }] }, 'enviado'],
    ['cualquier dirección del dominio permitido', { to: 'alguien@otro.ejemplo' }, 'enviado'],
    ['otra persona del dominio de una dirección exacta', { to: 'otra@dominio.ejemplo' }, 'EENVELOPE'],
    ['un subdominio del dominio permitido', { to: 'alguien@sub.otro.ejemplo' }, 'EENVELOPE'],
    ['un dominio que solo termina igual', { to: 'alguien@malotro.ejemplo' }, 'EENVELOPE'],
    ['dos destinatarios, uno fuera de la lista', { to: 'persona@dominio.ejemplo, intruso@fuera.ejemplo' }, 'EENVELOPE'],
    ['cc fuera de la lista', { to: 'persona@dominio.ejemplo', cc: 'intruso@fuera.ejemplo' }, 'EENVELOPE'],
    ['bcc fuera de la lista', { to: 'persona@dominio.ejemplo', bcc: ['intruso@fuera.ejemplo'] }, 'EENVELOPE'],
    ['sobre propio (envelope)', { to: 'persona@dominio.ejemplo', envelope: { to: 'intruso@fuera.ejemplo' } }, 'EENVELOPE'],
    ['sin destinatarios', {}, 'EENVELOPE'],
    ['dirección no válida', { to: 'persona@' }, 'EENVELOPE']
  ]) {
    const antes = llamadas.length;
    const r = await probar(mensaje);
    igual(`${descripcion} -> ${esperado === 'enviado' ? 'llega al transporte' : 'rechazado sin llegar al transporte'}`, [r, llamadas.length - antes], [esperado, esperado === 'enviado' ? 1 : 0]);
  }
  igual('sin lista (null): se devuelve el mismo transporte, sin envoltorio', limitarDestinos(doble, null) === doble, true);
  igual('el envoltorio conserva close()', limitado.close(), 'cerrado');

  // crearCorreo: el límite se aplica también con un transporte inyectado y no hay red
  const ENV_LIMITADO = { ...SIN_AUT, PANSYS_PERMITIR_SMTP_REAL: '1', PANSYS_CORREO_DESTINOS_PERMITIDOS: 'persona@dominio.ejemplo' };
  const enviados = [];
  const correoLimitado = crearCorreo({ env: ENV_LIMITADO, transporte: { sendMail: async (m) => { enviados.push(m.to); return {}; } } });
  const intentosLimite = intentosRed.length;
  const fuera = await correoLimitado.enviarEnlaceRestablecimiento({ para: 'intruso@fuera.ejemplo', enlace }).then(() => null, x => x);
  igual('crearCorreo: destinatario fuera de la lista -> ErrorEnvioCorreo EENVELOPE (rechazado), sin llegar al transporte',
    [fuera instanceof ErrorEnvioCorreo, fuera?.code, clasificarError(fuera), enviados.length], [true, 'EENVELOPE', 'rechazado', 0]);
  const dentro = await correoLimitado.enviarEnlaceRestablecimiento({ para: 'persona+x@dominio.ejemplo', enlace }).then(() => 'ok', x => x?.code);
  igual('crearCorreo: subdirección permitida -> llega al transporte', [dentro, enviados.length], ['ok', 1]);
  const creadosLimite = [];
  const correoCreado = crearCorreo({ env: ENV_LIMITADO, crearTransporte: (o) => { creadosLimite.push(o.host); return { sendMail: async () => ({}) }; } });
  const fueraCreado = await correoCreado.enviarEnlaceRestablecimiento({ para: 'intruso@fuera.ejemplo', enlace }).then(() => null, x => x?.code);
  igual('crearCorreo con crearTransporte: el límite también se aplica', fueraCreado, 'EENVELOPE');
  igual('en el límite común no hubo ningún intento de red', intentosRed.length - intentosLimite, 0);

  console.log('\n== describirCorreo: resumen del arranque sin secretos');
  const descripciones = [
    describirCorreo({ modo: 'desactivado' }),
    describirCorreo(leerConfiguracionCorreo({ ...JSON_ENV, NODE_ENV: 'test' })),
    describirCorreo(leerConfiguracionCorreo({ ...MP, PANSYS_SMTP_HOST: '127.0.0.1' })),
    describirCorreo(leerConfiguracionCorreo(ENV_LIMITADO)),
    describirCorreo(leerConfiguracionCorreo({ ...SM_PRODUCCION, PANSYS_SMTP_USUARIO: SECRETOS.usuario, PANSYS_SMTP_CONTRASENA: SECRETOS.contrasena }))
  ];
  igual('textos esperados', descripciones, [
    'desactivado',
    'json (en memoria, sin red)',
    'mailpit 127.0.0.1:1025 (servidor local de pruebas, sin TLS ni autenticación)',
    'smtp smtp.ejemplo.com:587 (STARTTLS, con autenticación, destinos restringidos: 1)',
    'smtp smtp.ejemplo.com:587 (STARTTLS, con autenticación, sin restricción de destinos)'
  ]);
  igual('ningún resumen contiene usuario, contraseña, remitente ni destinos',
    descripciones.some(t => contieneCentinela(t) || t.includes(REMITENTE) || t.includes('persona@dominio.ejemplo')), false);

  // ================= Errores saneados y tope de tiempo =================
  console.log('\n== errores: sin credenciales, texto del servidor ni enlace; tope de 20 s');
  const MP_ENV = { ...MP };
  const errorServidor = Object.assign(new Error(`Invalid login: 535 5.7.8 user ${SECRETOS.usuario} pass ${SECRETOS.contrasena} rejected for ${enlace}`), {
    code: 'EAUTH', command: 'AUTH PLAIN', responseCode: 535, response: `535 Authentication failed for ${SECRETOS.usuario}`
  });
  const fallido = crearCorreo({ env: MP_ENV, transporte: { sendMail: async () => { throw errorServidor; } } });
  const e = await conConsolaCapturada(() => fallido.enviarEnlaceRestablecimiento({ para: 'destino@pansys.invalid', enlace }).then(() => null, x => x));
  const serializado = JSON.stringify({ ...e, mensaje: e?.message, pila: e?.stack });
  igual('el error del servidor se sustituye por ErrorEnvioCorreo con solo código, comando y código de respuesta',
    [e instanceof ErrorEnvioCorreo, e?.code, e?.command, e?.responseCode, 'response' in (e ?? {})], [true, 'EAUTH', 'AUTH PLAIN', 535, false]);
  igual('el error saneado no contiene credenciales, el enlace ni el texto del servidor', [contieneCentinela(serializado), serializado.includes(enlace), serializado.includes('535 5.7.8')], [false, false, false]);
  igual('la clasificación sigue funcionando con el error saneado (EAUTH -> rechazado)', clasificarError(e), 'rechazado');
  const sinConexion = crearCorreo({ env: MP_ENV, transporte: { sendMail: async () => { throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ESOCKET', command: 'CONN' }); } } });
  igual('conexión rechazada -> sin_conexion', clasificarError(await sinConexion.enviarEnlaceRestablecimiento({ para: 'x@pansys.invalid', enlace }).then(() => null, x => x)), 'sin_conexion');
  igual('clasificación de fallos', [
    clasificarError({ code: 'ECONNECTION' }), clasificarError({ code: 'EDNS' }), clasificarError({ code: 'ETLS' }),
    clasificarError({ code: 'EENVELOPE' }), clasificarError({ code: 'EMESSAGE', responseCode: 550 }), clasificarError({ code: 'ETIMEDOUT' }),
    clasificarError({ code: 'ESOCKET', command: 'DATA' }), clasificarError(new Error('desconocido'))
  ], ['sin_conexion', 'sin_conexion', 'rechazado', 'rechazado', 'rechazado', 'tiempo_agotado', 'tiempo_agotado', 'tiempo_agotado']);
  igual('el tope global sigue en 20 s', TIEMPO_MAXIMO_MS, 20000);
  const colgado = crearCorreo({ env: MP_ENV, transporte: { sendMail: () => new Promise(() => {}) }, tiempoMaximoMs: 30 });
  const tope = await colgado.enviarEnlaceRestablecimiento({ para: 'x@pansys.invalid', enlace }).then(() => null, x => x);
  igual('un envío que no termina se corta en el tope -> ErrorTiempoCorreo (tiempo_agotado)', [tope instanceof ErrorTiempoCorreo, clasificarError(tope)], [true, 'tiempo_agotado']);

  console.log('\n== transporte perezoso y sin registros');
  let creados = 0;
  const perezoso = crearCorreo({ env: MP_ENV, crearTransporte: () => { creados++; return { sendMail: async () => ({}) }; } });
  const antesDeEnviar = creados;
  perezoso.configurado();
  await perezoso.enviarEnlaceRestablecimiento({ para: 'a@pansys.invalid', enlace });
  await perezoso.enviarEnlaceRestablecimiento({ para: 'b@pansys.invalid', enlace });
  igual('el transporte se crea al primer envío (no al configurar) y una sola vez', [antesDeEnviar, creados], [0, 1]);
  igual('el módulo no escribió nada en la consola en ningún caso', salidaModulo, []);
  const codigo = fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', 'correo.js'), 'utf8')
    .split(/\r?\n/).filter(l => !l.trim().startsWith('//')).join('\n');
  igual('revisión estática: sin console, sin logger/debug activados y sin rejectUnauthorized: false',
    [/console\./.test(codigo), /logger:\s*true|debug:\s*true/.test(codigo), /rejectUnauthorized:\s*false/.test(codigo)], [false, false, false]);
  igual('en toda la ejecución no hubo ningún intento de conexión de red', intentosRed, []);
};

main()
  .catch(error => { resultados.push(false); console.log('FALLA ejecución abortada ->', error.stack); })
  .finally(() => {
    const fallidas = resultados.filter(ok => !ok).length;
    console.log(`\n${resultados.length - fallidas}/${resultados.length} pruebas correctas`);
    process.exit(fallidas ? 1 : 0);
  });
