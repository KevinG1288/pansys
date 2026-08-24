const { MateriaPrima } = require('../../models/index');

class InventarioService {

  async getAll(panaderia_id) {
    return await MateriaPrima.findAll({
      where: { panaderia_id, estado: true }
    });
  }

  async getById(id) {
    const item = await MateriaPrima.findByPk(id);
    if (!item) throw new Error('Materia prima no encontrada');
    return item;
  }

  async crear(datos) {
    return await MateriaPrima.create(datos);
  }

  async actualizar(id, datos) {
    const item = await MateriaPrima.findByPk(id);
    if (!item) throw new Error('Materia prima no encontrada');
    return await item.update(datos);
  }

  async eliminar(id) {
    const item = await MateriaPrima.findByPk(id);
    if (!item) throw new Error('Materia prima no encontrada');
    await item.update({ estado: false });
    return { mensaje: 'Materia prima eliminada correctamente' };
  }

  async verificarStockBajo(panaderia_id) {
    const items = await MateriaPrima.findAll({
      where: { panaderia_id, estado: true }
    });
    return items.filter(i => i.cantidad_disponible <= i.stock_minimo);
  }
}

module.exports = new InventarioService();