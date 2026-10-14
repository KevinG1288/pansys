const { ErrorNegocio } = require('./errores');

const MAX_EMAIL = 255;
const PATRON_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Email recortado y con formato válido (mismo patrón y longitud que validarEmail del frontend)
const parsearEmail = (valor) => {
  const email = typeof valor === 'string' ? valor.trim() : '';
  if (!email) throw new ErrorNegocio('El email es obligatorio', 400);
  if (email.length > MAX_EMAIL || !PATRON_EMAIL.test(email)) {
    throw new ErrorNegocio('El email no es válido', 400);
  }
  return email;
};

module.exports = { parsearEmail };
