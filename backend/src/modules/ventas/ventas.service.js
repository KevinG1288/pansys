const { Venta, DetalleVenta, Producto } = require('../../models/index');

class VentasService {

  async getAll(panaderia_id) {
    return await Venta.findAll({
      where: { panaderia_id },
      include: [{ model: DetalleVenta, include: [Producto] }],
      order: [['createdAt', 'DESC']]
    });
  }

  async crear(datos) {
    const { empleado_id, panaderia_id, productos } = datos;

    let total = 0;
    const detalles = [];

    for (const p of productos) {
      const producto = await Producto.findByPk(p.producto_id);
      if (!producto) throw new Error(`Producto ${p.producto_id} no encontrado`);
      const subtotal = producto.precio_venta * p.cantidad;
      total += subtotal;
      detalles.push({
        producto_id: p.producto_id,
        cantidad: p.cantidad,
        precio_unitario: producto.precio_venta,
        subtotal
      });
    }

    const venta = await Venta.create({ empleado_id, panaderia_id, total });

    for (const d of detalles) {
      await DetalleVenta.create({ ...d, venta_id: venta.id });
    }

    return venta;
  }

  async getProductos(panaderia_id) {
    return await Producto.findAll({
      where: { panaderia_id, estado: true }
    });
  }

  async crearProducto(datos) {
    return await Producto.create(datos);
  }
}

module.exports = new VentasService();