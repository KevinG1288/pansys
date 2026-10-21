const { Op } = require('sequelize');
const {
  sequelize, Producto, MateriaPrima, Usuario, OrdenProduccion, InsumoUsado
} = require('../../models/index');
const { ErrorNegocio } = require('../../utils/errores');
const { enTransaccion } = require('../../utils/transaccion');
const recetasService = require('./recetas.service');
const {
  ESTADOS_ORDEN, MAX_CANTIDAD_ORDEN, MAX_UNIDADES, aUnidades, deUnidades, aDecimal4, centavosATexto,
  parsearId, parsearEntero, parsearCantidad, parsearTexto, parsearFecha, fechaHoy
} = require('./produccion.validaciones');

// Detalle completo de una orden (los insumos guardan su copia histórica)
const INCLUDE_DETALLE = [
  { model: Producto, attributes: ['id', 'nombre'] },
  { model: Usuario, as: 'empleado', attributes: ['id', 'email'] },
  { model: Usuario, as: 'cerradoPor', attributes: ['id', 'email'] },
  { model: InsumoUsado, as: 'insumos', include: [{ model: MateriaPrima, attributes: ['id', 'nombre'] }] }
];

// panaderiaId null = administrador sin panadería indicada
const condicionPorId = (id, panaderiaId) => (panaderiaId ? { id, panaderia_id: panaderiaId } : { id });

// Valida el detalle opcional de devoluciones (antes de abrir la transacción)
const validarDevoluciones = (insumos) => {
  if (!Array.isArray(insumos)) {
    throw new ErrorNegocio('insumos debe ser una lista', 400);
  }
  const vistos = new Set();
  return insumos.map((insumo, i) => {
    const materiaPrimaId = parsearId(insumo?.materia_prima_id, `insumos[${i}].materia_prima_id`);
    if (vistos.has(materiaPrimaId)) {
      throw new ErrorNegocio(`La materia prima ${materiaPrimaId} está repetida`, 400);
    }
    vistos.add(materiaPrimaId);
    const unidades = parsearCantidad(insumo?.cantidad_devuelta, `insumos[${i}].cantidad_devuelta`, { permitirCero: true });
    return { materia_prima_id: materiaPrimaId, unidades };
  });
};

class OrdenesService {

  async listar(panaderiaId, filtros = {}) {
    const where = { panaderia_id: panaderiaId };

    if (filtros.estado !== undefined) {
      if (!ESTADOS_ORDEN.includes(filtros.estado)) {
        throw new ErrorNegocio(`estado debe ser uno de: ${ESTADOS_ORDEN.join(', ')}`, 400);
      }
      where.estado = filtros.estado;
    }

    const desde = parsearFecha(filtros.desde, 'desde');
    const hasta = parsearFecha(filtros.hasta, 'hasta');
    if (desde && hasta && desde > hasta) {
      throw new ErrorNegocio('desde no puede ser posterior a hasta', 400);
    }
    if (desde || hasta) {
      where.fecha = {};
      if (desde) where.fecha[Op.gte] = desde;
      if (hasta) where.fecha[Op.lte] = hasta;
    }

    return await OrdenProduccion.findAll({
      where,
      include: [
        { model: Producto, attributes: ['id', 'nombre'] },
        { model: Usuario, as: 'empleado', attributes: ['id', 'email'] }
      ],
      order: [['createdAt', 'DESC'], ['id', 'DESC']]
    });
  }

  async obtener(id, panaderiaId) {
    const ordenId = parsearId(id, 'id');
    const orden = await OrdenProduccion.findOne({
      where: condicionPorId(ordenId, panaderiaId),
      include: INCLUDE_DETALLE,
      order: [[{ model: InsumoUsado, as: 'insumos' }, 'materia_prima_id', 'ASC']]
    });
    if (!orden) throw new ErrorNegocio('Orden de producción no encontrada', 404);
    return orden;
  }

  // Valida el stock y descuenta las materias primas en una sola transacción
  async crear(datos, panaderiaId, empleadoId) {
    const productoId = parsearId(datos?.producto_id, 'producto_id');
    const cantidad = parsearEntero(datos?.cantidad_planificada, 'cantidad_planificada', 1, MAX_CANTIDAD_ORDEN);
    const observaciones = parsearTexto(datos?.observaciones, 'observaciones');

    const { ordenId, materiaIds } = await enTransaccion(sequelize, async (t) => {
      const producto = await recetasService.obtenerProducto(productoId, panaderiaId, { transaction: t });

      // Bloquea las materias primas (por id ascendente) y lee su stock real
      const necesidades = await recetasService.calcularNecesidades(producto, cantidad, {
        transaction: t, lock: t.LOCK.UPDATE
      });

      const faltantes = necesidades.filter(n => n.faltante > 0);
      if (faltantes.length > 0) {
        throw new ErrorNegocio('Materia prima insuficiente para la orden', 409, {
          faltantes: faltantes.map(n => recetasService.formatearNecesidad(n))
        });
      }

      // Descuento atómico en MySQL con valores exactos de 4 decimales: la condición vuelve a
      // comprobar el stock sobre la fila bloqueada, sin tolerancias
      for (const n of necesidades) {
        const [afectadas] = await MateriaPrima.update(
          { cantidad_disponible: sequelize.literal(`GREATEST(cantidad_disponible - ${aDecimal4(n.necesario)}, 0)`) },
          {
            where: {
              id: n.materia_prima_id,
              panaderia_id: producto.panaderia_id,
              estado: true,
              cantidad_disponible: { [Op.gte]: aDecimal4(n.necesario) }
            },
            transaction: t
          }
        );
        if (afectadas !== 1) {
          throw new Error(`No se pudo descontar la materia prima ${n.materia_prima_id}`);
        }
      }

      const orden = await OrdenProduccion.create({
        panaderia_id: producto.panaderia_id,
        producto_id: producto.id,
        empleado_id: empleadoId,
        fecha: fechaHoy(),
        cantidad_planificada: cantidad,
        estado: 'en_proceso',
        // Suma exacta de los costos por línea, que ya están redondeados a centavos
        costo_insumos: centavosATexto(necesidades.reduce((acc, n) => acc + n.costoCentavos, 0n)),
        observaciones
      }, { transaction: t });

      // Copia histórica: no depende de la receta ni de la materia prima actuales
      await InsumoUsado.bulkCreate(necesidades.map(n => ({
        orden_id: orden.id,
        materia_prima_id: n.materia_prima_id,
        cantidad_por_unidad: aDecimal4(n.porUnidad),
        unidad_medida: n.unidad_medida,
        precio_unitario: centavosATexto(n.precioCopiaCentavos),
        cantidad_usada: aDecimal4(n.necesario),
        costo: centavosATexto(n.costoCentavos)
      })), { transaction: t });

      return { ordenId: orden.id, materiaIds: necesidades.map(n => n.materia_prima_id) };
    });

    const orden = await this.obtener(ordenId, null);
    const alertas_stock_bajo = await this.alertasStockBajo(materiaIds);
    return { orden, alertas_stock_bajo };
  }

  // Materias primas que quedaron en su stock mínimo o por debajo (RF-04)
  async alertasStockBajo(materiaIds) {
    const materias = await MateriaPrima.findAll({
      where: { id: materiaIds },
      attributes: [
        'id', 'nombre', 'unidad_medida',
        ['cantidad_disponible', 'disponible'],
        ['stock_minimo', 'minimo']
      ],
      order: [['id', 'ASC']]
    });
    return materias
      .filter(m => aUnidades(m.get('disponible')) <= aUnidades(m.get('minimo')))
      .map(m => ({
        materia_prima_id: m.id,
        nombre: m.nombre,
        unidad_medida: m.unidad_medida,
        disponible: Number(m.get('disponible')),
        stock_minimo: Number(m.get('minimo'))
      }));
  }

  // Bloquea la orden (FOR UPDATE) y exige que siga en proceso. Una segunda petición
  // simultánea espera el bloqueo y, al entrar, encuentra la orden ya cerrada (409).
  async bloquearOrdenAbierta(ordenId, panaderiaId, t) {
    const orden = await OrdenProduccion.findOne({
      where: condicionPorId(ordenId, panaderiaId),
      transaction: t,
      lock: t.LOCK.UPDATE
    });
    if (!orden) throw new ErrorNegocio('Orden de producción no encontrada', 404);
    if (orden.estado !== 'en_proceso') {
      throw new ErrorNegocio(`La orden ya está ${orden.estado}`, 409, { estado: orden.estado });
    }
    return orden;
  }

  // Cierra la orden solo si sigue en proceso (segunda protección contra doble proceso)
  async cerrarOrden(orden, cambios, t) {
    const [afectadas] = await OrdenProduccion.update(cambios, {
      where: { id: orden.id, estado: 'en_proceso' },
      transaction: t
    });
    if (afectadas !== 1) throw new ErrorNegocio('La orden ya fue procesada', 409);
  }

  async finalizar(id, datos, panaderiaId, usuarioId) {
    const ordenId = parsearId(id, 'id');
    const producida = parsearEntero(datos?.cantidad_producida, 'cantidad_producida', 0, MAX_CANTIDAD_ORDEN);
    const observaciones = parsearTexto(datos?.observaciones, 'observaciones');

    await enTransaccion(sequelize, async (t) => {
      const orden = await this.bloquearOrdenAbierta(ordenId, panaderiaId, t);

      if (producida > orden.cantidad_planificada) {
        throw new ErrorNegocio(
          `La cantidad producida no puede superar la planificada (${orden.cantidad_planificada})`, 400
        );
      }

      // El producto terminado se suma en la panadería de la orden
      const [productos] = await Producto.update(
        { cantidad_disponible: sequelize.literal(`COALESCE(cantidad_disponible, 0) + ${producida}`) },
        { where: { id: orden.producto_id, panaderia_id: orden.panaderia_id }, transaction: t }
      );
      if (productos !== 1) {
        throw new Error(`Producto ${orden.producto_id} de la orden ${orden.id} no encontrado en su panadería`);
      }

      // Todo lo descontado se convirtió en producto
      const insumos = await InsumoUsado.findAll({
        where: { orden_id: orden.id }, attributes: ['id'], transaction: t
      });
      if (insumos.length > 0) {
        await InsumoUsado.update(
          { cantidad_consumida: sequelize.col('cantidad_usada'), cantidad_devuelta: 0, cantidad_mermada: 0 },
          { where: { id: insumos.map(i => i.id) }, transaction: t }
        );
      }

      await this.cerrarOrden(orden, {
        estado: 'finalizada',
        cantidad_producida: producida,
        fecha_finalizacion: new Date(),
        cerrado_por: usuarioId,
        ...(observaciones ? { observaciones } : {})
      }, t);
    });

    return this.obtener(ordenId, null);
  }

  // Fase A: valida todas las devoluciones sin escribir. Fase B: aplica los cambios.
  async cancelar(id, datos, panaderiaId, usuarioId) {
    const ordenId = parsearId(id, 'id');
    const motivo = parsearTexto(datos?.motivo, 'motivo', { requerido: true });

    if (typeof datos?.devolver_insumos !== 'boolean') {
      throw new ErrorNegocio('devolver_insumos debe ser true o false', 400);
    }
    const devolver = datos.devolver_insumos;
    const tieneDetalle = datos.insumos !== undefined;
    if (!devolver && tieneDetalle) {
      throw new ErrorNegocio('No envíe insumos cuando devolver_insumos es false', 400);
    }
    const detalle = tieneDetalle ? validarDevoluciones(datos.insumos) : null;

    await enTransaccion(sequelize, async (t) => {
      // ---- Fase A: bloquear y validar (sin escrituras) ----
      const orden = await this.bloquearOrdenAbierta(ordenId, panaderiaId, t);

      // Protegidos por el bloqueo de la orden: nadie más modifica sus insumos
      const insumos = await InsumoUsado.findAll({
        where: { orden_id: orden.id },
        order: [['materia_prima_id', 'ASC']],
        transaction: t
      });
      const porMateria = new Map(insumos.map(i => [i.materia_prima_id, i]));

      const devoluciones = new Map();
      if (devolver && detalle === null) {
        insumos.forEach(i => devoluciones.set(i.materia_prima_id, aUnidades(i.cantidad_usada)));
      } else if (devolver) {
        for (const d of detalle) {
          const insumo = porMateria.get(d.materia_prima_id);
          if (!insumo) {
            throw new ErrorNegocio(`La materia prima ${d.materia_prima_id} no pertenece a la orden`, 400);
          }
          const descontada = aUnidades(insumo.cantidad_usada);
          if (d.unidades > descontada) {
            throw new ErrorNegocio(
              `No se puede devolver más de lo descontado para la materia prima ${d.materia_prima_id}`, 400,
              { materia_prima_id: d.materia_prima_id, maximo: deUnidades(descontada) }
            );
          }
          devoluciones.set(d.materia_prima_id, d.unidades);
        }
      }

      // ---- Fase B: aplicar (materias primas en orden de id) ----
      let algunaDevuelta = false;
      for (const insumo of insumos) {
        const descontada = aUnidades(insumo.cantidad_usada);
        const devuelta = devoluciones.get(insumo.materia_prima_id) ?? 0;
        const mermada = descontada - devuelta;

        if (devuelta > 0) {
          algunaDevuelta = true;
          // DECIMAL(12,4) no admite más de 99.999.999,9999: la condición evita que MySQL rechace
          // la suma con un error de rango (y que la cancelación termine en un 500)
          const donde = { id: insumo.materia_prima_id, panaderia_id: orden.panaderia_id };
          const [afectadas] = await MateriaPrima.update(
            { cantidad_disponible: sequelize.literal(`cantidad_disponible + ${aDecimal4(devuelta)}`) },
            {
              where: { ...donde, cantidad_disponible: { [Op.lte]: aDecimal4(MAX_UNIDADES - devuelta) } },
              transaction: t
            }
          );
          if (afectadas !== 1) {
            if (await MateriaPrima.count({ where: donde, transaction: t }) === 1) {
              throw new ErrorNegocio(
                `Devolver los insumos superaría el máximo de inventario (99.999.999,9999) para la materia prima ${insumo.materia_prima_id}`,
                409, { materia_prima_id: insumo.materia_prima_id }
              );
            }
            throw new Error(`Materia prima ${insumo.materia_prima_id} de la orden ${orden.id} no encontrada en su panadería`);
          }
        }

        await insumo.update({
          cantidad_consumida: 0,
          cantidad_devuelta: aDecimal4(devuelta),
          cantidad_mermada: aDecimal4(mermada)
        }, { transaction: t });
      }

      await this.cerrarOrden(orden, {
        estado: 'cancelada',
        motivo_cancelacion: motivo,
        insumos_devueltos: algunaDevuelta,
        fecha_finalizacion: new Date(),
        cerrado_por: usuarioId
      }, t);
    });

    return this.obtener(ordenId, null);
  }
}

module.exports = new OrdenesService();
