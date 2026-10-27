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
// Para todos los roles es la de la cuenta autenticada (verificarToken la lee de la base en cada
// petición); el panaderia_id que envíe el cliente en la query o el cuerpo se ignora.
// Una cuenta sin panadería asignada no accede a los módulos de negocio (403).
const resolverPanaderia = () => (req, res, next) => {
  const panaderiaId = req.usuario?.panaderia_id;
  if (!Number.isSafeInteger(panaderiaId) || panaderiaId <= 0) {
    return res.status(403).json({ error: 'El usuario no tiene una panadería asignada' });
  }
  req.panaderiaId = panaderiaId;
  next();
};

module.exports = { permitirRoles, resolverPanaderia };
