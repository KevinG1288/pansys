const { ErrorNegocio } = require('./errores');

const LIMITE_VERSION = 4294967294;
const conflictoVersion = () => new ErrorNegocio('La materia prima cambió desde que se consultó. Recargue e inténtelo de nuevo', 409, { codigo: 'VERSION_DESACTUALIZADA' });
const parsearVersion = (valor) => {
  if (!Number.isInteger(valor) || valor < 0 || valor > LIMITE_VERSION) {
    throw new ErrorNegocio('version_fila debe ser un entero entre 0 y 4294967294', 400);
  }
  return valor;
};
const exigirVersionDisponible = (valor) => {
  if (!Number.isInteger(valor) || valor < 0 || valor > LIMITE_VERSION) throw new Error('Versión de materia prima inválida en almacenamiento');
  if (valor === LIMITE_VERSION) throw new ErrorNegocio('La materia prima alcanzó el límite de versiones', 409, { codigo: 'VERSION_AGOTADA' });
};
module.exports = { LIMITE_VERSION, parsearVersion, exigirVersionDisponible, conflictoVersion };
