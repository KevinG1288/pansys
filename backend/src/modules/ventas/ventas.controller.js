const ventasService = require('./ventas.service');

class VentasController {

  async getAll(req, res) {
    try {
      const { panaderia_id } = req.query;
      const ventas = await ventasService.getAll(panaderia_id);
      res.json(ventas);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async crear(req, res) {
    try {
      const venta = await ventasService.crear(req.body);
      res.status(201).json(venta);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }

  async getProductos(req, res) {
    try {
      const { panaderia_id } = req.query;
      const productos = await ventasService.getProductos(panaderia_id);
      res.json(productos);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }

  async crearProducto(req, res) {
    try {
      const producto = await ventasService.crearProducto(req.body);
      res.status(201).json(producto);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }
}

module.exports = new VentasController();