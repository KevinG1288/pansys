const { Op } = require('sequelize');
const { sequelize, Venta, DetalleVenta, Producto } = require('../../models/index');
const { ErrorNegocio } = require('../../utils/errores');
const { enTransaccion } = require('../../utils/transaccion');
const { parsearId, parsearEntero } = require('../produccion/produccion.validaciones');

// Campos que el cliente puede enviar al crear un producto (panaderia_id y estado los fija el servidor)
const CAMPOS_PRODUCTO = ['nombre', 'precio_compra', 'precio_venta', 'cantidad_disponible'];

const MAX_PRODUCTOS_VENTA = 50;
const MAX_CANTIDAD_LINEA = 100000;

// Valida { productos: [{ producto_id, cantidad }] }
const validarLineas = (productos) => {
  if (!Array.isArray(productos) || productos.length === 0) {
    throw new ErrorNegocio('Debe indicar al menos un producto', 400);
  }
  if (productos.length > MAX_PRODUCTOS_VENTA) {
    throw new ErrorNegocio(`Una venta admite máximo ${MAX_PRODUCTOS_VENTA} productos`, 400);
  }

  const vistos = new Set();
  return productos.map((p, i) => {
    const productoId = parsearId(p?.producto_id, `productos[${i}].producto_id`);
    if (vistos.has(productoId)) {
      throw new ErrorNegocio(`El producto ${productoId} está repetido en la venta`, 400);
    }
    vistos.add(productoId);
    const cantidad = parsearEntero(p?.cantidad, `productos[${i}].cantidad`, 1, MAX_CANTIDAD_LINEA);
    return { producto_id: productoId, cantidad };
  });
};

class VentasService {

  async getAll(panaderiaId) {
    return await Venta.findAll({
      where: { panaderia_id: panaderiaId },
      include: [{ model: DetalleVenta, include: [Producto] }],
      order: [['createdAt', 'DESC']]
    });
  }

  // Valida el stock de todos los productos y lo descuenta junto con la venta en una sola transacción
  async crear(datos, panaderiaId, empleadoId) {
    const lineas = validarLineas(datos?.productos);

    return await enTransaccion(sequelize, async (t) => {
      // Solo productos activos de la misma panadería, bloqueados en orden de id
      const productos = await Producto.findAll({
        where: { id: lineas.map(l => l.producto_id), panaderia_id: panaderiaId, estado: true },
        order: [['id', 'ASC']],
        transaction: t,
        lock: t.LOCK.UPDATE
      });
      const porId = new Map(productos.map(p => [p.id, p]));

      const noEncontrados = lineas.filter(l => !porId.has(l.producto_id)).map(l => l.producto_id);
      if (noEncontrados.length > 0) {
        throw new ErrorNegocio(`Productos no encontrados: ${noEncontrados.join(', ')}`, 404);
      }

      const insuficientes = lineas.filter(l => (porId.get(l.producto_id).cantidad_disponible ?? 0) < l.cantidad);
      if (insuficientes.length > 0) {
        const detalle = insuficientes
          .map(l => `${porId.get(l.producto_id).nombre} (disponible ${porId.get(l.producto_id).cantidad_disponible ?? 0}, solicitado ${l.cantidad})`)
          .join('; ');
        throw new ErrorNegocio(`Stock insuficiente: ${detalle}`, 409);
      }

      let total = 0;
      const detalles = [];
      for (const l of [...lineas].sort((a, b) => a.producto_id - b.producto_id)) {
        const producto = porId.get(l.producto_id);

        // Descuento atómico; la condición impide dejar stock negativo
        const [afectadas] = await Producto.update(
          { cantidad_disponible: sequelize.literal(`cantidad_disponible - ${l.cantidad}`) },
          {
            where: { id: producto.id, panaderia_id: panaderiaId, cantidad_disponible: { [Op.gte]: l.cantidad } },
            transaction: t
          }
        );
        if (afectadas !== 1) throw new Error(`No se pudo descontar el producto ${producto.id}`);

        const subtotal = producto.precio_venta * l.cantidad;
        total += subtotal;
        detalles.push({
          producto_id: producto.id,
          cantidad: l.cantidad,
          precio_unitario: producto.precio_venta,
          subtotal
        });
      }

      const venta = await Venta.create({ empleado_id: empleadoId, panaderia_id: panaderiaId, total }, { transaction: t });
      await DetalleVenta.bulkCreate(detalles.map(d => ({ ...d, venta_id: venta.id })), { transaction: t });

      return venta;
    });
  }

  async getProductos(panaderiaId) {
    return await Producto.findAll({
      where: { panaderia_id: panaderiaId, estado: true }
    });
  }

  async crearProducto(datos, panaderiaId) {
    // Sin cuerpo (petición sin JSON) no se envía ningún campo: el modelo responde qué falta
    const campos = Object.fromEntries(
      CAMPOS_PRODUCTO.filter(c => datos?.[c] !== undefined).map(c => [c, datos[c]])
    );
    return await Producto.create({ ...campos, panaderia_id: panaderiaId });
  }
}

module.exports = new VentasService();
module.exports.CAMPOS_PRODUCTO = CAMPOS_PRODUCTO;