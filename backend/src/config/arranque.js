const fs = require('fs');
const path = require('path');
const express = require('express');
const { leerConfiguracionCorreo, ErrorConfiguracionCorreo } = require('../utils/correo');

// Modo demo: el servidor solo arranca contra la base de pruebas. Nunca se cambia la base de
// forma silenciosa: si la configuración no es exactamente esta, el arranque se cancela.
const BASE_DEMO = 'pansys_test';

// frontend/build (generado con: node scripts/compilar-demo.js, desde frontend/)
const DIR_FRONTEND = path.resolve(__dirname, '../../../frontend/build');

// Error de configuración del arranque: se informa con su mensaje, sin traza
class ErrorArranque extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'ErrorArranque';
  }
}

// '1', 'true', 'si' o 'sí' (sin distinguir mayúsculas) activan la opción; cualquier otro valor no
const activado = (valor) => ['1', 'true', 'si', 'sí'].includes(String(valor ?? '').trim().toLowerCase());

// Base de producción. Solo se admite con autorización explícita y coherente (ver validarConfiguracion).
const BASE_PRODUCCION = 'pansys_db';
// MySQL en Windows no distingue mayúsculas en los nombres de base: se compara normalizado
const normalizarBase = (valor) => String(valor ?? '').trim().toLowerCase();

// PANSYS_MODO_DEMO: exige pansys_test. PANSYS_SERVIR_FRONTEND: sirve frontend/build desde Express.
// entorno/entornoCargado: resultado de config/entorno.js ('produccion' solo con --entorno=produccion).
const leerOpciones = (env = process.env, estadoEntorno = require('./entorno')) => ({
  modoDemo: activado(env.PANSYS_MODO_DEMO),
  servirFrontend: activado(env.PANSYS_SERVIR_FRONTEND),
  dirFrontend: DIR_FRONTEND,
  entorno: estadoEntorno.nombre,
  entornoCargado: estadoEntorno.cargado
});

// Antes de conectar (primer paso de iniciarServidor):
//  1. Producción: la base de producción exige, A LA VEZ, --entorno=produccion (solo por argumento),
//     NODE_ENV=production y PANSYS_AUTORIZAR_BASE_PRODUCCION=pansys_db, y nunca el modo demo. Una
//     combinación parcial o incoherente detiene el arranque.
//  2. Correo: una configuración inválida o no autorizada (p. ej. SMTP real fuera de producción sin
//     PANSYS_PERMITIR_SMTP_REAL=1 y destinos) detiene el arranque. El mensaje solo usa los textos de
//     correo.js, que nunca incluyen valores; cualquier otro error se resume sin detalles.
//  3. Modo demo: DB_NAME debe ser exactamente pansys_test.
const validarConfiguracion = (env, opciones) => {
  const esProduccion = opciones.entorno === 'produccion';
  const esBaseProduccion = normalizarBase(env.DB_NAME) === BASE_PRODUCCION;
  if (esProduccion) {
    if (!opciones.entornoCargado) throw new ErrorArranque('--entorno=produccion: no se pudo leer backend/.env.produccion. El servidor no arranca.');
    if (env.NODE_ENV !== 'production') throw new ErrorArranque('--entorno=produccion exige NODE_ENV=production. El servidor no arranca.');
    if (opciones.modoDemo) throw new ErrorArranque('El modo demo no se admite con --entorno=produccion. El servidor no arranca.');
  } else if (env.NODE_ENV === 'production') {
    throw new ErrorArranque('NODE_ENV=production solo se admite con --entorno=produccion (npm run start:produccion). El servidor no arranca.');
  }
  if (esBaseProduccion) {
    if (!esProduccion || env.PANSYS_AUTORIZAR_BASE_PRODUCCION !== BASE_PRODUCCION) {
      throw new ErrorArranque(`DB_NAME apunta a la base de producción. Solo se admite con --entorno=produccion, NODE_ENV=production y PANSYS_AUTORIZAR_BASE_PRODUCCION=${BASE_PRODUCCION}. El servidor no arranca.`);
    }
  } else if (env.PANSYS_AUTORIZAR_BASE_PRODUCCION !== undefined) {
    throw new ErrorArranque('PANSYS_AUTORIZAR_BASE_PRODUCCION está definida, pero DB_NAME no es la base de producción. El servidor no arranca.');
  }
  try {
    leerConfiguracionCorreo(env);
  } catch (error) {
    const detalle = error instanceof ErrorConfiguracionCorreo ? error.message : 'la configuración no es válida';
    throw new ErrorArranque(`Correo: ${detalle}. El servidor no arranca.`);
  }
  if (!opciones.modoDemo) return;
  if (env.DB_NAME !== BASE_DEMO) {
    throw new ErrorArranque(
      `Modo demo: DB_NAME debe ser exactamente "${BASE_DEMO}" y es "${env.DB_NAME ?? '(sin definir)'}". ` +
      'El servidor no arranca.'
    );
  }
};

// Antes de servir el frontend, el build tiene que existir
const comprobarBuild = (opciones) => {
  if (!opciones.servirFrontend) return;
  if (!fs.existsSync(path.join(opciones.dirFrontend, 'index.html'))) {
    throw new ErrorArranque(
      `PANSYS_SERVIR_FRONTEND está activo pero no existe ${path.join(opciones.dirFrontend, 'index.html')}. ` +
      'Compile antes el frontend (desde frontend/: node scripts/compilar-demo.js). El servidor no arranca.'
    );
  }
};

// Después de conectar y antes de aceptar peticiones: la base REAL de la conexión
const verificarBaseConectada = async (sequelize, opciones) => {
  if (!opciones.modoDemo) return;
  const [[fila]] = await sequelize.query('SELECT DATABASE() AS base');
  if (fila?.base !== BASE_DEMO) {
    throw new ErrorArranque(
      `Modo demo: la conexión apunta a "${fila?.base ?? '(ninguna)'}" y no a "${BASE_DEMO}". El servidor no arranca.`
    );
  }
};

const esRutaApi = (ruta) => ruta === '/api' || ruta.startsWith('/api/');

// Sirve los archivos de frontend/build y devuelve index.html para las rutas del frontend
// (/login, /dashboard, ...). Nunca intercepta /api: esas rutas siguen a los routers de la API
// o al 404 de Express. Las rutas con extensión (p. ej. /static/js/x.js) que no existan dan 404
// en lugar de index.html.
const montarFrontend = (app, dir) => {
  const estaticos = express.static(dir, { index: 'index.html' });
  app.use((req, res, next) => (esRutaApi(req.path) ? next() : estaticos(req, res, next)));
  app.use((req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method) || esRutaApi(req.path) || path.extname(req.path)) return next();
    res.sendFile(path.join(dir, 'index.html'));
  });
};

// Orden del arranque: configuración -> build -> conexión -> base real -> aceptar peticiones.
// Si cualquier paso falla, no se llama a listen().
const iniciarServidor = async ({ app, sequelize, env = process.env, opciones = leerOpciones(env) }) => {
  validarConfiguracion(env, opciones);
  comprobarBuild(opciones);
  await sequelize.authenticate();
  await verificarBaseConectada(sequelize, opciones);
  return new Promise((resolve, reject) => {
    const servidor = app.listen(env.PORT, () => resolve(servidor));
    servidor.on('error', reject);
  });
};

module.exports = {
  BASE_DEMO, BASE_PRODUCCION, ErrorArranque, leerOpciones, validarConfiguracion, comprobarBuild,
  verificarBaseConectada, montarFrontend, iniciarServidor
};
