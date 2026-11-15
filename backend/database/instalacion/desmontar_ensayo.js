'use strict';
// =====================================================================================
// Pansys - Desmontaje del ENSAYO de instalación (nunca en producción)
// =====================================================================================
// Uso (desde backend/, en una terminal interactiva, con autorización expresa):
//   node database/instalacion/desmontar_ensayo.js --parametros=<JSON fuera del repositorio> --solo-comprobar
//   node database/instalacion/desmontar_ensayo.js --parametros=<JSON fuera del repositorio> --ejecutar
// Lógica y barreras: desmontaje.js.
// =====================================================================================
const { ejecutar } = require('./desmontaje');
const { lanzar } = require('./cli');

lanzar(ejecutar);
