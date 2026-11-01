const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// SQL 005: enlaces de restablecimiento de contraseña. Solo se guarda el SHA-256 del token.
// Las columnas generadas activo_de y enviando_de (UNIQUE: como mucho un enlace 'activo' y una
// reserva 'enviando' por cuenta) las calcula MySQL: este modelo NO las declara.
// Estados: enviando (reserva; no se puede usar) -> activo (el único que se puede usar) ->
// usado | invalidado; o enviando -> envio_fallido. Los CHECK de la tabla exigen la coherencia
// entre estado, motivo y fechas.
const RestablecimientoContrasena = sequelize.define('RestablecimientoContrasena', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  usuario_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  origen: {
    type: DataTypes.ENUM('administrador', 'propio'),
    allowNull: false
  },
  solicitado_por: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  token_hash: {
    type: DataTypes.CHAR(64),
    allowNull: false
  },
  estado: {
    type: DataTypes.ENUM('enviando', 'activo', 'usado', 'invalidado', 'envio_fallido'),
    allowNull: false,
    defaultValue: 'enviando'
  },
  motivo: {
    type: DataTypes.STRING(30),
    allowNull: true
  },
  intentos_fallidos: {
    type: DataTypes.TINYINT.UNSIGNED,
    allowNull: false,
    defaultValue: 0
  },
  expira_en: {
    type: DataTypes.DATE,
    allowNull: false
  },
  enviado_en: {
    type: DataTypes.DATE,
    allowNull: true
  },
  usado_en: {
    type: DataTypes.DATE,
    allowNull: true
  },
  invalidado_en: {
    type: DataTypes.DATE,
    allowNull: true
  },
  fallido_en: {
    type: DataTypes.DATE,
    allowNull: true
  }
}, {
  tableName: 'restablecimientos_contrasena',
  timestamps: true
});

module.exports = RestablecimientoContrasena;
