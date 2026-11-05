const { ErrorNegocio, responderError } = require('../../utils/errores');

// Rechazos de negocio de la red colaborativa (códigos del protocolo validado en el ensayo E6) y su
// respuesta HTTP. Cada respuesta lleva { error, codigo } y, si aplica, un detalle sin datos ajenos.
const RECHAZOS = Object.freeze({
  FUERA_DE_RED: [409, 'Una de las panaderías no participa en la red colaborativa'],
  PANADERIA_NO_ENCONTRADA: [404, 'Panadería no encontrada en la red'],
  MISMA_PANADERIA: [400, 'La operación requiere otra panadería de la red'],
  SOLICITUD_NO_ENCONTRADA: [404, 'Solicitud no encontrada'],
  LADO_NO_AUTORIZADO: [403, 'Solo la panadería proveedora puede aceptar o rechazar una solicitud y solo la solicitante puede cancelarla'],
  LINEAS_NO_COINCIDEN: [400, 'Indique la materia prima de origen de todas las líneas de la solicitud, y solo de ellas'],
  CONTADOR_DESCUADRADO: [500, 'La red detectó una inconsistencia interna; la operación no se aplicó'],
  PAREJA_INEXISTENTE: [409, 'La solicitud no tiene una pareja de panaderías válida'],
  LIMITE_PENDIENTES: [409, 'Ya hay 10 solicitudes pendientes entre estas panaderías'],
  MATERIA_INACTIVA_O_AJENA: [409, 'Alguna materia prima de destino no es propia o no está activa'],
  YA_CERRADA: [409, 'La solicitud ya no está pendiente'],
  ORIGEN_NO_VALIDO: [409, 'Alguna materia prima de origen no es propia o no está activa'],
  DESTINO_NO_VALIDO: [409, 'Alguna materia prima de destino ya no está activa en la panadería solicitante'],
  UNIDAD_DISTINTA: [409, 'La materia prima de origen debe tener la misma unidad de medida que la solicitada'],
  INSUFICIENTE: [409, 'No hay inventario suficiente para aceptar la solicitud'],
  TOPE: [409, 'La entrada superaría el máximo de inventario (99.999.999,9999)'],
  VERSION_AGOTADA: [409, 'La materia prima alcanzó el límite de versiones'],
  VERSION_DESACTUALIZADA: [409, 'La materia prima cambió desde que se consultó. Recargue e inténtelo de nuevo'],
  MATERIA_EN_SOLICITUD_PENDIENTE: [409, 'La materia prima forma parte de una solicitud pendiente de la red']
});

// Rechazo de negocio con su código (siempre un código conocido)
const rechazo = (codigo, detalle = {}) => {
  const definicion = RECHAZOS[codigo];
  if (!definicion) throw new Error(`Código de rechazo desconocido: ${codigo}`);
  const [status, mensaje] = definicion;
  return new ErrorNegocio(mensaje, status, { codigo, ...detalle });
};

const codigoMysql = (error) => error?.parent?.errno ?? error?.original?.errno ?? error?.errno;

// Claves foráneas: con privilegios restringidos MySQL responde 1216/1217 en lugar de 1452/1451 y no
// nombra la restricción (ensayo L1a 20261105T001953Z), así que no se depende del nombre.
const ERRORES_INTEGRIDAD = [1216, 1217, 1451, 1452];
const ER_CHECK_CONSTRAINT_VIOLATED = 3819;
const ER_DUP_ENTRY = 1062;

// Respuesta de los controladores de la red: los errores de integridad de MySQL son un 409 genérico
// (sin el mensaje interno); lo demás sigue la respuesta común (ErrorNegocio, concurrencia 1205/1213 → 409
// con reintentar, cualquier otro error → 500 sin detalles).
const responderErrorRed = (res, error) => {
  const errno = codigoMysql(error);
  if (ERRORES_INTEGRIDAD.includes(errno)) {
    return res.status(409).json({ error: 'La operación no es coherente con los datos actuales de la red', codigo: 'CONFLICTO_INTEGRIDAD' });
  }
  if (errno === ER_CHECK_CONSTRAINT_VIOLATED) {
    return res.status(409).json({ error: 'La operación no cumple las reglas de la red', codigo: 'CONFLICTO_RESTRICCION' });
  }
  if (errno === ER_DUP_ENTRY) {
    return res.status(409).json({ error: 'La operación ya se registró', codigo: 'CONFLICTO_DUPLICADO' });
  }
  // Un rechazo de integridad interna (p. ej. CONTADOR_DESCUADRADO) se registra para su revisión
  if (error instanceof ErrorNegocio && error.status >= 500) console.error('Red colaborativa: inconsistencia interna', error.detalle?.codigo);
  return responderError(res, error);
};

module.exports = { RECHAZOS, rechazo, responderErrorRed, codigoMysql, ERRORES_INTEGRIDAD };
