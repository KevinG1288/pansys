const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Usuario = sequelize.define('Usuario', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  email: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  contrasena: {
    type: DataTypes.STRING,
    allowNull: false
  },
  rol_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  // NULL = administrador general (opera sobre ambas panaderías)
  panaderia_id: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  estado: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  // SQL 004: sube al cambiar la contraseña o desactivar la cuenta e invalida los JWT anteriores.
  // Es un dato interno: no se devuelve en ninguna respuesta.
  version_sesion: {
    type: DataTypes.INTEGER.UNSIGNED,
    allowNull: false,
    defaultValue: 0
  }
}, {
  tableName: 'usuarios',
  timestamps: true
});

module.exports = Usuario;