const router = require('express').Router();
const authController = require('./auth.controller');

// POST /api/auth/login
router.post('/login', authController.login);

// POST /api/auth/registrar
router.post('/registrar', authController.registrar);

module.exports = router;