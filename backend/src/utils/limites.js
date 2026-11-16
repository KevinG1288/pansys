// Claves de los limitadores en memoria (recuperación de contraseña e inicio de sesión).
// La IP y el correo nunca se guardan en claro como clave de correo ni se registran: el correo se
// reduce a su SHA-256 en minúsculas. Mismas funciones que usaba restablecimiento.service.js.
const crypto = require('crypto');

const claveIp = (ip) => `ip:${typeof ip === 'string' && ip ? ip.slice(0, 100) : 'desconocida'}`;
const claveCorreo = (email) => `correo:${crypto.createHash('sha256').update(email.toLowerCase(), 'utf8').digest('hex')}`;

module.exports = { claveIp, claveCorreo };
