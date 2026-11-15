'use strict';
// Dependencias reales de los ejecutables de instalación (terminal, archivos y MySQL).
// Las contraseñas solo pasan por preguntarOculto (sin eco) o por los archivos de credenciales.
const fs = require('fs');
const readline = require('readline');
const mysql = require('mysql2/promise');
const { leerOculto, crearArchivosReales } = require('./comun');

const preguntar = (texto) => new Promise((resolve) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr, terminal: true });
  rl.question(texto, (respuesta) => { rl.close(); resolve(respuesta); });
});

const conectar = ({ host, puerto, usuario, base, contrasena }) => mysql.createConnection({
  host, port: puerto, user: usuario, password: contrasena, database: base,
  multipleStatements: false, connectTimeout: 10000, charset: 'utf8mb4_0900_ai_ci'
});

const dependencias = () => ({
  argv: process.argv.slice(2),
  leerArchivo: (ruta) => fs.readFileSync(ruta, 'utf8'),
  leerBytes: (ruta) => fs.readFileSync(ruta),
  preguntar,
  preguntarOculto: (pregunta) => leerOculto({ entrada: process.stdin, salida: process.stderr, pregunta }),
  conectar,
  archivos: crearArchivosReales(),
  salida: process.stdout
});

const lanzar = (ejecutar, extra = {}) => ejecutar({ ...dependencias(), ...extra }).then((codigo) => { process.exitCode = codigo; });

module.exports = { lanzar };
