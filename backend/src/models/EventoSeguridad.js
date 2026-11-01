const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// SQL 005: auditoría de seguridad. Solo se insertan filas: ningún archivo de src/ las modifica ni
// las borra. Nunca contienen contraseñas, tokens, hashes de tokens, secretos ni direcciones IP.
// panaderia_id es la de la cuenta afectada EN EL MOMENTO del evento. restablecimiento_id no tiene
// clave foránea (los enlaces se pueden purgar); los tipos restablecimiento_* lo exigen y los demás
// lo prohíben (CHECK de la tabla).
const EventoSeguridad = sequelize.define('EventoSeguridad', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  tipo: {
    type: DataTypes.ENUM(
      'restablecimiento_solicitado', 'restablecimiento_propio_solicitado', 'restablecimiento_activado',
      'restablecimiento_fallido', 'restablecimiento_usado', 'restablecimiento_invalidado',
      'reconfirmacion_fallida', 'email_cambiado', 'emergencia_local'
    ),
    allowNull: false
  },
  usuario_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  panaderia_id: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  actor_id: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  restablecimiento_id: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  detalle: {
    type: DataTypes.STRING(255),
    allowNull: true
  }
}, {
  tableName: 'eventos_seguridad',
  timestamps: true,
  updatedAt: false
});

module.exports = EventoSeguridad;
