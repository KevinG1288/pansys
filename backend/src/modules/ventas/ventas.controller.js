const ventasService = require('./ventas.service');

class VentasController {

  async getAll(req, res) {
    try {
      const ventas = await ventasService.getAll(req.panaderiaId);
      res.json(ventas);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async crear(req, res) {
    try {
      // El empleado es siempre el usuario autenticado
      const venta = await ventasService.crear(req.body, req.panaderiaId, req.usuario.id);
      res.status(201).json(venta);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async getProductos(req, res) {
    try {
      const productos = await ventasService.getProductos(req.panaderiaId);
      res.json(productos);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async crearProducto(req, res) {
    try {
      const producto = await ventasService.crearProducto(req.body, req.panaderiaId);
      res.status(201).json(producto);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }
}

module.exports = new VentasController();