const router = require('express').Router();
const ventasController = require('./ventas.controller');
const verificarToken = require('../../middlewares/auth.middleware');

router.get('/', verificarToken, ventasController.getAll);
router.post('/', verificarToken, ventasController.crear);
router.get('/productos', verificarToken, ventasController.getProductos);
router.post('/productos', verificarToken, ventasController.crearProducto);

module.exports = router;