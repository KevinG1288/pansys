const inventarioService = require('./inventario.service');

class InventarioController {

  async getAll(req, res) {
    try {
      const items = await inventarioService.getAll(req.panaderiaId);
      res.json(items);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async getById(req, res) {
    try {
      const item = await inventarioService.getById(req.params.id, req.panaderiaId);
      res.json(item);
    } catch (error) {
      res.status(404).json({ error: error.message });
    }
  }

  async crear(req, res) {
    try {
      const item = await inventarioService.crear(req.body, req.panaderiaId);
      res.status(201).json(item);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async actualizar(req, res) {
    try {
      const item = await inventarioService.actualizar(req.params.id, req.body, req.panaderiaId);
      res.json(item);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async eliminar(req, res) {
    try {
      const resultado = await inventarioService.eliminar(req.params.id, req.panaderiaId);
      res.json(resultado);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async stockBajo(req, res) {
    try {
      const items = await inventarioService.verificarStockBajo(req.panaderiaId);
      res.json(items);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
}

module.exports = new InventarioController();