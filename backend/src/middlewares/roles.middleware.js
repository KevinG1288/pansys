const ROLES = require('../config/roles');
const { Panaderia } = require('../models/index');

// Restringe la ruta a los roles indicados (usa rol_id del token)
const permitirRoles = (...rolesPermitidos) => (req, res, next) => {
  if (!req.usuario || !req.usuario.rol_id) {
    return res.status(401).json({ error: 'Sesión desactualizada, inicie sesión nuevamente' });
  }

  if (!rolesPermitidos.includes(req.usuario.rol_id)) {
    return res.status(403).json({ error: 'No tiene permisos para realizar esta acción' });
  }

  next();
};

// Determina la panadería sobre la que opera la petición y la deja en req.panaderiaId.
// Panadero y gerente: siempre la de su token (se ignora lo que envíe el cliente).
// Administrador: la indicada en query o body. Con { requerida: false } puede omitirla
// y req.panaderiaId queda en null (acceso a cualquier panadería).
const resolverPanaderia = ({ requerida = true } = {}) => async (req, res, next) => {
  try {
    if (req.usuario.rol_id !== ROLES.ADMINISTRADOR) {
      if (!req.usuario.panaderia_id) {
        return res.status(403).json({ error: 'El usuario no tiene una panadería asignada' });
      }
      req.panaderiaId = req.usuario.panaderia_id;
      return next();
    }

    const valor = req.query.panaderia_id ?? req.body?.panaderia_id;

    if (valor === undefined || valor === null || valor === '') {
      if (requerida) {
        return res.status(400).json({ error: 'panaderia_id es requerido' });
      }
      req.panaderiaId = null;
      return next();
    }

    const id = Number(valor);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'panaderia_id inválido' });
    }

    const panaderia = await Panaderia.findByPk(id);
    if (!panaderia) {
      return res.status(404).json({ error: 'Panadería no encontrada' });
    }

    req.panaderiaId = id;
    next();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = { permitirRoles, resolverPanaderia };
