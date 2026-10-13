const router = require('express').Router();
const inventarioController = require('./inventario.controller');
const verificarToken = require('../../middlewares/auth.middleware');
const { permitirRoles, resolverPanaderia } = require('../../middlewares/roles.middleware');
const { ADMINISTRADOR, PANADERO, GERENTE } = require('../../config/roles');

// Lectura: todos los roles. Escritura: administrador y panadero
const lectura = [verificarToken, permitirRoles(ADMINISTRADOR, PANADERO, GERENTE)];
const escritura = [verificarToken, permitirRoles(ADMINISTRADOR, PANADERO)];

router.get('/', ...lectura, resolverPanaderia(), inventarioController.getAll);
router.get('/stock-bajo', ...lectura, resolverPanaderia(), inventarioController.stockBajo);
router.get('/:id', ...lectura, resolverPanaderia({ requerida: false }), inventarioController.getById);
router.post('/', ...escritura, resolverPanaderia(), inventarioController.crear);
router.put('/:id', ...escritura, resolverPanaderia({ requerida: false }), inventarioController.actualizar);
router.delete('/:id', ...escritura, resolverPanaderia({ requerida: false }), inventarioController.eliminar);

module.exports = router;