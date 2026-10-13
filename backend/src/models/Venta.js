const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Venta = sequelize.define('Venta', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  fecha: {
    type: DataTypes.DATEONLY,
    defaultValue: DataTypes.NOW
  },
  total: {
    type: DataTypes.FLOAT,
    defaultValue: 0
  },
  empleado_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  panaderia_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  estado: {
    type: DataTypes.STRING,
    defaultValue: 'completada'
  }
}, {
  tableName: 'ventas',
  timestamps: true
});

module.exports = Venta;