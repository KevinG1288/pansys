// Errores de MySQL que indican un conflicto entre operaciones simultáneas (recuperables)
const ER_LOCK_WAIT_TIMEOUT = 1205;
const ER_LOCK_DEADLOCK = 1213;

// Error esperado de la lógica de negocio: se responde con su código HTTP y su mensaje
class ErrorNegocio extends Error {
  constructor(mensaje, status = 400, detalle = {}) {
    super(mensaje);
    this.name = 'ErrorNegocio';
    this.status = status;
    this.detalle = detalle;
  }
}

const codigoMysql = (error) => error?.parent?.errno ?? error?.original?.errno ?? error?.errno;

const esDeadlock = (error) => codigoMysql(error) === ER_LOCK_DEADLOCK;

const esConflictoConcurrencia = (error) =>
  [ER_LOCK_DEADLOCK, ER_LOCK_WAIT_TIMEOUT].includes(codigoMysql(error));

// Traduce cualquier error a una respuesta HTTP sin exponer detalles internos
const responderError = (res, error) => {
  if (error instanceof ErrorNegocio) {
    return res.status(error.status).json({ error: error.message, ...error.detalle });
  }

  if (esConflictoConcurrencia(error)) {
    return res.status(409).json({
      error: 'La operación coincidió con otra simultánea. Inténtelo de nuevo.',
      codigo: 'CONFLICTO_CONCURRENCIA',
      reintentar: true
    });
  }

  if (error?.name === 'SequelizeUniqueConstraintError') {
    return res.status(409).json({ error: 'El registro ya existe' });
  }

  console.error('Error interno:', error);
  return res.status(500).json({ error: 'Error interno del servidor' });
};

module.exports = { ErrorNegocio, esDeadlock, esConflictoConcurrencia, responderError };
