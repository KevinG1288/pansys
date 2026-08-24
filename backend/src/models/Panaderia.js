const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Panaderia = sequelize.define('Panaderia', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  nombre: {
    type: DataTypes.STRING,
    allowNull: false
  },
  direccion: {
    type: DataTypes.STRING,
    allowNull: false
  },
  telefono: {
    type: DataTypes.STRING
  },
  en_red: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  usuario_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  }
}, {
  tableName: 'panaderias',
  timestamps: true
});

module.exports = Panaderia;