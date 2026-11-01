// Envío de correo de los enlaces de restablecimiento (nodemailer). Este módulo nunca escribe en la
// consola ni en ningún registro: ni la dirección, ni el enlace, ni el token, ni la configuración.
//
// PANSYS_CORREO_MODO elige el modo; SIN ESA VARIABLE EL CORREO ESTÁ DESACTIVADO (una configuración
// SMTP antigua, sin modo, no envía nada):
//  - desactivado (por defecto): configurado() es false y los endpoints responden 503.
//  - json: jsonTransport de nodemailer, sin ninguna conexión de red (el mensaje se serializa en
//    memoria). Solo con NODE_ENV=test, o fuera de producción con PANSYS_PERMITIR_CORREO_JSON=1
//    (autorización explícita para un entorno local). Nunca en producción.
//  - mailpit: servidor de pruebas en el propio equipo (PANSYS_SMTP_HOST localhost, 127.0.0.1 o ::1;
//    por defecto localhost; puerto por defecto 1025), sin TLS ni autenticación. Nunca en producción.
//  - smtp: proveedor real. Exige PANSYS_SMTP_HOST y PANSYS_SMTP_TLS = implicito (TLS desde el
//    inicio, puerto por defecto 465) o starttls (STARTTLS OBLIGATORIO, puerto por defecto 587).
//    Nunca sin cifrar. Certificados validados, TLS 1.2 como mínimo y nombre del servidor
//    comprobado. Autenticación opcional: PANSYS_SMTP_USUARIO y PANSYS_SMTP_CONTRASENA, las dos o
//    ninguna. FUERA de producción exige además PANSYS_PERMITIR_SMTP_REAL=1 y la lista
//    PANSYS_CORREO_DESTINOS_PERMITIDOS; en producción la lista es opcional. Con lista, todo envío
//    pasa por limitarDestinos, que rechaza sin conexión cualquier destinatario fuera de ella.
// Comunes: PANSYS_CORREO_REMITENTE (obligatoria salvo en desactivado) y PANSYS_SMTP_PUERTO.
// PANSYS_SMTP_SOLO_LOCAL ya no se usa: si está definida junto con un modo, la configuración se
// rechaza (para que nadie crea que sigue protegiendo).
//
// Tope global de cada envío: TIEMPO_MAXIMO_MS (20 s), además de los tiempos de conexión, saludo y
// socket del transporte. Si se agota, el envío se da por fallido ('tiempo_agotado').
// Los errores del transporte se sustituyen por ErrorEnvioCorreo, que solo conserva el código, el
// comando y el código de respuesta SMTP: nunca el texto del servidor (que puede repetir la
// dirección o el usuario), las credenciales ni el mensaje.

const net = require('net');
const nodemailer = require('nodemailer');

const MODOS = ['desactivado', 'json', 'mailpit', 'smtp'];
const MODOS_TLS = ['implicito', 'starttls'];
const PUERTO_MAILPIT = 1025;
const PUERTO_POR_TLS = { implicito: 465, starttls: 587 };
const TIEMPO_MAXIMO_MS = 20000;
const HOSTS_LOCALES = new Set(['localhost', '127.0.0.1', '::1']);
const PATRON_REMITENTE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;
const PATRON_HOST = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
const TIEMPOS = { connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000, dnsTimeout: 10000 };

class ErrorConfiguracionCorreo extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'ErrorConfiguracionCorreo';
  }
}

// Error de un envío que superó el tope global
class ErrorTiempoCorreo extends Error {
  constructor() {
    super('El envío superó el tiempo máximo');
    this.name = 'ErrorTiempoCorreo';
    this.code = 'ETIMEDOUT';
  }
}

// Error de envío saneado: sin el texto del servidor, credenciales, dirección ni mensaje
class ErrorEnvioCorreo extends Error {
  constructor({ code, command, responseCode }) {
    super('El servidor de correo no aceptó el envío');
    this.name = 'ErrorEnvioCorreo';
    if (typeof code === 'string') this.code = code;
    if (typeof command === 'string') this.command = command;
    if (Number.isInteger(responseCode)) this.responseCode = responseCode;
  }
}

const definida = (valor) => valor !== undefined && valor !== '';

const leerPuerto = (texto, porDefecto) => {
  if (!definida(texto)) return porDefecto;
  if (!/^\d{1,5}$/.test(texto) || Number(texto) < 1 || Number(texto) > 65535) {
    throw new ErrorConfiguracionCorreo('PANSYS_SMTP_PUERTO debe ser un entero de 1 a 65535');
  }
  return Number(texto);
};

const leerRemitente = (env) => {
  const remitente = env.PANSYS_CORREO_REMITENTE;
  if (typeof remitente !== 'string' || !PATRON_REMITENTE.test(remitente)) {
    throw new ErrorConfiguracionCorreo('Falta PANSYS_CORREO_REMITENTE o no es una dirección válida');
  }
  return remitente;
};

const hayAutenticacion = (env) => definida(env.PANSYS_SMTP_USUARIO) || definida(env.PANSYS_SMTP_CONTRASENA);

// PANSYS_CORREO_DESTINOS_PERMITIDOS: lista separada por comas de direcciones exactas
// (persona@dominio, que admite también sus subdirecciones persona+etiqueta@dominio) o de dominios
// completos (@dominio). Se normaliza a minúsculas. Los mensajes de error nunca incluyen los valores.
const PATRON_DESTINO_EXACTO = /^[^\s@<>",]+@[^\s@<>",]+\.[^\s@<>",]+$/;
const PATRON_DESTINO_DOMINIO = /^@[^\s@<>",]+\.[^\s@<>",]+$/;
const leerDestinos = (texto, obligatoria) => {
  if (!definida(texto)) {
    if (obligatoria) throw new ErrorConfiguracionCorreo('Modo smtp fuera de producción: falta PANSYS_CORREO_DESTINOS_PERMITIDOS');
    return null;
  }
  const lista = String(texto).split(',').map(d => d.trim().toLowerCase());
  if (lista.length === 0 || lista.some(d => !(PATRON_DESTINO_EXACTO.test(d) || PATRON_DESTINO_DOMINIO.test(d)))) {
    throw new ErrorConfiguracionCorreo('PANSYS_CORREO_DESTINOS_PERMITIDOS no tiene un formato válido (direcciones o @dominio separados por comas)');
  }
  return lista;
};
// Direcciones de un campo de nodemailer (cadena con comas, «Nombre <dir>», objeto { address } o lista)
const direccionesDe = (campo) => {
  if (campo === undefined || campo === null || campo === '') return [];
  const lista = Array.isArray(campo) ? campo : String(campo).split(',');
  return lista.map((d) => {
    const texto = typeof d === 'string' ? d : d?.address;
    const angulos = /<([^>]*)>/.exec(String(texto ?? ''));
    return String(angulos ? angulos[1] : texto ?? '').trim().toLowerCase();
  });
};
const destinoPermitido = (direccion, destinos) => {
  const arroba = direccion.lastIndexOf('@');
  if (arroba <= 0 || !PATRON_DESTINO_EXACTO.test(direccion)) return false;
  const dominio = direccion.slice(arroba);
  const sinEtiqueta = `${direccion.slice(0, arroba).split('+')[0]}${dominio}`;
  return destinos.some(d => (d.startsWith('@') ? d === dominio : d === direccion || d === sinEtiqueta));
};
// Límite común de envío: TODO mensaje pasa por aquí antes de llegar al transporte. Con una lista de
// destinos, se rechaza (sin abrir ninguna conexión) cualquier mensaje con un destinatario fuera de ella,
// sin destinatarios o con un sobre propio (envelope, que nodemailer usaría en lugar de to/cc/bcc).
const limitarDestinos = (transporte, destinos) => {
  if (!destinos) return transporte;
  return {
    sendMail(mensaje, ...resto) {
      const todos = [...direccionesDe(mensaje?.to), ...direccionesDe(mensaje?.cc), ...direccionesDe(mensaje?.bcc)];
      if (mensaje?.envelope || todos.length === 0 || !todos.every(d => destinoPermitido(d, destinos))) {
        return Promise.reject(Object.assign(new Error('Destinatario no permitido por PANSYS_CORREO_DESTINOS_PERMITIDOS'), { code: 'EENVELOPE' }));
      }
      return transporte.sendMail(mensaje, ...resto);
    },
    close(...args) { return typeof transporte.close === 'function' ? transporte.close(...args) : undefined; }
  };
};

// Configuración validada SIN secretos (nunca incluye la contraseña ni el usuario del SMTP).
// Los mensajes de error nunca incluyen los valores configurados.
const leerConfiguracionCorreo = (env = process.env) => {
  const modoTexto = env?.PANSYS_CORREO_MODO;
  const modo = definida(modoTexto) ? modoTexto : 'desactivado';
  if (!MODOS.includes(modo)) {
    throw new ErrorConfiguracionCorreo(`PANSYS_CORREO_MODO no es válido (admite: ${MODOS.join(', ')})`);
  }
  if (modo === 'desactivado') return { modo };

  if (env.PANSYS_SMTP_SOLO_LOCAL !== undefined) {
    throw new ErrorConfiguracionCorreo('PANSYS_SMTP_SOLO_LOCAL ya no se usa: elimínela y elija el modo con PANSYS_CORREO_MODO');
  }
  const produccion = env.NODE_ENV === 'production';
  const remitente = leerRemitente(env);

  if (modo === 'json') {
    if (produccion) throw new ErrorConfiguracionCorreo('El modo json no se admite en producción');
    if (env.NODE_ENV !== 'test' && env.PANSYS_PERMITIR_CORREO_JSON !== '1') {
      throw new ErrorConfiguracionCorreo('El modo json solo se admite con NODE_ENV=test o con PANSYS_PERMITIR_CORREO_JSON=1');
    }
    return { modo, remitente };
  }

  if (modo === 'mailpit') {
    if (produccion) throw new ErrorConfiguracionCorreo('El modo mailpit no se admite en producción');
    const host = definida(env.PANSYS_SMTP_HOST) ? env.PANSYS_SMTP_HOST : 'localhost';
    if (!HOSTS_LOCALES.has(host.toLowerCase())) {
      throw new ErrorConfiguracionCorreo('Modo mailpit: PANSYS_SMTP_HOST debe ser localhost, 127.0.0.1 o ::1');
    }
    if (hayAutenticacion(env)) throw new ErrorConfiguracionCorreo('El modo mailpit no admite autenticación');
    if (definida(env.PANSYS_SMTP_TLS)) throw new ErrorConfiguracionCorreo('El modo mailpit no usa TLS: elimine PANSYS_SMTP_TLS');
    return { modo, host, puerto: leerPuerto(env.PANSYS_SMTP_PUERTO, PUERTO_MAILPIT), remitente, tls: null, autenticacion: false };
  }

  // smtp: proveedor real, siempre cifrado
  const host = env.PANSYS_SMTP_HOST;
  if (typeof host !== 'string' || !(PATRON_HOST.test(host) || net.isIP(host))) {
    throw new ErrorConfiguracionCorreo('Falta PANSYS_SMTP_HOST o no es un nombre de servidor válido');
  }
  const tls = env.PANSYS_SMTP_TLS;
  if (!MODOS_TLS.includes(tls)) {
    throw new ErrorConfiguracionCorreo('Modo smtp: PANSYS_SMTP_TLS debe ser implicito o starttls (nunca sin cifrar)');
  }
  if (definida(env.PANSYS_SMTP_USUARIO) !== definida(env.PANSYS_SMTP_CONTRASENA)) {
    throw new ErrorConfiguracionCorreo('Modo smtp: PANSYS_SMTP_USUARIO y PANSYS_SMTP_CONTRASENA van juntas (las dos o ninguna)');
  }
  // Fuera de producción el SMTP real exige autorización explícita Y destinatarios restringidos; en
  // producción la lista es opcional (si se define, también se aplica)
  let destinos = null;
  if (!produccion) {
    if (env.PANSYS_PERMITIR_SMTP_REAL !== '1') {
      throw new ErrorConfiguracionCorreo('Modo smtp fuera de producción: falta la autorización explícita PANSYS_PERMITIR_SMTP_REAL=1');
    }
    destinos = leerDestinos(env.PANSYS_CORREO_DESTINOS_PERMITIDOS, true);
  } else if (definida(env.PANSYS_CORREO_DESTINOS_PERMITIDOS)) {
    destinos = leerDestinos(env.PANSYS_CORREO_DESTINOS_PERMITIDOS, false);
  }
  return { modo, host, puerto: leerPuerto(env.PANSYS_SMTP_PUERTO, PUERTO_POR_TLS[tls]), remitente, tls, autenticacion: hayAutenticacion(env), destinos };
};

// Resumen del modo de correo para el arranque. Nunca incluye usuario, contraseña, remitente ni destinos.
const describirCorreo = (config) => {
  if (config.modo === 'desactivado') return 'desactivado';
  if (config.modo === 'json') return 'json (en memoria, sin red)';
  const base = `${config.modo} ${config.host}:${config.puerto}`;
  if (config.modo === 'mailpit') return `${base} (servidor local de pruebas, sin TLS ni autenticación)`;
  return `${base} (${config.tls === 'starttls' ? 'STARTTLS' : 'TLS implícito'}, ${config.autenticacion ? 'con' : 'sin'} autenticación, `
    + `${config.destinos ? `destinos restringidos: ${config.destinos.length}` : 'sin restricción de destinos'})`;
};

// Opciones del transporte de nodemailer. Es lo único que lee las credenciales; el resultado no se
// registra ni se devuelve fuera de este módulo (se exporta solo para las pruebas).
const construirOpcionesTransporte = (config, env = process.env) => {
  if (config.modo === 'json') return { jsonTransport: true };
  const comunes = { host: config.host, port: config.puerto, ...TIEMPOS, logger: false, debug: false, disableFileAccess: true, disableUrlAccess: true };
  if (config.modo === 'mailpit') {
    return { ...comunes, secure: false, ignoreTLS: true, requireTLS: false };
  }
  // smtp
  return {
    ...comunes,
    secure: config.tls === 'implicito',
    requireTLS: config.tls === 'starttls',
    ignoreTLS: false,
    tls: {
      rejectUnauthorized: true,
      minVersion: 'TLSv1.2',
      ...(net.isIP(config.host) ? {} : { servername: config.host })
    },
    ...(config.autenticacion && { auth: { user: env.PANSYS_SMTP_USUARIO, pass: env.PANSYS_SMTP_CONTRASENA } })
  };
};

// Clasificación de un fallo de envío, para el motivo de 'envio_fallido':
//  - sin_conexion: no se llegó a hablar con el servidor (DNS o conexión rechazada);
//  - rechazado: el servidor respondió con un error (dirección, mensaje, autenticación o TLS);
//  - tiempo_agotado: se agotó un tiempo, o el resultado es incierto (el correo pudo llegar).
const clasificarError = (error) => {
  const code = error?.code;
  if (code === 'ETIMEDOUT' || error instanceof ErrorTiempoCorreo) return 'tiempo_agotado';
  if (code === 'ECONNECTION' || code === 'EDNS' || code === 'ENOTFOUND' || code === 'ECONNREFUSED'
    || (code === 'ESOCKET' && error?.command === 'CONN')) return 'sin_conexion';
  if (code === 'EENVELOPE' || code === 'EMESSAGE' || code === 'EAUTH' || code === 'ETLS'
    || (Number.isInteger(error?.responseCode) && error.responseCode >= 400)) return 'rechazado';
  return 'tiempo_agotado';
};

const textoMensaje = (enlace) => [
  'Hola:',
  '',
  'Se ha solicitado restablecer la contraseña de su cuenta de Pansys.',
  'Para elegir una contraseña nueva, abra este enlace (válido durante 30 minutos y de un solo uso):',
  '',
  enlace,
  '',
  'Si no ha sido usted, ignore este mensaje: su contraseña actual sigue siendo válida.',
  'Al restablecerla se cerrarán todas las sesiones abiertas de la cuenta.'
].join('\n');

// Crea el servicio de correo.
//  - transporte: uno ya creado (p. ej. un doble en las pruebas); sustituye al de la configuración.
//  - crearTransporte: función que recibe las opciones de nodemailer (por defecto,
//    nodemailer.createTransport); permite comprobar en las pruebas las opciones exactas.
const crearCorreo = ({ env = process.env, transporte = null, crearTransporte = (o) => nodemailer.createTransport(o), tiempoMaximoMs = TIEMPO_MAXIMO_MS } = {}) => {
  let transporteCreado = transporte;

  const configuracion = () => {
    const config = leerConfiguracionCorreo(env);
    if (config.modo === 'desactivado') throw new ErrorConfiguracionCorreo('El correo está desactivado (PANSYS_CORREO_MODO)');
    return config;
  };

  // Todo envío pasa por el límite común de destinos (limitarDestinos), también con un transporte
  // inyectado. Se aplica en cada uso con la configuración vigente.
  const obtenerTransporte = (config) => {
    if (!transporteCreado) transporteCreado = crearTransporte(construirOpcionesTransporte(config, env));
    return limitarDestinos(transporteCreado, config.destinos ?? null);
  };

  return {
    // true si hay un modo activo con configuración válida (no revela por qué no lo es)
    configurado() {
      try {
        configuracion();
        return true;
      } catch {
        return false;
      }
    },

    // Envía el enlace. Resuelve sin valor si el servidor lo aceptó; si no, lanza
    // ErrorTiempoCorreo o ErrorEnvioCorreo (saneado). Nunca escribe en la consola.
    async enviarEnlaceRestablecimiento({ para, enlace }) {
      const config = configuracion();
      const envio = obtenerTransporte(config).sendMail({
        from: config.remitente,
        to: para,
        subject: 'Restablecer su contraseña de Pansys',
        text: textoMensaje(enlace),
        disableFileAccess: true,
        disableUrlAccess: true
      });
      let temporizador;
      const limite = new Promise((resolve, reject) => {
        // Sin unref(): el tope debe cumplirse aunque no quede nada más pendiente en el proceso; el
        // temporizador se cancela siempre al terminar el envío (finally)
        temporizador = setTimeout(() => reject(new ErrorTiempoCorreo()), tiempoMaximoMs);
      });
      try {
        await Promise.race([envio, limite]);
      } catch (error) {
        if (error instanceof ErrorTiempoCorreo) throw error;
        throw new ErrorEnvioCorreo(error ?? {});
      } finally {
        clearTimeout(temporizador);
        envio.catch(() => {}); // un envío que termina tarde no deja un rechazo sin atender
      }
    },

    clasificarError
  };
};

module.exports = {
  MODOS, TIEMPO_MAXIMO_MS, ErrorConfiguracionCorreo, ErrorTiempoCorreo, ErrorEnvioCorreo,
  leerConfiguracionCorreo, construirOpcionesTransporte, clasificarError, crearCorreo, describirCorreo, limitarDestinos
};
