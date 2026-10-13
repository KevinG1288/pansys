const { Venta, DetalleVenta, Producto } = require('../../models/index');

// Campos que el cliente puede enviar al crear un producto (panaderia_id y estado los fija el servidor)
const CAMPOS_PRODUCTO = ['nombre', 'precio_compra', 'precio_venta', 'cantidad_disponible'];

class VentasService {

  async getAll(panaderiaId) {
    return await Venta.findAll({
      where: { panaderia_id: panaderiaId },
      include: [{ model: DetalleVenta, include: [Producto] }],
      order: [['createdAt', 'DESC']]
    });
  }

  async crear(datos, panaderiaId, empleadoId) {
    const { productos } = datos;

    let total = 0;
    const detalles = [];

    for (const p of productos) {
      // Solo productos activos de la misma panadería
      const producto = await Producto.findOne({
        where: { id: p.producto_id, panaderia_id: panaderiaId, estado: true }
      });
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

    const venta = await Venta.create({ empleado_id: empleadoId, panaderia_id: panaderiaId, total });

    for (const d of detalles) {
      await DetalleVenta.create({ ...d, venta_id: venta.id });
    }

    return venta;
  }

  async getProductos(panaderiaId) {
    return await Producto.findAll({
      where: { panaderia_id: panaderiaId, estado: true }
    });
  }

  async crearProducto(datos, panaderiaId) {
    const campos = Object.fromEntries(
      CAMPOS_PRODUCTO.filter(c => datos[c] !== undefined).map(c => [c, datos[c]])
    );
    return await Producto.create({ ...campos, panaderia_id: panaderiaId });
  }
}

module.exports = new VentasService();