const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Cantidades y precio: DECIMAL(12,4) NOT NULL DEFAULT 0 (SQL 003). Con decimalNumbers llegan como
// números de JS exactos; el servicio de Inventario valida formato y rango antes de guardar.
const MateriaPrima = sequelize.define('MateriaPrima', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  nombre: {
    type: DataTypes.STRING,
    allowNull: false
  },
  unidad_medida: {
    type: DataTypes.STRING,
    allowNull: false
  },
  cantidad_disponible: {
    type: DataTypes.DECIMAL(12, 4),
    allowNull: false,
    defaultValue: 0
  },
  stock_minimo: {
    type: DataTypes.DECIMAL(12, 4),
    allowNull: false,
    defaultValue: 0
  },
  precio_unitario: {
    type: DataTypes.DECIMAL(12, 4),
    allowNull: false,
    defaultValue: 0
  },
  panaderia_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  estado: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  }
}, {
  tableName: 'materia_prima',
  timestamps: true
});

module.exports = MateriaPrima;