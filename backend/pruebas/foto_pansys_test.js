// Foto de solo lectura de pansys_test, para comparar el estado antes y después de ejecutar una
// suite o una verificación. No modifica nada: la sesión es READ ONLY (MySQL rechaza cualquier
// escritura) y solo se envían SELECT, CHECKSUM TABLE y ROLLBACK.
//
// Uso (desde backend/, PowerShell). DB_NAME debe fijarse en la terminal: el script no lo cambia
// por su cuenta y aborta si no es exactamente pansys_test.
//   $env:DB_NAME = 'pansys_test'; node pruebas/foto_pansys_test.js --guardar <archivo.json>
//   node pruebas/foto_pansys_test.js --comparar <antes.json> <despues.json>     (sin conexión)
// El archivo de --guardar debe estar FUERA del repositorio y no puede existir ya.
//
// Qué captura, por tabla: número de filas, id mínimo y máximo, dos agregados de CRC32 por fila
// (BIT_XOR y SUM, calculados en MySQL sobre todas las columnas), CHECKSUM TABLE y el esquema
// (columnas, tipos y nulabilidad). Además, las columnas no sensibles de las cuentas 1-4 y de las
// panaderías 1-2, y si existen las tablas del SQL 005.
//
// Qué NO captura: hashes de contraseñas (de las cuentas 1-4 solo se guarda si la contraseña es la
// de la semilla '!', calculado en MySQL), secretos ni valores del .env. La columna contrasena solo
// entra, junto con las demás, en el CRC32 de cada fila, y únicamente se guardan agregados de toda
// la tabla (32 bits por fila combinados): no se puede recuperar ningún hash a partir de ellos.
//
// LIMITACIONES: que dos fotos coincidan NO garantiza que los datos sean idénticos.
// - CRC32 y CHECKSUM TABLE son sumas de comprobación, no comparaciones fila a fila: dos estados
//   distintos pueden coincidir (colisiones), aunque es improbable que coincidan a la vez el
//   recuento, los id extremos, BIT_XOR, SUM y CHECKSUM TABLE.
// - CHECKSUM TABLE depende del formato de fila y de la versión de MySQL, y no se lee dentro de la
//   instantánea consistente de la transacción: compare solo fotos del mismo servidor y con la
//   base sin actividad (demo detenida).
// - Los valores se convierten a texto en MySQL (CAST AS CHAR): diferencias por debajo de esa
//   representación (p. ej., en columnas FLOAT) pueden no detectarse.
// - No incluye AUTO_INCREMENT (avanza legítimamente con filas temporales), índices, triggers,
//   privilegios ni otras bases.
// Una diferencia sí indica, con certeza, que algo cambió.

const fs = require('fs');
const path = require('path');

const BASE = 'pansys_test';
const TABLAS = [
  'roles', 'usuarios', 'panaderias', 'materia_prima', 'productos', 'ventas',
  'detalle_ventas', 'receta_producto', 'orden_produccion', 'insumo_usado'
];
const TABLAS_OPCIONALES = ['eventos_seguridad', 'restablecimientos_contrasena'];
const RAIZ_REPOSITORIO = path.resolve(__dirname, '..', '..');
const VERSION_FOTO = 1;

class ErrorFoto extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'ErrorFoto';
  }
}

const identificadorValido = (nombre) => typeof nombre === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(nombre);
const texto = (valor) => (valor === null || valor === undefined ? null : String(valor));

// Conexión real: base literal y números grandes como texto (CHECKSUM y BIT_XOR son BIGINT)
const crearConexionMysql = (env) => require('mysql2/promise').createConnection({
  host: env.DB_HOST,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: BASE,
  supportBigNumbers: true,
  bigNumberStrings: true,
  dateStrings: true
});

// Toma la foto con una conexión ya abierta. Solo lectura: la transacción es READ ONLY y al final
// se deshace. Lanza ErrorFoto si la base no es pansys_test.
const capturar = async (conexion) => {
  const consultar = async (sql, params) => (await conexion.query(sql, params))[0];

  await consultar('SET SESSION TRANSACTION READ ONLY');
  await consultar('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
  try {
    const base = (await consultar('SELECT DATABASE() AS base'))?.[0]?.base;
    if (base !== BASE) throw new ErrorFoto(`La conexión está en "${base}": se esperaba ${BASE}`);

    const existentes = (await consultar(
      'SELECT TABLE_NAME AS tabla FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?)',
      [BASE, [...TABLAS, ...TABLAS_OPCIONALES]]
    )).map(f => f.tabla);
    const faltan = TABLAS.filter(t => !existentes.includes(t));
    if (faltan.length) throw new ErrorFoto(`Faltan tablas en ${BASE}: ${faltan.join(', ')}`);
    const tablas = [...TABLAS, ...TABLAS_OPCIONALES.filter(t => existentes.includes(t))];

    const columnas = await consultar(
      `SELECT TABLE_NAME AS tabla, COLUMN_NAME AS columna, COLUMN_TYPE AS tipo, IS_NULLABLE AS nulable
       FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?)
       ORDER BY TABLE_NAME, ORDINAL_POSITION`,
      [BASE, tablas]
    );

    const foto = {
      version: VERSION_FOTO,
      base: BASE,
      tomada_en: new Date().toISOString(),
      opcionales: Object.fromEntries(TABLAS_OPCIONALES.map(t => [t, existentes.includes(t)])),
      esquema: {},
      tablas: {}
    };

    for (const t of tablas) {
      const cols = columnas.filter(c => c.tabla === t);
      if (!cols.length || !cols.every(c => identificadorValido(c.columna))) {
        throw new ErrorFoto(`Columnas no válidas o ausentes en ${t}`);
      }
      foto.esquema[t] = cols.map(c => `${c.columna} ${c.tipo} ${c.nulable === 'YES' ? 'NULL' : 'NOT NULL'}`);
      // CRC32 de cada fila sobre todas sus columnas (NULL distinto de texto vacío); solo se
      // devuelven agregados de la tabla
      const fila = `CONCAT_WS(CHAR(31), ${cols.map(c => `IFNULL(CAST(\`${c.columna}\` AS CHAR), '<NULL>')`).join(', ')})`;
      const [agregado] = await consultar(
        `SELECT COUNT(*) AS filas, MIN(id) AS id_min, MAX(id) AS id_max,
                BIT_XOR(CRC32(${fila})) AS xor_crc, SUM(CRC32(${fila})) AS suma_crc
         FROM ${BASE}.\`${t}\``
      );
      foto.tablas[t] = {
        filas: Number(agregado.filas),
        id_min: texto(agregado.id_min),
        id_max: texto(agregado.id_max),
        xor_crc: texto(agregado.xor_crc),
        suma_crc: texto(agregado.suma_crc),
        checksum: null
      };
    }

    // Cuentas y panaderías de la semilla: columnas no sensibles. La contraseña solo se compara
    // en MySQL con el valor de la semilla; el hash nunca sale de la base.
    foto.usuarios_semilla = (await consultar(
      `SELECT id, email, rol_id, panaderia_id, estado, version_sesion, (contrasena = '!') AS contrasena_es_semilla
       FROM ${BASE}.usuarios WHERE id IN (1, 2, 3, 4) ORDER BY id`
    )).map(u => ({
      id: Number(u.id), email: u.email, rol_id: Number(u.rol_id), panaderia_id: u.panaderia_id === null ? null : Number(u.panaderia_id),
      estado: u.estado === null ? null : Number(u.estado), version_sesion: Number(u.version_sesion),
      contrasena_es_semilla: Number(u.contrasena_es_semilla) === 1
    }));
    foto.panaderias_semilla = (await consultar(
      `SELECT id, nombre, direccion, telefono, en_red, usuario_id FROM ${BASE}.panaderias WHERE id IN (1, 2) ORDER BY id`
    )).map(p => ({
      id: Number(p.id), nombre: p.nombre, direccion: p.direccion, telefono: p.telefono,
      en_red: p.en_red === null ? null : Number(p.en_red), usuario_id: Number(p.usuario_id)
    }));

    // Al final: CHECKSUM TABLE no forma parte de la instantánea consistente
    const sumas = await consultar(`CHECKSUM TABLE ${tablas.map(t => `${BASE}.\`${t}\``).join(', ')}`);
    for (const fila of sumas) {
      const t = String(fila.Table ?? '').split('.').pop();
      if (foto.tablas[t]) foto.tablas[t].checksum = texto(fila.Checksum);
    }
    return foto;
  } finally {
    await consultar('ROLLBACK').catch(() => {});
  }
};

// Abre la conexión, toma la foto y cierra. Solo muestra códigos de error (el mensaje de mysql2
// puede incluir el usuario o el host).
const tomarFoto = async ({ env = process.env, crearConexion = crearConexionMysql } = {}) => {
  if (env.DB_NAME !== BASE) throw new ErrorFoto(`DB_NAME es "${env.DB_NAME}": la foto solo se toma de ${BASE}`);
  let conexion;
  try {
    conexion = await crearConexion(env);
  } catch (error) {
    throw new ErrorFoto(`No se pudo conectar: ${error.code ?? 'error desconocido'}`);
  }
  conexion.on?.('error', () => {});
  try {
    return await capturar(conexion);
  } catch (error) {
    if (error instanceof ErrorFoto) throw error;
    throw new ErrorFoto(`No se pudo tomar la foto: ${error.code ?? 'error desconocido'}`);
  } finally {
    await conexion.end().catch(() => {});
  }
};

// Compara dos fotos. Sin diferencias NO significa datos idénticos (ver LIMITACIONES).
const compararFotos = (antes, despues) => {
  const diferencias = [];
  const distinto = (a, b) => JSON.stringify(a) !== JSON.stringify(b);
  for (const [nombre, foto] of [['antes', antes], ['despues', despues]]) {
    if (!foto || foto.version !== VERSION_FOTO || foto.base !== BASE) {
      diferencias.push(`La foto "${nombre}" no es una foto válida de ${BASE} (versión ${VERSION_FOTO})`);
    }
  }
  if (diferencias.length) return { sinDiferencias: false, diferencias };

  if (distinto(antes.opcionales, despues.opcionales)) diferencias.push('Cambió la presencia de las tablas del SQL 005');
  const tablas = [...new Set([...Object.keys(antes.tablas), ...Object.keys(despues.tablas)])].sort();
  for (const t of tablas) {
    const a = antes.tablas[t];
    const b = despues.tablas[t];
    if (!a || !b) { diferencias.push(`${t}: la tabla solo aparece en una de las fotos`); continue; }
    if (distinto(antes.esquema[t], despues.esquema[t])) diferencias.push(`${t}: cambió el esquema (columnas, tipos o nulabilidad)`);
    for (const campo of ['filas', 'id_min', 'id_max', 'xor_crc', 'suma_crc', 'checksum']) {
      if (a[campo] !== b[campo]) diferencias.push(`${t}: ${campo} ${a[campo]} -> ${b[campo]}`);
    }
  }
  for (const [clave, etiqueta] of [['usuarios_semilla', 'cuenta'], ['panaderias_semilla', 'panadería']]) {
    const ids = [...new Set([...antes[clave], ...despues[clave]].map(f => f.id))].sort((x, y) => x - y);
    for (const id of ids) {
      const a = antes[clave].find(f => f.id === id);
      const b = despues[clave].find(f => f.id === id);
      if (!a || !b) { diferencias.push(`${etiqueta} ${id}: solo aparece en una de las fotos`); continue; }
      for (const campo of Object.keys({ ...a, ...b })) {
        if (distinto(a[campo], b[campo])) diferencias.push(`${etiqueta} ${id}: ${campo} cambió`);
      }
    }
  }
  return { sinDiferencias: diferencias.length === 0, diferencias };
};

// La foto se guarda fuera del repositorio y nunca sobrescribe un archivo existente
const validarRutaSalida = (ruta, raiz = RAIZ_REPOSITORIO) => {
  if (typeof ruta !== 'string' || !ruta.trim()) throw new ErrorFoto('Indique el archivo de salida');
  const absoluta = path.resolve(ruta);
  const relativa = path.relative(path.resolve(raiz), absoluta);
  if (relativa === '' || (!relativa.startsWith('..') && !path.isAbsolute(relativa))) {
    throw new ErrorFoto('El archivo de salida debe estar fuera del repositorio');
  }
  return absoluta;
};

const guardarFoto = (foto, ruta, raiz = RAIZ_REPOSITORIO) => {
  const absoluta = validarRutaSalida(ruta, raiz);
  try {
    fs.writeFileSync(absoluta, `${JSON.stringify(foto, null, 2)}\n`, { flag: 'wx' });
  } catch (error) {
    if (error.code === 'EEXIST') throw new ErrorFoto('El archivo de salida ya existe: no se sobrescribe');
    throw new ErrorFoto(`No se pudo guardar la foto: ${error.code ?? 'error desconocido'}`);
  }
  return absoluta;
};

const resumen = (foto) => Object.entries(foto.tablas).map(([t, d]) => `  ${t}: ${d.filas} filas`).join('\n');

const principal = async (argv) => {
  const [modo, ...args] = argv;
  if (modo === '--comparar' && args.length === 2) {
    const leer = (ruta) => JSON.parse(fs.readFileSync(ruta, 'utf8'));
    const { sinDiferencias, diferencias } = compararFotos(leer(args[0]), leer(args[1]));
    if (sinDiferencias) {
      console.log('No se detectaron diferencias (comparación por sumas de comprobación: no garantiza igualdad absoluta).');
      return 0;
    }
    console.log(`Se detectaron ${diferencias.length} diferencias:\n${diferencias.map(d => `  - ${d}`).join('\n')}`);
    return 1;
  }
  if (modo === '--guardar' && args.length === 1) {
    // DB_NAME debe venir ya fijado: dotenv no sobrescribe variables existentes
    if (process.env.DB_NAME !== BASE) throw new ErrorFoto(`DB_NAME debe ser exactamente ${BASE} (fíjelo en la terminal)`);
    validarRutaSalida(args[0]);
    require('dotenv').config({ quiet: true });
    const foto = await tomarFoto();
    const ruta = guardarFoto(foto, args[0]);
    console.log(`Foto de ${BASE} guardada en ${ruta}:\n${resumen(foto)}`);
    return 0;
  }
  console.error('Uso: --guardar <archivo.json>  |  --comparar <antes.json> <despues.json>');
  return 2;
};

if (require.main === module) {
  principal(process.argv.slice(2))
    .then(codigo => { process.exitCode = codigo; })
    .catch(error => {
      console.error(`Foto cancelada: ${error instanceof ErrorFoto ? error.message : (error.code ?? 'error desconocido')}`);
      process.exitCode = 1;
    });
}

module.exports = {
  BASE, TABLAS, TABLAS_OPCIONALES, ErrorFoto, capturar, tomarFoto, compararFotos, validarRutaSalida, guardarFoto
};
