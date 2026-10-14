const { ErrorNegocio } = require('./errores');

const MINIMO_CARACTERES = 8;
const MAXIMO_BYTES = 72; // bcrypt solo usa los primeros 72 bytes

// Política de contraseñas (la misma que aplica el frontend):
// entre 8 caracteres y 72 bytes, con al menos una letra y un número
const validarContrasenaNueva = (contrasena, campo = 'La contraseña nueva') => {
  if (typeof contrasena !== 'string' || contrasena.length === 0) {
    throw new ErrorNegocio(`${campo} es obligatoria`, 400);
  }
  if (contrasena.length < MINIMO_CARACTERES) {
    throw new ErrorNegocio(`${campo} debe tener al menos ${MINIMO_CARACTERES} caracteres`, 400);
  }
  if (Buffer.byteLength(contrasena, 'utf8') > MAXIMO_BYTES) {
    throw new ErrorNegocio(`${campo} es demasiado larga (máximo ${MAXIMO_BYTES} bytes)`, 400);
  }
  if (!/\p{L}/u.test(contrasena) || !/\d/.test(contrasena)) {
    throw new ErrorNegocio(`${campo} debe incluir al menos una letra y un número`, 400);
  }
};

module.exports = { validarContrasenaNueva };
