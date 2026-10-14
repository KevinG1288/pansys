const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const OrdenProduccion = sequelize.define('OrdenProduccion', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  panaderia_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  producto_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  empleado_id: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  fecha: {
    type: DataTypes.DATEONLY,
    allowNull: false
  },
  cantidad_planificada: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  cantidad_producida: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  estado: {
    type: DataTypes.ENUM('en_proceso', 'finalizada', 'cancelada'),
    allowNull: false,
    defaultValue: 'en_proceso'
  },
  costo_insumos: {
    type: DataTypes.DECIMAL(12, 2),
    allowNull: false,
    defaultValue: 0
  },
  observaciones: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  motivo_cancelacion: {
    type: DataTypes.STRING(500),
    allowNull: true
  },
  insumos_devueltos: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  // Fecha de cierre: finalización o cancelación
  fecha_finalizacion: {
    type: DataTypes.DATE,
    allowNull: true
  },
  cerrado_por: {
    type: DataTypes.INTEGER,
    allowNull: true
  }
}, {
  tableName: 'orden_produccion',
  timestamps: true
});

module.exports = OrdenProduccion;
