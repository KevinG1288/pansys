const { sequelize, MateriaPrima } = require('../../models/index');
const { Transaction } = require('sequelize');
const { enTransaccion } = require('../../utils/transaccion');
const { parsearVersion, exigirVersionDisponible, conflictoVersion } = require('../../utils/version-fila');
const { exigirSinPendientes } = require('./inventario.proteccion');
const { ErrorNegocio } = require('../../utils/errores');
const { parsearCantidad, deUnidades, exigirPanaderiaId } = require('../produccion/produccion.validaciones');

// Campos que el cliente puede enviar al crear o editar (panaderia_id y estado los fija el servidor)
const CAMPOS_EDITABLES = ['nombre', 'unidad_medida', 'cantidad_disponible', 'stock_minimo', 'precio_unitario'];

// Columnas DECIMAL(12,4): número o texto con punto decimal, de 0 a 99.999.999,9999 y con máximo
// 4 decimales. Se rechazan (400) en lugar de dejar que MySQL redondee o falle por rango.
const CAMPOS_DECIMALES = ['cantidad_disponible', 'stock_minimo', 'precio_unitario'];

const filtrarCampos = (datos = {}) => {
  const campos = Object.fromEntries(CAMPOS_EDITABLES.filter(c => datos[c] !== undefined).map(c => [c, datos[c]]));
  CAMPOS_DECIMALES.filter(c => c in campos).forEach(c => {
    // Las diezmilésimas son exactas: el número resultante tiene como mucho 4 decimales
    campos[c] = deUnidades(parsearCantidad(campos[c], c, { permitirCero: true }));
  });
  return campos;
};

// Siempre limitada a la panadería autorizada: un registro de otra panadería no se encuentra
const condicionPorId = (id, panaderiaId) => ({ id, panaderia_id: exigirPanaderiaId(panaderiaId) });

class InventarioService {

  async getAll(panaderiaId) {
    return await MateriaPrima.findAll({
      where: { panaderia_id: panaderiaId, estado: true }
    });
  }

  // Contrato de siempre: 404 al consultarla, 400 al editarla o eliminarla
  async getById(id, panaderiaId, estadoNoEncontrada = 404) {
    const item = await MateriaPrima.findOne({ where: condicionPorId(id, panaderiaId) });
    if (!item) throw new ErrorNegocio('Materia prima no encontrada', estadoNoEncontrada);
    return item;
  }

  async crear(datos, panaderiaId) {
    return await MateriaPrima.create({ ...filtrarCampos(datos), panaderia_id: exigirPanaderiaId(panaderiaId), version_fila: 0 });
  }

  async actualizar(id, datos, panaderiaId) {
    const campos = filtrarCampos(datos);
    return this.modificar(id, panaderiaId, datos?.version_fila, campos);
  }

  async eliminar(id, panaderiaId, version) {
    await this.modificar(id, panaderiaId, version, { estado: false });
    return { mensaje: 'Materia prima eliminada correctamente' };
  }

  async modificar(id, panaderiaId, version, campos) {
    const esperada = parsearVersion(version);
    const where = condicionPorId(id, panaderiaId);
    // Si se envían campos estructurales usamos RC para poder clasificarlos bajo bloqueo.
    // Solo los cambios efectivos consultan pendientes. Stock/precio/mínimo conservan el aislamiento habitual.
    const estructuralPosible = 'nombre' in campos || 'unidad_medida' in campos || campos.estado === false;
    const opciones = estructuralPosible ? { isolationLevel: Transaction.ISOLATION_LEVELS.READ_COMMITTED } : undefined;
    return enTransaccion(sequelize, async (t) => {
      const item = await MateriaPrima.findOne({ where, transaction: t, lock: t.LOCK.UPDATE });
      if (!item) throw new ErrorNegocio('Materia prima no encontrada', 400);
      if (item.version_fila !== esperada) throw conflictoVersion();
      if (!item.estado) throw new ErrorNegocio('Materia prima inactiva', 409, { codigo: 'MATERIA_INACTIVA' });
      exigirVersionDisponible(item.version_fila);
      const estructural = campos.estado === false || ['nombre', 'unidad_medida'].some(c => c in campos && campos[c] !== item[c]);
      if (estructural) await exigirSinPendientes(item.id, where.panaderia_id, t);
      const [afectadas] = await MateriaPrima.update({ ...campos, version_fila: sequelize.literal('version_fila + 1') }, {
        where: { ...where, estado: true, version_fila: esperada }, transaction: t
      });
      if (afectadas !== 1) throw conflictoVersion();
      return MateriaPrima.findOne({ where, transaction: t });
    }, 3, opciones);
  }

  async verificarStockBajo(panaderiaId) {
    const items = await MateriaPrima.findAll({
      where: { panaderia_id: panaderiaId, estado: true }
    });
    return items.filter(i => i.cantidad_disponible <= i.stock_minimo);
  }
}

module.exports = new InventarioService();
module.exports.CAMPOS_EDITABLES = CAMPOS_EDITABLES;
