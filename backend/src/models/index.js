const sequelize = require('../config/database');
const Rol = require('./Rol');
const Usuario = require('./Usuario');
const Panaderia = require('./Panaderia');
const MateriaPrima = require('./MateriaPrima');
const Producto = require('./Producto');
const Venta = require('./Venta');
const DetalleVenta = require('./DetalleVenta');

// Relaciones
Rol.hasMany(Usuario, { foreignKey: 'rol_id' });
Usuario.belongsTo(Rol, { foreignKey: 'rol_id' });

Usuario.hasOne(Panaderia, { foreignKey: 'usuario_id' });
Panaderia.belongsTo(Usuario, { foreignKey: 'usuario_id' });

// Panadería en la que trabaja el usuario (alias para no chocar con la relación anterior)
Panaderia.hasMany(Usuario, { foreignKey: 'panaderia_id', as: 'empleados', onDelete: 'RESTRICT' });
Usuario.belongsTo(Panaderia, { foreignKey: 'panaderia_id', as: 'panaderiaAsignada' });

Panaderia.hasMany(MateriaPrima, { foreignKey: 'panaderia_id' });
MateriaPrima.belongsTo(Panaderia, { foreignKey: 'panaderia_id' });

Panaderia.hasMany(Producto, { foreignKey: 'panaderia_id' });
Producto.belongsTo(Panaderia, { foreignKey: 'panaderia_id' });

Panaderia.hasMany(Venta, { foreignKey: 'panaderia_id' });
Venta.belongsTo(Panaderia, { foreignKey: 'panaderia_id' });

Venta.hasMany(DetalleVenta, { foreignKey: 'venta_id', onDelete: 'CASCADE' });
DetalleVenta.belongsTo(Venta, { foreignKey: 'venta_id' });

Producto.hasMany(DetalleVenta, { foreignKey: 'producto_id' });
DetalleVenta.belongsTo(Producto, { foreignKey: 'producto_id' });

module.exports = {
  sequelize,
  Rol,
  Usuario,
  Panaderia,
  MateriaPrima,
  Producto,
  Venta,
  DetalleVenta
};