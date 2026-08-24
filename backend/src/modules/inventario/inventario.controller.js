const inventarioService = require('./inventario.service');

class InventarioController {

  async getAll(req, res) {
    try {
      const { panaderia_id } = req.query;
      const items = await inventarioService.getAll(panaderia_id);
      res.json(items);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getById(req, res) {
    try {
      const item = await inventarioService.getById(req.params.id);
      res.json(item);
    } catch (error) {
      res.status(404).json({ error: error.message });
    }
  }

  async crear(req, res) {
    try {
      const item = await inventarioService.crear(req.body);
      res.status(201).json(item);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async actualizar(req, res) {
    try {
      const item = await inventarioService.actualizar(req.params.id, req.body);
      res.json(item);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async eliminar(req, res) {
    try {
      const resultado = await inventarioService.eliminar(req.params.id);
      res.json(resultado);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async stockBajo(req, res) {
    try {
      const { panaderia_id } = req.query;
      const items = await inventarioService.verificarStockBajo(panaderia_id);
      res.json(items);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
}

module.exports = new InventarioController();