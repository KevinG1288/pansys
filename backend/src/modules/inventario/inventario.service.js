const { MateriaPrima } = require('../../models/index');
const { ErrorNegocio } = require('../../utils/errores');
const { parsearCantidad, deUnidades } = require('../produccion/produccion.validaciones');

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

// panaderiaId null = administrador sin panadería indicada (acceso a cualquier registro)
const condicionPorId = (id, panaderiaId) =>
  panaderiaId ? { id, panaderia_id: panaderiaId } : { id };

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
    return await MateriaPrima.create({ ...filtrarCampos(datos), panaderia_id: panaderiaId });
  }

  async actualizar(id, datos, panaderiaId) {
    const campos = filtrarCampos(datos);
    const item = await this.getById(id, panaderiaId, 400);
    return await item.update(campos);
  }

  async eliminar(id, panaderiaId) {
    const item = await this.getById(id, panaderiaId, 400);
    await item.update({ estado: false });
    return { mensaje: 'Materia prima eliminada correctamente' };
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
