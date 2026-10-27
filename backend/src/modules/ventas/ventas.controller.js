const ventasService = require('./ventas.service');
const { responderError, responderErrorDeDatos } = require('../../utils/errores');

class VentasController {

  async getAll(req, res) {
    try {
      const ventas = await ventasService.getAll(req.panaderiaId);
      res.json(ventas);
    } catch (error) {
      responderError(res, error);
    }
  }

  async crear(req, res) {
    try {
      // El empleado es siempre el usuario autenticado
      const venta = await ventasService.crear(req.body, req.panaderiaId, req.usuario.id);
      res.status(201).json(venta);
    } catch (error) {
      // 400 datos inválidos, 404 producto ajeno o inexistente, 409 stock insuficiente o conflicto, 500 interno
      responderError(res, error);
    }
  }

  async getProductos(req, res) {
    try {
      const productos = await ventasService.getProductos(req.panaderiaId);
      res.json(productos);
    } catch (error) {
      responderError(res, error);
    }
  }

  async crearProducto(req, res) {
    try {
      const producto = await ventasService.crearProducto(req.body, req.panaderiaId);
      res.status(201).json(producto);
    } catch (error) {
      // 400 si faltan campos o un valor no es válido; cualquier error interno es un 500 sin detalles
      responderErrorDeDatos(res, error, ventasService.CAMPOS_PRODUCTO);
    }
  }
}

module.exports = new VentasController();