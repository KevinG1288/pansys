'use strict';
// =====================================================================================
// Pansys - INSTALACIÓN LIMPIA: lógica del paso 2 (dos panaderías y sus dos administradores)
// =====================================================================================
// La usa 02_instalar_panaderias.js. Todas las dependencias externas (conexión MySQL, lectura oculta,
// bcrypt, archivos, salida) se reciben por parámetro para poder probarla sin MySQL
// (pruebas/instalacion.unitarias.js).
//
// Reglas de seguridad:
//  - Contraseñas de los administradores: solo de una terminal interactiva, sin eco. Nunca de
//    argumentos, variables de entorno, archivos ni tuberías. Solo se guarda su hash bcrypt.
//  - La contraseña de la cuenta MySQL de instalación se lee de su archivo de credenciales
//    protegido (lo creó 03_crear_cuenta.js); nunca se muestra.
//  - Nada se escribe en disco. La salida nunca contiene contraseñas, hashes ni el texto de los
//    errores de MySQL (que podría incluir valores): solo su código.
//  - Identidad POSITIVA del servidor (puerto, server_uuid y datadir de los parámetros) y base exacta.
//  - Solo actúa sobre una base con el esquema exacto de 01_esquema.sql (17 tablas InnoDB, claves y
//    CHECK), con los 3 roles y TODAS las demás tablas vacías, en una sesión con modo estricto.
//  - Todo el alta va en UNA transacción: o quedan las dos panaderías con sus dos administradores, o
//    no queda nada (ROLLBACK). Si falla el propio COMMIT, el estado es INCIERTO y no se toca nada más.
// =====================================================================================
const { validarContrasenaNueva } = require('../../src/utils/contrasenas');
const ROLES = require('../../src/config/roles');
const {
  ErrorInstalacion, DIR_REPOSITORIO, NUMERO_PANADERIAS, errorSeguro, esConexionPerdida, cargarParametros, leerArgumentos,
  comprobarIdentidad, leerCredenciales
} = require('./comun');

// Las 17 tablas de 01_esquema.sql
const TABLAS = Object.freeze([
  'roles', 'usuarios', 'panaderias', 'materia_prima', 'productos', 'ventas', 'detalle_ventas',
  'receta_producto', 'orden_produccion', 'insumo_usado', 'restablecimientos_contrasena', 'eventos_seguridad',
  'red_parejas', 'solicitudes_red', 'solicitudes_red_detalle', 'movimientos_red', 'eventos_red'
]);
const CLAVES_FORANEAS = 41;
const CHECKS = 32;
const ROLES_ESPERADOS = Object.freeze([
  { id: ROLES.ADMINISTRADOR, nombre: 'administrador' },
  { id: ROLES.PANADERO, nombre: 'panadero' },
  { id: ROLES.GERENTE, nombre: 'gerente' }
]);
const COSTE_BCRYPT = 12;

// Política de la aplicación (8 caracteres a 72 bytes, letra y número), confirmación igual, las dos
// contraseñas distintas entre sí y ninguna que contenga la parte local del correo.
const validarContrasenas = (pares, emails) => {
  if (!Array.isArray(pares) || pares.length !== NUMERO_PANADERIAS) throw new ErrorInstalacion('Se necesitan exactamente dos contraseñas.');
  pares.forEach(([contrasena, confirmacion], i) => {
    const quien = `La contraseña del administrador ${i + 1}`;
    try {
      validarContrasenaNueva(contrasena, quien);
    } catch (e) {
      throw new ErrorInstalacion(`${e.message}.`);
    }
    if (contrasena !== confirmacion) throw new ErrorInstalacion(`${quien} y su confirmación no coinciden.`);
    const local = String(emails[i]).split('@')[0].toLowerCase();
    if (local.length >= 4 && contrasena.toLowerCase().includes(local)) throw new ErrorInstalacion(`${quien} no puede contener su correo.`);
  });
  if (pares[0][0] === pares[1][0]) throw new ErrorInstalacion('Los dos administradores deben tener contraseñas diferentes.');
};

const filas = async (con, sql, params = []) => {
  const [resultado] = await con.execute(sql, params);
  return resultado;
};
const numero = async (con, sql, params = []) => Number((await filas(con, sql, params))[0].n);

// Comprueba que el destino es exactamente el esperado y tiene el esquema de 01_esquema.sql sin datos
// (solo lectura)
const comprobarDestino = async (con, { base, identidad }) => {
  await comprobarIdentidad(con, identidad, base);
  const [modo] = await filas(con, 'SELECT @@SESSION.sql_mode AS m, @@SESSION.autocommit AS a');
  if (!String(modo?.m ?? '').split(',').includes('STRICT_TRANS_TABLES')) {
    throw new ErrorInstalacion('La sesión no tiene STRICT_TRANS_TABLES. No se ha modificado nada.');
  }
  const tablas = (await filas(con, "SELECT TABLE_NAME AS t, ENGINE AS e, TABLE_TYPE AS y FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()"));
  const nombres = tablas.map(f => f.t).sort();
  if (JSON.stringify(nombres) !== JSON.stringify([...TABLAS].sort())) {
    throw new ErrorInstalacion(`La base no tiene exactamente las ${TABLAS.length} tablas de 01_esquema.sql. Ejecute antes ese script en una base nueva. No se ha modificado nada.`);
  }
  if (!tablas.every(f => f.e === 'InnoDB' && f.y === 'BASE TABLE')) {
    throw new ErrorInstalacion('Alguna tabla no es InnoDB: la transacción no podría deshacerse. No se ha modificado nada.');
  }
  const columnas = await numero(con, "SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND ((TABLE_NAME = 'panaderias' AND COLUMN_NAME = 'localidad') OR (TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'version_sesion') OR (TABLE_NAME = 'materia_prima' AND COLUMN_NAME = 'version_fila'))");
  const fks = await numero(con, 'SELECT COUNT(*) AS n FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE()');
  const ciclo = await numero(con, "SELECT COUNT(*) AS n FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND ((TABLE_NAME = 'usuarios' AND CONSTRAINT_NAME = 'usuarios_ibfk_4' AND REFERENCED_TABLE_NAME = 'panaderias') OR (TABLE_NAME = 'panaderias' AND CONSTRAINT_NAME = 'panaderias_ibfk_1' AND REFERENCED_TABLE_NAME = 'usuarios'))");
  const checks = await numero(con, "SELECT COUNT(*) AS n FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_TYPE = 'CHECK' AND ENFORCED = 'YES'");
  if (columnas !== 3 || fks !== CLAVES_FORANEAS || ciclo !== 2 || checks !== CHECKS) {
    throw new ErrorInstalacion('El esquema no coincide con 01_esquema.sql (columnas, claves foráneas o CHECK). No se ha modificado nada.');
  }
  const roles = (await filas(con, 'SELECT id, nombre, estado FROM roles ORDER BY id'))
    .map(r => ({ id: Number(r.id), nombre: r.nombre, estado: Number(r.estado) }));
  if (JSON.stringify(roles) !== JSON.stringify(ROLES_ESPERADOS.map(r => ({ ...r, estado: 1 })))) {
    throw new ErrorInstalacion('La tabla roles no contiene exactamente los tres roles fijos. No se ha modificado nada.');
  }
  for (const t of TABLAS.filter(t => t !== 'roles')) {
    if (await numero(con, `SELECT COUNT(*) AS n FROM \`${t}\``) !== 0) {
      throw new ErrorInstalacion(`La tabla ${t} ya tiene datos: la instalación solo se hace sobre una base recién creada. No se ha modificado nada.`);
    }
  }
};

// Alta en UNA transacción. Orden del ciclo usuarios <-> panaderias:
//   1) administradores con panaderia_id NULL  2) panaderías con su usuario_id  3) asignar panadería.
// hashes: hashes bcrypt ya calculados (nunca contraseñas).
const instalar = async (con, panaderias, hashes) => {
  if (hashes.length !== NUMERO_PANADERIAS || hashes.some(h => !/^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(h))) {
    throw new ErrorInstalacion('Hashes de contraseña no válidos. No se ha modificado nada.');
  }
  const [bloqueo] = await filas(con, "SELECT GET_LOCK(CONCAT('pansys_instalacion:', DATABASE()), 0) AS b");
  if (Number(bloqueo?.b) !== 1) throw new ErrorInstalacion('Otra instalación está en curso sobre esta base. No se ha modificado nada.');
  try {
    await con.beginTransaction();
    try {
      // FOR UPDATE sobre las tablas vacías: bloquea inserciones concurrentes hasta el COMMIT
      if (await numero(con, 'SELECT COUNT(*) AS n FROM usuarios FOR UPDATE') !== 0
        || await numero(con, 'SELECT COUNT(*) AS n FROM panaderias FOR UPDATE') !== 0) {
        throw new ErrorInstalacion('usuarios o panaderias ya tienen datos. No se ha modificado nada.');
      }
      const admins = [];
      for (let i = 0; i < NUMERO_PANADERIAS; i++) {
        const r = await filas(con,
          'INSERT INTO usuarios (email, contrasena, rol_id, panaderia_id, estado, version_sesion, createdAt, updatedAt) VALUES (?, ?, ?, NULL, 1, 0, NOW(), NOW())',
          [panaderias[i].email, hashes[i], ROLES.ADMINISTRADOR]);
        admins.push(r.insertId);
      }
      const ids = [];
      for (let i = 0; i < NUMERO_PANADERIAS; i++) {
        const p = panaderias[i];
        const r = await filas(con,
          'INSERT INTO panaderias (nombre, direccion, localidad, telefono, en_red, usuario_id, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())',
          [p.nombre, p.direccion, p.localidad, p.telefono, p.en_red ? 1 : 0, admins[i]]);
        ids.push(r.insertId);
      }
      for (let i = 0; i < NUMERO_PANADERIAS; i++) {
        const r = await filas(con,
          'UPDATE usuarios SET panaderia_id = ?, updatedAt = NOW() WHERE id = ? AND rol_id = ? AND panaderia_id IS NULL',
          [ids[i], admins[i], ROLES.ADMINISTRADOR]);
        if (r.affectedRows !== 1) throw new ErrorInstalacion('No se pudo asignar la panadería a su administrador. Se deshace todo.');
      }
      // Comprobación dentro de la transacción, antes del COMMIT
      const enlaces = await filas(con,
        'SELECT u.id AS u, u.panaderia_id AS up, p.id AS p FROM usuarios u JOIN panaderias p ON p.usuario_id = u.id WHERE u.rol_id = ? ORDER BY u.id',
        [ROLES.ADMINISTRADOR]);
      const coherente = enlaces.length === NUMERO_PANADERIAS
        && enlaces.every((f, i) => Number(f.u) === admins[i] && Number(f.up) === ids[i] && Number(f.p) === ids[i])
        && await numero(con, 'SELECT COUNT(*) AS n FROM usuarios') === NUMERO_PANADERIAS
        && await numero(con, 'SELECT COUNT(*) AS n FROM panaderias') === NUMERO_PANADERIAS;
      if (!coherente) throw new ErrorInstalacion('La comprobación previa al COMMIT no cuadra. Se deshace todo.');
      try {
        await con.commit();
      } catch (e) {
        const codigo = e && typeof e.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(e.code) ? e.code : 'desconocido';
        throw Object.assign(new ErrorInstalacion(`El COMMIT falló y el resultado es INCIERTO (código ${codigo}): ejecute 04_verificar.sql antes de repetir. No se intenta ninguna reversión.`, { incierto: true }), { enCommit: true });
      }
      return { administradores: admins, panaderias: ids };
    } catch (e) {
      if (e.enCommit) throw e;
      if (e instanceof ErrorInstalacion) {
        await con.rollback().catch(() => {});
        throw e;
      }
      if (esConexionPerdida(e)) {
        // MySQL deshace la transacción no confirmada al perder la conexión, pero no se puede comprobar aquí
        throw errorSeguro(e, 'Se perdió la conexión durante el alta (sin COMMIT): MySQL deshace la transacción, pero verifique con 04_verificar.sql antes de repetir');
      }
      await con.rollback().catch(() => {});
      throw errorSeguro(e, 'MySQL rechazó el alta; se ha deshecho la transacción y no se ha guardado nada');
    }
  } finally {
    await filas(con, "SELECT RELEASE_LOCK(CONCAT('pansys_instalacion:', DATABASE())) AS r").catch(() => {});
  }
};

const AYUDA = [
  'Uso (desde backend/):',
  '  node database/instalacion/02_instalar_panaderias.js --parametros=<JSON FUERA del repositorio>',
  'El JSON (ver parametros.ejemplo.json) no lleva contraseñas. La de la cuenta MySQL de instalación se lee',
  'de su archivo de credenciales protegido; las de los dos administradores se piden de forma oculta, dos veces.'
].join('\n');

// Programa completo con dependencias inyectables:
//   argv, leerArchivo(ruta) -> texto, preguntar(texto) -> respuesta visible, preguntarOculto(texto),
//   archivos (credenciales), conectar({host, puerto, usuario, base, contrasena}) -> conexión
//   mysql2/promise, hashear(c, coste), salida.write(texto).
//   Devuelve el código de salida (0 bien, 1 detenido sin cambios, 2 resultado incierto).
const ejecutar = async ({ argv, leerArchivo, preguntar, preguntarOculto, archivos, conectar, hashear, salida, repositorio = DIR_REPOSITORIO }) => {
  const decir = (t) => salida.write(`${t}\n`);
  let con;
  try {
    const args = leerArgumentos(argv, { valores: ['parametros'], banderas: ['ayuda'] }, AYUDA);
    if (args.ayuda) { decir(AYUDA); return 0; }
    if (!args.parametros) throw new ErrorInstalacion(`Falta --parametros.\n${AYUDA}`);
    const p = cargarParametros(args.parametros, leerArchivo, repositorio);
    const { conexion, panaderias, identidad } = p;
    const cuenta = p.cuentas.instalador;

    decir('Instalación de Pansys: dos panaderías y sus administradores');
    decir(`Destino: ${cuenta.usuario}@${conexion.host}:${conexion.puerto} / base ${conexion.base} / servidor ${identidad.server_uuid}`);
    panaderias.forEach((x, i) => decir(`  Panadería ${i + 1}: ${x.nombre} | ${x.localidad} | en red: ${x.en_red ? 'sí' : 'no'} | administrador: ${x.email}`));
    const confirmacion = await preguntar(`Para continuar escriba el nombre de la base (${conexion.base}): `);
    if (String(confirmacion).trim() !== conexion.base) throw new ErrorInstalacion('Confirmación incorrecta. No se ha modificado nada.');

    const claveMysql = leerCredenciales(archivos, cuenta.credenciales, cuenta.usuario);
    try {
      con = await conectar({ host: conexion.host, puerto: conexion.puerto, usuario: cuenta.usuario, base: conexion.base, contrasena: claveMysql });
    } catch (e) {
      throw errorSeguro(e, 'No se pudo conectar a MySQL. No se ha modificado nada');
    }
    try {
      await comprobarDestino(con, { base: conexion.base, identidad });
    } catch (e) {
      throw errorSeguro(e, 'No se pudo comprobar la base de destino. No se ha modificado nada');
    }
    decir('Destino comprobado: servidor esperado, esquema completo (InnoDB), 3 roles y ninguna otra fila.');

    const pares = [];
    for (let i = 0; i < NUMERO_PANADERIAS; i++) {
      const c1 = await preguntarOculto(`Contraseña del administrador ${i + 1} (${panaderias[i].email}): `);
      const c2 = await preguntarOculto(`Repita la contraseña del administrador ${i + 1}: `);
      pares.push([c1, c2]);
    }
    validarContrasenas(pares, panaderias.map(x => x.email));
    const hashes = [];
    for (const [c] of pares) hashes.push(await hashear(c, COSTE_BCRYPT));
    pares.length = 0;

    const r = await instalar(con, panaderias, hashes);
    decir('INSTALACIÓN COMPLETADA (una sola transacción confirmada):');
    panaderias.forEach((x, i) => decir(`  Panadería ${r.panaderias[i]} "${x.nombre}" -> administrador ${r.administradores[i]} (${x.email})`));
    decir('Siguiente paso: 03_crear_cuenta.js --tipo=aplicacion y después 04_verificar.sql.');
    return 0;
  } catch (e) {
    const seguro = errorSeguro(e, 'Error inesperado; no se muestra el detalle para no revelar datos. No se ha modificado nada');
    decir(`DETENIDO: ${seguro.message}`);
    return seguro.incierto ? 2 : 1;
  } finally {
    if (con) await con.end().catch(() => {});
  }
};

module.exports = {
  ErrorInstalacion, TABLAS, CLAVES_FORANEAS, CHECKS, COSTE_BCRYPT,
  validarContrasenas, comprobarDestino, instalar, ejecutar, AYUDA
};
