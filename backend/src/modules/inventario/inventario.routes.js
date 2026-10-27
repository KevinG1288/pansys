const router = require('express').Router();
const inventarioController = require('./inventario.controller');
const verificarToken = require('../../middlewares/auth.middleware');
const { permitirRoles, resolverPanaderia } = require('../../middlewares/roles.middleware');
const { ADMINISTRADOR, PANADERO, GERENTE } = require('../../config/roles');

// Lectura: todos los roles. Escritura: administrador y panadero. Siempre la panadería de la cuenta.
const lectura = [verificarToken, permitirRoles(ADMINISTRADOR, PANADERO, GERENTE), resolverPanaderia()];
const escritura = [verificarToken, permitirRoles(ADMINISTRADOR, PANADERO), resolverPanaderia()];

router.get('/', ...lectura, inventarioController.getAll);
router.get('/stock-bajo', ...lectura, inventarioController.stockBajo);
router.get('/:id', ...lectura, inventarioController.getById);
router.post('/', ...escritura, inventarioController.crear);
router.put('/:id', ...escritura, inventarioController.actualizar);
router.delete('/:id', ...escritura, inventarioController.eliminar);

module.exports = router;