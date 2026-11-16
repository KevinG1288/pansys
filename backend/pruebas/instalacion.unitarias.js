// Pruebas unitarias de la instalación limpia (backend/database/instalacion/), parte 1:
//  - 01_esquema.sql: 17 tablas, 41 claves foráneas, 32 CHECK, solo los roles, identidad POSITIVA
//    como primera compuerta, sin identificadores locales, sin desactivar foreign_key_checks, orden de
//    dependencias y comparación con los scripts históricos (crear_pansys_test + 005 + 006 de pruebas).
//  - 04_verificar.sql: identidad positiva y solo lectura.
//  - Ningún archivo versionado de instalación contiene server_uuid, rutas o equipos locales.
//  - Inventario de DELETE / sync() en src (respalda los privilegios de cuentas.js).
//  - Parámetros (comun.js), contraseñas, destino (identidad, InnoDB, modo estricto), transacción con
//    fallo en cada paso, lectura oculta (incluidas las teclas especiales) y el programa 02 completo
//    sin imprimir ni guardar contraseñas.
// Sin MySQL: no se crea ninguna conexión real (dobles) y CUALQUIER conexión de red queda bloqueada.
//
// Uso (desde backend/):  node pruebas/instalacion.unitarias.js

const net = require('net');
net.Socket.prototype.connect = function () { throw new Error('Red bloqueada en las pruebas unitarias de instalación'); };

const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const bcrypt = require('bcrypt');
const ins = require('../database/instalacion/instalador');
const comun = require('../database/instalacion/comun');
const D = require('./instalacion.dobles');

const DIR = D.DIR_INSTALACION;
const DIR_PRUEBAS_SQL = path.join(__dirname, '../database/pruebas');
const leer = (ruta) => fs.readFileSync(ruta, 'utf8');

const resultados = [];
const igual = (descripcion, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  resultados.push(ok);
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${descripcion}${ok ? '' : ` -> obtenido ${JSON.stringify(real)}, esperado ${JSON.stringify(esperado)}`}`);
};
const resultado = (promesa) => promesa.then(r => ({ ok: true, r }), e => ({ ok: false, e }));
const lanza = (fn) => { try { fn(); return null; } catch (e) { return e; } };

// ---------------------------------------------------------------- Análisis de CREATE TABLE
const sinComentarios = (sql) => sql.split(/\r?\n/).filter(l => !/^\s*--/.test(l)).join('\n');
const cierre = (s, desde) => {
  let prof = 0, comilla = false;
  for (let i = desde; i < s.length; i++) {
    const c = s[i];
    if (comilla) { if (c === "'") comilla = false; continue; }
    if (c === "'") comilla = true;
    else if (c === '(') prof++;
    else if (c === ')') { prof--; if (prof === 0) return i; }
  }
  return -1;
};
const partirComas = (s) => {
  const partes = []; let prof = 0, comilla = false, actual = '';
  for (const c of s) {
    if (comilla) { actual += c; if (c === "'") comilla = false; continue; }
    if (c === "'") comilla = true;
    if (c === '(') prof++;
    if (c === ')') prof--;
    if (c === ',' && prof === 0) { partes.push(actual); actual = ''; } else actual += c;
  }
  if (actual.trim()) partes.push(actual);
  return partes;
};
const normalizar = (t) => t.replace(/`/g, '').replace(/pansys_test\./gi, '').replace(/\s+/g, ' ').trim().toLowerCase()
  .replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').replace(/,\s+/g, ',').replace(/default '(\d+(?:\.\d+)?)'/g, 'default $1').replace(/ default null\b/g, ' null');
const tablasDe = (sql) => {
  const s = sinComentarios(sql);
  const mapa = new Map();
  const re = /CREATE TABLE\s+(?:pansys_test\.)?`?([a-z_]+)`?\s*\(/gi;
  let m;
  while ((m = re.exec(s))) {
    const abre = m.index + m[0].length - 1;
    const fin = cierre(s, abre);
    const cola = s.slice(fin + 1, s.indexOf(';', fin));
    mapa.set(m[1], { elementos: partirComas(s.slice(abre + 1, fin)).map(normalizar), cola: normalizar(cola), posicion: m.index });
  }
  return mapa;
};
const esColumna = (e) => !/^(primary|unique|key|index|constraint|foreign|check)\b/.test(e);
const columnas = (t) => t.elementos.filter(esColumna).map(e => e.split(' ')[0]);
const ordenar = (a) => [...a].sort();

const main = async () => {
  const esquema = leer(path.join(DIR, '01_esquema.sql'));
  const esquemaSinComentarios = sinComentarios(esquema);
  const tablas = tablasDe(esquema);

  // ---------------- 01_esquema.sql: estructura general
  console.log('== 01_esquema.sql');
  igual('crea exactamente las 17 tablas de TABLAS', ordenar([...tablas.keys()]), ordenar(ins.TABLAS));
  const fks = (esquemaSinComentarios.match(/FOREIGN KEY/g) || []).length;
  const checks = (esquemaSinComentarios.match(/CONSTRAINT\s+`?\w+`?\s+CHECK/g) || []).length;
  igual('41 claves foráneas declaradas (igual a la compuerta y a CLAVES_FORANEAS)', [fks, ins.CLAVES_FORANEAS, /REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE\(\)\) = 41/.test(esquema)], [41, 41, true]);
  igual('32 CHECK declarados (igual a la compuerta y a CHECKS)', [checks, ins.CHECKS, /ENFORCED = 'YES'\) = 32/.test(esquema)], [32, 32, true]);
  igual('no nombra pansys_db', /pansys_db/i.test(esquemaSinComentarios), false);
  igual('pansys_test solo aparece en la compuerta que la rechaza',
    esquemaSinComentarios.split('\n').filter(l => /pansys_test/i.test(l)), ["DO JSON_TYPE(IF(LOWER(DATABASE()) <> 'pansys_test', '[]', 'ABORTAR: pansys_test es la base de pruebas'));"]);
  igual('sin USE, CREATE/DROP DATABASE, DROP, TRUNCATE, DELETE, GRANT ni foreign_key_checks = 0',
    /^\s*USE\s|CREATE\s+DATABASE|\bDROP\b|TRUNCATE|\bDELETE\b|\bGRANT\b|FOREIGN_KEY_CHECKS\s*=\s*0/im.test(esquemaSinComentarios.replace(/ON DELETE/g, '')), false);
  igual('solo inserta en roles', (esquemaSinComentarios.match(/INSERT INTO\s+`?(\w+)/gi) || []).map(x => x.split(/\s+/).pop().replace(/`/g, '')), ['roles']);
  igual('los roles son los tres fijos', /\(1, 'administrador', 1, NOW\(\), NOW\(\)\),\s*\(2, 'panadero', 1, NOW\(\), NOW\(\)\),\s*\(3, 'gerente', 1, NOW\(\), NOW\(\)\);/.test(esquema), true);
  igual('sin correos, cuentas de prueba ni hashes bcrypt', /@pansys\.|\$2[aby]\$|panadero1|gerente1|Prueba Uno/i.test(esquemaSinComentarios), false);
  const primera = esquemaSinComentarios.trim().split(';')[0];
  igual('la PRIMERA sentencia es la compuerta de identidad positiva (uuid, puerto, datadir)',
    /^DO JSON_TYPE\(IF\(@pansys_uuid IS NOT NULL AND @pansys_puerto IS NOT NULL AND @pansys_datadir IS NOT NULL/.test(primera)
    && /CAST\(@@server_uuid AS BINARY\) = CAST\(@pansys_uuid AS BINARY\)/.test(primera) && /@@port = @pansys_puerto/.test(primera)
    && /CAST\(@@datadir AS BINARY\) = CAST\(@pansys_datadir AS BINARY\)/.test(primera), true);
  igual('exige base vacía antes de crear nada', esquemaSinComentarios.indexOf('ABORTAR: la base no esta vacia') < esquemaSinComentarios.indexOf('CREATE TABLE'), true);
  igual('todas las compuertas usan DO JSON_TYPE(IF(...)) (ERROR 3141 al fallar)',
    (esquemaSinComentarios.match(/ABORTAR:/g) || []).length, (esquemaSinComentarios.match(/DO JSON_TYPE\(IF\(/g) || []).length);
  igual('la cabecera ya no afirma que el 3141 muestra «ABORTAR» y explica cmd /c y utf8mb4',
    [/con el texto «ABORTAR: \.\.\.»/.test(esquema), /NO incluye el texto «ABORTAR»/.test(esquema), /--default-character-set=utf8mb4/.test(esquema), /cmd \/c/.test(esquema)], [false, true, true, true]);

  const s = esquemaSinComentarios;
  const fuera = [];
  for (const [nombre, t] of tablas) {
    for (const m of t.elementos.join(',').matchAll(/references (\w+)/g)) {
      const destino = tablas.get(m[1]);
      if (!destino || (destino.posicion >= t.posicion && m[1] !== nombre)) fuera.push(`${nombre}->${m[1]}`);
    }
  }
  igual('todas las claves foráneas apuntan a tablas ya creadas (foreign_key_checks = 1)', fuera, []);
  const alter = /ALTER TABLE `usuarios`\s+ADD CONSTRAINT `usuarios_ibfk_4` FOREIGN KEY \(`panaderia_id`\) REFERENCES `panaderias` \(`id`\) ON DELETE RESTRICT ON UPDATE CASCADE;/.exec(s);
  igual('el ciclo se cierra con ALTER usuarios_ibfk_4 después de crear panaderias y antes de materia_prima',
    !!alter && alter.index > tablas.get('panaderias').posicion && alter.index < tablas.get('materia_prima').posicion, true);
  igual('usuarios: un solo índice único (email)', tablas.get('usuarios').elementos.filter(e => e.startsWith('unique key')), ['unique key email (email)']);

  // ---------------- Comparación con los scripts históricos de pruebas
  console.log('\n== Comparación con crear_pansys_test + 005 + 006 (pruebas)');
  const base = tablasDe(leer(path.join(DIR_PRUEBAS_SQL, 'crear_pansys_test.sql')));
  const t005 = tablasDe(leer(path.join(DIR_PRUEBAS_SQL, '005_restablecimiento_contrasena_pansys_test.sql')));
  const sql006 = leer(path.join(DIR_PRUEBAS_SQL, '006_red_colaborativa_pansys_test.sql'));
  const t006 = tablasDe(sql006);
  igual('las fuentes históricas suman 10 + 2 + 5 tablas', [base.size, t005.size, t006.size], [10, 2, 5]);
  igual('ninguna tabla histórica queda fuera', ordenar([...base.keys(), ...t005.keys(), ...t006.keys()]), ordenar(ins.TABLAS));
  const altersDe = (tabla) => {
    const m = new RegExp(`ALTER TABLE pansys_test\\.${tabla}\\s+([\\s\\S]*?);`).exec(sinComentarios(sql006));
    return partirComas(m[1]).map(normalizar).map(e => {
      const despues = / after (\w+)$/.exec(e);
      return { elemento: e.replace(/^add (column )?/, '').replace(/ after \w+$/, ''), despues: despues && despues[1] };
    });
  };
  const esperado = (origen, ajustes = []) => {
    const elementos = [...origen.elementos];
    const cols = columnas(origen);
    for (const a of ajustes) {
      elementos.push(a.elemento);
      if (a.despues) cols.splice(cols.indexOf(a.despues) + 1, 0, a.elemento.split(' ')[0]);
    }
    return { elementos, cols };
  };
  const comparar = (tabla, esp, colaEsperada) => {
    const real = tablas.get(tabla);
    igual(`${tabla}: mismas columnas en el mismo orden`, columnas(real), esp.cols);
    igual(`${tabla}: mismas definiciones, índices y restricciones`, ordenar(real.elementos), ordenar(esp.elementos));
    igual(`${tabla}: mismas opciones de tabla`, real.cola, colaEsperada);
  };
  for (const [nombre, t] of base) {
    if (nombre === 'usuarios') {
      const quitados = t.elementos.filter(e => /^unique key email_\d+ /.test(e) || e.startsWith('constraint usuarios_ibfk_4 '));
      igual('usuarios histórico: 58 índices email_N duplicados + la clave del ciclo', quitados.length, 59);
      comparar(nombre, esperado({ ...t, elementos: t.elementos.filter(e => !quitados.includes(e)) }), t.cola);
      igual('usuarios_ibfk_4 del ALTER = la clave histórica', normalizar(alter ? alter[0] : '').includes(quitados.find(e => e.startsWith('constraint'))), true);
    } else if (nombre === 'materia_prima' || nombre === 'panaderias') {
      comparar(nombre, esperado(t, altersDe(nombre)), t.cola);
    } else {
      comparar(nombre, esperado(t), t.cola);
    }
  }
  for (const [nombre, t] of [...t005, ...t006]) comparar(nombre, esperado(t), t.cola);

  // ---------------- 04_verificar.sql
  console.log('\n== 04_verificar.sql');
  const verificar = sinComentarios(leer(path.join(DIR, '04_verificar.sql')));
  const sentencias = verificar.split(';').map(x => x.trim()).filter(Boolean);
  igual('solo sentencias DO o SELECT (solo lectura)', sentencias.filter(x => !/^(DO|SELECT)\b/.test(x)).length, 0);
  igual('sin INSERT, UPDATE, DELETE, ALTER, CREATE, DROP, GRANT ni SET', /\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|GRANT|SET)\b/.test(verificar.replace(/UPDATE_RULE/g, '')), false);
  igual('la primera sentencia es la compuerta de identidad positiva', /^DO JSON_TYPE\(IF\(@pansys_uuid IS NOT NULL/.test(sentencias[0]), true);
  igual('nunca selecciona la columna contrasena para mostrarla', /SELECT[^;]*\bu?\.?contrasena\b[^;]*FROM usuarios[^;]*ORDER BY/i.test(verificar), false);

  // ---------------- Sin identificadores locales en archivos versionados de instalación
  console.log('\n== Archivos de instalación sin identificadores locales');
  const archivosInstalacion = fs.readdirSync(DIR).filter(a => /\.(js|sql|json|md)$/.test(a));
  // Patrones GENÉRICOS (aquí no se publica ningún identificador real): uuid completos, nombres de equipo
  // por defecto de Windows, perfiles de usuario, cualquier ruta absoluta de unidad salvo C:\Windows
  // (herramientas del sistema) y el marcador C:\CAMBIAR de la plantilla, y bases de ensayo numeradas.
  // Cada desarrollador puede añadir sus identificadores reales SIN versionarlos, como texto literal:
  //   PANSYS_PATRONES_LOCALES=texto1,texto2 node pruebas/instalacion.unitarias.js
  const escaparRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const PATRONES_LOCALES_GENERICOS = [
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
    /\b(?:DESKTOP|LAPTOP)-[A-Z0-9]{3,}\b/i,
    /\b[A-Z]:[\\/]+(?:Users|Usuarios|Documents and Settings)[\\/]/i,
    /(?:^|[\s'"`(=])\/(?:home|Users)\/[^/\s'"`]+/,
    /\b[A-Z]:[\\/]+(?!(?:Windows|CAMBIAR)(?:[\\/]|\b))[A-Za-z0-9_.-]/i,
    /\bpansys_?ensayo\d+\b/i
  ];
  const patronesLocales = (extra = []) => [...PATRONES_LOCALES_GENERICOS, ...extra.filter(Boolean).map(t => new RegExp(escaparRegex(t), 'i'))];
  const contieneLocal = (texto, patrones) => patrones.some(p => p.test(texto));
  const extraEntorno = (process.env.PANSYS_PATRONES_LOCALES || '').split(',').map(t => t.trim()).filter(Boolean);
  const patrones = patronesLocales(extraEntorno);
  const POSITIVOS = ['aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', 'DESKTOP-ABC1234', 'LAPTOP-XYZ99', 'C:\\Users\\alguien\\x', 'C:\\\\Users\\\\alguien',
    'C:/Users/alguien', 'D:\\Respaldos\\x.sql', 'E:/datos/x', 'C:\\Carpeta\\datos', ' /home/alguien/x', "'/Users/alguien/x'", 'pansysensayo007', 'pansys_ensayo12'];
  const NEGATIVOS = ['C:\\Windows\\System32\\icacls.exe', 'C:\\\\Windows\\\\System32\\\\whoami.exe', 'C:\\CAMBIAR\\carpeta_fuera_del_repositorio\\',
    '127.0.0.1:3317', 'https://ejemplo.local/ruta', 'pansys_inst_ensayo', 'base:pansys_db', 'node database/instalacion/cli.js'];
  igual('el detector reconoce identificadores locales ficticios', POSITIVOS.filter(t => !contieneLocal(t, PATRONES_LOCALES_GENERICOS)), []);
  igual('el detector no marca rutas del sistema, marcadores ni texto legítimo', NEGATIVOS.filter(t => contieneLocal(t, PATRONES_LOCALES_GENERICOS)), []);
  igual('patrones extra por entorno: texto literal, sin comodines', [contieneLocal('equipo ABC.1', patronesLocales(['ABC.1'])), contieneLocal('equipo ABCx1', patronesLocales(['ABC.1']))], [true, false]);
  const locales = archivosInstalacion.filter(a => contieneLocal(leer(path.join(DIR, a)), patrones));
  igual(`ningún archivo contiene uuid, equipo, perfil de usuario, ruta local ni base de ensayo numerada${extraEntorno.length ? ` (+${extraEntorno.length} patrones locales del entorno)` : ''}`, locales, []);
  igual('la plantilla insegura 03_cuenta_app.sql ya no existe', fs.existsSync(path.join(DIR, '03_cuenta_app.sql')), false);

  // ---------------- Inventario del código (respalda los privilegios de cuentas.js)
  console.log('\n== Inventario de src: DELETE, destroy y sync');
  const archivos = [];
  const recorrer = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach(e => (e.isDirectory() ? recorrer(path.join(d, e.name)) : e.name.endsWith('.js') && archivos.push(path.join(d, e.name))));
  recorrer(path.join(__dirname, '../src'));
  const codigo = archivos.map(a => ({ a: path.relative(path.join(__dirname, '..'), a).replace(/\\/g, '/'), t: leer(a).split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n') }));
  const buscar = (re) => codigo.flatMap(({ a, t }) => (t.match(re) || []).map(x => `${a}: ${x}`));
  igual('destroy() solo sobre RecetaProducto', buscar(/\w+\.destroy\(/g), ['src/modules/produccion/recetas.service.js: RecetaProducto.destroy(', 'src/modules/produccion/recetas.service.js: RecetaProducto.destroy(']);
  igual('sin DELETE / REPLACE / TRUNCATE en SQL literal', buscar(/['"`]\s*(DELETE\s+FROM|REPLACE\s+INTO|TRUNCATE)/gi), []);
  igual('sin sync(), queryInterface ni migraciones automáticas', buscar(/\.sync\(|queryInterface|umzug|\.drop\(/gi), []);
  igual('sin bulkDelete ni paranoid', buscar(/bulkDelete|paranoid\s*:/g), []);

  // ---------------- validarParametros (comun.js)
  console.log('\n== validarParametros');
  const v = comun.validarParametros(D.parametros(), { repositorio: D.REPOSITORIO });
  igual('parámetros válidos se aceptan y se normalizan',
    [v.conexion, v.panaderias.map(p => p.email), v.panaderias[0].telefono, v.cuentas.instalador.usuario, v.desmontaje.protegidas],
    [{ host: '127.0.0.1', puerto: 3317, base: 'pansys_inst_ensayo' }, ['norte@correo.co', 'sur@correo.co'], null, 'pansys_instalador', ['pansys_historica_ficticia']]);
  const rechaza = (descripcion, cambiar, patron) => {
    const p = D.parametros(); cambiar(p);
    const e = lanza(() => comun.validarParametros(p, { repositorio: D.REPOSITORIO }));
    igual(`rechaza: ${descripcion}`, !!e && e instanceof comun.ErrorInstalacion && patron.test(e.message), true);
  };
  rechaza('una contraseña en el JSON', p => { p.panaderias[0].administrador.contrasena = 'Secreta123'; }, /no puede contener contraseñas/);
  rechaza('un password en cuentas', p => { p.cuentas.instalador.password = 'x'; }, /no puede contener contraseñas/);
  rechaza('un hash en cualquier nivel', p => { p.panaderias[1].hash = 'x'; }, /no puede contener contraseñas/);
  rechaza('sin identidad', p => { delete p.identidad; }, /faltan claves \(identidad\)/);
  rechaza('identidad con uuid de ejemplo', p => { p.identidad.server_uuid = 'CAMBIAR'; }, /UUID/);
  rechaza('identidad con uuid en mayúsculas', p => { p.identidad.server_uuid = p.identidad.server_uuid.toUpperCase().replace(/-/g, '-'); p.identidad.server_uuid = 'AAAAAAAA-2222-3333-4444-555555555555'; }, /UUID/);
  rechaza('identidad sin datadir', p => { delete p.identidad.datadir; }, /faltan claves \(datadir\)/);
  rechaza('identidad con datadir de ejemplo', p => { p.identidad.datadir = 'CAMBIAR'; }, /datadir/);
  rechaza('identidad con puerto inválido', p => { p.identidad.puerto = '3317'; }, /puerto/);
  rechaza('una sola panadería', p => { p.panaderias.pop(); }, /exactamente 2/);
  rechaza('tres panaderías', p => { p.panaderias.push(D.parametros().panaderias[0]); }, /exactamente 2/);
  rechaza('correos repetidos (sin distinguir mayúsculas)', p => { p.panaderias[1].administrador.email = 'NORTE@correo.co'; }, /correos distintos/);
  rechaza('correo con acentos (MySQL no distingue acentos: admín = admin)', p => { p.panaderias[1].administrador.email = 'nórte@correo.co'; }, /solo admite caracteres ASCII/);
  rechaza('nombres repetidos', p => { p.panaderias[1].nombre = 'panadería norte'; }, /nombres distintos/);
  rechaza('base pansys_test', p => { p.conexion.base = 'pansys_test'; }, /nunca es destino/);
  rechaza('base mysql', p => { p.conexion.base = 'mysql'; }, /nunca es destino/);
  rechaza('base con mayúsculas o caracteres raros', p => { p.conexion.base = 'Pansys-DB'; }, /minúsculas/);
  rechaza('base del ejemplo', p => { p.conexion.base = 'nombre_base_cambiar'; }, /ejemplo/);
  rechaza('valores del archivo de ejemplo', p => { p.panaderias[0].nombre = 'CAMBIAR nombre'; }, /ejemplo/);
  rechaza('correo .invalid', p => { p.panaderias[0].administrador.email = 'a@ejemplo.invalid'; }, /ejemplo/);
  rechaza('correo de pruebas @pansys.test', p => { p.panaderias[0].administrador.email = 'admin@pansys.test'; }, /ejemplo/);
  rechaza('correo mal formado', p => { p.panaderias[0].administrador.email = 'no-es-correo'; }, /no es válido/);
  rechaza('localidad vacía', p => { p.panaderias[0].localidad = '   '; }, /vacío/);
  rechaza('localidad de más de 100 caracteres', p => { p.panaderias[0].localidad = 'x'.repeat(101); }, /100/);
  rechaza('en_red no booleano', p => { p.panaderias[0].en_red = 'si'; }, /true o false/);
  rechaza('claves desconocidas', p => { p.panaderias[0].usuarios = []; }, /no admitidas/);
  rechaza('datos de demostración extra (productos)', p => { p.productos = []; }, /no admitidas/);
  rechaza('credenciales dentro del repositorio', p => { p.cuentas.aplicacion.credenciales = path.join(D.REPOSITORIO, 'backend', '.env.produccion.env'); }, /FUERA del repositorio/);
  rechaza('credenciales con ruta relativa', p => { p.cuentas.aplicacion.credenciales = 'aplicacion.env'; }, /ruta absoluta/);
  rechaza('credenciales sin extensión .env', p => { p.cuentas.aplicacion.credenciales = path.join(D.FUERA, 'aplicacion.txt'); }, /\.env/);
  rechaza('el mismo archivo para las dos cuentas', p => { p.cuentas.aplicacion.credenciales = p.cuentas.instalador.credenciales; }, /su propio archivo/);
  rechaza('cuenta root', p => { p.cuentas.aplicacion.usuario = 'root'; }, /reservado/);
  rechaza('cuenta pansys_test_app', p => { p.cuentas.aplicacion.usuario = 'pansys_test_app'; }, /reservado/);
  rechaza('host de cuenta no local', p => { p.cuentas.aplicacion.host = '%'; }, /127\.0\.0\.1/);
  rechaza('la misma cuenta para instalación y aplicación', p => { p.cuentas.aplicacion.usuario = 'pansys_instalador'; }, /distintas/);
  rechaza('sin sha256', p => { delete p.sha256; }, /faltan claves \(sha256\)/);
  rechaza('sha256 de ejemplo', p => { p.sha256['01_esquema.sql'] = 'CAMBIAR'; }, /SHA-256/);
  rechaza('desmontaje de una base que no es del ensayo', p => { p.desmontaje.bases.push('pansys_historica_ficticia'); }, /no es un objeto del ensayo/);
  rechaza('desmontaje de pansys_db', p => { p.desmontaje.bases = ['pansys_db']; }, /no es un objeto del ensayo/);
  rechaza('desmontaje de pansys_test', p => { p.desmontaje.bases = ['pansys_test']; }, /nunca es destino/);
  rechaza('desmontaje de una cuenta ajena', p => { p.desmontaje.cuentas = [{ usuario: 'pansys_ensayo', host: '127.0.0.1' }]; }, /no es una cuenta del ensayo/);
  rechaza('desmontaje de root', p => { p.desmontaje.cuentas = [{ usuario: 'root', host: 'localhost' }]; }, /no es una cuenta del ensayo/);
  rechaza('desmontaje sin bases protegidas', p => { p.desmontaje.protegidas = []; }, /al menos una base/);
  rechaza('protegida que coincide con un objeto a desmontar', p => { p.desmontaje.protegidas = ['pansys_inst_ensayo']; }, /coincide/);
  const ejemplo = lanza(() => comun.validarParametros(JSON.parse(leer(path.join(DIR, 'parametros.ejemplo.json'))), { repositorio: D.REPOSITORIO }));
  igual('parametros.ejemplo.json no pasa la validación (valores de ejemplo)', !!ejemplo, true);

  // ---------------- validarContrasenas
  console.log('\n== validarContrasenas');
  const emails = ['norte@correo.co', 'sur@correo.co'];
  const vc = (pares) => lanza(() => ins.validarContrasenas(pares, emails));
  igual('dos contraseñas válidas y distintas se aceptan', vc([['Horno2026a', 'Horno2026a'], ['Masa9Trigo', 'Masa9Trigo']]), null);
  igual('rechaza contraseñas iguales entre administradores', /diferentes/.test(vc([['Horno2026a', 'Horno2026a'], ['Horno2026a', 'Horno2026a']])?.message), true);
  igual('rechaza confirmación distinta', /no coinciden/.test(vc([['Horno2026a', 'Horno2026b'], ['Masa9Trigo', 'Masa9Trigo']])?.message), true);
  igual('rechaza la política (corta)', /al menos 8/.test(vc([['Ab1', 'Ab1'], ['Masa9Trigo', 'Masa9Trigo']])?.message), true);
  igual('rechaza la política (sin número)', /letra y un número/.test(vc([['SoloLetras', 'SoloLetras'], ['Masa9Trigo', 'Masa9Trigo']])?.message), true);
  igual('rechaza más de 72 bytes', /72 bytes/.test(vc([['ñ'.repeat(37) + '1', 'ñ'.repeat(37) + '1'], ['Masa9Trigo', 'Masa9Trigo']])?.message), true);
  igual('rechaza la contraseña que contiene el correo', /correo/.test(vc([['norte2026x', 'norte2026x'], ['Masa9Trigo', 'Masa9Trigo']])?.message), true);
  igual('los mensajes de error nunca incluyen la contraseña', /Horno2026a/.test(vc([['Horno2026a', 'Horno2026b'], ['Masa9Trigo', 'Masa9Trigo']])?.message), false);

  // ---------------- Doble de conexión para comprobarDestino / instalar
  const HASHES = ['$2b$12$' + 'a'.repeat(53), '$2b$12$' + 'b'.repeat(53)];
  const crearConexion = (opciones = {}) => {
    const o = { identidad: D.IDENTIDAD, base: 'pansys_inst_ensayo', sqlMode: 'ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES,NO_ZERO_IN_DATE', tablas: [...ins.TABLAS], motor: {}, columnas: 3, fks: 41, ciclo: 2, checks: 32,
      roles: [{ id: 1, nombre: 'administrador', estado: 1 }, { id: 2, nombre: 'panadero', estado: 1 }, { id: 3, nombre: 'gerente', estado: 1 }],
      filas: {}, lock: 1, fallarEn: null, fallarCommit: false, conexionPerdidaEn: null, afectadas: 1, ...opciones };
    const registro = [];
    let id = 100;
    const usuarios = []; const panaderias = [];
    const con = {
      registro, usuarios, panaderias, transaccion: null, cerrada: false,
      async execute(sql, params = []) {
        registro.push({ sql, params });
        if (o.conexionPerdidaEn && sql.includes(o.conexionPerdidaEn)) throw D.errorMysql('PROTOCOL_CONNECTION_LOST', undefined, { fatal: true });
        if (o.fallarEn && sql.includes(o.fallarEn)) throw D.errorMysql('ER_DUP_ENTRY', 1062);
        if (sql.startsWith('SELECT @@port AS puerto')) return [[{ puerto: o.identidad.puerto, uuid: o.identidad.server_uuid, datadir: o.identidad.datadir, base: o.base }]];
        if (sql.startsWith('SELECT @@SESSION.sql_mode')) return [[{ m: o.sqlMode, a: 1 }]];
        if (sql.includes('information_schema.TABLES')) return [o.tablas.map(t => ({ t, e: o.motor[t] || 'InnoDB', y: 'BASE TABLE' }))];
        if (sql.includes('information_schema.COLUMNS')) return [[{ n: o.columnas }]];
        if (sql.includes("CONSTRAINT_NAME = 'usuarios_ibfk_4'")) return [[{ n: o.ciclo }]];
        if (sql.includes('REFERENTIAL_CONSTRAINTS')) return [[{ n: o.fks }]];
        if (sql.includes('TABLE_CONSTRAINTS')) return [[{ n: o.checks }]];
        if (sql.startsWith('SELECT id, nombre, estado FROM roles')) return [o.roles];
        if (sql.startsWith('SELECT GET_LOCK')) return [[{ b: o.lock }]];
        if (sql.startsWith('SELECT RELEASE_LOCK')) { con.liberado = true; return [[{ r: 1 }]]; }
        if (/^SELECT COUNT\(\*\) AS n FROM `(\w+)`$/.test(sql)) return [[{ n: o.filas[/`(\w+)`/.exec(sql)[1]] || 0 }]];
        if (sql === 'SELECT COUNT(*) AS n FROM usuarios FOR UPDATE' || sql === 'SELECT COUNT(*) AS n FROM usuarios') return [[{ n: (o.filas.usuarios || 0) + usuarios.length }]];
        if (sql === 'SELECT COUNT(*) AS n FROM panaderias FOR UPDATE' || sql === 'SELECT COUNT(*) AS n FROM panaderias') return [[{ n: (o.filas.panaderias || 0) + panaderias.length }]];
        if (sql.startsWith('INSERT INTO usuarios')) { const u = { id: ++id, email: params[0], contrasena: params[1], panaderia_id: null }; usuarios.push(u); return [{ insertId: u.id }]; }
        if (sql.startsWith('INSERT INTO panaderias')) { const p = { id: ++id, usuario_id: params[5] }; panaderias.push(p); return [{ insertId: p.id }]; }
        if (sql.startsWith('UPDATE usuarios SET panaderia_id')) {
          const u = usuarios.find(x => x.id === params[1] && x.panaderia_id === null);
          if (u && o.afectadas === 1) u.panaderia_id = params[0];
          return [{ affectedRows: u ? o.afectadas : 0 }];
        }
        if (sql.startsWith('SELECT u.id AS u')) return [usuarios.map(u => ({ u: u.id, up: u.panaderia_id, p: (panaderias.find(p => p.usuario_id === u.id) || {}).id }))];
        throw new Error(`SQL no previsto en el doble: ${sql}`);
      },
      async query() { throw new Error('instalador no debe usar query()'); },
      async beginTransaction() { registro.push({ sql: 'BEGIN' }); con.transaccion = 'abierta'; },
      async commit() { registro.push({ sql: 'COMMIT' }); if (o.fallarCommit) throw D.errorMysql('PROTOCOL_CONNECTION_LOST', undefined, { fatal: true }); con.transaccion = 'confirmada'; },
      async rollback() { registro.push({ sql: 'ROLLBACK' }); con.transaccion = 'deshecha'; usuarios.length = 0; panaderias.length = 0; },
      async end() { con.cerrada = true; }
    };
    return con;
  };

  // ---------------- comprobarDestino
  console.log('\n== comprobarDestino (solo lectura)');
  const destino = async (op, patron) => {
    const con = crearConexion(op);
    const r = await resultado(ins.comprobarDestino(con, { base: 'pansys_inst_ensayo', identidad: D.IDENTIDAD }));
    const soloLectura = con.registro.every(x => /^SELECT /.test(x.sql));
    return { ok: patron ? !r.ok && patron.test(r.e.message) : r.ok, soloLectura };
  };
  const otro = (cambio) => ({ identidad: { ...D.IDENTIDAD, ...cambio } });
  igual('destino correcto: se acepta y solo lee', await destino({}), { ok: true, soloLectura: true });
  igual('otro server_uuid (p. ej. el MySQL de desarrollo)', await destino(otro({ server_uuid: 'aaaaaaaa-bbbb-4ccc-8ddd-000000000000' }), /identidad del servidor/), { ok: true, soloLectura: true });
  igual('otro puerto (p. ej. 3306)', await destino(otro({ puerto: 3306 }), /identidad del servidor/), { ok: true, soloLectura: true });
  igual('otro datadir', await destino(otro({ datadir: 'C:\\otro\\Data\\' }), /identidad del servidor/), { ok: true, soloLectura: true });
  igual('la conexión apunta a otra base', await destino({ base: 'pansys_db' }, /no apunta a la base/), { ok: true, soloLectura: true });
  igual('sesión sin STRICT_TRANS_TABLES', await destino({ sqlMode: 'NO_ENGINE_SUBSTITUTION' }, /STRICT_TRANS_TABLES/), { ok: true, soloLectura: true });
  igual('falta una tabla (01 incompleto)', await destino({ tablas: ins.TABLAS.slice(1) }, /exactamente las 17/), { ok: true, soloLectura: true });
  igual('tabla de más', await destino({ tablas: [...ins.TABLAS, 'otra'] }, /exactamente las 17/), { ok: true, soloLectura: true });
  igual('una tabla MyISAM (la transacción no se desharía)', await destino({ motor: { panaderias: 'MyISAM' } }, /InnoDB/), { ok: true, soloLectura: true });
  igual('claves foráneas incompletas', await destino({ fks: 40 }, /no coincide/), { ok: true, soloLectura: true });
  igual('falta una clave del ciclo', await destino({ ciclo: 1 }, /no coincide/), { ok: true, soloLectura: true });
  igual('roles alterados', await destino({ roles: [{ id: 1, nombre: 'administrador', estado: 1 }] }, /tres roles/), { ok: true, soloLectura: true });
  igual('base con datos (p. ej. pansys_db con ventas)', await destino({ filas: { ventas: 5 } }, /ya tiene datos/), { ok: true, soloLectura: true });
  igual('base con usuarios', await destino({ filas: { usuarios: 1 } }, /ya tiene datos/), { ok: true, soloLectura: true });

  // ---------------- instalar (transacción)
  console.log('\n== instalar (transacción única)');
  const panaderiasOk = v.panaderias;
  {
    const con = crearConexion();
    const r = await resultado(ins.instalar(con, panaderiasOk, HASHES));
    const orden = con.registro.map(x => x.sql.split(' ').slice(0, 3).join(' '));
    igual('instala y confirma', [r.ok, con.transaccion, con.liberado], [true, 'confirmada', true]);
    igual('orden del ciclo: 2 usuarios (panaderia NULL) -> 2 panaderías -> 2 asignaciones -> COMMIT',
      orden.filter(x => /^(INSERT|UPDATE|COMMIT|BEGIN)/.test(x)),
      ['BEGIN', 'INSERT INTO usuarios', 'INSERT INTO usuarios', 'INSERT INTO panaderias', 'INSERT INTO panaderias', 'UPDATE usuarios SET', 'UPDATE usuarios SET', 'COMMIT']);
    igual('los usuarios se insertan con panaderia_id NULL y rol administrador', con.registro.filter(x => x.sql.startsWith('INSERT INTO usuarios')).every(x => x.sql.includes('?, ?, ?, NULL, 1, 0') && x.params[2] === 1), true);
    igual('se guardan los hashes, nunca contraseñas', con.usuarios.map(u => u.contrasena), HASHES);
    igual('cada administrador queda en la panadería de la que es propietario', con.usuarios.map(u => u.panaderia_id), con.panaderias.map(p => p.id));
    igual('cada panadería pertenece a su administrador', con.panaderias.map(p => p.usuario_id), con.usuarios.map(u => u.id));
    igual('en_red y localidad se envían', con.registro.filter(x => x.sql.startsWith('INSERT INTO panaderias')).map(x => [x.params[2], x.params[4]]), [['Kennedy', 1], ['Bosa', 1]]);
    igual('GET_LOCK antes de BEGIN', orden.indexOf('SELECT GET_LOCK(CONCAT(\'pansys_instalacion:\',') < orden.indexOf('BEGIN'), true);
    igual('re-comprueba usuarios y panaderias vacías con FOR UPDATE dentro de la transacción', con.registro.filter(x => / FOR UPDATE$/.test(x.sql)).length, 2);
    igual('ninguna sentencia usa DELETE, DROP ni foreign_key_checks', con.registro.some(x => /DELETE|DROP|FOREIGN_KEY_CHECKS/i.test(x.sql)), false);
  }
  const fallo = async (descripcion, opciones, patron) => {
    const con = crearConexion(opciones);
    const r = await resultado(ins.instalar(con, panaderiasOk, HASHES));
    igual(`fallo en ${descripcion}: ROLLBACK, sin COMMIT, sin datos, bloqueo liberado`,
      [r.ok, patron.test(r.e?.message), con.transaccion, con.registro.some(x => x.sql === 'COMMIT'), con.usuarios.length, con.panaderias.length, con.liberado, !!r.e?.incierto],
      [false, true, 'deshecha', false, 0, 0, true, false]);
    igual(`fallo en ${descripcion}: el mensaje no contiene valores (correo, hash, SQL)`, /correo\.co|\$2b\$|INSERT|Duplicate|sensibles/.test(r.e?.message), false);
  };
  await fallo('el primer INSERT de usuarios', { fallarEn: 'INSERT INTO usuarios' }, /ER_DUP_ENTRY/);
  await fallo('el INSERT de panaderías', { fallarEn: 'INSERT INTO panaderias' }, /ER_DUP_ENTRY/);
  await fallo('la asignación de panadería', { fallarEn: 'UPDATE usuarios SET panaderia_id' }, /ER_DUP_ENTRY/);
  await fallo('la asignación que no afecta a una fila', { afectadas: 0 }, /No se pudo asignar/);
  await fallo('la comprobación previa al COMMIT', { fallarEn: 'SELECT u.id AS u' }, /deshecho la transacción/);
  await fallo('tablas no vacías al bloquear', { filas: { usuarios: 1 } }, /ya tienen datos/);
  {
    const con = crearConexion({ conexionPerdidaEn: 'INSERT INTO panaderias' });
    const r = await resultado(ins.instalar(con, panaderiasOk, HASHES));
    igual('conexión perdida a mitad (sin COMMIT): incierto, sin COMMIT ni ROLLBACK forzado, pide 04_verificar',
      [r.ok, r.e?.incierto, /04_verificar/.test(r.e?.message), con.registro.some(x => x.sql === 'COMMIT'), con.registro.some(x => x.sql === 'ROLLBACK')], [false, true, true, false, false]);
  }
  {
    const con = crearConexion({ lock: 0 });
    const r = await resultado(ins.instalar(con, panaderiasOk, HASHES));
    igual('otra instalación en curso (GET_LOCK = 0): no abre transacción', [r.ok, /en curso/.test(r.e?.message), con.registro.some(x => x.sql === 'BEGIN')], [false, true, false]);
  }
  {
    const con = crearConexion({ fallarCommit: true });
    const r = await resultado(ins.instalar(con, panaderiasOk, HASHES));
    igual('COMMIT fallido: resultado INCIERTO, sin ROLLBACK, pide 04_verificar', [r.ok, r.e?.incierto, /INCIERTO.*04_verificar/.test(r.e?.message), con.registro.some(x => x.sql === 'ROLLBACK'), con.liberado], [false, true, true, false, true]);
  }
  {
    const con = crearConexion();
    const r = await resultado(ins.instalar(con, panaderiasOk, ['Horno2026a', 'Masa9Trigo']));
    igual('instalar rechaza contraseñas en lugar de hashes, sin tocar la base', [r.ok, con.registro.length], [false, 0]);
  }

  // ---------------- leerOculto
  console.log('\n== leerOculto (sin eco, teclas especiales descartadas)');
  const leerCon = async (trozos) => {
    const entrada = D.crearTTY(); const salida = D.crearSalida();
    const p = resultado(comun.leerOculto({ entrada, salida, pregunta: 'Clave: ' }));
    const rawAlEmpezar = entrada.raw;
    for (const t of trozos) entrada.emit('data', t);
    return { r: await p, salida: salida.texto, entrada, rawAlEmpezar };
  };
  {
    const x = await leerCon(['Horno20', '26x\u007fa', '\r']);
    igual('activa el modo sin eco', x.rawAlEmpezar, true);
    igual('devuelve lo tecleado (con retroceso)', x.r.r, 'Horno2026a');
    igual('no escribe ningún carácter tecleado', x.salida, 'Clave: \n');
    igual('restaura el modo de la terminal y deja de escuchar', [x.entrada.raw, x.entrada.listenerCount('data'), x.entrada.activa], [false, 0, false]);
  }
  igual('flechas (ESC [ D / ESC [ C) no se cuelan', (await leerCon(['Horno\u001b[D\u001b[C2026a\r'])).r.r, 'Horno2026a');
  igual('Supr, Inicio y Fin (ESC [ 3 ~, ESC [ H, ESC [ F) no se cuelan', (await leerCon(['Hor\u001b[3~no\u001b[H2026\u001b[Fa\r'])).r.r, 'Horno2026a');
  igual('secuencia partida entre dos trozos', (await leerCon(['Horno\u001b', '[1;5D2026a\r'])).r.r, 'Horno2026a');
  igual('F1 (ESC O P) y Alt+tecla (ESC x) no se cuelan', (await leerCon(['Hor\u001bOPno\u001bx2026a\r'])).r.r, 'Horno2026a');
  igual('Retroceso Windows (\\b) y caracteres no ASCII', (await leerCon(['Mañana1x\b\r'])).r.r, 'Mañana1');
  {
    const x = await leerCon(['abc\u0003']);
    igual('Ctrl+C cancela y restaura la terminal', [x.r.ok, /Cancelado/.test(x.r.e?.message), x.entrada.raw], [false, true, false]);
  }
  {
    const r = await resultado(comun.leerOculto({ entrada: Object.assign(new EventEmitter(), { isTTY: false }), salida: D.crearSalida(), pregunta: 'Clave: ' }));
    igual('rechaza entradas que no son terminal (tuberías o archivos)', [r.ok, /terminal interactiva/.test(r.e?.message)], [false, true]);
  }

  // ---------------- ejecutar (programa 02 completo con dobles)
  console.log('\n== ejecutar 02 (programa completo, sin MySQL)');
  const CONTRASENAS = ['Horno2026a', 'Masa9Trigo'];
  const CLAVE_MYSQL = "Instal#'2026`x";
  const credInstalador = comun.serializarCredenciales('pansys_instalador', CLAVE_MYSQL);
  const escrituras = [];
  const fsOriginal = {};
  for (const f of ['writeFileSync', 'appendFileSync', 'writeFile', 'appendFile', 'createWriteStream', 'openSync']) {
    fsOriginal[f] = fs[f];
    // openSync también se usa para leer: solo cuenta la apertura para escribir, añadir o crear
    fs[f] = (...a) => { if (f !== 'openSync' || /[wax+]/.test(String(a[1] ?? 'r'))) escrituras.push(f); return fsOriginal[f].apply(fs, a); };
  }
  const consola = [];
  const consolaOriginal = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  const programa = async ({ argv = [`--parametros=${D.RUTA_PARAMETROS}`], datos = D.parametros(), respuestas, confirmar = 'pansys_inst_ensayo', conexion, archivos } = {}) => {
    const salida = D.crearSalida();
    const preguntas = [];
    const ocultas = [...(respuestas || [CONTRASENAS[0], CONTRASENAS[0], CONTRASENAS[1], CONTRASENAS[1]])];
    const con = conexion || crearConexion();
    const conexiones = [];
    const costes = [];
    const arch = archivos || D.crearArchivos({ iniciales: { [datos.cuentas.instalador.credenciales]: credInstalador } });
    for (const k of Object.keys(consolaOriginal)) console[k] = (...a) => consola.push(a.join(' '));
    let codigo;
    try {
      codigo = await ins.ejecutar({
        argv, archivos: arch,
        leerArchivo: (ruta) => { if (ruta !== D.RUTA_PARAMETROS) throw new Error('ruta inesperada'); return JSON.stringify(datos); },
        preguntar: async (t) => { preguntas.push(t); return confirmar; },
        preguntarOculto: async (t) => { preguntas.push(t); if (!ocultas.length) throw new comun.ErrorInstalacion('sin respuesta'); return ocultas.shift(); },
        conectar: async (c) => { conexiones.push(c); return con; },
        hashear: async (c, coste) => { costes.push(coste); return bcrypt.hash(c, 4); },
        salida, repositorio: D.REPOSITORIO
      });
    } finally {
      Object.assign(console, consolaOriginal);
    }
    return { codigo, salida: salida.texto, preguntas, con, conexiones, costes, arch };
  };
  const e1 = await programa();
  igual('instalación completa: código 0 y COMMIT', [e1.codigo, e1.con.transaccion, e1.con.cerrada], [0, 'confirmada', true]);
  igual('pide solo las 2 x 2 contraseñas de administradores de forma oculta', e1.preguntas.filter(t => /Contraseña|Repita/.test(t)).length, 4);
  igual('la contraseña MySQL de instalación sale del archivo protegido (verificado antes de leer) y solo va a conectar()',
    [e1.conexiones.map(c => c.contrasena), e1.arch.registro.filter(([op]) => op !== 'leer').map(([op]) => op)], [[CLAVE_MYSQL], ['verificar']]);
  igual('bcrypt con coste 12', e1.costes, [12, 12]);
  const hashesGuardados = e1.con.usuarios.map(u => u.contrasena);
  igual('se guardan hashes bcrypt que verifican cada contraseña', [await bcrypt.compare(CONTRASENAS[0], hashesGuardados[0]), await bcrypt.compare(CONTRASENAS[1], hashesGuardados[1])], [true, true]);
  igual('ningún parámetro SQL contiene una contraseña en claro', e1.con.registro.some(x => (x.params || []).some(p => CONTRASENAS.includes(p) || p === CLAVE_MYSQL)), false);
  const secretos = [...CONTRASENAS, CLAVE_MYSQL, ...hashesGuardados];
  igual('la salida no contiene contraseñas ni hashes', secretos.some(sx => e1.salida.includes(sx)), false);
  igual('la salida resume panaderías y administradores', /INSTALACIÓN COMPLETADA[\s\S]*Panadería Norte[\s\S]*norte@correo\.co/.test(e1.salida), true);
  igual('console.* no se usa (nada fuera de la salida controlada)', consola, []);
  igual('no escribe archivos', escrituras, []);

  const casos = [
    ['argumento extra (p. ej. una contraseña)', { argv: [`--parametros=${D.RUTA_PARAMETROS}`, '--contrasena=Horno2026a'] }, /Argumentos no admitidos/, 1],
    ['sin argumentos', { argv: [] }, /Falta --parametros/, 1],
    ['parámetros dentro del repositorio', { argv: [`--parametros=${path.join(DIR, 'parametros.ejemplo.json')}`] }, /FUERA del repositorio/, 1],
    ['confirmación con otra base', { confirmar: 'pansys_db' }, /Confirmación incorrecta/, 1],
    ['archivo de credenciales sin proteger', { archivos: D.crearArchivos({ fallar: { verificar: true }, iniciales: { [D.parametros().cuentas.instalador.credenciales]: credInstalador } }) }, /no está restringido/, 1],
    ['archivo de credenciales de otra cuenta', { archivos: D.crearArchivos({ iniciales: { [D.parametros().cuentas.instalador.credenciales]: comun.serializarCredenciales('pansys_otra', 'x1') } }) }, /no corresponde/, 1],
    ['sin archivo de credenciales', { archivos: D.crearArchivos() }, /No existe el archivo de credenciales/, 1],
    ['servidor con otra identidad', { conexion: crearConexion({ identidad: { ...D.IDENTIDAD, server_uuid: '99999999-2222-3333-4444-555555555555' } }) }, /identidad del servidor/, 1],
    ['contraseñas iguales', { respuestas: ['Horno2026a', 'Horno2026a', 'Horno2026a', 'Horno2026a'] }, /diferentes/, 1],
    ['confirmación de contraseña distinta', { respuestas: ['Horno2026a', 'Horno2026b', 'Masa9Trigo', 'Masa9Trigo'] }, /no coinciden/, 1],
    ['destino con datos', { conexion: crearConexion({ filas: { productos: 3 } }) }, /ya tiene datos/, 1],
    ['fallo de MySQL en el alta', { conexion: crearConexion({ fallarEn: 'INSERT INTO panaderias' }) }, /deshecho la transacción.*ER_DUP_ENTRY/, 1],
    ['conexión perdida en el alta', { conexion: crearConexion({ conexionPerdidaEn: 'INSERT INTO panaderias' }) }, /04_verificar/, 2],
    ['COMMIT incierto', { conexion: crearConexion({ fallarCommit: true }) }, /INCIERTO/, 2]
  ];
  for (const [descripcion, op, patron, codigo] of casos) {
    const r = await programa(op);
    igual(`detiene: ${descripcion} (código ${codigo}, sin secretos en la salida)`,
      [r.codigo, patron.test(r.salida), secretos.some(sx => r.salida.includes(sx)) || /Horno2026|Masa9Trigo|\$2b\$|sensibles/.test(r.salida)], [codigo, true, false]);
  }
  const sinConfirmar = await programa({ confirmar: 'no' });
  igual('sin confirmación no lee credenciales, no se conecta ni pide contraseñas', [sinConfirmar.arch.registro.length, sinConfirmar.conexiones.length, sinConfirmar.preguntas.filter(t => /Contraseña/.test(t)).length], [0, 0, 0]);
  const conDatos = await programa({ conexion: crearConexion({ filas: { ventas: 1 } }) });
  igual('destino inválido: no pide las contraseñas de administradores y cierra la conexión', [conDatos.preguntas.filter(t => /administrador/.test(t)).length, conDatos.con.cerrada], [0, true]);
  igual('ningún caso escribió archivos', escrituras, []);
  Object.assign(fs, fsOriginal);

  // ---------------- Código fuente del instalador
  console.log('\n== Código fuente del instalador');
  const fuenteIns = leer(path.join(DIR, 'instalador.js')) + leer(path.join(DIR, '02_instalar_panaderias.js'));
  igual('no usa console.*, process.env ni escritura de archivos', /console\.|process\.env|writeFile|appendFile|createWriteStream/.test(fuenteIns), false);
  igual('no usa multipleStatements ni query()', [/multipleStatements: true/.test(fuenteIns), /\.query\(/.test(fuenteIns)], [false, false]);

  const fallidas = resultados.filter(r => !r).length;
  console.log(`\n${resultados.length - fallidas}/${resultados.length} pruebas correctas`);
  process.exit(fallidas ? 1 : 0);
};

main().catch(e => { console.error('Error inesperado en las pruebas:', e?.stack || e?.message); process.exit(1); });
