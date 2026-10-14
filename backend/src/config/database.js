const { Sequelize } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    dialect: 'mysql',
    logging: false,
    // Entregar las columnas DECIMAL como números (por defecto mysql2 las devuelve como texto)
    dialectOptions: { decimalNumbers: true }
  }
);

module.exports = sequelize;