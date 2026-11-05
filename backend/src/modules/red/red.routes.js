const router = require('express').Router();
const redController = require('./red.controller');
const verificarToken = require('../../middlewares/auth.middleware');
const { permitirRoles, resolverPanaderia } = require('../../middlewares/roles.middleware');
const { ADMINISTRADOR, PANADERO, GERENTE } = require('../../config/roles');

// Red colaborativa. Lectura: todos los roles (el gerente SOLO lee). Escritura: administrador y panadero.
// Siempre la panadería de la cuenta.
const lectura = [verificarToken, permitirRoles(ADMINISTRADOR, PANADERO, GERENTE), resolverPanaderia()];
const escritura = [verificarToken, permitirRoles(ADMINISTRADOR, PANADERO), resolverPanaderia()];

router.get('/panaderias', ...lectura, redController.directorio);
router.get('/panaderias/:id/disponibilidad', ...lectura, redController.disponibilidad);
router.get('/resumen', ...lectura, redController.resumen);
router.get('/solicitudes', ...lectura, redController.bandeja);
router.get('/solicitudes/:id', ...lectura, redController.detalle);
router.get('/movimientos', ...lectura, redController.movimientos);
router.post('/solicitudes', ...escritura, redController.crear);
router.post('/solicitudes/:id/aceptar', ...escritura, redController.aceptar);
router.post('/solicitudes/:id/rechazar', ...escritura, redController.rechazar);
router.post('/solicitudes/:id/cancelar', ...escritura, redController.cancelar);

module.exports = router;
