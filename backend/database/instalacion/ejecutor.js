'use strict';
// =====================================================================================
// Pansys - INSTALACIÓN LIMPIA: ejecución controlada de 01_esquema.sql y 04_verificar.sql
// =====================================================================================
// Sustituye a «mysql ... < archivo» (en Windows PowerShell 5.1 «<» no existe y la tubería «|»
// recodifica el texto y estropea los acentos de los COMMENT). Aquí:
//  - el script se lee como bytes UTF-8 y debe coincidir con el SHA-256 APROBADO de los parámetros;
//  - la contraseña de la cuenta se lee de su archivo de credenciales protegido (nunca se muestra);
//  - antes de la primera sentencia se comprueba la identidad POSITIVA del servidor y la base, y se
//    definen @pansys_uuid, @pansys_puerto y @pansys_datadir, que la compuerta de identidad del
//    propio script vuelve a comprobar dentro de MySQL;
//  - las sentencias se envían de una en una; la primera que falla detiene todo y se informa de su
//    número, su línea, su código y (si es una compuerta) su texto «ABORTAR: ...» tomado del propio
//    script. Nunca se muestra el mensaje de MySQL (en 8.0.44 el 3141 solo dice «Invalid value»).
//  - Si se pierde la conexión, el estado de la última sentencia es INCIERTO (código 2) y no se hace
//    nada más: ninguna reversión automática.
// =====================================================================================
const crypto = require('crypto');
const path = require('path');
const {
  ErrorInstalacion, DIR_REPOSITORIO, SCRIPTS_SQL, errorSeguro, esConexionPerdida, cargarParametros,
  leerArgumentos, comprobarIdentidad, leerCredenciales
} = require('./comun');

// Parte un script en sentencias terminadas en «;», respetando comillas ('...', "..." y `...`, con
// escapes \ y comillas dobladas) y comentarios (-- , # y /* */). Devuelve { sql, linea } con la
// línea (1..n) donde empieza cada sentencia. No admite DELIMITER (los scripts no lo usan).
const partirSentencias = (texto) => {
  const sentencias = [];
  let actual = '';
  let linea = 1;
  let inicio = null;
  let i = 0;
  const n = texto.length;
  const empezar = () => { if (inicio === null) inicio = linea; };
  while (i < n) {
    const c = texto[i];
    const sig = texto[i + 1];
    if (c === '\n') { linea++; actual += c; i++; continue; }
    if (c === '-' && sig === '-' && (i + 2 >= n || /\s/.test(texto[i + 2]))) {
      while (i < n && texto[i] !== '\n') i++;
      continue;
    }
    if (c === '#') { while (i < n && texto[i] !== '\n') i++; continue; }
    if (c === '/' && sig === '*') {
      i += 2;
      while (i < n && !(texto[i] === '*' && texto[i + 1] === '/')) { if (texto[i] === '\n') linea++; i++; }
      if (i >= n) throw new ErrorInstalacion('El script tiene un comentario /* sin cerrar.');
      i += 2; actual += ' ';
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      empezar();
      const cierre = c;
      actual += c; i++;
      let cerrado = false;
      while (i < n) {
        const d = texto[i];
        if (d === '\n') linea++;
        if (d === '\\' && cierre !== '`') { actual += d + (texto[i + 1] ?? ''); if (texto[i + 1] === '\n') linea++; i += 2; continue; }
        if (d === cierre) {
          if (texto[i + 1] === cierre) { actual += d + d; i += 2; continue; }
          actual += d; i++; cerrado = true; break;
        }
        actual += d; i++;
      }
      if (!cerrado) throw new ErrorInstalacion(`El script tiene una cadena o identificador sin cerrar (línea ${inicio}).`);
      continue;
    }
    if (c === ';') {
      const sql = actual.trim();
      if (sql) sentencias.push({ sql, linea: inicio });
      actual = ''; inicio = null; i++;
      continue;
    }
    if (!/\s/.test(c)) empezar();
    actual += c; i++;
  }
  if (actual.trim()) throw new ErrorInstalacion(`El script termina sin «;» (sentencia de la línea ${inicio}).`);
  return sentencias;
};

const esCambio = (sql) => /^(CREATE|ALTER|INSERT|UPDATE|DELETE|DROP|GRANT|REVOKE|RENAME|TRUNCATE)\b/i.test(sql);
const textoCompuerta = (sql) => {
  const m = /'(ABORTAR:[^']{1,200})'/.exec(sql);
  return m ? m[1] : null;
};
const formatearFila = (f) => Object.entries(f).map(([k, v]) => `${k}=${Buffer.isBuffer(v) ? v.toString('hex') : v}`).join(' | ');

// Ejecuta las sentencias en orden. Devuelve { ok, codigo, ejecutadas } y escribe el informe en salida.
const ejecutarSentencias = async (con, sentencias, decir) => {
  let cambios = false;
  for (let k = 0; k < sentencias.length; k++) {
    const { sql, linea } = sentencias[k];
    try {
      const [resultado] = await con.query(sql);
      if (Array.isArray(resultado)) resultado.forEach(f => decir(`  ${formatearFila(f)}`));
      if (esCambio(sql)) cambios = true;
    } catch (e) {
      const codigo = e && typeof e.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(e.code) ? e.code : 'desconocido';
      const errno = Number.isInteger(e?.errno) ? e.errno : '?';
      const donde = `sentencia ${k + 1} de ${sentencias.length} (línea ${linea})`;
      if (esConexionPerdida(e)) {
        decir(`INCIERTO: se perdió la conexión en la ${donde}, código ${codigo}. No se hace nada más; revise el estado con 04_verificar.sql o el desmontaje (solo ensayo).`);
        return { ok: false, codigo: 2, ejecutadas: k };
      }
      const compuerta = errno === 3141 ? textoCompuerta(sql) : null;
      decir(`DETENIDO en la ${donde}: código ${codigo} (errno ${errno})${compuerta ? `. Compuerta: ${compuerta}` : ''}.`);
      decir(cambios || esCambio(sql)
        ? 'ESTADO: el script ya había modificado la base (DDL sin vuelta atrás). NO lo repita sobre ella: vea «Fallos y recuperación» en INSTALACION.md.'
        : 'ESTADO: no se ha modificado nada (se detuvo antes de cualquier cambio).');
      return { ok: false, codigo: 1, ejecutadas: k };
    }
  }
  return { ok: true, codigo: 0, ejecutadas: sentencias.length };
};

const AYUDA = [
  'Uso (desde backend/):',
  '  node database/instalacion/ejecutar_sql.js --parametros=<JSON fuera del repositorio> --script=01_esquema.sql --cuenta=instalador',
  '  node database/instalacion/ejecutar_sql.js --parametros=<JSON fuera del repositorio> --script=04_verificar.sql --cuenta=aplicacion',
  '01_esquema.sql solo con la cuenta de instalación. 04_verificar.sql con la de instalación o la de la aplicación.'
].join('\n');

// Programa completo con dependencias inyectables: argv, leerArchivo(ruta) -> texto,
// leerBytes(ruta) -> Buffer, archivos (credenciales), conectar({...}), salida.
const ejecutar = async ({ argv, leerArchivo, leerBytes, archivos, conectar, salida, repositorio = DIR_REPOSITORIO, dirScripts = __dirname }) => {
  const decir = (t) => salida.write(`${t}\n`);
  let con;
  try {
    const args = leerArgumentos(argv, { valores: ['parametros', 'script', 'cuenta'], banderas: ['ayuda'] }, AYUDA);
    if (args.ayuda) { decir(AYUDA); return 0; }
    if (!args.parametros || !args.script || !args.cuenta) throw new ErrorInstalacion(`Faltan argumentos.\n${AYUDA}`);
    if (!SCRIPTS_SQL.includes(args.script)) throw new ErrorInstalacion(`Script no admitido: solo ${SCRIPTS_SQL.join(' o ')}.`);
    if (!['instalador', 'aplicacion'].includes(args.cuenta)) throw new ErrorInstalacion('--cuenta debe ser instalador o aplicacion.');
    if (args.script === '01_esquema.sql' && args.cuenta !== 'instalador') throw new ErrorInstalacion('01_esquema.sql solo se ejecuta con la cuenta de instalación.');
    const p = cargarParametros(args.parametros, leerArchivo, repositorio);
    const bytes = leerBytes(path.join(dirScripts, args.script));
    const huella = crypto.createHash('sha256').update(bytes).digest('hex');
    if (huella !== p.sha256[args.script]) {
      throw new ErrorInstalacion(`${args.script} no coincide con el SHA-256 aprobado en los parámetros (actual ${huella}). No se ha modificado nada.`);
    }
    const sentencias = partirSentencias(bytes.toString('utf8'));
    const cuenta = p.cuentas[args.cuenta];
    decir(`Script ${args.script} | SHA-256 ${huella} | ${sentencias.length} sentencias`);
    decir(`Destino: ${cuenta.usuario}@${p.conexion.host}:${p.conexion.puerto} / base ${p.conexion.base} / servidor ${p.identidad.server_uuid}`);

    const clave = leerCredenciales(archivos, cuenta.credenciales, cuenta.usuario);
    try {
      con = await conectar({ host: p.conexion.host, puerto: p.conexion.puerto, usuario: cuenta.usuario, base: p.conexion.base, contrasena: clave });
    } catch (e) {
      throw errorSeguro(e, 'No se pudo conectar a MySQL. No se ha modificado nada');
    }
    try {
      await comprobarIdentidad(con, p.identidad, p.conexion.base);
      await con.execute('SET @pansys_uuid = ?, @pansys_puerto = ?, @pansys_datadir = ?', [p.identidad.server_uuid, p.identidad.puerto, p.identidad.datadir]);
    } catch (e) {
      throw errorSeguro(e, 'No se pudo verificar la identidad del servidor. No se ha modificado nada');
    }
    decir('Identidad verificada (puerto, server_uuid, datadir y base).');
    const r = await ejecutarSentencias(con, sentencias, decir);
    if (r.ok) decir(`COMPLETADO: ${r.ejecutadas} sentencias sin errores.`);
    return r.codigo;
  } catch (e) {
    const seguro = errorSeguro(e, 'Error inesperado; no se muestra el detalle. No se ha modificado nada');
    decir(`DETENIDO: ${seguro.message}`);
    return seguro.incierto ? 2 : 1;
  } finally {
    if (con) await con.end().catch(() => {});
  }
};

module.exports = { partirSentencias, ejecutarSentencias, textoCompuerta, ejecutar, AYUDA };
