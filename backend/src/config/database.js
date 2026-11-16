const { Sequelize } = require('sequelize');
require('./entorno'); // única carga de variables (.env, o .env.produccion con --entorno=produccion)
const { leerPuertoBase } = require('./puertoBase');

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host: process.env.DB_HOST,
    port: leerPuertoBase(process.env.DB_PORT), // opcional; sin definir -> 3306 (ver puertoBase.js)
    dialect: 'mysql',
    logging: false,
    // Entregar las columnas DECIMAL como números (por defecto mysql2 las devuelve como texto)
    dialectOptions: { decimalNumbers: true }
  }
);

module.exports = sequelize;