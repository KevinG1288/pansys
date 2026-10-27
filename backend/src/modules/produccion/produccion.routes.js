const router = require('express').Router();
const recetasController = require('./recetas.controller');
const ordenesController = require('./ordenes.controller');
const verificarToken = require('../../middlewares/auth.middleware');
const { permitirRoles, resolverPanaderia } = require('../../middlewares/roles.middleware');
const { ADMINISTRADOR, PANADERO, GERENTE } = require('../../config/roles');

// Lectura: todos los roles. Escritura: administrador y panadero. Siempre la panadería de la cuenta:
// en las rutas por id, un registro de otra panadería no se encuentra (404).
const lectura = [verificarToken, permitirRoles(ADMINISTRADOR, PANADERO, GERENTE), resolverPanaderia()];
const escritura = [verificarToken, permitirRoles(ADMINISTRADOR, PANADERO), resolverPanaderia()];

// Recetas
router.get('/recetas', ...lectura, recetasController.listar);
router.get('/recetas/:producto_id', ...lectura, recetasController.obtener);
router.post('/recetas/:producto_id', ...escritura, recetasController.crear);
router.put('/recetas/:producto_id', ...escritura, recetasController.actualizar);
router.delete('/recetas/:producto_id', ...escritura, recetasController.eliminar);

// Cálculo previo de insumos (solo lectura)
router.get('/calcular', ...lectura, recetasController.calcular);

// Órdenes de producción
router.get('/ordenes', ...lectura, ordenesController.listar);
router.get('/ordenes/:id', ...lectura, ordenesController.obtener);
router.post('/ordenes', ...escritura, ordenesController.crear);
router.patch('/ordenes/:id/finalizar', ...escritura, ordenesController.finalizar);
router.patch('/ordenes/:id/cancelar', ...escritura, ordenesController.cancelar);

module.exports = router;
