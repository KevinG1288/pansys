'use strict';
// =====================================================================================
// Pansys - INSTALACIÓN LIMPIA: cuentas MySQL de instalación y de aplicación (lógica de 03)
// =====================================================================================
// Sustituye a la antigua plantilla 03_cuenta_app.sql (PREPARE + RANDOM PASSWORD mostraba el secreto
// en la salida). Aquí:
//  - La contraseña del administrador de MySQL se pide de forma oculta.
//  - Identidad POSITIVA del servidor antes de nada.
//  - El archivo de credenciales (fuera del repositorio) se crea VACÍO, en exclusiva y restringido
//    ANTES de crear la cuenta: si no se puede proteger, no se toca MySQL.
//  - CREATE USER ... IDENTIFIED BY RANDOM PASSWORD como sentencia normal (no preparada): MySQL
//    genera el secreto y lo devuelve en el resultado; se guarda SOLO en memoria y se escribe en el
//    archivo protegido. Nunca se muestra, ni va en argumentos, registros o archivos temporales.
//  - @@GLOBAL.partial_revokes (0 o 1, si no se detiene antes de escribir) decide el nombre del GRANT de
//    base: ON -> literal; OFF -> con _ escapado. La verificación acepta SOLO la forma de ese modo.
//  - Privilegios mínimos y verificación EXACTA: nombre de la base (una sola forma, según el modo), tipos
//    de privilegio, sin privilegios globales ni de columna ni GRANT OPTION, y prueba funcional con
//    una conexión nueva de la propia cuenta.
//  - Cualquier fallo detiene el proceso y se informa del estado. NUNCA se borra una cuenta
//    automáticamente (estado incierto -> código 2; para retirarla, desmontaje del ensayo o DROP USER
//    manual con autorización).
// =====================================================================================
const path = require('path');
const {
  ErrorInstalacion, DIR_REPOSITORIO, errorSeguro, esConexionPerdida, cargarParametros, leerArgumentos,
  comprobarIdentidad, serializarCredenciales
} = require('./comun');

const PRIVILEGIOS = Object.freeze({
  // 01_esquema.sql (CREATE TABLE con claves foráneas, ALTER del ciclo, INSERT de roles) y 02 (alta,
  // SELECT ... FOR UPDATE). Sin DROP, DELETE, INDEX ni privilegios globales.
  instalador: { base: ['ALTER', 'CREATE', 'INSERT', 'REFERENCES', 'SELECT', 'UPDATE'], tablas: [] },
  // Inventario del código: SELECT/INSERT/UPDATE; DELETE solo en receta_producto (recetas.service.js)
  aplicacion: { base: ['INSERT', 'SELECT', 'UPDATE'], tablas: [['receta_producto', 'DELETE']] }
});
const INTENTOS_CONTRASENA = 3;

// Nombre de base de un GRANT de base, según @@GLOBAL.partial_revokes (el patrón de nombre ya excluye % y `):
//  OFF: _ es comodín -> se escapa (\_); MySQL lo guarda así en mysql.db y lo compara como literal.
//  ON: el nombre es SIEMPRE literal y \ NO es escape. Comprobado en el ensayo 3317 (E3-2, 2026-11-15):
//      con ON, `pansys\_inst\_ensayo` quedó guardado con barras (HEX ...5C5F...) y no daba acceso a
//      pansys_inst_ensayo (ER_DBACCESS_DENIED_ERROR al conectar con la cuenta).
const nombreGrant = (base, partialRevokes) => {
  if (partialRevokes !== 0 && partialRevokes !== 1) throw new ErrorInstalacion('partial_revokes debe ser 0 o 1.');
  return partialRevokes === 1 ? base : base.replace(/_/g, '\\_');
};
const baseParaGrant = (base, partialRevokes) => `\`${nombreGrant(base, partialRevokes)}\``;
const cadena = (v) => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
const cuentaSql = (c) => `${cadena(c.usuario)}@${cadena(c.host)}`;
const grantee = (c) => `'${c.usuario}'@'${c.host}'`;

const filas = async (con, sql, params = []) => (await con.execute(sql, params))[0];
const numero = async (con, sql, params = []) => Number((await filas(con, sql, params))[0].n);

// Estado previo (solo lectura): modo partial_revokes, base, cuenta inexistente y momento correcto de la
// instalación. Devuelve { partialRevokes } (0 o 1); cualquier otro valor detiene antes de escribir.
const comprobarPrevio = async (con, { tipo, base, cuenta }) => {
  const [modo] = await filas(con, 'SELECT @@GLOBAL.partial_revokes AS pr');
  const crudo = modo ? modo.pr : undefined;
  const partialRevokes = (crudo === 0 || crudo === 1 || crudo === '0' || crudo === '1') ? Number(crudo) : null;
  if (partialRevokes === null) {
    throw new ErrorInstalacion('No se pudo leer @@GLOBAL.partial_revokes como 0 o 1. No se ha modificado nada.');
  }
  const esquema = await filas(con, 'SELECT DEFAULT_CHARACTER_SET_NAME AS cs, DEFAULT_COLLATION_NAME AS co FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [base]);
  if (esquema.length !== 1 || esquema[0].cs !== 'utf8mb4' || esquema[0].co !== 'utf8mb4_0900_ai_ci') {
    throw new ErrorInstalacion(`La base ${base} no existe o no usa utf8mb4 / utf8mb4_0900_ai_ci. No se ha modificado nada.`);
  }
  if (await numero(con, 'SELECT COUNT(*) AS n FROM mysql.user WHERE User = ?', [cuenta.usuario]) !== 0) {
    throw new ErrorInstalacion(`Ya existe una cuenta ${cuenta.usuario} (en algún host). No se ha modificado nada.`);
  }
  const tablas = await numero(con, 'SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?', [base]);
  if (tipo === 'instalador' && tablas !== 0) throw new ErrorInstalacion('La cuenta de instalación se crea con la base VACÍA (antes de 01_esquema.sql). No se ha modificado nada.');
  if (tipo === 'aplicacion') {
    if (tablas !== 17) throw new ErrorInstalacion('La cuenta de la aplicación se crea con el esquema completo (17 tablas). No se ha modificado nada.');
    if (await numero(con, `SELECT COUNT(*) AS n FROM \`${base}\`.\`panaderias\``) !== 2) {
      throw new ErrorInstalacion('La cuenta de la aplicación se crea después de 02 (dos panaderías). No se ha modificado nada.');
    }
  }
  return { partialRevokes };
};

// Privilegios exactos (solo lectura, como administrador)
// El nombre de base debe ser EXACTAMENTE el que corresponde al modo detectado (una sola forma).
const verificarPrivilegios = async (con, { tipo, base, cuenta, partialRevokes }) => {
  const esperadoEnMysqlDb = nombreGrant(base, partialRevokes);
  const g = grantee(cuenta);
  const esperado = PRIVILEGIOS[tipo];
  const globales = await filas(con, "SELECT PRIVILEGE_TYPE AS p FROM information_schema.USER_PRIVILEGES WHERE GRANTEE = ? AND PRIVILEGE_TYPE <> 'USAGE'", [g]);
  const deBase = await filas(con, 'SELECT TABLE_SCHEMA AS s, PRIVILEGE_TYPE AS p, IS_GRANTABLE AS gr FROM information_schema.SCHEMA_PRIVILEGES WHERE GRANTEE = ?', [g]);
  const deTabla = await filas(con, 'SELECT TABLE_SCHEMA AS s, TABLE_NAME AS t, PRIVILEGE_TYPE AS p, IS_GRANTABLE AS gr FROM information_schema.TABLE_PRIVILEGES WHERE GRANTEE = ?', [g]);
  const deColumna = await numero(con, 'SELECT COUNT(*) AS n FROM information_schema.COLUMN_PRIVILEGES WHERE GRANTEE = ?', [g]);
  const fallos = [];
  if (globales.length) fallos.push('tiene privilegios globales');
  if (deColumna) fallos.push('tiene privilegios de columna');
  if (!deBase.length || !deBase.every(f => f.s === esperadoEnMysqlDb)) fallos.push(`los privilegios de base no están sobre el nombre exacto ${esperadoEnMysqlDb} (partial_revokes=${partialRevokes ? 'ON' : 'OFF'})`);
  if (new Set(deBase.map(f => f.s)).size !== 1) fallos.push('los privilegios de base no están sobre exactamente una base');
  if (JSON.stringify(deBase.map(f => f.p).sort()) !== JSON.stringify([...esperado.base].sort())) fallos.push('los privilegios de base no son los esperados');
  const tablas = deTabla.map(f => `${f.s}.${f.t}:${f.p}`).sort();
  if (JSON.stringify(tablas) !== JSON.stringify(esperado.tablas.map(([t, p]) => `${base}.${t}:${p}`).sort())) fallos.push('los privilegios de tabla no son los esperados');
  if ([...deBase, ...deTabla].some(f => f.gr !== 'NO')) fallos.push('tiene GRANT OPTION');
  if (fallos.length) throw new ErrorInstalacion(`Verificación de privilegios fallida: ${fallos.join('; ')}.`);
};

// Prueba funcional con la propia cuenta: lo permitido funciona y lo denegado da 1142.
// Solo sentencias inocuas aunque los privilegios estuvieran mal (DELETE ... WHERE 1 = 0, LIMIT 0).
const verificarFuncional = async (conCuenta, { tipo, cuenta }) => {
  const [yo] = await filas(conCuenta, 'SELECT CURRENT_USER() AS c');
  if (yo?.c !== `${cuenta.usuario}@${cuenta.host}`) throw new ErrorInstalacion('La prueba funcional no se conectó con la cuenta esperada.');
  const denegado = async (sql) => {
    try { await conCuenta.query(sql); } catch (e) { if (e.errno === 1142 || e.errno === 1044) return; throw e; }
    throw new ErrorInstalacion('La prueba funcional encontró un permiso que debería estar denegado.');
  };
  if (tipo === 'instalador') {
    await filas(conCuenta, 'SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()');
  } else {
    if (await numero(conCuenta, 'SELECT COUNT(*) AS n FROM roles') !== 3) throw new ErrorInstalacion('La cuenta de la aplicación no lee los 3 roles.');
    await conCuenta.query('DELETE FROM receta_producto WHERE 1 = 0');
    await denegado('DELETE FROM productos WHERE 1 = 0');
  }
  await denegado('SELECT 1 FROM mysql.user LIMIT 0');
};

const AYUDA = [
  'Uso (desde backend/):',
  '  node database/instalacion/03_crear_cuenta.js --parametros=<JSON fuera del repositorio> --tipo=instalador   (antes de 01)',
  '  node database/instalacion/03_crear_cuenta.js --parametros=<JSON fuera del repositorio> --tipo=aplicacion   (después de 02)',
  'Pide de forma oculta la contraseña del administrador de MySQL. La de la cuenta nueva la genera MySQL y',
  'solo se escribe en el archivo de credenciales protegido indicado en los parámetros; nunca se muestra.'
].join('\n');

// Programa completo con dependencias inyectables: argv, leerArchivo, preguntar, preguntarOculto,
// conectar({host, puerto, usuario, base?, contrasena}), archivos, salida.
// Códigos: 0 bien, 1 detenido (se informa del estado), 2 estado incierto.
const ejecutar = async ({ argv, leerArchivo, preguntar, preguntarOculto, conectar, archivos, salida, repositorio = DIR_REPOSITORIO }) => {
  const decir = (t) => salida.write(`${t}\n`);
  let con; let conCuenta;
  let archivoCreado = false; let secretoEscrito = false; let cuentaCreada = false; let ruta = null; let partialRevokes = null;
  try {
    const args = leerArgumentos(argv, { valores: ['parametros', 'tipo'], banderas: ['ayuda'] }, AYUDA);
    if (args.ayuda) { decir(AYUDA); return 0; }
    if (!args.parametros || !['instalador', 'aplicacion'].includes(args.tipo)) throw new ErrorInstalacion(`Faltan --parametros o --tipo=instalador|aplicacion.\n${AYUDA}`);
    const p = cargarParametros(args.parametros, leerArchivo, repositorio);
    const tipo = args.tipo;
    const cuenta = p.cuentas[tipo];
    const base = p.conexion.base;
    ruta = cuenta.credenciales;
    if (archivos.existe(ruta)) throw new ErrorInstalacion('El archivo de credenciales ya existe: no se sobrescribe. No se ha modificado nada.');
    if (!archivos.directorioExiste(path.dirname(ruta))) throw new ErrorInstalacion('La carpeta del archivo de credenciales no existe. No se ha modificado nada.');

    decir(`Cuenta de ${tipo === 'instalador' ? 'INSTALACIÓN' : 'la APLICACIÓN'}: ${cuenta.usuario}@${cuenta.host} sobre la base ${base}`);
    decir(`Servidor esperado: puerto ${p.identidad.puerto}, server_uuid ${p.identidad.server_uuid}`);
    decir(`Privilegios: ${PRIVILEGIOS[tipo].base.join(', ')} sobre ${base}.*${PRIVILEGIOS[tipo].tablas.map(([t, x]) => `; ${x} sobre ${base}.${t}`).join('')}`);
    const confirmacion = await preguntar(`Para continuar escriba el nombre de la base (${base}): `);
    if (String(confirmacion).trim() !== base) throw new ErrorInstalacion('Confirmación incorrecta. No se ha modificado nada.');

    const claveAdmin = await preguntarOculto(`Contraseña del administrador de MySQL ${p.administrador} (no se muestra): `);
    try {
      con = await conectar({ host: p.conexion.host, puerto: p.conexion.puerto, usuario: p.administrador, contrasena: claveAdmin });
    } catch (e) {
      throw errorSeguro(e, 'No se pudo conectar como administrador de MySQL. No se ha modificado nada');
    }
    try {
      await comprobarIdentidad(con, p.identidad);
      ({ partialRevokes } = await comprobarPrevio(con, { tipo, base, cuenta }));
    } catch (e) {
      throw errorSeguro(e, 'Comprobaciones previas fallidas. No se ha modificado nada');
    }
    decir(`partial_revokes=${partialRevokes ? 'ON' : 'OFF'}: el GRANT de base usará ${baseParaGrant(base, partialRevokes)}.`);

    // 1) Archivo vacío, exclusivo y restringido ANTES de tocar MySQL
    try {
      archivos.crearProtegido(ruta);
      archivoCreado = true;
    } catch (e) {
      throw errorSeguro(e, 'No se pudo crear y restringir el archivo de credenciales. No se ha modificado nada en MySQL');
    }

    // 2) Cuenta con contraseña generada por MySQL (en memoria). CREATE USER es atómico.
    let contenido = null; let contrasena = null;
    try {
      const [resultado] = await con.query(`CREATE USER ${cuentaSql(cuenta)} IDENTIFIED BY RANDOM PASSWORD PASSWORD EXPIRE NEVER`);
      cuentaCreada = true;
      contrasena = resultado?.[0]?.['generated password'];
      contenido = serializarCredenciales(cuenta.usuario, contrasena);
      for (let k = 1; !contenido && k < INTENTOS_CONTRASENA; k++) {
        const [otro] = await con.query(`ALTER USER ${cuentaSql(cuenta)} IDENTIFIED BY RANDOM PASSWORD`);
        contrasena = otro?.[0]?.['generated password'];
        contenido = serializarCredenciales(cuenta.usuario, contrasena);
      }
    } catch (e) {
      if (esConexionPerdida(e)) throw errorSeguro(e, `Se perdió la conexión al crear la cuenta: estado INCIERTO (la cuenta ${cuenta.usuario} puede existir). No se intenta ninguna reversión`);
      throw errorSeguro(e, cuentaCreada
        ? `La cuenta ${cuenta.usuario} EXISTE pero no se pudo fijar una contraseña guardable. No se borra automáticamente`
        : 'MySQL rechazó CREATE USER: la cuenta no se ha creado');
    }
    if (!contenido) throw new ErrorInstalacion(`La cuenta ${cuenta.usuario} EXISTE pero su contraseña generada no se puede guardar de forma segura. No se borra automáticamente: retírela (desmontaje del ensayo o DROP USER con autorización).`);

    // 3) Secreto al archivo protegido; comprobación de ida y vuelta
    try {
      archivos.escribirProtegido(ruta, contenido);
      secretoEscrito = true;
    } catch (e) {
      throw errorSeguro(e, `La cuenta ${cuenta.usuario} EXISTE pero no se pudo guardar su contraseña. No se borra automáticamente`);
    }
    contenido = null;

    // 4) Privilegios mínimos
    try {
      const priv = PRIVILEGIOS[tipo];
      await con.query(`GRANT ${priv.base.join(', ')} ON ${baseParaGrant(base, partialRevokes)}.* TO ${cuentaSql(cuenta)}`);
      for (const [t, x] of priv.tablas) await con.query(`GRANT ${x} ON \`${base}\`.\`${t}\` TO ${cuentaSql(cuenta)}`);
    } catch (e) {
      throw errorSeguro(e, `La cuenta ${cuenta.usuario} EXISTE con privilegios INCOMPLETOS${esConexionPerdida(e) ? ' o inciertos' : ''}. No se borra automáticamente`);
    }

    // 5) Verificación exacta (administrador) y funcional (la propia cuenta)
    try {
      await verificarPrivilegios(con, { tipo, base, cuenta, partialRevokes });
      conCuenta = await conectar({ host: p.conexion.host, puerto: p.conexion.puerto, usuario: cuenta.usuario, base, contrasena });
      await comprobarIdentidad(conCuenta, p.identidad, base);
      await verificarFuncional(conCuenta, { tipo, cuenta });
    } catch (e) {
      const aviso = `La cuenta ${cuenta.usuario} EXISTE pero su verificación FALLÓ. No se usa ni se borra automáticamente`;
      if (e instanceof ErrorInstalacion) throw new ErrorInstalacion(`${aviso}: ${e.message}`, { incierto: !!e.incierto });
      throw errorSeguro(e, aviso);
    }
    contrasena = null;
    decir(`CUENTA CREADA Y VERIFICADA: ${cuenta.usuario}@${cuenta.host}. Credenciales en ${ruta} (restringido; no se muestran).`);
    decir(tipo === 'instalador' ? 'Siguiente paso: ejecutar_sql.js --script=01_esquema.sql --cuenta=instalador.' : 'Siguiente paso: ejecutar_sql.js --script=04_verificar.sql --cuenta=aplicacion.');
    return 0;
  } catch (e) {
    // El archivo VACÍO (sin secreto) es nuestro y no sirve: se retira. Un archivo con secreto se conserva
    // porque la cuenta existe y es la única forma de usarla o retirarla con conocimiento.
    if (archivoCreado && !secretoEscrito) { try { archivos.borrar(ruta); } catch { /* se informa abajo */ } }
    const seguro = errorSeguro(e, 'Error inesperado; no se muestra el detalle');
    decir(`DETENIDO: ${seguro.message}`);
    if (cuentaCreada) decir(`ESTADO: la cuenta existe${secretoEscrito ? ` y su contraseña está en ${ruta}` : ' SIN contraseña guardada'}. No se ha borrado nada.`);
    return seguro.incierto ? 2 : 1;
  } finally {
    if (conCuenta) await conCuenta.end().catch(() => {});
    if (con) await con.end().catch(() => {});
  }
};

module.exports = { PRIVILEGIOS, nombreGrant, baseParaGrant, cuentaSql, comprobarPrevio, verificarPrivilegios, verificarFuncional, ejecutar, AYUDA };
