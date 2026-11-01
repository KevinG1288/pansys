const bcrypt = require('bcrypt');
const tokens = require('../../utils/tokens');
const { crearCorreo } = require('../../utils/correo');
const { ErrorNegocio, esConflictoConcurrencia } = require('../../utils/errores');
const repositorio = require('./restablecimiento.repositorio');
const { crearServicio, registroSeguro } = require('./restablecimiento.service');

// Respuesta de error sin registrar datos sensibles. A diferencia de responderError (que registra el
// error completo, y un error de Sequelize lleva el SQL con sus parámetros, p. ej. el token_hash),
// aquí solo se registran el nombre y el código del error. Los 429 llevan Retry-After.
const responder = (res, error) => {
  if (error instanceof ErrorNegocio) {
    if (error.status === 429 && Number.isInteger(error.retryAfterS)) res.set('Retry-After', String(error.retryAfterS));
    return res.status(error.status).json({ error: error.message, ...error.detalle });
  }
  if (esConflictoConcurrencia(error) || error?.name === 'SequelizeUniqueConstraintError') {
    return res.status(409).json({
      error: 'La operación coincidió con otra simultánea. Inténtelo de nuevo.',
      codigo: 'CONFLICTO_CONCURRENCIA',
      reintentar: true
    });
  }
  registroSeguro('restablecimiento de contraseña', error);
  return res.status(500).json({ error: 'Error interno del servidor' });
};

// La IP solo se usa como clave de los limitadores en memoria: nunca se guarda en la base ni se
// registra. req.ip es la dirección de la conexión (Express sin trust proxy).
const crearControlador = (servicio) => {
  const manejar = (operacion, datos) => async (req, res) => {
    try {
      const { status, cuerpo } = await servicio[operacion](datos(req));
      res.status(status).json(cuerpo);
    } catch (error) {
      responder(res, error);
    }
  };
  return {
    solicitar: manejar('solicitarPropio', (req) => ({ email: req.body?.email, ip: req.ip })),
    validar: manejar('validar', (req) => ({ token: req.body?.token, ip: req.ip })),
    confirmar: manejar('confirmar', (req) => ({ token: req.body?.token, contrasena: req.body?.contrasena_nueva, ip: req.ip })),
    solicitarAsistido: manejar('solicitarAsistido', (req) => ({ actorId: req.usuario.id, idTexto: req.params.id, contrasena: req.body?.contrasena }))
  };
};

module.exports = crearControlador(crearServicio({ repo: repositorio, correo: crearCorreo(), tokens, bcrypt }));
module.exports.crearControlador = crearControlador;
module.exports.responder = responder;
