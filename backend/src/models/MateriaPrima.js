const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

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
    type: DataTypes.FLOAT,
    defaultValue: 0
  },
  stock_minimo: {
    type: DataTypes.FLOAT,
    defaultValue: 0
  },
  precio_unitario: {
    type: DataTypes.FLOAT,
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