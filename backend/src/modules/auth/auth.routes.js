const router = require('express').Router();
const authController = require('./auth.controller');
const restablecimientoController = require('./restablecimiento.controller');
const verificarToken = require('../../middlewares/auth.middleware');
const { permitirRoles } = require('../../middlewares/roles.middleware');
const { ADMINISTRADOR, PANADERO, GERENTE } = require('../../config/roles');

// POST /api/auth/login
router.post('/login', authController.login);

// POST /api/auth/registrar (solo administrador)
router.post('/registrar', verificarToken, permitirRoles(ADMINISTRADOR), authController.registrar);

// PATCH /api/auth/contrasena (cualquier cuenta activa, sobre sí misma)
router.patch('/contrasena', verificarToken, permitirRoles(ADMINISTRADOR, PANADERO, GERENTE), authController.cambiarContrasena);

// Restablecimiento de contraseña (públicos, sin sesión):
// POST /api/auth/restablecimiento/solicitar  -> 202 siempre que el formato sea válido
// POST /api/auth/restablecimiento/validar    -> estado del enlace (200 activo, 202 procesando)
// POST /api/auth/restablecimiento/confirmar  -> consume el enlace y cambia la contraseña
router.post('/restablecimiento/solicitar', restablecimientoController.solicitar);
router.post('/restablecimiento/validar', restablecimientoController.validar);
router.post('/restablecimiento/confirmar', restablecimientoController.confirmar);

module.exports = router;
