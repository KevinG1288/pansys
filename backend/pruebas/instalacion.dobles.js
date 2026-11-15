// Dobles compartidos por las pruebas unitarias de la instalación limpia (sin MySQL ni red).
// No es una suite: lo cargan instalacion.unitarias.js e instalacion.herramientas.unitarias.js.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const DIR_INSTALACION = path.join(__dirname, '../database/instalacion');
const REPOSITORIO = path.resolve(__dirname, '../..');
const FUERA = path.resolve(REPOSITORIO, '..', 'pansys_ensayo_pruebas_unitarias');
const IDENTIDAD = Object.freeze({ puerto: 3317, server_uuid: '11111111-2222-3333-4444-555555555555', datadir: 'D:\\ensayo\\datos\\' });
const sha = (archivo) => crypto.createHash('sha256').update(fs.readFileSync(path.join(DIR_INSTALACION, archivo))).digest('hex');

const parametros = () => ({
  identidad: { ...IDENTIDAD },
  conexion: { host: '127.0.0.1', base: 'pansys_inst_ensayo' },
  administrador_mysql: 'root',
  cuentas: {
    instalador: { usuario: 'pansys_instalador', host: '127.0.0.1', credenciales: path.join(FUERA, 'instalador.env') },
    aplicacion: { usuario: 'pansys_app_ensayo', host: '127.0.0.1', credenciales: path.join(FUERA, 'aplicacion.env') }
  },
  sha256: { '01_esquema.sql': sha('01_esquema.sql'), '04_verificar.sql': sha('04_verificar.sql') },
  panaderias: [
    { nombre: 'Panadería Norte', direccion: 'Calle 1 # 2-3', localidad: 'Kennedy', telefono: null, en_red: true, administrador: { email: 'norte@correo.co' } },
    { nombre: 'Panadería Sur', direccion: 'Carrera 4 # 5-6', localidad: 'Bosa', telefono: '3000000000', en_red: true, administrador: { email: 'sur@correo.co' } }
  ],
  desmontaje: {
    bases: ['pansys_inst_ensayo', 'pansys_inst_senuelo', 'pansysxinstxensayo'],
    cuentas: [{ usuario: 'pansys_instalador', host: '127.0.0.1' }, { usuario: 'pansys_app_ensayo', host: '127.0.0.1' }],
    protegidas: ['pansysensayo005']
  }
});
const RUTA_PARAMETROS = path.join(FUERA, 'parametros.json');

const crearSalida = () => ({ texto: '', write(t) { this.texto += t; } });
const crearTTY = () => {
  const e = new EventEmitter();
  Object.assign(e, { isTTY: true, raw: false, setRawMode(v) { e.raw = v; }, setEncoding() {}, resume() { e.activa = true; }, pause() { e.activa = false; } });
  return e;
};

// Archivos en memoria con protección simulada. fallar: { crear, escribir, verificar, borrar }.
const crearArchivos = ({ fallar = {}, iniciales = {}, directorios = [FUERA] } = {}) => {
  const contenido = new Map(Object.entries(iniciales));
  const protegidos = new Set(Object.keys(iniciales));
  const registro = [];
  return {
    contenido, protegidos, registro,
    existe: (r) => contenido.has(r),
    directorioExiste: (d) => directorios.includes(d),
    leer: (r) => { registro.push(['leer', r]); if (!contenido.has(r)) throw Object.assign(new Error('no existe'), { code: 'ENOENT' }); return contenido.get(r); },
    crearProtegido(r) {
      registro.push(['crear', r]);
      if (contenido.has(r)) throw Object.assign(new Error('existe'), { code: 'EEXIST' });
      contenido.set(r, '');
      if (fallar.crear) throw Object.assign(new Error('icacls'), { code: 'EPERM' });
      protegidos.add(r);
    },
    escribirProtegido(r, t) {
      registro.push(['escribir', r]);
      if (!protegidos.has(r)) throw new Error('sin proteger');
      if (fallar.escribir) { contenido.set(r, t.slice(0, 5)); throw Object.assign(new Error('disco'), { code: 'ENOSPC' }); }
      contenido.set(r, t);
    },
    verificarProtegido(r) {
      registro.push(['verificar', r]);
      if (fallar.verificar || !protegidos.has(r)) { const { ErrorInstalacion } = require('../database/instalacion/comun'); throw new ErrorInstalacion('El archivo de credenciales no está restringido a su usuario. No se usa.'); }
    },
    borrar(r) { registro.push(['borrar', r]); if (fallar.borrar) throw new Error('no'); contenido.delete(r); protegidos.delete(r); }
  };
};

// Conexión MySQL falsa por reglas: [[regex, (params, sql) => resultado | throw]]. Registra todo.
const crearMysql = (reglas, { nombre = 'con' } = {}) => {
  const registro = [];
  const responder = async (tipo, sql, params = []) => {
    registro.push({ tipo, sql, params });
    for (const [re, fn] of reglas) if (re.test(sql)) return fn(params, sql);
    throw new Error(`SQL no previsto en el doble ${nombre}: ${sql}`);
  };
  return {
    registro, cerrada: false, nombre,
    execute: (sql, params) => responder('execute', sql, params),
    query: (sql, params) => responder('query', sql, params),
    async beginTransaction() { registro.push({ tipo: 'tx', sql: 'BEGIN' }); },
    async commit() { registro.push({ tipo: 'tx', sql: 'COMMIT' }); },
    async rollback() { registro.push({ tipo: 'tx', sql: 'ROLLBACK' }); },
    async end() { this.cerrada = true; }
  };
};
const errorMysql = (code, errno, extra = {}) => Object.assign(new Error(`mensaje con datos sensibles norte@correo.co ${code}`), { code, errno, sql: 'INSERT ... valores', ...extra });
const identidadOk = (base = null, id = IDENTIDAD) => [/^SELECT @@port AS puerto/, () => [[{ puerto: id.puerto, uuid: id.server_uuid, datadir: id.datadir, base }]]];

module.exports = {
  DIR_INSTALACION, REPOSITORIO, FUERA, IDENTIDAD, RUTA_PARAMETROS, parametros, crearSalida, crearTTY, crearArchivos,
  crearMysql, errorMysql, identidadOk
};
