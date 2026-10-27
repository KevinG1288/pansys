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

// Errores de MySQL por un valor enviado por el cliente, con la columna afectada en el mensaje:
// 1048 nulo, 1264 fuera de rango, 1265 truncado, 1366 valor incorrecto, 1406 demasiado largo
const ERRORES_MYSQL_DE_DATOS = [1048, 1264, 1265, 1366, 1406];

// Columna que nombra el mensaje de MySQL ('c', `c` o `base`.`tabla`.`c`), o null si no la nombra
const columnaMysql = (mensaje) => {
  const m = /^Column (\S+) cannot be null$/.exec(mensaje) ?? / for column (\S+) at row \d+$/.exec(mensaje);
  return m ? m[1].replace(/[`'"]/g, '').split('.').pop() : null;
};

// Para escrituras con datos del cliente: un error del modelo (campo nulo o texto que no es texto)
// o de MySQL (formato, rango o longitud) solo es un 400 si afecta a campos que envía el cliente
// (camposCliente). Cualquier otro caso, incluido un campo que fija el servidor, sigue siendo interno.
const responderErrorDeDatos = (res, error, camposCliente) => {
  if (error?.name === 'SequelizeValidationError') {
    const items = Array.isArray(error.errors) ? error.errors : [];
    if (items.length && items.every(e => e?.origin === 'CORE' && camposCliente.includes(e.path))) {
      const campos = [...new Set(items.map(e => e.path))];
      return res.status(400).json({ error: `Campos requeridos o inválidos: ${campos.join(', ')}` });
    }
  }

  if (error?.name === 'SequelizeDatabaseError' && ERRORES_MYSQL_DE_DATOS.includes(codigoMysql(error))) {
    const columna = columnaMysql(String(error.parent?.sqlMessage ?? error.parent?.message ?? ''));
    if (columna && camposCliente.includes(columna)) {
      return res.status(400).json({ error: 'Datos inválidos' });
    }
  }

  return responderError(res, error);
};

module.exports = { ErrorNegocio, esDeadlock, esConflictoConcurrencia, responderError, responderErrorDeDatos };
