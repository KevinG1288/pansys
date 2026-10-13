const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Producto = sequelize.define('Producto', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  nombre: {
    type: DataTypes.STRING,
    allowNull: false
  },
  precio_compra: {
    type: DataTypes.FLOAT,
    defaultValue: 0
  },
  precio_venta: {
    type: DataTypes.FLOAT,
    allowNull: false
  },
  cantidad_disponible: {
    type: DataTypes.INTEGER,
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
  tableName: 'productos',
  timestamps: true
});

module.exports = Producto;