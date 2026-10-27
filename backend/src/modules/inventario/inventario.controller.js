const inventarioService = require('./inventario.service');
const { responderError, responderErrorDeDatos } = require('../../utils/errores');

class InventarioController {

  async getAll(req, res) {
    try {
      const items = await inventarioService.getAll(req.panaderiaId);
      res.json(items);
    } catch (error) {
      responderError(res, error);
    }
  }

  async getById(req, res) {
    try {
      const item = await inventarioService.getById(req.params.id, req.panaderiaId);
      res.json(item);
    } catch (error) {
      // 404 materia prima no encontrada; cualquier error interno es un 500 sin detalles
      responderError(res, error);
    }
  }

  async crear(req, res) {
    try {
      const item = await inventarioService.crear(req.body, req.panaderiaId);
      res.status(201).json(item);
    } catch (error) {
      // 400 si faltan campos o un valor no es válido; cualquier error interno es un 500 sin detalles
      responderErrorDeDatos(res, error, inventarioService.CAMPOS_EDITABLES);
    }
  }

  async actualizar(req, res) {
    try {
      const item = await inventarioService.actualizar(req.params.id, req.body, req.panaderiaId);
      res.json(item);
    } catch (error) {
      // 400 si no existe, faltan campos o un valor no es válido; cualquier error interno es un 500
      responderErrorDeDatos(res, error, inventarioService.CAMPOS_EDITABLES);
    }
  }

  async eliminar(req, res) {
    try {
      const resultado = await inventarioService.eliminar(req.params.id, req.panaderiaId);
      res.json(resultado);
    } catch (error) {
      // 400 materia prima no encontrada; cualquier error interno es un 500 sin detalles
      responderError(res, error);
    }
  }

  async stockBajo(req, res) {
    try {
      const items = await inventarioService.verificarStockBajo(req.panaderiaId);
      res.json(items);
    } catch (error) {
      responderError(res, error);
    }
  }
}

module.exports = new InventarioController();