const recetasService = require('./recetas.service');
const { responderError } = require('../../utils/errores');

class RecetasController {

  async listar(req, res) {
    try {
      const recetas = await recetasService.listar(req.panaderiaId);
      res.json(recetas);
    } catch (error) {
      responderError(res, error);
    }
  }

  async obtener(req, res) {
    try {
      const receta = await recetasService.obtener(req.params.producto_id, req.panaderiaId);
      res.json(receta);
    } catch (error) {
      responderError(res, error);
    }
  }

  async crear(req, res) {
    try {
      const receta = await recetasService.guardar(req.params.producto_id, req.panaderiaId, req.body, { crear: true });
      res.status(201).json(receta);
    } catch (error) {
      responderError(res, error);
    }
  }

  async actualizar(req, res) {
    try {
      const receta = await recetasService.guardar(req.params.producto_id, req.panaderiaId, req.body, { crear: false });
      res.json(receta);
    } catch (error) {
      responderError(res, error);
    }
  }

  async eliminar(req, res) {
    try {
      const resultado = await recetasService.eliminar(req.params.producto_id, req.panaderiaId);
      res.json(resultado);
    } catch (error) {
      responderError(res, error);
    }
  }

  async calcular(req, res) {
    try {
      const { producto_id, cantidad } = req.query;
      const calculo = await recetasService.calcular(producto_id, cantidad, req.panaderiaId);
      res.json(calculo);
    } catch (error) {
      responderError(res, error);
    }
  }
}

module.exports = new RecetasController();
