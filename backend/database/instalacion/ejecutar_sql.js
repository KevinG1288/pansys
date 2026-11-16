'use strict';
// =====================================================================================
// Pansys - INSTALACIÓN LIMPIA: ejecuta 01_esquema.sql o 04_verificar.sql de forma controlada
// =====================================================================================
// Uso (desde backend/):
//   node database/instalacion/ejecutar_sql.js --parametros=<JSON fuera del repositorio> --script=01_esquema.sql --cuenta=instalador
//   node database/instalacion/ejecutar_sql.js --parametros=<JSON fuera del repositorio> --script=04_verificar.sql --cuenta=aplicacion
// Lógica y barreras: ejecutor.js. Procedimiento: INSTALACION.md.
// =====================================================================================
const { ejecutar } = require('./ejecutor');
const { lanzar } = require('./cli');

lanzar(ejecutar);
