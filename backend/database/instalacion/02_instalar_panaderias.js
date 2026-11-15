'use strict';
// =====================================================================================
// Pansys - INSTALACIÓN LIMPIA, paso 2: exactamente dos panaderías y sus dos administradores
// =====================================================================================
// Requisito: 01_esquema.sql ya aplicado (ejecutar_sql.js) en la base NUEVA.
// Uso (desde backend/, en una terminal interactiva):
//   node database/instalacion/02_instalar_panaderias.js --parametros=<JSON fuera del repositorio>
// La contraseña de la cuenta de instalación se lee de su archivo de credenciales protegido; las de
// los administradores se piden de forma oculta (dos veces) y solo se guarda su hash bcrypt.
// Lógica y barreras: instalador.js. Procedimiento: INSTALACION.md.
// =====================================================================================
const bcrypt = require('bcrypt');
const { ejecutar } = require('./instalador');
const { lanzar } = require('./cli');

lanzar(ejecutar, { hashear: (contrasena, coste) => bcrypt.hash(contrasena, coste) });
