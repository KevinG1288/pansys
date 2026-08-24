const sequelize = require('../config/database');
const Rol = require('./Rol');
const Usuario = require('./Usuario');
const Panaderia = require('./Panaderia');
const MateriaPrima = require('./MateriaPrima');

// Relaciones
Rol.hasMany(Usuario, { foreignKey: 'rol_id' });
Usuario.belongsTo(Rol, { foreignKey: 'rol_id' });

Usuario.hasOne(Panaderia, { foreignKey: 'usuario_id' });
Panaderia.belongsTo(Usuario, { foreignKey: 'usuario_id' });

Panaderia.hasMany(MateriaPrima, { foreignKey: 'panaderia_id' });
MateriaPrima.belongsTo(Panaderia, { foreignKey: 'panaderia_id' });

module.exports = {
  sequelize,
  Rol,
  Usuario,
  Panaderia,
  MateriaPrima
};