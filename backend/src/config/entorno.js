// Carga ÚNICA de las variables de entorno del backend (sustituye a require('dotenv').config()).
//  - Por defecto: backend/.env (desarrollo, demo y pruebas).
//  - Solo con el argumento explícito --entorno=produccion: backend/.env.produccion, y NADA más (los
//    dos archivos nunca se mezclan). No se puede activar con una variable de entorno.
// Las variables ya definidas en el proceso (terminal) no se sobrescriben. Nunca escribe en la consola.
// El resultado se expone para las comprobaciones del arranque (config/arranque.js).
const path = require('path');
const dotenv = require('dotenv');

const DIR_BACKEND = path.resolve(__dirname, '../..');
const ARGUMENTO_PRODUCCION = '--entorno=produccion';

const produccion = process.argv.slice(2).includes(ARGUMENTO_PRODUCCION);
const archivo = produccion ? '.env.produccion' : '.env';
const resultado = dotenv.config({ path: path.join(DIR_BACKEND, archivo), quiet: true });

module.exports = Object.freeze({
  nombre: produccion ? 'produccion' : 'desarrollo',
  archivo,
  cargado: !resultado.error,
  ARGUMENTO_PRODUCCION
});
