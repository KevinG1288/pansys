'use strict';
// =====================================================================================
// Pansys - INSTALACIÓN LIMPIA: cuentas MySQL (instalación antes de 01; aplicación después de 02)
// =====================================================================================
// Uso (desde backend/, en una terminal interactiva):
//   node database/instalacion/03_crear_cuenta.js --parametros=<JSON fuera del repositorio> --tipo=instalador
//   node database/instalacion/03_crear_cuenta.js --parametros=<JSON fuera del repositorio> --tipo=aplicacion
// MySQL genera la contraseña (RANDOM PASSWORD); solo se guarda en el archivo de credenciales
// restringido de los parámetros. Nunca se muestra. Lógica y barreras: cuentas.js.
// =====================================================================================
const { ejecutar } = require('./cuentas');
const { lanzar } = require('./cli');

lanzar(ejecutar);
