const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Cantidad de una materia prima necesaria para elaborar UNA unidad de producto
const RecetaProducto = sequelize.define('RecetaProducto', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  producto_id: {
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
  }
}, {
  tableName: 'receta_producto',
  timestamps: true
});

module.exports = RecetaProducto;
