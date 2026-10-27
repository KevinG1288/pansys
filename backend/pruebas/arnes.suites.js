// Arnés de comportamiento para pruebas/suites.unitarias.js: carga UNA suite de integración
// (inventario, ventas, produccion o usuarios .pruebas.js) sustituyendo todo lo que podría tocar una
// base de datos o la red por dobles que registran lo que la suite intenta hacer. No se ejecuta a
// mano: lo lanza suites.unitarias.js en un proceso hijo.
//
//   node pruebas/arnes.suites.js <ruta de la suite> '<escenario JSON>'
//
// Dobles: dotenv (no lee .env), jsonwebtoken, los modelos y sequelize (responden a las lecturas de
// comprobación previas), ./aislamiento (las funciones puras son las reales; iniciarEjecucion y la
// ejecución son dobles), ../src/app (servidor falso que "escucha" como app.js) y fetch. Toda conexión
// de red (net, tls) queda bloqueada y cualquier otra carga de módulo no nativo se rechaza.
// Al salir, escribe en stderr <<REGISTRO:{...}>> con todo lo observado.
//
// Escenario: { base: 'pansys_test' | otra, bloqueoOcupado: bool, identidad: 'falla' | 'otroRunId',
//              errorEn: 'authenticate' | 'iniciarEjecucion' | 'crearCuenta' }
// errorEn simula un error inesperado (TypeError) en ese paso: sirve de control negativo, para
// comprobar que suites.unitarias.js no da por bueno un aborto que no es el esperado.

const Module = require('module');
const net = require('net');
const tls = require('tls');
const path = require('path');
const fs = require('fs');

const registro = { orden: [], consultas: [], modelos: [], peticiones: [], red: [], cargasBloqueadas: [] };
const anotar = (evento) => registro.orden.push(evento);

const bloquearRed = (nombre) => function () { registro.red.push(nombre); throw new Error('red bloqueada en el arnés'); };
net.connect = net.createConnection = bloquearRed('net.connect');
net.Socket.prototype.connect = bloquearRed('Socket.connect');
tls.connect = bloquearRed('tls.connect');

const [archivo, textoEscenario] = process.argv.slice(2);
const escenario = JSON.parse(textoEscenario ?? '{}');
const ruta = path.resolve(archivo);
const carpeta = path.dirname(ruta);

process.on('exit', (codigo) => {
  process.stderr.write(`\n<<REGISTRO:${JSON.stringify({ ...registro, codigo })}>>\n`);
});

// ---------- Dobles ----------
const RUN_ID = '0123456789abcdef';

// Error inesperado inyectado (control negativo)
const fallarSi = (paso) => {
  if (escenario.errorEn === paso) throw new TypeError(`Error inesperado simulado en ${paso}`);
};

const sequelizeFalso = {
  authenticate: async () => { anotar('sequelize:authenticate'); fallarSi('authenticate'); },
  query: async (sql) => {
    const texto = String(sql);
    registro.consultas.push(texto);
    anotar('sequelize:query');
    if (texto === 'SELECT DATABASE() AS base') return [[{ base: escenario.base ?? 'pansys_test' }]];
    if (texto.includes("COLUMN_NAME = 'version_sesion'")) {
      return texto.includes('COLUMN_DEFAULT AS d') ? [[{ t: 'int unsigned', n: 'NO', d: '0' }]] : [[{ n: 1 }]];
    }
    if (texto.includes("'cantidad_disponible', 'stock_minimo', 'precio_unitario'")) {
      return [[1, 2, 3].map(() => ({ t: 'decimal(12,4)', n: 'NO', d: '0.0000' }))];
    }
    return [[{ n: 0 }]];
  },
  close: async () => { anotar('sequelize:close'); }
};

// Modelo falso: cualquier llamada a un método queda registrada (la suite no debería hacer ninguna)
const modeloFalso = (nombre) => new Proxy({}, {
  get: (objeto, propiedad) => (propiedad in objeto ? objeto[propiedad] : (...args) => {
    registro.modelos.push(`${nombre}.${String(propiedad)}`);
    return Promise.resolve(null);
  }),
  set: (objeto, propiedad, valor) => { objeto[propiedad] = valor; return true; }
});
const modelos = new Proxy({ sequelize: sequelizeFalso }, {
  get: (objeto, propiedad) => {
    if (!(propiedad in objeto)) objeto[propiedad] = modeloFalso(String(propiedad));
    return objeto[propiedad];
  }
});

const jwtFalso = { sign: () => 'token.falso.del-arnes', verify: () => ({}), decode: () => ({}) };

// Módulos de pruebas reales (puros): se cargan antes de instalar el cargador del arnés
const cargaOriginal = Module._load;
const aislamientoReal = cargaOriginal(path.join(carpeta, 'aislamiento.js'), null, false);
const solapamientoReal = cargaOriginal(path.join(carpeta, 'solapamiento.js'), null, false);

let siguienteId = 1000;
const ejecucionFalsa = (suite) => ({
  runId: RUN_ID,
  correo: (etiqueta) => `prueba.${suite}.${RUN_ID}.${etiqueta}@pansys.test`,
  nombre: (texto) => `PRUEBA ${RUN_ID} ${texto}`,
  crearCuenta: async () => { anotar('ejecucion:crearCuenta'); fallarSi('crearCuenta'); return ++siguienteId; },
  crearPanaderia: async () => { anotar('ejecucion:crearPanaderia'); return ++siguienteId; },
  crearProducto: async () => { anotar('ejecucion:crearProducto'); return ++siguienteId; },
  registrar: (tipo, id) => { anotar('ejecucion:registrar'); return id; },
  ids: () => [],
  exigirBloqueo: async () => { anotar('ejecucion:exigirBloqueo'); },
  limpiar: async () => {
    anotar('ejecucion:limpiar');
    return { ok: true, resultado: 'limpia', motivo: null, borrados: {}, pendientes: null };
  },
  cerrar: async () => { anotar('ejecucion:cerrar'); }
});
const aislamientoFalso = {
  ...aislamientoReal,
  iniciarEjecucion: async (opciones) => {
    anotar(`ejecucion:iniciarEjecucion:${opciones?.suite}`);
    fallarSi('iniciarEjecucion');
    if (escenario.bloqueoOcupado) throw new aislamientoReal.ErrorAislamiento('Otra suite de integración está en curso (bloqueo de suite ocupado): no se escribe nada');
    return ejecucionFalsa(opciones?.suite);
  }
};

// Como app.js: devuelve la aplicación y llama a app.listen después de un turno
const appFalsa = () => {
  anotar('app:require');
  const app = {
    listen() {
      anotar('app:listen');
      return {
        listening: true,
        address: () => ({ port: 43210, family: 'IPv4' }),
        close: (cb) => { anotar('app:close'); cb(); },
        closeAllConnections: () => {}
      };
    },
    get(rutaGet) { anotar(`app:get ${rutaGet}`); }
  };
  setImmediate(() => app.listen(0));
  return app;
};

globalThis.fetch = async (url, opciones = {}) => {
  registro.peticiones.push({ url: String(url), metodo: opciones.method ?? 'GET', conToken: Boolean(opciones.headers?.Authorization) });
  anotar('fetch');
  if (escenario.identidad === 'otroRunId') return { status: 200, json: async () => ({ runId: 'ffffffffffffffff' }) };
  throw new Error('sin red en el arnés');
};

// ---------- Cargador del arnés ----------
Module._load = function (peticion) {
  if (Module.isBuiltin(peticion)) return cargaOriginal.apply(this, arguments);
  switch (peticion) {
    case 'dotenv': return { config: () => ({ parsed: {} }) };
    case 'jsonwebtoken': return jwtFalso;
    case '../src/models/index': anotar('modelos:require'); return modelos;
    case './aislamiento': return aislamientoFalso;
    case './solapamiento': return solapamientoReal;
    case '../src/app': return appFalsa();
    default:
      registro.cargasBloqueadas.push(peticion);
      throw new Error(`carga bloqueada en el arnés: ${peticion}`);
  }
};

const modulo = new Module(ruta, null);
modulo.filename = ruta;
modulo.paths = Module._nodeModulePaths(carpeta);
modulo._compile(fs.readFileSync(ruta, 'utf8'), ruta);
