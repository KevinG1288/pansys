const ordenesService = require('./ordenes.service');
const { responderError } = require('../../utils/errores');

class OrdenesController {

  async listar(req, res) {
    try {
      const ordenes = await ordenesService.listar(req.panaderiaId, req.query);
      res.json(ordenes);
    } catch (error) {
      responderError(res, error);
    }
  }

  async obtener(req, res) {
    try {
      const orden = await ordenesService.obtener(req.params.id, req.panaderiaId);
      res.json(orden);
    } catch (error) {
      responderError(res, error);
    }
  }

  async crear(req, res) {
    try {
      // El empleado es siempre el usuario autenticado
      const resultado = await ordenesService.crear(req.body, req.panaderiaId, req.usuario.id);
      res.status(201).json(resultado);
    } catch (error) {
      responderError(res, error);
    }
  }

  async finalizar(req, res) {
    try {
      const orden = await ordenesService.finalizar(req.params.id, req.body, req.panaderiaId, req.usuario.id);
      res.json(orden);
    } catch (error) {
      responderError(res, error);
    }
  }

  async cancelar(req, res) {
    try {
      const orden = await ordenesService.cancelar(req.params.id, req.body, req.panaderiaId, req.usuario.id);
      res.json(orden);
    } catch (error) {
      responderError(res, error);
    }
  }
}

module.exports = new OrdenesController();
