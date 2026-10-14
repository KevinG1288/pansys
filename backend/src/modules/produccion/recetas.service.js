const { sequelize, Producto, MateriaPrima, RecetaProducto } = require('../../models/index');
const { ErrorNegocio } = require('../../utils/errores');
const { enTransaccion } = require('../../utils/transaccion');
const {
  MAX_CANTIDAD_ORDEN, MAX_UNIDADES, aUnidades, deUnidades, aDecimal4,
  parsearId, parsearEntero, parsearCantidad
} = require('./produccion.validaciones');

const MAX_INSUMOS_RECETA = 50;

// Costos en centavos enteros (BigInt): 9.999.999.999,99 = máximo de DECIMAL(12,2)
const MAX_CENTAVOS = 999999999999n;
const DIEZMILESIMAS = 10000n;

// materia_prima usa FLOAT: MySQL lo entrega con ~6 dígitos significativos, por eso las
// cantidades y precios se leen convertidos a DECIMAL para validar con el valor real.
const ATRIBUTOS_MATERIA_EXACTOS = [
  'id', 'nombre', 'unidad_medida', 'panaderia_id', 'estado',
  [sequelize.literal('CAST(`cantidad_disponible` AS DECIMAL(16,4))'), 'disponible'],
  [sequelize.literal('CAST(`stock_minimo` AS DECIMAL(16,4))'), 'minimo'],
  [sequelize.literal('CAST(`precio_unitario` AS DECIMAL(14,2))'), 'precio']
];

// Valida { insumos: [{ materia_prima_id, cantidad_por_unidad }] }
const validarInsumos = (insumos) => {
  if (!Array.isArray(insumos) || insumos.length === 0) {
    throw new ErrorNegocio('Debe indicar al menos un insumo', 400);
  }
  if (insumos.length > MAX_INSUMOS_RECETA) {
    throw new ErrorNegocio(`Una receta admite máximo ${MAX_INSUMOS_RECETA} insumos`, 400);
  }

  const vistos = new Set();
  return insumos.map((insumo, i) => {
    const materiaPrimaId = parsearId(insumo?.materia_prima_id, `insumos[${i}].materia_prima_id`);
    if (vistos.has(materiaPrimaId)) {
      throw new ErrorNegocio(`La materia prima ${materiaPrimaId} está repetida en la receta`, 400);
    }
    vistos.add(materiaPrimaId);
    const unidades = parsearCantidad(insumo?.cantidad_por_unidad, `insumos[${i}].cantidad_por_unidad`);
    return { materia_prima_id: materiaPrimaId, unidades };
  });
};

const formatearReceta = (producto, lineas) => ({
  producto_id: producto.id,
  producto: producto.nombre,
  panaderia_id: producto.panaderia_id,
  insumos: lineas.map(l => ({
    materia_prima_id: l.materia_prima_id,
    nombre: l.MateriaPrima?.nombre ?? null,
    unidad_medida: l.MateriaPrima?.unidad_medida ?? null,
    activo: l.MateriaPrima?.estado ?? false,
    cantidad_por_unidad: Number(l.cantidad_por_unidad)
  }))
});

const formatearNecesidad = (n) => ({
  materia_prima_id: n.materia_prima_id,
  nombre: n.nombre,
  unidad_medida: n.unidad_medida,
  cantidad_por_unidad: deUnidades(n.porUnidad),
  necesario: deUnidades(n.necesario),
  disponible: deUnidades(n.disponible),
  faltante: deUnidades(n.faltante),
  precio_unitario: n.precio,
  costo_estimado: n.costo
});

class RecetasService {

  formatearNecesidad(necesidad) {
    return formatearNecesidad(necesidad);
  }

  // Producto activo; si se indica panadería, debe pertenecer a ella (si no, 404)
  async obtenerProducto(productoId, panaderiaId, opciones = {}) {
    const id = parsearId(productoId, 'producto_id');
    const where = { id, estado: true };
    if (panaderiaId) where.panaderia_id = panaderiaId;

    const producto = await Producto.findOne({ where, ...opciones });
    if (!producto) throw new ErrorNegocio('Producto no encontrado', 404);
    return producto;
  }

  async listar(panaderiaId) {
    const productos = await Producto.findAll({
      where: { panaderia_id: panaderiaId, estado: true },
      include: [{
        model: RecetaProducto,
        as: 'receta',
        include: [{ model: MateriaPrima, attributes: ['id', 'nombre', 'unidad_medida', 'estado'] }]
      }],
      order: [['nombre', 'ASC'], [{ model: RecetaProducto, as: 'receta' }, 'materia_prima_id', 'ASC']]
    });
    return productos.map(p => formatearReceta(p, p.receta));
  }

  async obtener(productoId, panaderiaId) {
    const producto = await this.obtenerProducto(productoId, panaderiaId);
    const lineas = await RecetaProducto.findAll({
      where: { producto_id: producto.id },
      include: [{ model: MateriaPrima, attributes: ['id', 'nombre', 'unidad_medida', 'estado'] }],
      order: [['materia_prima_id', 'ASC']]
    });
    if (lineas.length === 0) throw new ErrorNegocio('El producto no tiene receta', 404);
    return formatearReceta(producto, lineas);
  }

  // crear = true: POST (falla si ya existe). crear = false: PUT (falla si no existe)
  async guardar(productoId, panaderiaId, datos, { crear }) {
    const lineas = validarInsumos(datos?.insumos);

    const id = await enTransaccion(sequelize, async (t) => {
      // Bloquear el producto serializa ediciones simultáneas de la misma receta
      const producto = await this.obtenerProducto(productoId, panaderiaId, {
        transaction: t, lock: t.LOCK.UPDATE
      });

      const existentes = await RecetaProducto.count({ where: { producto_id: producto.id }, transaction: t });
      if (crear && existentes > 0) {
        throw new ErrorNegocio('El producto ya tiene una receta; use PUT para reemplazarla', 409);
      }
      if (!crear && existentes === 0) {
        throw new ErrorNegocio('El producto no tiene receta; use POST para crearla', 404);
      }

      // Los insumos deben ser materias primas activas de la MISMA panadería del producto
      const ids = lineas.map(l => l.materia_prima_id);
      const materias = await MateriaPrima.findAll({
        where: { id: ids, panaderia_id: producto.panaderia_id, estado: true },
        attributes: ['id'],
        transaction: t
      });
      const encontradas = new Set(materias.map(m => m.id));
      const noEncontradas = ids.filter(mid => !encontradas.has(mid));
      if (noEncontradas.length > 0) {
        throw new ErrorNegocio('Materias primas no encontradas en la panadería del producto', 404, {
          materias_primas: noEncontradas
        });
      }

      // Las órdenes existentes no dependen de la receta (guardan su propia copia)
      await RecetaProducto.destroy({ where: { producto_id: producto.id }, transaction: t });
      await RecetaProducto.bulkCreate(lineas.map(l => ({
        producto_id: producto.id,
        materia_prima_id: l.materia_prima_id,
        cantidad_por_unidad: aDecimal4(l.unidades)
      })), { transaction: t });

      return producto.id;
    });

    return this.obtener(id, panaderiaId);
  }

  async eliminar(productoId, panaderiaId) {
    await enTransaccion(sequelize, async (t) => {
      const producto = await this.obtenerProducto(productoId, panaderiaId, {
        transaction: t, lock: t.LOCK.UPDATE
      });
      const borradas = await RecetaProducto.destroy({ where: { producto_id: producto.id }, transaction: t });
      if (borradas === 0) throw new ErrorNegocio('El producto no tiene receta', 404);
    });
    return { mensaje: 'Receta eliminada correctamente' };
  }

  // Insumos necesarios para producir `cantidad` unidades, con disponibilidad real.
  // Con opciones.lock bloquea las materias primas (en orden de id) para descontarlas después.
  async calcularNecesidades(producto, cantidad, { transaction, lock } = {}) {
    const lineas = await RecetaProducto.findAll({
      where: { producto_id: producto.id },
      order: [['materia_prima_id', 'ASC']],
      transaction
    });
    if (lineas.length === 0) throw new ErrorNegocio('El producto no tiene receta', 422);

    const materias = await MateriaPrima.findAll({
      where: { id: lineas.map(l => l.materia_prima_id) },
      attributes: ATRIBUTOS_MATERIA_EXACTOS,
      order: [['id', 'ASC']],
      transaction,
      lock
    });
    const porId = new Map(materias.map(m => [m.id, m]));

    // Cada insumo debe seguir activo y ser de la misma panadería del producto
    const invalidas = lineas
      .filter(l => {
        const m = porId.get(l.materia_prima_id);
        return !m || !m.estado || m.panaderia_id !== producto.panaderia_id;
      })
      .map(l => l.materia_prima_id);
    if (invalidas.length > 0) {
      throw new ErrorNegocio('La receta incluye materias primas inactivas o de otra panadería', 422, {
        materias_primas: invalidas
      });
    }

    // Inventario no valida precios: uno negativo (o que no cabe en DECIMAL(12,2)) violaría
    // las restricciones de insumo_usado, así que se rechaza antes de descontar nada
    const preciosCentavos = new Map(materias.map(m => [m.id, BigInt(Math.round(Number(m.get('precio')) * 100))]));
    const preciosInvalidos = lineas
      .filter(l => {
        const centavos = preciosCentavos.get(l.materia_prima_id);
        return centavos < 0n || centavos > MAX_CENTAVOS;
      })
      .map(l => l.materia_prima_id);
    if (preciosInvalidos.length > 0) {
      throw new ErrorNegocio(
        'Hay materias primas con precio unitario inválido (negativo o demasiado alto); corríjalo en Inventario', 422,
        { materias_primas: preciosInvalidos }
      );
    }

    let costoTotalCentavos = 0n;
    const necesidades = lineas.map(l => {
      const m = porId.get(l.materia_prima_id);
      const porUnidad = aUnidades(l.cantidad_por_unidad);
      const necesario = porUnidad * cantidad;
      if (necesario > MAX_UNIDADES) {
        throw new ErrorNegocio('La cantidad solicitada supera el máximo permitido', 400);
      }

      // costo = necesario (diezmilésimas) × precio (centavos) / 10000, redondeado a centavos
      const costoCentavos = (BigInt(necesario) * preciosCentavos.get(m.id) + DIEZMILESIMAS / 2n) / DIEZMILESIMAS;
      costoTotalCentavos += costoCentavos;

      const disponible = aUnidades(m.get('disponible'));
      return {
        materia_prima_id: m.id,
        nombre: m.nombre,
        unidad_medida: m.unidad_medida,
        porUnidad,
        necesario,
        disponible,
        minimo: aUnidades(m.get('minimo')),
        faltante: Math.max(necesario - disponible, 0),
        precio: Number(m.get('precio')),
        costoCentavos,
        costo: Number(costoCentavos) / 100
      };
    });

    if (costoTotalCentavos > MAX_CENTAVOS) {
      throw new ErrorNegocio('El costo de los insumos supera el máximo permitido (9.999.999.999,99)', 400);
    }
    return necesidades;
  }

  async calcular(productoId, cantidadValor, panaderiaId) {
    const cantidad = parsearEntero(cantidadValor, 'cantidad', 1, MAX_CANTIDAD_ORDEN);
    const producto = await this.obtenerProducto(productoId, panaderiaId);
    const necesidades = await this.calcularNecesidades(producto, cantidad);

    return {
      producto_id: producto.id,
      producto: producto.nombre,
      panaderia_id: producto.panaderia_id,
      cantidad,
      alcanza: necesidades.every(n => n.faltante === 0),
      costo_total_estimado: Number(necesidades.reduce((acc, n) => acc + n.costoCentavos, 0n)) / 100,
      insumos: necesidades.map(formatearNecesidad)
    };
  }
}

module.exports = new RecetasService();
