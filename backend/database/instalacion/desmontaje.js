'use strict';
// =====================================================================================
// Pansys - INSTALACIÓN LIMPIA: desmontaje del ENSAYO (solo objetos del ensayo)
// =====================================================================================
// Elimina las cuentas y bases creadas en un ensayo de instalación. NUNCA se usa en producción.
// Barreras:
//  - Solo nombres del ensayo (bases pansys_inst_* / pansysxinstx*, cuentas pansys_instalador y
//    pansys_*_ensayo), declarados en el bloque «desmontaje» de los parámetros. Otro nombre: rechazo.
//  - Bases protegidas (p. ej. la del ensayo anterior): deben existir, no pueden coincidir con ningún
//    objeto a eliminar y su huella (CHECKSUM TABLE de todas sus tablas + recuento de tablas) se
//    compara antes y después.
//  - Identidad POSITIVA del servidor (puerto, server_uuid y datadir de los parámetros).
//  - Ninguna sesión ajena usando esas bases o cuentas.
//  - Por defecto SOLO COMPRUEBA (--solo-comprobar). Ejecutar exige --ejecutar y, además, escribir la
//    frase «DESMONTAR <últimos 12 caracteres del server_uuid>».
//  - Se ejecuta objeto a objeto y se verifica cada uno. Ante un error se detiene; si se pierde la
//    conexión, el estado es INCIERTO (código 2) y no se reintenta nada.
// =====================================================================================
const {
  ErrorInstalacion, DIR_REPOSITORIO, errorSeguro, esConexionPerdida, cargarParametros, leerArgumentos,
  comprobarIdentidad
} = require('./comun');

const filas = async (con, sql, params = []) => (await con.execute(sql, params))[0];
const numero = async (con, sql, params = []) => Number((await filas(con, sql, params))[0].n);

// Huella de una base protegida: nº de tablas y CHECKSUM TABLE de cada una (solo lectura)
const huellaBase = async (con, base) => {
  const tablas = (await filas(con, "SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME", [base])).map(f => f.t);
  if (!tablas.length) return JSON.stringify({ tablas: 0 });
  const [sumas] = await con.query(`CHECKSUM TABLE ${tablas.map(t => `\`${base}\`.\`${t}\``).join(', ')}`);
  return JSON.stringify({ tablas: tablas.length, sumas: sumas.map(f => [f.Table, String(f.Checksum)]) });
};

const inventario = async (con, d) => {
  const bases = [];
  for (const b of d.bases) {
    const existe = await numero(con, 'SELECT COUNT(*) AS n FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [b]) === 1;
    const tablas = existe ? await numero(con, 'SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?', [b]) : 0;
    bases.push({ nombre: b, existe, tablas });
  }
  const cuentas = [];
  for (const c of d.cuentas) {
    cuentas.push({ ...c, existe: await numero(con, 'SELECT COUNT(*) AS n FROM mysql.user WHERE User = ? AND Host = ?', [c.usuario, c.host]) === 1 });
  }
  const protegidas = [];
  for (const b of d.protegidas) {
    if (await numero(con, 'SELECT COUNT(*) AS n FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [b]) !== 1) {
      throw new ErrorInstalacion(`La base protegida ${b} no existe en este servidor: no se desmonta nada.`);
    }
    protegidas.push({ nombre: b, huella: await huellaBase(con, b) });
  }
  const marcadores = [...d.bases.map(() => '?')].join(', ') || "''";
  const usuarios = d.cuentas.map(c => c.usuario);
  const ajenas = await numero(con,
    `SELECT COUNT(*) AS n FROM information_schema.PROCESSLIST WHERE ID <> CONNECTION_ID() AND (DB IN (${marcadores}) OR USER IN (${usuarios.map(() => '?').join(', ') || "''"}))`,
    [...d.bases, ...usuarios]);
  return { bases, cuentas, protegidas, ajenas };
};

const AYUDA = [
  'Uso (desde backend/), SOLO en el ensayo:',
  '  node database/instalacion/desmontar_ensayo.js --parametros=<JSON fuera del repositorio> --solo-comprobar',
  '  node database/instalacion/desmontar_ensayo.js --parametros=<JSON fuera del repositorio> --ejecutar',
  'Los objetos salen del bloque «desmontaje» de los parámetros. Pide de forma oculta la contraseña del',
  'administrador de MySQL y, para ejecutar, la frase DESMONTAR <últimos 12 caracteres del server_uuid>.'
].join('\n');

const ejecutar = async ({ argv, leerArchivo, preguntar, preguntarOculto, conectar, archivos, salida, repositorio = DIR_REPOSITORIO }) => {
  const decir = (t) => salida.write(`${t}\n`);
  let con;
  const hecho = [];
  try {
    const args = leerArgumentos(argv, { valores: ['parametros'], banderas: ['ayuda', 'solo-comprobar', 'ejecutar'] }, AYUDA);
    if (args.ayuda) { decir(AYUDA); return 0; }
    if (!args.parametros || !!args['solo-comprobar'] === !!args.ejecutar) throw new ErrorInstalacion(`Indique --parametros y exactamente uno de --solo-comprobar o --ejecutar.\n${AYUDA}`);
    const p = cargarParametros(args.parametros, leerArchivo, repositorio);
    const d = p.desmontaje;
    if (!d) throw new ErrorInstalacion('Los parámetros no tienen bloque «desmontaje». No se ha modificado nada.');

    const claveAdmin = await preguntarOculto(`Contraseña del administrador de MySQL ${p.administrador} (no se muestra): `);
    try {
      con = await conectar({ host: p.conexion.host, puerto: p.conexion.puerto, usuario: p.administrador, contrasena: claveAdmin });
    } catch (e) {
      throw errorSeguro(e, 'No se pudo conectar como administrador de MySQL. No se ha modificado nada');
    }
    let inv;
    try {
      await comprobarIdentidad(con, p.identidad);
      inv = await inventario(con, d);
    } catch (e) {
      throw errorSeguro(e, 'Comprobaciones previas fallidas. No se ha modificado nada');
    }
    decir(`Servidor verificado: puerto ${p.identidad.puerto}, server_uuid ${p.identidad.server_uuid}`);
    inv.cuentas.forEach(c => decir(`  Cuenta ${c.usuario}@${c.host}: ${c.existe ? 'EXISTE -> se eliminaría' : 'no existe'}`));
    inv.bases.forEach(b => decir(`  Base ${b.nombre}: ${b.existe ? `EXISTE (${b.tablas} tablas) -> se eliminaría` : 'no existe'}`));
    inv.protegidas.forEach(b => decir(`  Protegida ${b.nombre}: existe; huella registrada`));
    if (inv.ajenas) throw new ErrorInstalacion(`Hay ${inv.ajenas} sesiones ajenas usando esas bases o cuentas. No se ha modificado nada.`);
    if (args['solo-comprobar']) { decir('SOLO COMPROBACIÓN: no se ha modificado nada.'); return 0; }

    const frase = `DESMONTAR ${p.identidad.server_uuid.slice(-12)}`;
    const respuesta = await preguntar(`Para eliminar lo marcado escriba exactamente: ${frase}\n> `);
    if (String(respuesta).trim() !== frase) throw new ErrorInstalacion('Frase de autorización incorrecta. No se ha modificado nada.');

    // Revalidación inmediata (identidad) antes del primer cambio
    await comprobarIdentidad(con, p.identidad);
    for (const c of inv.cuentas.filter(x => x.existe)) {
      const objeto = `cuenta ${c.usuario}@${c.host}`;
      try {
        await con.query(`DROP USER '${c.usuario}'@'${c.host}'`);
      } catch (e) {
        throw errorSeguro(e, `Fallo al eliminar la ${objeto}${esConexionPerdida(e) ? ' (estado INCIERTO)' : ''}. Hecho hasta ahora: ${hecho.join(', ') || 'nada'}`);
      }
      if (await numero(con, 'SELECT COUNT(*) AS n FROM mysql.user WHERE User = ? AND Host = ?', [c.usuario, c.host]) !== 0) {
        throw new ErrorInstalacion(`La ${objeto} sigue existiendo tras DROP USER. Hecho hasta ahora: ${hecho.join(', ') || 'nada'}.`);
      }
      hecho.push(objeto);
    }
    for (const b of inv.bases.filter(x => x.existe)) {
      const objeto = `base ${b.nombre}`;
      try {
        await con.query(`DROP DATABASE \`${b.nombre}\``);
      } catch (e) {
        throw errorSeguro(e, `Fallo al eliminar la ${objeto}${esConexionPerdida(e) ? ' (estado INCIERTO)' : ''}. Hecho hasta ahora: ${hecho.join(', ') || 'nada'}`);
      }
      if (await numero(con, 'SELECT COUNT(*) AS n FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [b.nombre]) !== 0) {
        throw new ErrorInstalacion(`La ${objeto} sigue existiendo tras DROP DATABASE. Hecho hasta ahora: ${hecho.join(', ') || 'nada'}.`);
      }
      hecho.push(objeto);
    }
    // Archivos de credenciales de las cuentas eliminadas (fuera del repositorio, declarados en cuentas)
    for (const c of inv.cuentas.filter(x => x.existe)) {
      for (const tipo of ['instalador', 'aplicacion']) {
        const cu = p.cuentas[tipo];
        if (cu.usuario === c.usuario && cu.host === c.host && archivos.existe(cu.credenciales)) {
          archivos.borrar(cu.credenciales);
          hecho.push(`credenciales de ${tipo}`);
        }
      }
    }
    for (const b of inv.protegidas) {
      if (await huellaBase(con, b.nombre) !== b.huella) throw new ErrorInstalacion(`ALTO: la huella de la base protegida ${b.nombre} ha CAMBIADO. Hecho: ${hecho.join(', ')}.`);
    }
    decir(`DESMONTAJE COMPLETADO: ${hecho.join(', ') || 'no había nada que eliminar'}. Bases protegidas con la misma huella.`);
    return 0;
  } catch (e) {
    const seguro = errorSeguro(e, 'Error inesperado; no se muestra el detalle');
    decir(`DETENIDO: ${seguro.message}`);
    return seguro.incierto ? 2 : 1;
  } finally {
    if (con) await con.end().catch(() => {});
  }
};

module.exports = { huellaBase, inventario, ejecutar, AYUDA };
