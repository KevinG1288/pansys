const crypto = require('crypto');

// Tokens de los enlaces de recuperación de contraseña. Módulo independiente de Express,
// Sequelize, MySQL y del envío de correo: solo usa crypto de Node.
//  - El token son 32 bytes aleatorios (crypto.randomBytes) en base64url: 43 caracteres.
//  - En la base solo se guarda su hash SHA-256 (64 caracteres hexadecimales).
//  - El enlace se construye EXCLUSIVAMENTE con PANSYS_URL_PUBLICA: nunca con el encabezado Host,
//    req.protocol ni ninguna otra cabecera de la petición (esta función no recibe la petición).
//  - Ningún mensaje de error incluye el token, su hash ni el valor de la URL configurada.

const BYTES_TOKEN = 32;
const FORMATO_TOKEN = /^[A-Za-z0-9_-]{43}$/; // 32 bytes en base64url, sin relleno
const RUTA_RESTABLECER = '/restablecer';
// HTTP solo se admite hacia el propio equipo (p. ej. la demo local con Mailpit)
const HOSTS_LOCALES = new Set(['localhost', '127.0.0.1', '[::1]']);

class ErrorConfiguracionUrl extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'ErrorConfiguracionUrl';
  }
}

const generarToken = () => crypto.randomBytes(BYTES_TOKEN).toString('base64url');

const esFormatoToken = (token) => typeof token === 'string' && FORMATO_TOKEN.test(token);

// Hash que se guarda en la base. Solo acepta tokens con el formato de generarToken.
const hashToken = (token) => {
  if (!esFormatoToken(token)) throw new TypeError('Token con formato no válido');
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
};

// Origen público validado (protocolo, host y puerto), a partir de la configuración:
//  - PANSYS_URL_PUBLICA: obligatoria; URL absoluta sin usuario, contraseña, ruta, consulta ni
//    fragmento (se admite solo la barra final).
//  - https siempre. http únicamente si PANSYS_PERMITIR_HTTP_LOCAL vale exactamente '1', el host es
//    local (localhost, 127.0.0.1 o [::1]) y NODE_ENV no es 'production'.
const leerUrlPublica = (env = process.env) => {
  const valor = env?.PANSYS_URL_PUBLICA;
  if (typeof valor !== 'string' || valor.trim() === '') {
    throw new ErrorConfiguracionUrl('Falta PANSYS_URL_PUBLICA: no se pueden construir enlaces de recuperación');
  }
  if (valor !== valor.trim()) {
    throw new ErrorConfiguracionUrl('PANSYS_URL_PUBLICA no puede tener espacios al principio ni al final');
  }

  let url;
  try {
    url = new URL(valor);
  } catch {
    throw new ErrorConfiguracionUrl('PANSYS_URL_PUBLICA no es una URL absoluta válida');
  }

  if (url.username || url.password) {
    throw new ErrorConfiguracionUrl('PANSYS_URL_PUBLICA no puede incluir usuario ni contraseña');
  }
  if ((url.pathname !== '/' && url.pathname !== '') || url.search || url.hash || valor.includes('?') || valor.includes('#')) {
    throw new ErrorConfiguracionUrl('PANSYS_URL_PUBLICA debe ser solo el origen (protocolo, host y puerto), sin ruta, consulta ni fragmento');
  }

  if (url.protocol === 'https:') return url.origin;
  if (url.protocol !== 'http:') {
    throw new ErrorConfiguracionUrl('PANSYS_URL_PUBLICA debe usar https');
  }

  // http: solo con permiso explícito, fuera de producción y hacia el propio equipo
  if (env.PANSYS_PERMITIR_HTTP_LOCAL !== '1') {
    throw new ErrorConfiguracionUrl('PANSYS_URL_PUBLICA debe usar https (http solo con PANSYS_PERMITIR_HTTP_LOCAL=1 y un host local)');
  }
  if (env.NODE_ENV === 'production') {
    throw new ErrorConfiguracionUrl('PANSYS_URL_PUBLICA debe usar https en producción');
  }
  if (!HOSTS_LOCALES.has(url.hostname)) {
    throw new ErrorConfiguracionUrl('Con http, PANSYS_URL_PUBLICA solo puede apuntar a localhost, 127.0.0.1 o [::1]');
  }
  return url.origin;
};

// Enlace del correo: <origen público>/restablecer#token=<token>. El token va en el fragmento
// (#), que el navegador nunca envía al servidor ni incluye en el encabezado Referer.
const construirEnlace = (token, env = process.env) => {
  if (!esFormatoToken(token)) throw new TypeError('Token con formato no válido');
  return `${leerUrlPublica(env)}${RUTA_RESTABLECER}#token=${token}`;
};

module.exports = {
  BYTES_TOKEN, RUTA_RESTABLECER, ErrorConfiguracionUrl,
  generarToken, esFormatoToken, hashToken, leerUrlPublica, construirEnlace
};
