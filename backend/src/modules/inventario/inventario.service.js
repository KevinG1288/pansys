const { MateriaPrima } = require('../../models/index');

// Campos que el cliente puede enviar al crear o editar (panaderia_id y estado los fija el servidor)
const CAMPOS_EDITABLES = ['nombre', 'unidad_medida', 'cantidad_disponible', 'stock_minimo', 'precio_unitario'];

const filtrarCampos = (datos = {}) =>
  Object.fromEntries(CAMPOS_EDITABLES.filter(c => datos[c] !== undefined).map(c => [c, datos[c]]));

// panaderiaId null = administrador sin panadería indicada (acceso a cualquier registro)
const condicionPorId = (id, panaderiaId) =>
  panaderiaId ? { id, panaderia_id: panaderiaId } : { id };

class InventarioService {

  async getAll(panaderiaId) {
    return await MateriaPrima.findAll({
      where: { panaderia_id: panaderiaId, estado: true }
    });
  }

  async getById(id, panaderiaId) {
    const item = await MateriaPrima.findOne({ where: condicionPorId(id, panaderiaId) });
    if (!item) throw new Error('Materia prima no encontrada');
    return item;
  }

  async crear(datos, panaderiaId) {
    return await MateriaPrima.create({ ...filtrarCampos(datos), panaderia_id: panaderiaId });
  }

  async actualizar(id, datos, panaderiaId) {
    const item = await this.getById(id, panaderiaId);
    return await item.update(filtrarCampos(datos));
  }

  async eliminar(id, panaderiaId) {
    const item = await this.getById(id, panaderiaId);
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