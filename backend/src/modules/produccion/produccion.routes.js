const router = require('express').Router();
const recetasController = require('./recetas.controller');
const ordenesController = require('./ordenes.controller');
const verificarToken = require('../../middlewares/auth.middleware');
const { permitirRoles, resolverPanaderia } = require('../../middlewares/roles.middleware');
const { ADMINISTRADOR, PANADERO, GERENTE } = require('../../config/roles');

// Lectura: todos los roles. Escritura: administrador y panadero
const lectura = [verificarToken, permitirRoles(ADMINISTRADOR, PANADERO, GERENTE)];
const escritura = [verificarToken, permitirRoles(ADMINISTRADOR, PANADERO)];

// Panadería obligatoria para listar y crear; en rutas por id la determina el registro
const panaderia = resolverPanaderia();
const panaderiaOpcional = resolverPanaderia({ requerida: false });

// Recetas
router.get('/recetas', ...lectura, panaderia, recetasController.listar);
router.get('/recetas/:producto_id', ...lectura, panaderiaOpcional, recetasController.obtener);
router.post('/recetas/:producto_id', ...escritura, panaderiaOpcional, recetasController.crear);
router.put('/recetas/:producto_id', ...escritura, panaderiaOpcional, recetasController.actualizar);
router.delete('/recetas/:producto_id', ...escritura, panaderiaOpcional, recetasController.eliminar);

// Cálculo previo de insumos (solo lectura)
router.get('/calcular', ...lectura, panaderiaOpcional, recetasController.calcular);

// Órdenes de producción
router.get('/ordenes', ...lectura, panaderia, ordenesController.listar);
router.get('/ordenes/:id', ...lectura, panaderiaOpcional, ordenesController.obtener);
router.post('/ordenes', ...escritura, panaderia, ordenesController.crear);
router.patch('/ordenes/:id/finalizar', ...escritura, panaderiaOpcional, ordenesController.finalizar);
router.patch('/ordenes/:id/cancelar', ...escritura, panaderiaOpcional, ordenesController.cancelar);

module.exports = router;
