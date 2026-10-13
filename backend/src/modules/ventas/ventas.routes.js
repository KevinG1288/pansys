const router = require('express').Router();
const ventasController = require('./ventas.controller');
const verificarToken = require('../../middlewares/auth.middleware');
const { permitirRoles, resolverPanaderia } = require('../../middlewares/roles.middleware');
const { ADMINISTRADOR, PANADERO, GERENTE } = require('../../config/roles');

// Lectura: todos los roles. Escritura: administrador y panadero
const lectura = [verificarToken, permitirRoles(ADMINISTRADOR, PANADERO, GERENTE), resolverPanaderia()];
const escritura = [verificarToken, permitirRoles(ADMINISTRADOR, PANADERO), resolverPanaderia()];

router.get('/', ...lectura, ventasController.getAll);
router.post('/', ...escritura, ventasController.crear);
router.get('/productos', ...lectura, ventasController.getProductos);
router.post('/productos', ...escritura, ventasController.crearProducto);

module.exports = router;