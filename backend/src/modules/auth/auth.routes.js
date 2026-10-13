const router = require('express').Router();
const authController = require('./auth.controller');
const verificarToken = require('../../middlewares/auth.middleware');
const { permitirRoles } = require('../../middlewares/roles.middleware');
const { ADMINISTRADOR } = require('../../config/roles');

// POST /api/auth/login
router.post('/login', authController.login);

// POST /api/auth/registrar (solo administrador)
router.post('/registrar', verificarToken, permitirRoles(ADMINISTRADOR), authController.registrar);

module.exports = router;
