const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Insumo descontado por una orden de producción, con copia histórica de la receta,
// la unidad y el precio vigentes al crear la orden.
// Invariante: cantidad_consumida + cantidad_devuelta + cantidad_mermada <= cantidad_usada
const InsumoUsado = sequelize.define('InsumoUsado', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  orden_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  materia_prima_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  cantidad_por_unidad: {
    type: DataTypes.DECIMAL(12, 4),
    allowNull: false
  },
  unidad_medida: {
    type: DataTypes.STRING,
    allowNull: false
  },
  precio_unitario: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    defaultValue: 0
  },
  // Cantidad DESCONTADA del inventario al crear la orden
  cantidad_usada: {
    type: DataTypes.DECIMAL(12, 4),
    allowNull: false
  },
  // Convertida en producto (solo al finalizar)
  cantidad_consumida: {
    type: DataTypes.DECIMAL(12, 4),
    allowNull: false,
    defaultValue: 0
  },
  // Devuelta al inventario al cancelar
  cantidad_devuelta: {
    type: DataTypes.DECIMAL(12, 4),
    allowNull: false,
    defaultValue: 0
  },
  // Perdida al cancelar (descontada - devuelta)
  cantidad_mermada: {
    type: DataTypes.DECIMAL(12, 4),
    allowNull: false,
    defaultValue: 0
  },
  costo: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    defaultValue: 0
  }
}, {
  tableName: 'insumo_usado',
  timestamps: true
});

module.exports = InsumoUsado;
