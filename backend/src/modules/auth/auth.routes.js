const router = require('express').Router();
const authController = require('./auth.controller');
const verificarToken = require('../../middlewares/auth.middleware');
const { permitirRoles } = require('../../middlewares/roles.middleware');
const { ADMINISTRADOR, PANADERO, GERENTE } = require('../../config/roles');

// POST /api/auth/login
router.post('/login', authController.login);

// POST /api/auth/registrar (solo administrador)
router.post('/registrar', verificarToken, permitirRoles(ADMINISTRADOR), authController.registrar);

// PATCH /api/auth/contrasena (cualquier cuenta activa, sobre sí misma)
router.patch('/contrasena', verificarToken, permitirRoles(ADMINISTRADOR, PANADERO, GERENTE), authController.cambiarContrasena);

module.exports = router;
