// Pruebas unitarias de la instalación limpia, parte 2: herramientas (sin MySQL ni red).
//  - comun.js: credenciales (serializar/leer), argumentos, identidad positiva, errores seguros.
//  - Archivos protegidos: lógica de icacls/whoami con dobles y, en Windows, una prueba REAL con un
//    archivo ficticio (sin secretos) en una carpeta temporal propia que se elimina al terminar.
//  - ejecutor.js (ejecutar_sql.js): partición de sentencias, SHA-256 aprobado, identidad, compuertas,
//    estado tras un fallo y conexión perdida.
//  - cuentas.js (03_crear_cuenta.js): orden seguro (archivo protegido -> CREATE USER -> secreto ->
//    GRANT -> verificación), escape de _, verificación exacta y funcional, sin borrados automáticos.
//  - desmontaje.js: solo comprobar por defecto, frase de autorización, identidad, protegidas.
// Ninguna contraseña aparece en salidas, argumentos de procesos ni registros de los dobles.
//
// Uso (desde backend/):  node pruebas/instalacion.herramientas.unitarias.js

const net = require('net');
net.Socket.prototype.connect = function () { throw new Error('Red bloqueada en las pruebas unitarias de instalación'); };

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const dotenv = require('dotenv');
const comun = require('../database/instalacion/comun');
const ejecutor = require('../database/instalacion/ejecutor');
const cuentas = require('../database/instalacion/cuentas');
const desmontaje = require('../database/instalacion/desmontaje');
const D = require('./instalacion.dobles');

const resultados = [];
const igual = (descripcion, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  resultados.push(ok);
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${descripcion}${ok ? '' : ` -> obtenido ${JSON.stringify(real)}, esperado ${JSON.stringify(esperado)}`}`);
};
const resultado = (promesa) => promesa.then(r => ({ ok: true, r }), e => ({ ok: false, e }));
const lanza = (fn) => { try { fn(); return null; } catch (e) { return e; } };
const leer = (a) => fs.readFileSync(path.join(D.DIR_INSTALACION, a), 'utf8');

const main = async () => {
  // ---------------------------------------------------------------- comun.js
  console.log('== comun.js: credenciales');
  const claves = ['Ab1!x%&()*+,-./:<=>?@[]^_{|}~', "con'comilla", "con'y`acento", 'con"doble', "con'y\"doble", 'con#almohadilla$y;', 'con\\barra', "con\\barra'y`", 'espacio interior', 'ñandú1'];
  for (const c of claves) {
    const t = comun.serializarCredenciales('pansys_app_ensayo', c);
    igual(`ida y vuelta exacta con dotenv: ${JSON.stringify(c).slice(0, 24)}`, t ? dotenv.parse(t) : 'NO SERIALIZABLE', { DB_USER: 'pansys_app_ensayo', DB_PASSWORD: c });
  }
  igual("no serializable si contiene ' ` y \" a la vez (se regenera)", [comun.serializarCredenciales('u', "a'b`c\"d"), comun.serializarCredenciales('u', "a'b`c\"\\d")], [null, null]);
  igual('no serializable con saltos de línea o vacía', [comun.serializarCredenciales('u', 'a\nb'), comun.serializarCredenciales('u', ''), comun.serializarCredenciales('u', undefined)], [null, null, null]);
  {
    const ruta = path.join(D.FUERA, 'x.env');
    const ok = D.crearArchivos({ iniciales: { [ruta]: comun.serializarCredenciales('pansys_instalador', 'Clave1x') } });
    igual('leerCredenciales devuelve la contraseña tras verificar la protección', [comun.leerCredenciales(ok, ruta, 'pansys_instalador'), ok.registro.map(r => r[0])], ['Clave1x', ['verificar', 'leer']]);
    const sinProteger = D.crearArchivos({ fallar: { verificar: true }, iniciales: { [ruta]: 'DB_USER=pansys_instalador\nDB_PASSWORD=x\n' } });
    const e1 = lanza(() => comun.leerCredenciales(sinProteger, ruta, 'pansys_instalador'));
    igual('leerCredenciales no lee un archivo sin proteger', [/no está restringido/.test(e1?.message), sinProteger.registro.some(r => r[0] === 'leer')], [true, false]);
    const extra = D.crearArchivos({ iniciales: { [ruta]: 'DB_USER=pansys_instalador\nDB_PASSWORD=x\nOTRA=1\n' } });
    igual('leerCredenciales rechaza claves extra y no muestra el contenido', /no corresponde/.test(lanza(() => comun.leerCredenciales(extra, ruta, 'pansys_instalador'))?.message), true);
  }
  console.log('\n== comun.js: argumentos, identidad y errores');
  const opciones = { valores: ['parametros'], banderas: ['ayuda'] };
  igual('argumentos válidos', comun.leerArgumentos(['--parametros=C:\\x.json'], opciones, ''), { parametros: 'C:\\x.json' });
  for (const malos of [['--contrasena=x'], ['--parametros=a', '--parametros=b'], ['parametros=a'], ['--parametros'], ['--ayuda=1'], ['-p']]) {
    igual(`argumentos rechazados: ${malos.join(' ')}`, /Argumentos no admitidos/.test(lanza(() => comun.leerArgumentos(malos, opciones, ''))?.message), true);
  }
  {
    const ok = D.crearMysql([D.identidadOk('pansys_inst_ensayo')]);
    igual('comprobarIdentidad acepta el servidor y la base esperados', (await resultado(comun.comprobarIdentidad(ok, D.IDENTIDAD, 'pansys_inst_ensayo'))).ok, true);
    for (const [k, valor] of [['puerto', 3306], ['server_uuid', 'aaaaaaaa-2222-3333-4444-555555555555'], ['datadir', 'D:\\ensayo\\datos']]) {
      const con = D.crearMysql([D.identidadOk('pansys_inst_ensayo', { ...D.IDENTIDAD, [k]: valor })]);
      igual(`comprobarIdentidad rechaza otro ${k}`, /NO coincide/.test((await resultado(comun.comprobarIdentidad(con, D.IDENTIDAD, 'pansys_inst_ensayo'))).e?.message), true);
    }
    const otraBase = D.crearMysql([D.identidadOk('pansys_db')]);
    igual('comprobarIdentidad rechaza otra base', /no apunta/.test((await resultado(comun.comprobarIdentidad(otraBase, D.IDENTIDAD, 'pansys_inst_ensayo'))).e?.message), true);
  }
  igual('errorSeguro: solo el código, marca incierto si la conexión se perdió',
    [comun.errorSeguro(D.errorMysql('ER_DUP_ENTRY', 1062), 'X').message, comun.errorSeguro(D.errorMysql('ECONNRESET'), 'X').incierto, comun.errorSeguro(D.errorMysql('ER_X', 1, { fatal: true }), 'X').incierto, !!comun.errorSeguro(D.errorMysql('ER_DUP_ENTRY', 1062), 'X').incierto],
    ['X (código ER_DUP_ENTRY).', true, true, false]);

  // ---------------------------------------------------------------- Archivos protegidos (dobles)
  console.log('\n== Archivos protegidos: lógica con dobles');
  const WHOAMI = '"desktop-x\\usuario","S-1-5-21-1-2-3-1001"\r\n';
  const crearReal = (salidaIcacls) => {
    const llamadas = [];
    const memoria = new Map();
    const fsFalso = {
      openSync: (r, f) => { llamadas.push(['open', f]); if (memoria.has(r)) throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' }); memoria.set(r, ''); return 7; },
      closeSync: () => {}, existsSync: (r) => memoria.has(r), statSync: () => ({ isDirectory: () => true }),
      writeFileSync: (r, t) => { llamadas.push(['write']); memoria.set(r, t); }, readFileSync: (r) => memoria.get(r), unlinkSync: (r) => memoria.delete(r), chmodSync: () => {}
    };
    const programas = [];
    const ejecutar = (prog, args) => { programas.push(prog); const corto = path.win32.basename(prog, '.exe'); llamadas.push([corto, ...args]); return corto === 'whoami' ? WHOAMI : salidaIcacls; };
    return { a: comun.crearArchivosReales({ fs: fsFalso, ejecutar, plataforma: 'win32', dirSistema: 'C:\\Windows\\System32' }), llamadas, memoria, programas };
  };
  const ICACLS_OK = 'C:\\fuera\\x.env DESKTOP-X\\Usuario:(F)\r\n\r\nSe procesaron correctamente 1 archivos; error al procesar 0 archivos\r\n';
  {
    const { a, llamadas, memoria, programas } = crearReal(ICACLS_OK);
    a.crearProtegido('C:\\fuera\\x.env');
    a.escribirProtegido('C:\\fuera\\x.env', 'DB_USER=u\nDB_PASSWORD=\'SECRETO-FICTICIO\'\n');
    const orden = llamadas.map(l => l[0] === 'icacls' ? `icacls ${l.slice(2).join(' ')}`.trim() : l[0]);
    igual('crea en exclusiva (wx), restringe (herencia fuera, solo el SID actual), verifica y DESPUÉS escribe',
      orden, ['open', 'whoami', 'icacls /inheritance:r /grant:r *S-1-5-21-1-2-3-1001:F', 'whoami', 'icacls', 'whoami', 'icacls', 'write', 'whoami', 'icacls']);
    igual('apertura exclusiva', llamadas[0][1], 'wx');
    igual('whoami e icacls por ruta absoluta de System32 (nunca por el PATH)', [...new Set(programas)], ['C:\\Windows\\System32\\whoami.exe', 'C:\\Windows\\System32\\icacls.exe']);
    igual('el secreto nunca va en argumentos de procesos externos', llamadas.some(l => l.join(' ').includes('SECRETO-FICTICIO')), false);
    igual('el contenido queda escrito', memoria.get('C:\\fuera\\x.env').includes('SECRETO-FICTICIO'), true);
  }
  for (const [descripcion, salidaIcacls] of [
    ['permiso heredado (I)', 'C:\\fuera\\x.env DESKTOP-X\\Usuario:(I)(F)\r\n'],
    ['dos permisos', 'C:\\fuera\\x.env DESKTOP-X\\Usuario:(F)\r\n                BUILTIN\\Usuarios:(RX)\r\n'],
    ['otro usuario', 'C:\\fuera\\x.env DESKTOP-X\\Otro:(F)\r\n'],
    ['solo lectura para el usuario', 'C:\\fuera\\x.env DESKTOP-X\\Usuario:(R)\r\n']
  ]) {
    const { a } = crearReal(salidaIcacls);
    igual(`verificarProtegido rechaza: ${descripcion}`, /no está restringido/.test(lanza(() => a.verificarProtegido('C:\\fuera\\x.env'))?.message), true);
  }
  {
    const { a, llamadas } = crearReal('C:\\fuera\\x.env Todos:(F)\r\n');
    const e = lanza(() => a.crearProtegido('C:\\fuera\\x.env'));
    igual('si no se puede proteger, crearProtegido falla y no escribe nada', [!!e, llamadas.some(l => l[0] === 'write')], [true, false]);
  }

  // ---------------------------------------------------------------- Archivos protegidos (Windows real)
  if (process.platform === 'win32') {
    console.log('\n== Archivos protegidos: prueba REAL en Windows (archivo ficticio, sin secretos)');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pansys-acl-'));
    const ruta = path.join(dir, 'ficticio.env');
    try {
      const a = comun.crearArchivosReales();
      a.crearProtegido(ruta);
      a.escribirProtegido(ruta, comun.serializarCredenciales('pansys_ficticia', 'ValorFicticio1'));
      igual('ACL real: herencia retirada y un único permiso (F) del usuario actual', lanza(() => a.verificarProtegido(ruta)), null);
      igual('ACL real: se lee de vuelta', comun.leerCredenciales(a, ruta, 'pansys_ficticia'), 'ValorFicticio1');
      igual('ACL real: no sobrescribe un archivo existente', lanza(() => a.crearProtegido(ruta))?.code, 'EEXIST');
      const otro = path.join(dir, 'sin_proteger.env');
      fs.writeFileSync(otro, 'DB_USER=x\nDB_PASSWORD=y\n');
      igual('ACL real: un archivo normal (heredado) se rechaza', /no está restringido/.test(lanza(() => a.verificarProtegido(otro))?.message), true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    igual('ACL real: carpeta temporal eliminada', fs.existsSync(dir), false);
  }

  // ---------------------------------------------------------------- ejecutor.js
  console.log('\n== ejecutor.js: partición de sentencias');
  const partir = ejecutor.partirSentencias;
  igual('respeta ; en cadenas, identificadores y comentarios',
    partir("SELECT 'a;b', \"c;d\", `e;f`; -- x;y\n# z;w\n/* u;v */ DO 1;\nSELECT 'it''s;', 'it\\'s;';").map(s => [s.sql.replace(/\s+/g, ' '), s.linea]),
    [["SELECT 'a;b', \"c;d\", `e;f`", 1], ['DO 1', 3], ["SELECT 'it''s;', 'it\\'s;'", 4]]);
  igual('-- sin espacio no es comentario (MySQL)', partir('SELECT 1--1;').map(s => s.sql), ['SELECT 1--1']);
  igual('error si termina sin ;', /sin «;»/.test(lanza(() => partir('SELECT 1; SELECT 2'))?.message), true);
  igual('error con cadena sin cerrar', /sin cerrar/.test(lanza(() => partir("SELECT 'a;"))?.message), true);
  const s01 = partir(leer('01_esquema.sql'));
  const s04 = partir(leer('04_verificar.sql'));
  const lineas01 = leer('01_esquema.sql').split('\n');
  igual('01: la primera sentencia es la compuerta de identidad y su línea es exacta',
    [/^DO JSON_TYPE\(IF\(@pansys_uuid IS NOT NULL/.test(s01[0].sql), lineas01[s01[0].linea - 1].startsWith('DO JSON_TYPE(IF(@pansys_uuid')], [true, true]);
  igual('01: 17 CREATE TABLE, 1 ALTER, 1 INSERT, y solo SET/DO/CREATE/ALTER/INSERT/SELECT',
    [s01.filter(x => /^CREATE TABLE/.test(x.sql)).length, s01.filter(x => /^ALTER/.test(x.sql)).length, s01.filter(x => /^INSERT/.test(x.sql)).length, s01.every(x => /^(SET|DO|CREATE TABLE|ALTER TABLE|INSERT|SELECT)\b/.test(x.sql))],
    [17, 1, 1, true]);
  igual('01: cada sentencia empieza en la línea indicada', s01.every(x => lineas01[x.linea - 1].trim().startsWith(x.sql.split(/\s/)[0])), true);
  igual('01: todas las compuertas van antes del primer CREATE', s01.findIndex(x => /^CREATE/.test(x.sql)) > s01.map(x => /ABORTAR: la base no esta vacia/.test(x.sql)).lastIndexOf(true), true);
  igual('04: solo DO y SELECT, la primera es la identidad', [s04.every(x => /^(DO|SELECT)\b/.test(x.sql)), /@pansys_uuid IS NOT NULL/.test(s04[0].sql)], [true, true]);
  igual('textoCompuerta extrae el ABORTAR del propio script', ejecutor.textoCompuerta(s01[0].sql), 'ABORTAR: identidad del servidor no verificada (server_uuid, puerto o datadir distintos o sin definir)');

  console.log('\n== ejecutor.js: programa');
  const CLAVE_INST = "Inst'2026`ficticia";
  const credInst = comun.serializarCredenciales('pansys_instalador', CLAVE_INST);
  const credApp = comun.serializarCredenciales('pansys_app_ensayo', 'App"2026ficticia');
  const P = D.parametros();
  const corrida = async ({ argv, datos = D.parametros(), reglas = [], archivos, bytes } = {}) => {
    const salida = D.crearSalida();
    const conexiones = [];
    const con = D.crearMysql([D.identidadOk('pansys_inst_ensayo'), [/^SET @pansys_uuid/, () => [{}]], ...reglas, [/^(DO|SET|CREATE|ALTER|INSERT)\b/, () => [{}]], [/^SELECT/, () => [[{ base: 'pansys_inst_ensayo', resultado: 'OK' }]]]]);
    const codigo = await ejecutor.ejecutar({
      argv: argv || [`--parametros=${D.RUTA_PARAMETROS}`, '--script=01_esquema.sql', '--cuenta=instalador'],
      leerArchivo: () => JSON.stringify(datos),
      leerBytes: (r) => bytes || fs.readFileSync(r),
      archivos: archivos || D.crearArchivos({ iniciales: { [P.cuentas.instalador.credenciales]: credInst, [P.cuentas.aplicacion.credenciales]: credApp } }),
      conectar: async (c) => { conexiones.push(c); return con; },
      salida, repositorio: D.REPOSITORIO
    });
    return { codigo, salida: salida.texto, con, conexiones };
  };
  {
    const r = await corrida();
    const consultas = r.con.registro.filter(x => x.tipo === 'query').map(x => x.sql);
    igual('01 completo: código 0, todas las sentencias en orden', [r.codigo, consultas.length, consultas[0] === s01[0].sql, consultas[consultas.length - 1] === s01[s01.length - 1].sql], [0, s01.length, true, true]);
    igual('identidad (Node) y SET de @pansys_* ANTES de la primera sentencia', r.con.registro.slice(0, 2).map(x => [x.tipo, x.sql.slice(0, 24), x.params]),
      [['execute', 'SELECT @@port AS puerto,', []], ['execute', 'SET @pansys_uuid = ?, @p', [D.IDENTIDAD.server_uuid, D.IDENTIDAD.puerto, D.IDENTIDAD.datadir]]]);
    igual('conecta con la cuenta de instalación, la base y la contraseña del archivo', r.conexiones.map(c => [c.usuario, c.base, c.contrasena]), [['pansys_instalador', 'pansys_inst_ensayo', CLAVE_INST]]);
    igual('la salida informa del SHA-256 y no contiene la contraseña', [r.salida.includes(D.parametros().sha256['01_esquema.sql']), r.salida.includes(CLAVE_INST)], [true, false]);
    igual('muestra las filas de los SELECT', /base=pansys_inst_ensayo \| resultado=OK/.test(r.salida), true);
  }
  {
    const r = await corrida({ bytes: Buffer.from(leer('01_esquema.sql') + '\n-- cambio\n') });
    igual('script distinto del SHA-256 aprobado: no se conecta', [r.codigo, /no coincide con el SHA-256 aprobado/.test(r.salida), r.conexiones.length], [1, true, 0]);
  }
  {
    const r = await corrida({ reglas: [[/^SELECT @@port AS puerto/, () => [[{ puerto: 3306, uuid: D.IDENTIDAD.server_uuid, datadir: D.IDENTIDAD.datadir, base: 'pansys_inst_ensayo' }]]]] });
    // la regla de identidadOk va primero en la lista: forzamos otra identidad con un doble propio
    const con = D.crearMysql([[/^SELECT @@port AS puerto/, () => [[{ puerto: 3306, uuid: D.IDENTIDAD.server_uuid, datadir: D.IDENTIDAD.datadir, base: 'pansys_inst_ensayo' }]]]]);
    const salida = D.crearSalida();
    const codigo = await ejecutor.ejecutar({ argv: [`--parametros=${D.RUTA_PARAMETROS}`, '--script=01_esquema.sql', '--cuenta=instalador'], leerArchivo: () => JSON.stringify(D.parametros()), leerBytes: (x) => fs.readFileSync(x), archivos: D.crearArchivos({ iniciales: { [P.cuentas.instalador.credenciales]: credInst } }), conectar: async () => con, salida, repositorio: D.REPOSITORIO });
    igual('servidor con otra identidad: ninguna sentencia del script', [codigo, /identidad/.test(salida.texto), con.registro.filter(x => x.tipo === 'query').length, r.codigo], [1, true, 0, 0]);
  }
  {
    const r = await corrida({ reglas: [[/ABORTAR: la base no esta vacia/, () => { throw D.errorMysql('ER_INVALID_JSON_TEXT_IN_PARAM', 3141); }]] });
    igual('compuerta fallida: código 1, línea y texto ABORTAR del script, sin cambios', [r.codigo, /DETENIDO en la sentencia \d+ de \d+ \(línea \d+\): código ER_INVALID_JSON_TEXT_IN_PARAM \(errno 3141\)\. Compuerta: ABORTAR: la base no esta vacia/.test(r.salida), /no se ha modificado nada/.test(r.salida)], [1, true, true]);
    igual('compuerta fallida: no se envía ninguna sentencia posterior', r.con.registro.some(x => /^CREATE/.test(x.sql)), false);
    igual('el mensaje de MySQL nunca se muestra', /sensibles|correo\.co/.test(r.salida), false);
  }
  {
    const r = await corrida({ reglas: [[/^CREATE TABLE `productos`/, () => { throw D.errorMysql('ER_CANT_CREATE_TABLE', 1005); }]] });
    igual('fallo tras crear tablas: avisa de que la base ya cambió y no se repite', [r.codigo, /ya había modificado la base/.test(r.salida), r.con.registro.some(x => /^CREATE TABLE `ventas`/.test(x.sql))], [1, true, false]);
  }
  {
    const r = await corrida({ reglas: [[/^CREATE TABLE `ventas`/, () => { throw D.errorMysql('PROTOCOL_CONNECTION_LOST', undefined, { fatal: true }); }]] });
    igual('conexión perdida: INCIERTO, código 2, nada más', [r.codigo, /INCIERTO/.test(r.salida), r.con.registro.some(x => /^CREATE TABLE `detalle_ventas`/.test(x.sql))], [2, true, false]);
  }
  {
    const r = await corrida({ argv: [`--parametros=${D.RUTA_PARAMETROS}`, '--script=01_esquema.sql', '--cuenta=aplicacion'] });
    igual('01 con la cuenta de la aplicación: rechazado sin conectar', [r.codigo, r.conexiones.length], [1, 0]);
    const r2 = await corrida({ argv: [`--parametros=${D.RUTA_PARAMETROS}`, '--script=../../src/app.js', '--cuenta=instalador'] });
    igual('script fuera de la lista: rechazado sin conectar', [r2.codigo, /Script no admitido/.test(r2.salida), r2.conexiones.length], [1, true, 0]);
    const r3 = await corrida({ argv: [`--parametros=${D.RUTA_PARAMETROS}`, '--script=04_verificar.sql', '--cuenta=aplicacion'] });
    igual('04 con la cuenta de la aplicación: lee su archivo de credenciales', [r3.codigo, r3.conexiones[0]?.usuario, r3.conexiones[0]?.contrasena], [0, 'pansys_app_ensayo', 'App"2026ficticia']);
  }

  // ---------------------------------------------------------------- cuentas.js
  console.log('\n== cuentas.js (03_crear_cuenta.js)');
  igual('partial_revokes=ON (1): nombre LITERAL en el GRANT', [cuentas.nombreGrant('pansys_inst_ensayo', 1), cuentas.baseParaGrant('pansys_inst_ensayo', 1)], ['pansys_inst_ensayo', '`pansys_inst_ensayo`']);
  igual('partial_revokes=OFF (0): _ ESCAPADO en el GRANT', [cuentas.nombreGrant('pansys_inst_ensayo', 0), cuentas.baseParaGrant('pansys_inst_ensayo', 0)], ['pansys\\_inst\\_ensayo', '`pansys\\_inst\\_ensayo`']);
  igual('nombreGrant rechaza modos que no sean 0 o 1 (null, 2, "1", true)', [null, 2, '1', true, undefined].map(m => !!lanza(() => cuentas.nombreGrant('pansys_inst_ensayo', m))), [true, true, true, true, true]);
  igual('cuenta SQL entrecomillada', cuentas.cuentaSql({ usuario: 'pansys_instalador', host: '127.0.0.1' }), "'pansys_instalador'@'127.0.0.1'");
  const GENERADAS = ["Gen'1`x\"y\\z", 'Gen2;#$%ficticia', 'Gen3ficticia'];
  // Privilegios como los devolvería information_schema: el nombre de base guardado depende del modo
  // (ON: literal; OFF: con _ escapado). 'guardado' permite simular un nombre guardado distinto.
  const privilegiosOk = (tipo, modo = 1, guardado = null, base = 'pansys_inst_ensayo') => ({
    deBase: cuentas.PRIVILEGIOS[tipo].base.map(p => ({ s: guardado ?? (modo === 1 ? base : base.replace(/_/g, '\\_')), p, gr: 'NO' })),
    deTabla: cuentas.PRIVILEGIOS[tipo].tablas.map(([t, p]) => ({ s: base, t, p, gr: 'NO' }))
  });
  const crearEscenario = (tipo, o = {}) => {
    const modo = 'partialRevokes' in o ? o.partialRevokes : 1;
    const cfg = { usuariosExistentes: 0, tablas: tipo === 'instalador' ? 0 : 17, panaderias: 2, generadas: [GENERADAS[2]], crearFalla: null, grantFalla: null, privilegios: privilegiosOk(tipo, modo === 0 ? 0 : 1), globales: [], columnas: 0, deleteProductos: 'denegado', identidad: D.IDENTIDAD, partialRevokes: 1, ...o };
    let generada = 0;
    const admin = D.crearMysql([
      [/^SELECT @@port AS puerto/, () => [[{ puerto: cfg.identidad.puerto, uuid: cfg.identidad.server_uuid, datadir: cfg.identidad.datadir, base: null }]]],
      [/^SELECT @@GLOBAL\.partial_revokes AS pr$/, () => {
        if (cfg.partialRevokes === 'error') throw D.errorMysql('ER_UNKNOWN_SYSTEM_VARIABLE', 1193);
        if (cfg.partialRevokes === 'sin_filas') return [[]];
        return [[{ pr: cfg.partialRevokes }]];
      }],
      [/FROM information_schema\.SCHEMATA/, () => [[{ cs: 'utf8mb4', co: 'utf8mb4_0900_ai_ci' }]]],
      [/FROM mysql\.user WHERE User = \?$/, () => [[{ n: cfg.usuariosExistentes }]]],
      [/FROM information_schema\.TABLES WHERE TABLE_SCHEMA = \?/, () => [[{ n: cfg.tablas }]]],
      [/`panaderias`/, () => [[{ n: cfg.panaderias }]]],
      [/^CREATE USER/, () => { if (cfg.crearFalla) throw cfg.crearFalla; return [[{ user: 'x', host: 'y', 'generated password': cfg.generadas[generada++] }]]; }],
      [/^ALTER USER/, () => [[{ 'generated password': cfg.generadas[generada++] }]]],
      [/^GRANT/, (p, sql) => { if (cfg.grantFalla && cfg.grantFalla.test(sql)) throw D.errorMysql('ER_DBACCESS_DENIED_ERROR', 1044); return [{}]; }],
      [/USER_PRIVILEGES/, () => [cfg.globales]],
      [/SCHEMA_PRIVILEGES/, () => [cfg.privilegios.deBase]],
      [/TABLE_PRIVILEGES/, () => [cfg.privilegios.deTabla]],
      [/COLUMN_PRIVILEGES/, () => [[{ n: cfg.columnas }]]]
    ], { nombre: 'admin' });
    const cuenta = D.parametros().cuentas[tipo];
    const deCuenta = D.crearMysql([
      D.identidadOk('pansys_inst_ensayo'),
      [/^SELECT CURRENT_USER/, () => [[{ c: `${cuenta.usuario}@${cuenta.host}` }]]],
      [/information_schema\.TABLES WHERE TABLE_SCHEMA = DATABASE/, () => [[{ n: 0 }]]],
      [/FROM roles/, () => [[{ n: 3 }]]],
      [/^DELETE FROM receta_producto/, () => [{}]],
      [/^DELETE FROM productos/, () => { if (cfg.deleteProductos === 'denegado') throw D.errorMysql('ER_TABLEACCESS_DENIED_ERROR', 1142); return [{}]; }],
      [/mysql\.user LIMIT 0/, () => { throw D.errorMysql('ER_TABLEACCESS_DENIED_ERROR', 1142); }]
    ], { nombre: 'cuenta' });
    return { admin, deCuenta, cfg };
  };
  const crearCuenta = async (tipo, o = {}, { archivos, confirmar = 'pansys_inst_ensayo', argv } = {}) => {
    const { admin, deCuenta } = crearEscenario(tipo, o);
    const arch = archivos || D.crearArchivos();
    const salida = D.crearSalida();
    const conexiones = [];
    const codigo = await cuentas.ejecutar({
      argv: argv || [`--parametros=${D.RUTA_PARAMETROS}`, `--tipo=${tipo}`],
      leerArchivo: () => JSON.stringify(D.parametros()),
      preguntar: async () => confirmar,
      preguntarOculto: async () => 'RootFicticio1',
      conectar: async (c) => { conexiones.push(c); return c.usuario === 'root' ? admin : deCuenta; },
      archivos: arch, salida, repositorio: D.REPOSITORIO
    });
    const ruta = D.parametros().cuentas[tipo].credenciales;
    const todasLasSql = [...admin.registro, ...deCuenta.registro];
    return { codigo, salida: salida.texto, admin, deCuenta, arch, ruta, conexiones, todasLasSql };
  };
  const sinSecretos = (r) => !GENERADAS.some(g => r.salida.includes(g)) && !r.todasLasSql.some(x => GENERADAS.some(g => x.sql.includes(g) || (x.params || []).includes(g))) && !r.salida.includes('RootFicticio1');
  const nuncaBorraCuenta = (r) => !r.admin.registro.some(x => /DROP USER|DROP DATABASE/.test(x.sql));
  {
    const r = await crearCuenta('instalador');
    const pasos = r.admin.registro.map(x => x.sql.split(' ').slice(0, 2).join(' '));
    const iCrear = r.arch.registro.findIndex(x => x[0] === 'crear');
    igual('instalador: código 0 y cuenta verificada', [r.codigo, /CUENTA CREADA Y VERIFICADA/.test(r.salida)], [0, true]);
    igual('instalador: archivo protegido creado ANTES de CREATE USER, secreto escrito después', [iCrear, r.arch.registro.map(x => x[0])], [0, ['crear', 'escribir']]);
    igual('instalador: CREATE USER con RANDOM PASSWORD, sin PREPARE, como sentencia normal',
      r.admin.registro.filter(x => /^CREATE USER/.test(x.sql)).map(x => [x.tipo, x.sql]), [['query', "CREATE USER 'pansys_instalador'@'127.0.0.1' IDENTIFIED BY RANDOM PASSWORD PASSWORD EXPIRE NEVER"]]);
    igual('instalador (partial_revokes=ON): GRANT exacto con el nombre LITERAL', r.admin.registro.filter(x => /^GRANT/.test(x.sql)).map(x => x.sql),
      ["GRANT ALTER, CREATE, INSERT, REFERENCES, SELECT, UPDATE ON `pansys_inst_ensayo`.* TO 'pansys_instalador'@'127.0.0.1'"]);
    igual('instalador: partial_revokes se lee ANTES de crear el archivo y la cuenta, y se informa del modo',
      [r.admin.registro.findIndex(x => /partial_revokes/.test(x.sql)) < r.admin.registro.findIndex(x => /^CREATE USER/.test(x.sql)), /partial_revokes=ON: el GRANT de base usará `pansys_inst_ensayo`/.test(r.salida)], [true, true]);
    igual('instalador: el archivo contiene exactamente la contraseña generada', dotenv.parse(r.arch.contenido.get(r.ruta)), { DB_USER: 'pansys_instalador', DB_PASSWORD: GENERADAS[2] });
    igual('instalador: la prueba funcional usa la contraseña en memoria', r.conexiones.map(c => [c.usuario, c.contrasena]), [['root', 'RootFicticio1'], ['pansys_instalador', GENERADAS[2]]]);
    igual('instalador: ningún secreto en la salida ni en el SQL; ningún DROP', [sinSecretos(r), nuncaBorraCuenta(r)], [true, true]);
    igual('instalador: comprobaciones previas antes del CREATE', pasos.indexOf('CREATE USER') > pasos.indexOf('SELECT COUNT(*)'), true);
  }
  {
    const r = await crearCuenta('aplicacion');
    igual('aplicación (ON): código 0; GRANT de base literal y DELETE solo en receta_producto', [r.codigo, r.admin.registro.filter(x => /^GRANT/.test(x.sql)).map(x => x.sql)],
      [0, ["GRANT INSERT, SELECT, UPDATE ON `pansys_inst_ensayo`.* TO 'pansys_app_ensayo'@'127.0.0.1'", "GRANT DELETE ON `pansys_inst_ensayo`.`receta_producto` TO 'pansys_app_ensayo'@'127.0.0.1'"]]);
    igual('aplicación: prueba funcional (roles, DELETE inocuo, denegaciones)', r.deCuenta.registro.map(x => x.sql).filter(x => !/^SELECT @@port/.test(x)),
      ['SELECT CURRENT_USER() AS c', 'SELECT COUNT(*) AS n FROM roles', 'DELETE FROM receta_producto WHERE 1 = 0', 'DELETE FROM productos WHERE 1 = 0', 'SELECT 1 FROM mysql.user LIMIT 0']);
    igual('aplicación: sin secretos ni DROP', [sinSecretos(r), nuncaBorraCuenta(r)], [true, true]);
  }
  {
    const r = await crearCuenta('instalador', { generadas: [GENERADAS[0], GENERADAS[2]] });
    igual("contraseña no guardable (' ` \" y \\): ALTER USER ... RANDOM PASSWORD y se guarda la nueva", [r.codigo, r.admin.registro.filter(x => /^ALTER USER/.test(x.sql)).length, dotenv.parse(r.arch.contenido.get(r.ruta)).DB_PASSWORD], [0, 1, GENERADAS[2]]);
  }
  {
    const r = await crearCuenta('instalador', { generadas: [GENERADAS[0], GENERADAS[0], GENERADAS[0]] });
    igual('nunca guardable: código 1, cuenta EXISTE (se informa), archivo vacío retirado, sin DROP',
      [r.codigo, /EXISTE/.test(r.salida), r.arch.contenido.has(r.ruta), nuncaBorraCuenta(r), sinSecretos(r)], [1, true, false, true, true]);
  }
  {
    const r = await crearCuenta('instalador', { crearFalla: D.errorMysql('ER_CANNOT_USER', 1396) });
    igual('CREATE USER rechazado: código 1, sin cuenta, archivo vacío retirado, sin GRANT',
      [r.codigo, /no se ha creado/.test(r.salida), r.arch.contenido.has(r.ruta), r.admin.registro.some(x => /^GRANT/.test(x.sql))], [1, true, false, false]);
  }
  {
    const r = await crearCuenta('instalador', { crearFalla: D.errorMysql('PROTOCOL_CONNECTION_LOST', undefined, { fatal: true }) });
    igual('conexión perdida en CREATE USER: INCIERTO (código 2), sin reversión', [r.codigo, /INCIERTO/.test(r.salida), nuncaBorraCuenta(r)], [2, true, true]);
  }
  {
    const r = await crearCuenta('instalador', {}, { archivos: D.crearArchivos({ fallar: { escribir: true } }) });
    igual('fallo al escribir el secreto: código 1, archivo parcial retirado, cuenta EXISTE sin DROP, sin GRANT',
      [r.codigo, r.arch.contenido.has(r.ruta), /EXISTE/.test(r.salida), nuncaBorraCuenta(r), r.admin.registro.some(x => /^GRANT/.test(x.sql))], [1, false, true, true, false]);
  }
  {
    const r = await crearCuenta('instalador', {}, { archivos: D.crearArchivos({ fallar: { crear: true } }) });
    igual('no se puede proteger el archivo: código 1, NO se crea la cuenta', [r.codigo, r.admin.registro.some(x => /^CREATE USER/.test(x.sql))], [1, false]);
  }
  {
    const r = await crearCuenta('aplicacion', { grantFalla: /receta_producto/ });
    igual('GRANT a medias: código 1, privilegios INCOMPLETOS, credenciales conservadas, sin DROP',
      [r.codigo, /INCOMPLETOS/.test(r.salida), r.arch.contenido.has(r.ruta), nuncaBorraCuenta(r)], [1, true, true, true]);
  }
  for (const [descripcion, cambio] of [
    ['privilegios sobre otra base', { privilegios: { ...privilegiosOk('aplicacion'), deBase: privilegiosOk('aplicacion', 1, 'pansys_otra').deBase } }],
    ['privilegio de base de más', { privilegios: { ...privilegiosOk('aplicacion'), deBase: [...privilegiosOk('aplicacion').deBase, { s: 'pansys_inst_ensayo', p: 'DELETE', gr: 'NO' }] } }],
    ['GRANT OPTION', { privilegios: { ...privilegiosOk('aplicacion'), deBase: privilegiosOk('aplicacion').deBase.map(f => ({ ...f, gr: 'YES' })) } }],
    ['privilegios globales', { globales: [{ p: 'PROCESS' }] }],
    ['privilegios de columna', { columnas: 1 }],
    ['DELETE en otra tabla', { privilegios: { ...privilegiosOk('aplicacion'), deTabla: [{ s: 'pansys_inst_ensayo', t: 'productos', p: 'DELETE', gr: 'NO' }] } }],
    ['DELETE productos permitido (prueba funcional)', { deleteProductos: 'permitido' }]
  ]) {
    const r = await crearCuenta('aplicacion', cambio);
    igual(`verificación falla: ${descripcion} (código 1, sin DROP)`, [r.codigo, /verificación FALLÓ/.test(r.salida), nuncaBorraCuenta(r)], [1, true, true]);
  }
  // ---- partial_revokes: modos ON/OFF, el fallo real de E3-2 y valores no válidos
  console.log('\n== cuentas.js: partial_revokes');
  const conexionesDeCuenta = (r, usuario) => r.conexiones.filter(c => c.usuario === usuario).length;
  {
    const r = await crearCuenta('instalador', { partialRevokes: 0 });
    igual('instalador (partial_revokes=OFF): GRANT con _ escapado, verificación con la forma escapada, código 0',
      [r.codigo, r.admin.registro.filter(x => /^GRANT/.test(x.sql)).map(x => x.sql), /partial_revokes=OFF: el GRANT de base usará `pansys\\_inst\\_ensayo`/.test(r.salida)],
      [0, ["GRANT ALTER, CREATE, INSERT, REFERENCES, SELECT, UPDATE ON `pansys\\_inst\\_ensayo`.* TO 'pansys_instalador'@'127.0.0.1'"], true]);
  }
  {
    const r = await crearCuenta('aplicacion', { partialRevokes: 0 });
    igual('aplicación (OFF): GRANT de base escapado; el GRANT de tabla sigue literal',
      [r.codigo, r.admin.registro.filter(x => /^GRANT/.test(x.sql)).map(x => x.sql)],
      [0, ["GRANT INSERT, SELECT, UPDATE ON `pansys\\_inst\\_ensayo`.* TO 'pansys_app_ensayo'@'127.0.0.1'", "GRANT DELETE ON `pansys_inst_ensayo`.`receta_producto` TO 'pansys_app_ensayo'@'127.0.0.1'"]]);
  }
  {
    // Caso REAL de E3-2: ON y mysql.db guarda el nombre con barras (\_). Debe fallar en la verificación
    // exacta (como root), SIN llegar a conectar con la cuenta, sin DROP y conservando las credenciales.
    const r = await crearCuenta('instalador', { partialRevokes: 1, privilegios: privilegiosOk('instalador', 1, 'pansys\\_inst\\_ensayo') });
    igual('fallo real de E3-2 (ON + nombre guardado escapado): código 1, verificación FALLÓ por nombre exacto',
      [r.codigo, /verificación FALLÓ/.test(r.salida), /no están sobre el nombre exacto pansys_inst_ensayo \(partial_revokes=ON\)/.test(r.salida)], [1, true, true]);
    igual('fallo real de E3-2: no se conecta con la cuenta, no hay DROP, credenciales conservadas, sin secretos',
      [conexionesDeCuenta(r, 'pansys_instalador'), nuncaBorraCuenta(r), r.arch.contenido.has(r.ruta), sinSecretos(r)], [0, true, true, true]);
  }
  {
    const r = await crearCuenta('instalador', { partialRevokes: 0, privilegios: privilegiosOk('instalador', 0, 'pansys_inst_ensayo') });
    igual('OFF + nombre guardado literal (_ actuaría como comodín): verificación FALLÓ, sin conectar con la cuenta',
      [r.codigo, /no están sobre el nombre exacto pansys\\_inst\\_ensayo \(partial_revokes=OFF\)/.test(r.salida), conexionesDeCuenta(r, 'pansys_instalador'), nuncaBorraCuenta(r)], [1, true, 0, true]);
  }
  {
    const r = await crearCuenta('instalador', { privilegios: { deBase: [], deTabla: [] } });
    igual('sin ningún privilegio de base: verificación FALLÓ', [r.codigo, /verificación FALLÓ/.test(r.salida)], [1, true]);
  }
  for (const [descripcion, valor] of [['NULL', null], ['2', 2], ['texto "ON"', 'ON'], ['booleano', true], ['sin filas', 'sin_filas'], ['error al consultar', 'error'], ['indefinido', undefined]]) {
    const r = await crearCuenta('instalador', { partialRevokes: valor });
    igual(`partial_revokes ${descripcion}: se detiene ANTES de escribir (sin archivo, sin CREATE USER ni GRANT)`,
      [r.codigo, /partial_revokes|Comprobaciones previas fallidas/.test(r.salida), r.arch.registro.some(([op]) => op === 'crear'), r.admin.registro.some(x => /^(CREATE|GRANT|ALTER)/.test(x.sql))], [1, true, false, false]);
  }
  {
    const r = await crearCuenta('instalador', { partialRevokes: '1' });
    igual('partial_revokes devuelto como texto "1" (mysql2 puede devolverlo así): se acepta como ON', [r.codigo, /partial_revokes=ON/.test(r.salida)], [0, true]);
  }
  for (const [descripcion, cambio, opciones, patron] of [
    ['el archivo de credenciales ya existe', {}, { archivos: D.crearArchivos({ iniciales: { [D.parametros().cuentas.instalador.credenciales]: 'x' } }) }, /ya existe/],
    ['la cuenta ya existe', { usuariosExistentes: 1 }, {}, /Ya existe una cuenta/],
    ['instalador con la base no vacía', { tablas: 3 }, {}, /base VACÍA/],
    ['otra identidad de servidor', { identidad: { ...D.IDENTIDAD, puerto: 3306 } }, {}, /identidad/],
    ['confirmación incorrecta', {}, { confirmar: 'pansys_db' }, /Confirmación incorrecta/]
  ]) {
    const r = await crearCuenta('instalador', cambio, opciones);
    igual(`no crea la cuenta: ${descripcion}`, [r.codigo, patron.test(r.salida), r.admin.registro.some(x => /^(CREATE|GRANT)/.test(x.sql))], [1, true, false]);
  }
  {
    const r = await crearCuenta('aplicacion', { panaderias: 0 });
    igual('aplicación antes de 02: no se crea', [r.codigo, /después de 02/.test(r.salida)], [1, true]);
  }

  // ---------------------------------------------------------------- desmontaje.js
  console.log('\n== desmontaje.js');
  const crearDesmontaje = (o = {}) => {
    const cfg = { existenBases: ['pansys_inst_ensayo', 'pansys_inst_senuelo', 'pansysxinstxensayo', 'pansysensayo005'], existenCuentas: ['pansys_instalador', 'pansys_app_ensayo'], ajenas: 0, checksum: '111', cambiaHuella: false, dropFalla: null, identidad: D.IDENTIDAD, ...o };
    let checksums = 0;
    return D.crearMysql([
      [/^SELECT @@port AS puerto/, () => [[{ puerto: cfg.identidad.puerto, uuid: cfg.identidad.server_uuid, datadir: cfg.identidad.datadir, base: null }]]],
      [/FROM information_schema\.SCHEMATA WHERE SCHEMA_NAME = \?/, ([b]) => [[{ n: cfg.existenBases.includes(b) ? 1 : 0 }]]],
      [/COUNT\(\*\) AS n FROM information_schema\.TABLES WHERE TABLE_SCHEMA = \?/, () => [[{ n: 17 }]]],
      [/SELECT TABLE_NAME AS t FROM information_schema\.TABLES/, () => [[{ t: 'roles' }, { t: 'usuarios' }]]],
      [/^CHECKSUM TABLE/, () => { checksums++; return [[{ Table: 'pansysensayo005.roles', Checksum: cfg.cambiaHuella && checksums > 1 ? '999' : cfg.checksum }, { Table: 'pansysensayo005.usuarios', Checksum: '222' }]]; }],
      [/FROM mysql\.user WHERE User = \? AND Host = \?/, ([u]) => [[{ n: cfg.existenCuentas.includes(u) ? 1 : 0 }]]],
      [/PROCESSLIST/, () => [[{ n: cfg.ajenas }]]],
      [/^DROP USER/, (p, sql) => { if (cfg.dropFalla && cfg.dropFalla.test(sql)) throw cfg.dropError || D.errorMysql('ER_CANNOT_USER', 1396); const u = /'([^']+)'@/.exec(sql)[1]; cfg.existenCuentas = cfg.existenCuentas.filter(x => x !== u); return [{}]; }],
      [/^DROP DATABASE/, (p, sql) => { if (cfg.dropFalla && cfg.dropFalla.test(sql)) throw cfg.dropError || D.errorMysql('ER_DB_DROP_EXISTS', 1008); const b = /`([^`]+)`/.exec(sql)[1]; cfg.existenBases = cfg.existenBases.filter(x => x !== b); return [{}]; }]
    ], { nombre: 'admin' });
  };
  const desmontar = async (argvExtra, o = {}, { frase, datos = D.parametros(), archivos } = {}) => {
    const con = crearDesmontaje(o);
    const salida = D.crearSalida();
    const preguntas = [];
    const P0 = D.parametros();
    const arch = archivos || D.crearArchivos({ iniciales: { [P0.cuentas.instalador.credenciales]: credInst, [P0.cuentas.aplicacion.credenciales]: credApp } });
    const codigo = await desmontaje.ejecutar({
      argv: [`--parametros=${D.RUTA_PARAMETROS}`, ...argvExtra],
      leerArchivo: () => JSON.stringify(datos),
      preguntar: async (t) => { preguntas.push(t); return frase ?? `DESMONTAR ${D.IDENTIDAD.server_uuid.slice(-12)}`; },
      preguntarOculto: async () => 'RootFicticio1',
      conectar: async () => con,
      archivos: arch, salida, repositorio: D.REPOSITORIO
    });
    return { codigo, salida: salida.texto, con, preguntas, arch, drops: con.registro.filter(x => /^DROP/.test(x.sql)).map(x => x.sql) };
  };
  {
    const r = await desmontar(['--solo-comprobar']);
    igual('solo comprobar: código 0, plan mostrado, ningún DROP ni frase', [r.codigo, /SOLO COMPROBACIÓN/.test(r.salida), r.drops, r.preguntas.length], [0, true, [], 0]);
  }
  {
    const r = await desmontar(['--ejecutar']);
    igual('ejecutar con frase correcta: cuentas primero, luego solo las bases del ensayo', r.drops,
      ["DROP USER 'pansys_instalador'@'127.0.0.1'", "DROP USER 'pansys_app_ensayo'@'127.0.0.1'", 'DROP DATABASE `pansys_inst_ensayo`', 'DROP DATABASE `pansys_inst_senuelo`', 'DROP DATABASE `pansysxinstxensayo`']);
    igual('ejecutar: código 0, protegida con la misma huella, credenciales retiradas',
      [r.codigo, /misma huella/.test(r.salida), r.arch.contenido.size], [0, true, 0]);
    igual('nunca toca la base protegida', r.drops.some(x => /pansysensayo005/.test(x)), false);
  }
  for (const [descripcion, argv, o, extra, patron] of [
    ['frase incorrecta', ['--ejecutar'], {}, { frase: 'DESMONTAR' }, /Frase de autorización incorrecta/],
    ['sin --solo-comprobar ni --ejecutar', [], {}, {}, /exactamente uno/],
    ['con las dos banderas', ['--solo-comprobar', '--ejecutar'], {}, {}, /exactamente uno/],
    ['otra identidad de servidor', ['--ejecutar'], { identidad: { ...D.IDENTIDAD, server_uuid: 'aaaaaaaa-2222-3333-4444-555555555555' } }, {}, /identidad/],
    ['base protegida ausente', ['--ejecutar'], { existenBases: ['pansys_inst_ensayo'] }, {}, /protegida pansysensayo005 no existe/],
    ['sesiones ajenas', ['--ejecutar'], { ajenas: 2 }, {}, /sesiones ajenas/],
    ['parámetros sin bloque desmontaje', ['--ejecutar'], {}, { datos: (() => { const p = D.parametros(); delete p.desmontaje; return p; })() }, /no tienen bloque/]
  ]) {
    const r = await desmontar(argv, o, extra);
    igual(`desmontaje detenido sin DROP: ${descripcion}`, [r.codigo, patron.test(r.salida), r.drops], [1, true, []]);
  }
  {
    const r = await desmontar(['--ejecutar'], { dropFalla: /pansys_inst_senuelo/ });
    igual('DROP fallido: se detiene, informa de lo hecho y no sigue', [r.codigo, /Hecho hasta ahora: cuenta pansys_instalador@127\.0\.0\.1, cuenta pansys_app_ensayo@127\.0\.0\.1, base pansys_inst_ensayo/.test(r.salida), r.drops.length], [1, true, 4]);
  }
  {
    const r = await desmontar(['--ejecutar'], { dropFalla: /pansys_inst_ensayo/, dropError: D.errorMysql('PROTOCOL_CONNECTION_LOST', undefined, { fatal: true }) });
    igual('conexión perdida en un DROP: INCIERTO (código 2), sin reintentos', [r.codigo, /INCIERTO/.test(r.salida), r.drops.length], [2, true, 3]);
  }
  {
    const r = await desmontar(['--ejecutar'], { cambiaHuella: true });
    igual('huella de la protegida cambiada: ALTO (código 1)', [r.codigo, /ALTO: la huella de la base protegida pansysensayo005 ha CAMBIADO/.test(r.salida)], [1, true]);
  }
  {
    const r = await desmontar(['--ejecutar'], { existenBases: ['pansysensayo005'], existenCuentas: [] });
    igual('nada que eliminar: código 0 sin DROP', [r.codigo, r.drops, /no había nada que eliminar/.test(r.salida)], [0, [], true]);
  }

  // ---------------------------------------------------------------- Código fuente
  console.log('\n== Código fuente de las herramientas');
  // Código sin comentarios (los comentarios pueden nombrar PREPARE o DROP para explicar por qué no se usan)
  const sinComentariosJs = (t) => t.split('\n').filter(l => !/^\s*\/\//.test(l)).map(l => l.replace(/\s\/\/ .*$/, '')).join('\n');
  const fuentes = ['comun.js', 'ejecutor.js', 'cuentas.js', 'desmontaje.js', 'cli.js', '03_crear_cuenta.js', 'ejecutar_sql.js', 'desmontar_ensayo.js'].map(a => [a, sinComentariosJs(leer(a))]);
  const ejecutaDrop = /\.(query|execute)\(\s*[`'"]DROP (USER|DATABASE)/;
  igual('ninguna herramienta usa console.*', fuentes.filter(([, t]) => /console\./.test(t)).map(([a]) => a), []);
  igual('process.env solo para SystemRoot en comun.js (nunca para contraseñas)', fuentes.flatMap(([a, t]) => (t.match(/process\.env(\.\w+)?/g) || []).map(x => `${a}:${x}`)), ['comun.js:process.env.SystemRoot']);
  igual('sin multipleStatements: true', fuentes.filter(([, t]) => /multipleStatements: true/.test(t)).map(([a]) => a), []);
  igual('sin PREPARE / EXECUTE de SQL dinámico', fuentes.filter(([, t]) => /PREPARE\s|EXECUTE\s+\w+\s*;/.test(t)).map(([a]) => a), []);
  igual('cuentas.js nunca ejecuta DROP', ejecutaDrop.test(fuentes.find(([a]) => a === 'cuentas.js')[1]), false);
  igual('solo desmontaje.js ejecuta DROP', fuentes.filter(([, t]) => ejecutaDrop.test(t)).map(([a]) => a), ['desmontaje.js']);
  igual('writeFileSync solo en comun.js (archivo protegido)', fuentes.filter(([, t]) => /writeFileSync/.test(t)).map(([a]) => a), ['comun.js']);
  igual('crearProtegido se llama antes de CREATE USER en el código', leer('cuentas.js').indexOf('archivos.crearProtegido') < leer('cuentas.js').indexOf('CREATE USER ${'), true);

  // ---------------------------------------------------------------- Manifiesto (informativo)
  console.log('\n== Manifiesto SHA-256 (backend/database/instalacion)');
  for (const a of fs.readdirSync(D.DIR_INSTALACION).sort()) {
    console.log(`     ${crypto.createHash('sha256').update(fs.readFileSync(path.join(D.DIR_INSTALACION, a))).digest('hex')}  ${a}`);
  }

  const fallidas = resultados.filter(r => !r).length;
  console.log(`\n${resultados.length - fallidas}/${resultados.length} pruebas correctas`);
  process.exit(fallidas ? 1 : 0);
};

main().catch(e => { console.error('Error inesperado en las pruebas:', e?.stack || e?.message); process.exit(1); });
