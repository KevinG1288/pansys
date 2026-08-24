const router = require('express').Router();
const inventarioController = require('./inventario.controller');
const verificarToken = require('../../middlewares/auth.middleware');

// Todas las rutas requieren token
router.get('/', verificarToken, inventarioController.getAll);
router.get('/stock-bajo', verificarToken, inventarioController.stockBajo);
router.get('/:id', verificarToken, inventarioController.getById);
router.post('/', verificarToken, inventarioController.crear);
router.put('/:id', verificarToken, inventarioController.actualizar);
router.delete('/:id', verificarToken, inventarioController.eliminar);

module.exports = router;