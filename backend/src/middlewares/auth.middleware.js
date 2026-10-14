const jwt = require('jsonwebtoken');
const { Usuario, Rol } = require('../models/index');

// Autentica la petición. El token solo identifica a la cuenta (id): rol, panadería, email y
// estado se leen de la base de datos en cada petición, así un cambio de rol, de panadería o
// una desactivación tienen efecto inmediato aunque el token siga vigente.
// 401 = autenticación no válida (sin token, token inválido o caducado, cuenta inexistente o
// desactivada): el frontend cierra la sesión. Los permisos insuficientes son 403 (roles.middleware).
const verificarToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token no proporcionado' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    const mensaje = error.name === 'TokenExpiredError'
      ? 'La sesión expiró. Inicia sesión nuevamente.'
      : 'Token inválido';
    return res.status(401).json({ error: mensaje });
  }

  try {
    const usuario = Number.isInteger(decoded?.id)
      ? await Usuario.findByPk(decoded.id, {
        attributes: ['id', 'email', 'rol_id', 'panaderia_id', 'estado'],
        include: [{ model: Rol, attributes: ['nombre'] }]
      })
      : null;
    if (!usuario || !usuario.estado) {
      return res.status(401).json({ error: 'La cuenta no está activa. Inicia sesión con una cuenta activa.' });
    }

    // Mismos campos que el token emitido por /login, con los valores actuales
    req.usuario = {
      id: usuario.id,
      email: usuario.email,
      rol: usuario.Rol?.nombre ?? null,
      rol_id: usuario.rol_id,
      panaderia_id: usuario.panaderia_id ?? null
    };
  } catch (error) {
    console.error('Error interno:', error);
    return res.status(500).json({ error: 'Error interno del servidor' });
  }

  next();
};

module.exports = verificarToken;
