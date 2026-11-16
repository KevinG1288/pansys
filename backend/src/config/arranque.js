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

// JWT_SECRET en producción (I2). Se rechaza ausente, con espacios en los extremos, corto, igual a un
// valor de ejemplo o evidentemente débil (pocos caracteres distintos o un fragmento de ejemplo).
// El mensaje nunca incluye el valor. El secreto definitivo debe generarse con un generador
// criptográficamente seguro, por ejemplo:
//   node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
const LONGITUD_MINIMA_JWT = 32;
const CARACTERES_DISTINTOS_MINIMOS_JWT = 12;
const SECRETOS_DE_EJEMPLO = ['genera_una_cadena_larga_y_aleatoria'];
const FRAGMENTOS_DE_EJEMPLO = ['genera_una', 'cambia_est', 'changeme', 'change_me', 'your_secret', 'tu_secreto', 'secreto_jwt', 'jwt_secret', 'ejemplo', 'example', 'password', 'contrasena'];
const motivoSecretoJwtDebil = (valor) => {
  if (typeof valor !== 'string' || valor === '') return 'falta JWT_SECRET';
  if (valor.trim() !== valor) return 'JWT_SECRET tiene espacios al principio o al final';
  if (valor.length < LONGITUD_MINIMA_JWT) return `JWT_SECRET debe tener al menos ${LONGITUD_MINIMA_JWT} caracteres`;
  const minusculas = valor.toLowerCase();
  if (SECRETOS_DE_EJEMPLO.includes(valor) || FRAGMENTOS_DE_EJEMPLO.some(f => minusculas.includes(f))) return 'JWT_SECRET es un valor de ejemplo';
  if (new Set(valor).size < CARACTERES_DISTINTOS_MINIMOS_JWT) return 'JWT_SECRET es demasiado repetitivo';
  return null;
};

// Dirección de escucha HTTP (PANSYS_HOST). En producción el servidor está detrás de Caddy y solo
// debe aceptar conexiones locales: se admite únicamente una dirección de bucle local y, sin
// PANSYS_HOST (o vacía), se usa 127.0.0.1. Así el puerto no queda expuesto aunque falte el
// firewall, sin restringir las conexiones salientes (SMTP). Fuera de producción, sin PANSYS_HOST
// se mantiene el comportamiento anterior: undefined -> app.listen(PORT) en todas las interfaces
// (demo en la red local); si se define, se usa tal cual.
const HOSTS_LOCALES = Object.freeze(['127.0.0.1', '::1', 'localhost']);
const HOST_PRODUCCION = '127.0.0.1';
const resolverHost = (env, opciones) => {
  const valor = env.PANSYS_HOST;
  const definido = valor !== undefined && valor !== '';
  if (opciones.entorno !== 'produccion') return definido ? valor : undefined;
  if (!definido) return HOST_PRODUCCION;
  if (!HOSTS_LOCALES.includes(valor)) {
    throw new ErrorArranque(`Producción: PANSYS_HOST solo admite ${HOSTS_LOCALES.join(', ')} (el servidor escucha en local, detrás del proxy). El servidor no arranca.`);
  }
  return valor;
};

// Antes de conectar (primer paso de iniciarServidor):
//  1. Producción: la base de producción exige, A LA VEZ, --entorno=produccion (solo por argumento),
//     NODE_ENV=production y PANSYS_AUTORIZAR_BASE_PRODUCCION=pansys_db, y nunca el modo demo. Una
//     combinación parcial o incoherente detiene el arranque. Con --entorno=produccion, además, un
//     JWT_SECRET ausente o débil detiene el arranque (motivoSecretoJwtDebil), y también un
//     PANSYS_HOST que no sea de bucle local (resolverHost).
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
    const motivoJwt = motivoSecretoJwtDebil(env.JWT_SECRET);
    if (motivoJwt) throw new ErrorArranque(`Producción: ${motivoJwt}. Genérelo con un generador criptográficamente seguro (ver .env.example). El servidor no arranca.`);
    resolverHost(env, opciones);
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

// Orden del arranque: configuración -> build -> conexión -> base real -> respuestas finales ->
// aceptar peticiones. Si cualquier paso falla, no se llama a listen().
// montarFinales(app): monta lo que debe ir DESPUÉS de todas las rutas (404 de /api y manejador
// final de errores). Se hace aquí, justo antes de listen(), y no al cargar app.js, para que las
// rutas que se añadan después de cargarlo (p. ej. la ruta de identidad de las suites de
// integración) queden por delante y no las tape el 404.
const iniciarServidor = async ({ app, sequelize, env = process.env, opciones = leerOpciones(env), montarFinales }) => {
  validarConfiguracion(env, opciones);
  comprobarBuild(opciones);
  await sequelize.authenticate();
  await verificarBaseConectada(sequelize, opciones);
  if (typeof montarFinales === 'function') montarFinales(app);
  const host = resolverHost(env, opciones);
  return new Promise((resolve, reject) => {
    const alEscuchar = () => resolve(servidor);
    // Sin host (fuera de producción y sin PANSYS_HOST): exactamente la llamada anterior
    const servidor = host === undefined ? app.listen(env.PORT, alEscuchar) : app.listen(env.PORT, host, alEscuchar);
    servidor.on('error', reject);
  });
};

module.exports = {
  BASE_DEMO, BASE_PRODUCCION, ErrorArranque, leerOpciones, validarConfiguracion, motivoSecretoJwtDebil, comprobarBuild,
  verificarBaseConectada, montarFrontend, iniciarServidor, resolverHost, HOSTS_LOCALES, HOST_PRODUCCION
};
