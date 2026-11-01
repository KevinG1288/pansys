// Verificación de pruebas/aislamiento.js contra MySQL real (hipótesis V1-V16 del plan). Escribe
// SOLO filas propias en pansys_test, marcadas con su runId, y las borra únicamente mediante
// ejecucion.limpiar(). Si la limpieza no termina en "limpia", se detiene: no reintenta ni borra
// por otra vía, e indica qué comprobar a mano.
//
// Uso (desde backend/, PowerShell), con la demo detenida y una foto antes y otra después:
//   $env:DB_NAME = 'pansys_test'
//   node pruebas/aislamiento.mysql.js --confirmar-pansys-test
//
// Barreras, en este orden: (1) sin --confirmar-pansys-test no hace nada; (2) DB_NAME debe venir
// fijado como pansys_test desde la terminal (no se cambia aquí y dotenv no lo sobrescribe);
// (3) toda conexión usa database: 'pansys_test' literal y se comprueba con SELECT DATABASE();
// (4) antes de cada escritura se vuelve a comprobar la base de esa conexión y que la sentencia
// apunte a una tabla pansys_test.<tabla>. Ante cualquier discrepancia, aborta.
//
// Qué datos cambia (todo en pansys_test y solo en filas propias de esta ejecución):
//  - Inserta cuentas, panaderías, materias primas, productos, recetas, ventas, detalles, órdenes e
//    insumos temporales, marcados con el runId (correo "prueba.verificacion.<runId>." y nombres
//    "PRUEBA <runId>"). Las cuentas 1-4 y las panaderías 1-2 de la semilla no se tocan.
//  - Actualiza filas propias: V7 cambia el nombre de un producto propio dentro de una transacción
//    que siempre termina en ROLLBACK (no queda ningún cambio); V15 asigna a una administradora
//    propia la panadería propia de la que es propietaria (asignarPanaderia, una sola fila); y
//    limpiar() desasigna esa panadería antes de retirar las filas, dentro de su transacción.
//  - V16 (requiere las tablas del SQL 005): inserta eventos de seguridad y enlaces de
//    restablecimiento de cuentas propias, y desvincula con UPDATE el actor de un evento y el
//    solicitante de un enlace, ambos propios. limpiar() los retira con el resto.
//  - Las inserciones que V6 y V12 intentan contra filas bloqueadas deben fallar por tiempo de
//    espera (1205); si alguna llegara a escribirse, es propia y la limpieza la incluye.
//  - Los contadores AUTO_INCREMENT de las tablas avanzan de forma permanente, aunque la limpieza
//    retire todas las filas temporales (MySQL no los retrocede). Es inocuo: la foto de
//    foto_pansys_test.js no los compara.
//
// Interrupción (Ctrl+C, cierre de la terminal o caída del proceso): no hay manejador que limpie.
// Si ocurre antes de que termine limpiar(), las filas temporales quedan en pansys_test,
// identificadas por el runId que se imprime antes de la primera inserción; si ocurre durante la
// limpieza, MySQL deshace su transacción al cerrarse la conexión y las filas también quedan.
//
// Recuperación ante cualquier fallo (código distinto de 0, una línea FALLA, una limpieza que no
// termina en "limpia", una interrupción o una foto posterior con diferencias):
//  1. No reintentar la verificación ni otra suite, y no retirar filas a mano ni por otra vía.
//  2. Conservar la salida (runId, id de cuentas y panaderías pendientes) y tomar la foto posterior.
//  3. Revisar en solo lectura qué filas con ese runId siguen en pansys_test.
//  4. Cualquier corrección, incluida la restauración de un respaldo de pansys_test, requiere una
//     autorización expresa aparte: antes de restaurar, comprobar el SHA-256 del respaldo y que la
//     conexión apunta a pansys_test; después, comparar recuentos y CHECKSUM TABLE con lo esperado.
//
// Cada OK de este script solo vale para el servidor y el momento en que se ejecuta.

// ---------- Barreras previas a cualquier carga o conexión ----------
if (require.main === module) {
  if (!process.argv.slice(2).includes('--confirmar-pansys-test')) {
    console.error('Verificación cancelada: falta el argumento --confirmar-pansys-test. No se ha cargado ningún módulo ni abierto ninguna conexión.');
    process.exit(1);
  }
  if (process.env.DB_NAME !== 'pansys_test') {
    console.error('Verificación cancelada: DB_NAME debe fijarse en la terminal exactamente como pansys_test. No se ha cargado ningún módulo ni abierto ninguna conexión.');
    process.exit(1);
  }
}

const BASE = 'pansys_test';
const BLOQUEO_V3 = 'pansys_test.verificacion_v3';
// Niveles de aislamiento con los que la limpieza de aislamiento.js es correcta (V13 y V14)
const NIVELES_ADMITIDOS = ['REPEATABLE-READ', 'READ-COMMITTED'];
const LECTURA_SESION = 'SELECT @@SESSION.transaction_isolation AS aislamiento, @@GLOBAL.transaction_isolation AS aislamiento_global, @@SESSION.innodb_lock_wait_timeout AS espera';
const INSERTAR_MATERIA = "INSERT INTO pansys_test.materia_prima (nombre, unidad_medida, cantidad_disponible, stock_minimo, precio_unitario, panaderia_id, estado, createdAt, updatedAt) VALUES (?, 'kg', 1, 0, 1, ?, 1, NOW(), NOW())";
const INSERTAR_VENTA = "INSERT INTO pansys_test.ventas (fecha, total, empleado_id, panaderia_id, estado, createdAt, updatedAt) VALUES (CURDATE(), 1, ?, ?, 'completada', NOW(), NOW())";
const INSERTAR_DETALLE = 'INSERT INTO pansys_test.detalle_ventas (venta_id, producto_id, cantidad, precio_unitario, subtotal, createdAt, updatedAt) VALUES (?, ?, 1, 1, 1, NOW(), NOW())';
// V16: tablas del SQL 005. El evento no lleva enlace (tipo email_cambiado) y el token_hash es el
// SHA-256 de un texto marcado con el runId, calculado en MySQL (nunca un token real).
const TABLAS_RECUPERACION = ['eventos_seguridad', 'restablecimientos_contrasena'];
const INSERTAR_EVENTO = "INSERT INTO pansys_test.eventos_seguridad (tipo, usuario_id, panaderia_id, actor_id, restablecimiento_id, detalle, createdAt) VALUES ('email_cambiado', ?, ?, ?, NULL, ?, NOW())";
const INSERTAR_ENLACE = "INSERT INTO pansys_test.restablecimientos_contrasena (usuario_id, origen, solicitado_por, token_hash, estado, expira_en, createdAt, updatedAt) VALUES (?, ?, ?, SHA2(?, 256), 'enviando', DATE_ADD(NOW(), INTERVAL 30 MINUTE), NOW(), NOW())";
const DESVINCULAR_EVENTO = 'UPDATE pansys_test.eventos_seguridad SET actor_id = NULL WHERE id = ? AND usuario_id = ? AND actor_id = ?';
const DESVINCULAR_ENLACE = "UPDATE pansys_test.restablecimientos_contrasena SET origen = 'propio', solicitado_por = NULL, updatedAt = NOW() WHERE id = ? AND usuario_id = ? AND solicitado_por = ?";
const CONTAR_EVENTOS = 'SELECT COUNT(*) AS n FROM pansys_test.eventos_seguridad WHERE usuario_id IN (?) OR actor_id IN (?)';
const CONTAR_ENLACES = 'SELECT COUNT(*) AS n FROM pansys_test.restablecimientos_contrasena WHERE usuario_id IN (?) OR solicitado_por IN (?)';
const DESASIGNADAS = 'usuarios (propietarias desasignadas)';

// Recuentos previstos en el orden exacto en que limpiar() los devuelve: primero la desasignación
// (si la hubo) y después cada paso de pasosDeBorrado, con 0 en los pasos sin filas previstas.
// Devuelve null si algún recuento previsto no corresponde a ningún paso (no se puede comparar).
const ordenarPrevistos = (previstos, pasos) => {
  const orden = [DESASIGNADAS, ...pasos.map(p => p.descripcion)];
  if (Object.keys(previstos).some(clave => !orden.includes(clave))) return null;
  const resultado = {};
  if (DESASIGNADAS in previstos) resultado[DESASIGNADAS] = previstos[DESASIGNADAS];
  for (const paso of pasos) resultado[paso.descripcion] = previstos[paso.descripcion] ?? 0;
  return resultado;
};

class ErrorVerificacion extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'ErrorVerificacion';
  }
}

const codigoDe = (error) => error?.code ?? (error instanceof Error && /^Error(Aislamiento|Verificacion)$/.test(error.name) ? error.message : 'error desconocido');

// Conexión real: base fija, nunca tomada de la configuración
const crearConexionMysql = (env) => require('mysql2/promise').createConnection({
  host: env.DB_HOST,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: 'pansys_test'
});

const verificarBase = async (conexion, etiqueta) => {
  const [filas] = await conexion.query('SELECT DATABASE() AS base');
  const base = filas?.[0]?.base;
  if (base !== BASE) throw new ErrorVerificacion(`La conexión "${etiqueta}" está en "${base}": se esperaba ${BASE}`);
};

// Abre una conexión auxiliar y comprueba su base antes de devolverla
const abrirConexion = async (crearConexion, env, etiqueta) => {
  let conexion;
  try {
    conexion = await crearConexion(env);
  } catch (error) {
    throw new ErrorVerificacion(`No se pudo abrir la conexión "${etiqueta}": ${error.code ?? 'error desconocido'}`);
  }
  conexion.on?.('error', () => {});
  try {
    await verificarBase(conexion, etiqueta);
  } catch (error) {
    await conexion.end().catch(() => {});
    throw error;
  }
  return conexion;
};

// Única vía de escritura: solo INSERT INTO / UPDATE sobre pansys_test.<tabla>, y con la base de
// la conexión comprobada justo antes
const SENTENCIA_PERMITIDA = /^(INSERT INTO|UPDATE) pansys_test\.[a-z_]+ /;
const escribir = async (conexion, etiqueta, sql, params) => {
  if (!SENTENCIA_PERMITIDA.test(sql)) throw new ErrorVerificacion(`Escritura no permitida: ${sql.slice(0, 60)}`);
  await verificarBase(conexion, etiqueta);
  const [resultado] = await conexion.query(sql, params);
  return resultado;
};

const consultar = async (conexion, sql, params) => (await conexion.query(sql, params))[0];

// Decide si la limpieza permite terminar bien. Si no, devuelve las instrucciones para comprobar a
// mano: nunca se reintenta ni se borra por otra vía.
const evaluarLimpieza = (limpieza) => {
  if (limpieza?.ok && limpieza.resultado === 'limpia') return { detener: false, lineas: [] };
  const p = limpieza?.pendientes ?? { runId: '(desconocido)', usuarios: [], panaderias: [] };
  const lista = (ids) => (ids?.length ? ids.join(', ') : 'ninguno');
  const lineas = [
    limpieza?.resultado === 'desconocido'
      ? 'RESULTADO DESCONOCIDO: falló el COMMIT de la limpieza. No se sabe si las filas temporales se borraron.'
      : `Limpieza no completada (resultado: ${limpieza?.resultado ?? 'sin resultado'}). Las filas temporales pueden seguir en pansys_test.`,
    `Motivo: ${limpieza?.motivo ?? 'no informado'}`,
    'No se reintenta la limpieza ni se borra nada por otra vía.',
    'Verificación manual necesaria (solo lectura) en pansys_test:',
    `  runId: ${p.runId}`,
    `  usuarios con id en: ${lista(p.usuarios)}`,
    `  panaderias con id en: ${lista(p.panaderias)}`,
    `  y filas de materia_prima, productos, ventas, orden_produccion con panaderia_id en: ${lista(p.panaderias)}`,
    '  (y sus detalle_ventas, receta_producto e insumo_usado).',
    'No borre estas filas sin autorización expresa.'
  ];
  return { detener: true, lineas };
};

const crearInforme = (salida) => {
  const fallos = [];
  return {
    fallos,
    comprobar(codigo, descripcion, ok, detalle = '') {
      if (!ok) fallos.push(codigo);
      salida(`${ok ? 'OK   ' : 'FALLA'} ${codigo} ${descripcion}${!ok && detalle ? ` -> ${detalle}` : ''}`);
    },
    nota: (texto) => salida(`      ${texto}`)
  };
};

// Ejecuta las verificaciones. Devuelve el código de salida (0 solo si todo fue bien y la
// limpieza terminó en "limpia"). Las dependencias se inyectan para las pruebas con dobles.
const ejecutar = async ({ env = process.env, crearConexion = crearConexionMysql, iniciar, salida = console.log } = {}) => {
  const informe = crearInforme(salida);
  if (env.DB_NAME !== BASE) {
    informe.comprobar('V0', 'DB_NAME es pansys_test', false);
    return 1;
  }
  const { iniciarEjecucion, ErrorAislamiento, NOMBRE_BLOQUEO, SQL_BLOQUEO_PRODUCTOS, SQL_DETALLES_AJENOS } = require('./aislamiento');
  const iniciarSuite = iniciar ?? ((opciones) => iniciarEjecucion(opciones));

  let ejecucion = null;
  const conexiones = [];
  const abrir = async (etiqueta) => {
    const c = await abrirConexion(crearConexion, env, etiqueta);
    conexiones.push(c);
    return c;
  };
  const cerrarConexiones = async () => {
    while (conexiones.length) await conexiones.pop().end().catch(() => {});
  };
  let limpiezaCorrecta = false;
  let previstos = null;
  let tablasRecuperacion = [];
  let v16Ejecutada = false;
  // true en cuanto se intenta la primera escritura de datos (antes de enviarla: cubre también una
  // escritura de resultado incierto). Si sigue en false, la verificación se detuvo sin crear datos.
  let escrituraIntentada = false;

  try {
    // ---------- Bloqueo de suite (V1, V2, V8) ----------
    ejecucion = await iniciarSuite({ suite: 'verificacion', env, crearConexion });
    informe.comprobar('V8', 'conexión dedicada en pansys_test y bloqueo de suite obtenido', true);
    const datos = await abrir('datos');
    const aux = await abrir('auxiliar');
    informe.comprobar('V8', 'conexiones auxiliares en pansys_test (SELECT DATABASE())', true);

    const idBloqueo = ejecucion.bloqueo.idConexion;
    const [lectura] = await consultar(aux, 'SELECT IS_USED_LOCK(?) AS dueno, CONNECTION_ID() AS propio', [NOMBRE_BLOQUEO]);
    informe.comprobar('V1', 'CONNECTION_ID e IS_USED_LOCK llegan como números y coinciden',
      Number.isSafeInteger(idBloqueo) && typeof lectura?.dueno === 'number' && lectura.dueno === idBloqueo && lectura.propio !== idBloqueo,
      `tipos: ${typeof idBloqueo}/${typeof lectura?.dueno}`);

    let segunda = null;
    try {
      segunda = await iniciarSuite({ suite: 'verificacion', env, crearConexion });
    } catch (error) {
      informe.comprobar('V2', 'una segunda ejecución no obtiene el bloqueo', error instanceof ErrorAislamiento && /Otra suite/.test(error.message), codigoDe(error));
    }
    if (segunda) {
      informe.comprobar('V2', 'una segunda ejecución no obtiene el bloqueo', false, 'la segunda ejecución obtuvo el bloqueo');
      await segunda.cerrar().catch(() => {});
    }

    const tablas = await consultar(aux, 'SELECT TABLE_NAME AS tabla FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?)',
      [BASE, ['usuarios', 'panaderias']]);
    informe.comprobar('V10', 'el alias de information_schema devuelve la columna "tabla"',
      tablas.length === 2 && tablas.every(f => typeof f.tabla === 'string'), JSON.stringify(Object.keys(tablas[0] ?? {})));
    // Tablas del SQL 005 presentes (solo lectura): fijan los pasos de limpiar() y si V16 se ejecuta
    tablasRecuperacion = (await consultar(aux, 'SELECT TABLE_NAME AS tabla FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?)',
      [BASE, TABLAS_RECUPERACION])).map(f => f.tabla).filter(t => TABLAS_RECUPERACION.includes(t)).sort();
    informe.nota(`tablas del SQL 005 presentes: ${tablasRecuperacion.length ? tablasRecuperacion.join(', ') : 'ninguna'}`);

    // ---------- V14: nivel de aislamiento y tiempo de espera de la sesión (solo lectura) ----------
    // La conexión auxiliar se abre con la misma configuración que la dedicada de aislamiento.js y
    // mysql2 no fija el nivel: ambas sesiones heredan el valor global, que también se lee
    const [sesion] = await consultar(aux, LECTURA_SESION);
    const aislamiento = sesion?.aislamiento ?? null;
    informe.nota(`aislamiento de la sesión: ${aislamiento ?? '(desconocido)'}; global: ${sesion?.aislamiento_global ?? '(desconocido)'}; ` +
      `innodb_lock_wait_timeout de la sesión: ${sesion?.espera ?? '(desconocido)'} s`);
    const nivelAdmitido = NIVELES_ADMITIDOS.includes(aislamiento) && aislamiento === sesion?.aislamiento_global;
    informe.comprobar('V14', `nivel de aislamiento admitido (${NIVELES_ADMITIDOS.join(' o ')}) e igual al global`, nivelAdmitido,
      `sesión ${aislamiento ?? '(desconocido)'}, global ${sesion?.aislamiento_global ?? '(desconocido)'}`);
    // Detención antes del primer INSERT: no hay nada que limpiar (limpiar() se ejecuta igualmente
    // y, sin nada registrado, no envía ningún borrado)
    if (!nivelAdmitido) throw new ErrorVerificacion('V14: nivel de aislamiento no admitido; no se crean datos de prueba');

    // ---------- Datos propios (solo con el bloqueo vigente) ----------
    await ejecucion.exigirBloqueo();
    // Antes del primer INSERT: si el proceso se interrumpe, el runId ya está a la vista
    informe.nota(`runId de esta ejecución: ${ejecucion.runId} (filas marcadas con "prueba.verificacion.${ejecucion.runId}." y "PRUEBA ${ejecucion.runId}")`);
    const insertar = async (sql, params) => {
      escrituraIntentada = true;
      return (await escribir(datos, 'datos', sql, params)).insertId;
    };
    const admin = ejecucion.registrar('usuarios', await insertar(
      "INSERT INTO pansys_test.usuarios (email, contrasena, rol_id, panaderia_id, estado, version_sesion, createdAt, updatedAt) VALUES (?, '!', 1, NULL, 0, 0, NOW(), NOW())",
      [ejecucion.correo('admin')]));
    const panA = ejecucion.registrar('panaderias', await insertar(
      'INSERT INTO pansys_test.panaderias (nombre, direccion, telefono, en_red, usuario_id, createdAt, updatedAt) VALUES (?, ?, NULL, 0, ?, NOW(), NOW())',
      [ejecucion.nombre('A'), 'Dirección temporal de verificación', admin]));
    const panB = ejecucion.registrar('panaderias', await insertar(
      'INSERT INTO pansys_test.panaderias (nombre, direccion, telefono, en_red, usuario_id, createdAt, updatedAt) VALUES (?, ?, NULL, 0, ?, NOW(), NOW())',
      [ejecucion.nombre('B'), 'Dirección temporal de verificación', admin]));
    const empleado = ejecucion.registrar('usuarios', await insertar(
      "INSERT INTO pansys_test.usuarios (email, contrasena, rol_id, panaderia_id, estado, version_sesion, createdAt, updatedAt) VALUES (?, '!', 2, ?, 0, 0, NOW(), NOW())",
      [ejecucion.correo('panadero'), panA]));
    const materia = await insertar(
      "INSERT INTO pansys_test.materia_prima (nombre, unidad_medida, cantidad_disponible, stock_minimo, precio_unitario, panaderia_id, estado, createdAt, updatedAt) VALUES (?, 'kg', 1, 0, 1, ?, 1, NOW(), NOW())",
      [ejecucion.nombre('Harina'), panA]);
    const nombreProducto = ejecucion.nombre('Pan');
    const productoA = await insertar(
      'INSERT INTO pansys_test.productos (nombre, precio_compra, precio_venta, cantidad_disponible, panaderia_id, estado, createdAt, updatedAt) VALUES (?, 0, 1, 0, ?, 1, NOW(), NOW())',
      [nombreProducto, panA]);
    await insertar(
      'INSERT INTO pansys_test.productos (nombre, precio_compra, precio_venta, cantidad_disponible, panaderia_id, estado, createdAt, updatedAt) VALUES (?, 0, 1, 0, ?, 1, NOW(), NOW())',
      [ejecucion.nombre('Pan B'), panB]);
    await insertar(
      'INSERT INTO pansys_test.receta_producto (producto_id, materia_prima_id, cantidad_por_unidad, createdAt, updatedAt) VALUES (?, ?, 1, NOW(), NOW())',
      [productoA, materia]);
    const venta = await insertar(
      "INSERT INTO pansys_test.ventas (fecha, total, empleado_id, panaderia_id, estado, createdAt, updatedAt) VALUES (CURDATE(), 1, ?, ?, 'completada', NOW(), NOW())",
      [empleado, panA]);
    await insertar(
      'INSERT INTO pansys_test.detalle_ventas (venta_id, producto_id, cantidad, precio_unitario, subtotal, createdAt, updatedAt) VALUES (?, ?, 1, 1, 1, NOW(), NOW())',
      [venta, productoA]);
    const orden = await insertar(
      "INSERT INTO pansys_test.orden_produccion (panaderia_id, producto_id, empleado_id, fecha, cantidad_planificada, estado, costo_insumos, insumos_devueltos, createdAt, updatedAt) VALUES (?, ?, ?, CURDATE(), 1, 'en_proceso', 0, 0, NOW(), NOW())",
      [panA, productoA, empleado]);
    await insertar(
      "INSERT INTO pansys_test.insumo_usado (orden_id, materia_prima_id, cantidad_por_unidad, unidad_medida, precio_unitario, cantidad_usada, costo, createdAt, updatedAt) VALUES (?, ?, 1, 'kg', 1, 1, 1, NOW(), NOW())",
      [orden, materia]);
    previstos = {
      insumo_usado: 1, orden_produccion: 1, receta_producto: 1, detalle_ventas: 1, ventas: 1, productos: 2,
      materia_prima: 1, 'usuarios (empleados)': 1, panaderias: 2, 'usuarios (propietarias)': 1
    };
    informe.comprobar('--', `filas propias creadas (runId ${ejecucion.runId})`, true);

    // ---------- V4: IN (?) con listas ----------
    const [enLista] = await consultar(aux, 'SELECT COUNT(*) AS n FROM pansys_test.usuarios WHERE id IN (?)', [ejecucion.ids('usuarios')]);
    informe.comprobar('V4', 'IN (?) se expande con la lista de id', Number(enLista?.n) === 2, `n = ${enLista?.n}`);

    // ---------- V6: FOR UPDATE sobre una panadería propia frena una inserción que la referencia ----------
    await consultar(aux, 'START TRANSACTION');
    try {
      await consultar(aux, 'SELECT id FROM pansys_test.panaderias WHERE id = ? FOR UPDATE', [panA]);
      await consultar(datos, 'SET SESSION innodb_lock_wait_timeout = 2');
      let errorEspera = null;
      try {
        await escribir(datos, 'datos',
          'INSERT INTO pansys_test.productos (nombre, precio_compra, precio_venta, cantidad_disponible, panaderia_id, estado, createdAt, updatedAt) VALUES (?, 0, 1, 0, ?, 1, NOW(), NOW())',
          [ejecucion.nombre('Espera'), panA]);
        previstos.productos += 1; // la hipótesis falló: la fila es propia y la limpieza la incluirá
      } catch (error) {
        errorEspera = error;
      }
      informe.comprobar('V6', 'la inserción espera al FOR UPDATE y falla por tiempo (1205)', errorEspera?.errno === 1205, codigoDe(errorEspera));
    } finally {
      await consultar(aux, 'ROLLBACK');
    }

    // ---------- V7: ROLLBACK deshace una escritura sobre una fila propia ----------
    await consultar(datos, 'START TRANSACTION');
    try {
      await escribir(datos, 'datos', 'UPDATE pansys_test.productos SET nombre = ? WHERE id = ?', [ejecucion.nombre('Modificado'), productoA]);
    } finally {
      await consultar(datos, 'ROLLBACK');
    }
    const [tras] = await consultar(aux, 'SELECT nombre FROM pansys_test.productos WHERE id = ?', [productoA]);
    informe.comprobar('V7', 'ROLLBACK deja la fila como estaba', tras?.nombre === nombreProducto);

    // Desde aquí, cada fila creada se suma a "previstos" en cuanto existe: todas son propias (de A
    // o de B) y la limpieza normal las borra con su panadería o con su venta.

    // ---------- V11: detección de un detalle de otra panadería hacia un producto propio (R1) ----------
    // Una venta PROPIA de B con un detalle hacia el producto de A. Con la consulta exacta de
    // limpiar() y solo [A] como propias, B hace de panadería ajena: debe contarse 1; con [A, B],
    // 0. Solo lectura: no se ejecuta ninguna limpieza con datos ajenos. La limpieza normal (A y B)
    // borra este detalle en el paso de detalle_ventas, por su venta, antes que los productos.
    const ventaB = await insertar(INSERTAR_VENTA, [admin, panB]);
    previstos.ventas += 1;
    await insertar(INSERTAR_DETALLE, [ventaB, productoA]);
    previstos.detalle_ventas += 1;
    const [soloA] = await consultar(aux, SQL_DETALLES_AJENOS, [[panA], [panA]]);
    const [ambas] = await consultar(aux, SQL_DETALLES_AJENOS, [[panA, panB], [panA, panB]]);
    informe.comprobar('V11', 'la consulta de limpiar() detecta el detalle de otra panadería hacia un producto propio (n = 1)',
      Number(soloA?.n) === 1, `n = ${soloA?.n}`);
    informe.comprobar('V11', 'con las dos panaderías como propias no hay detalles ajenos (n = 0)', Number(ambas?.n) === 0, `n = ${ambas?.n}`);

    // ---------- V12: el bloqueo de productos de limpiar() frena un detalle que los referencia ----------
    await consultar(aux, 'START TRANSACTION');
    try {
      await consultar(aux, SQL_BLOQUEO_PRODUCTOS, [[panA]]);
      await consultar(datos, 'SET SESSION innodb_lock_wait_timeout = 2');
      let errorEspera = null;
      try {
        await escribir(datos, 'datos', INSERTAR_DETALLE, [venta, productoA]);
        previstos.detalle_ventas += 1; // la hipótesis falló: el detalle es propio (venta de A) y se limpia
      } catch (error) {
        errorEspera = error;
      }
      informe.comprobar('V12', 'el detalle hacia un producto bloqueado espera al FOR UPDATE y falla por tiempo (1205)',
        errorEspera?.errno === 1205, codigoDe(errorEspera));
    } finally {
      await consultar(aux, 'ROLLBACK');
    }

    // ---------- V13: la instantánea la fija la primera lectura sin bloqueo, no el FOR UPDATE ----------
    // Supuesto de la corrección de R1. La PRIMERA sentencia de la transacción de aux es el bloqueo de
    // productos; después, datos confirma una materia prima propia en B (no bloqueada). El recuento sin
    // bloqueo de aux debe verla: si el FOR UPDATE hubiera fijado la instantánea, daría 0. Una segunda
    // materia prima confirmada después de ese recuento muestra el nivel real: con REPEATABLE-READ el
    // recuento repetido sigue en 1; con READ-COMMITTED pasa a 2.
    const contarMateriasB = async () => Number((await consultar(aux, 'SELECT COUNT(*) AS n FROM pansys_test.materia_prima WHERE panaderia_id = ?', [panB]))[0]?.n);
    await consultar(aux, 'START TRANSACTION');
    try {
      await consultar(aux, SQL_BLOQUEO_PRODUCTOS, [[panA]]);
      await insertar(INSERTAR_MATERIA, [ejecucion.nombre('Sal'), panB]);
      previstos.materia_prima += 1;
      const primero = await contarMateriasB();
      await insertar(INSERTAR_MATERIA, [ejecucion.nombre('Azucar'), panB]);
      previstos.materia_prima += 1;
      const segundo = await contarMateriasB();
      informe.comprobar('V13', 'tras el FOR UPDATE, la primera lectura sin bloqueo ve una fila confirmada después del bloqueo (n = 1)',
        primero === 1, `n = ${primero}`);
      const esperado = { 'REPEATABLE-READ': 1, 'READ-COMMITTED': 2 }[aislamiento];
      informe.comprobar('V13', `la lectura repetida se comporta según el nivel ${aislamiento ?? '(desconocido)'}`,
        esperado !== undefined && segundo === esperado, `n = ${segundo}, esperado ${esperado ?? 'ninguno (nivel no admitido)'}`);
    } finally {
      await consultar(aux, 'ROLLBACK');
    }

    // ---------- V15: un administrador por panadería (ciclo de claves foráneas) ----------
    // Con las escrituras protegidas de aislamiento.js: una administradora sin panadería, una
    // panadería de la que es propietaria, su asignación a esa panadería y una cuenta más en ella.
    // La administradora queda propietaria (panaderias.usuario_id, CASCADE) y asignada
    // (usuarios.panaderia_id, RESTRICT) a la vez. La comprobación decisiva es V5: limpiar() deshace
    // el ciclo desasignándola antes de borrar, con los recuentos previstos.
    await ejecucion.exigirBloqueo();
    const adminC = await ejecucion.crearCuenta({ etiqueta: 'adminc', rol: 'administrador', activa: false });
    previstos['usuarios (propietarias)'] += 1;
    const panC = await ejecucion.crearPanaderia({ etiqueta: 'C', propietariaId: adminC });
    previstos.panaderias += 1;
    await ejecucion.asignarPanaderia({ cuentaId: adminC, panaderiaId: panC });
    // limpiar() informa de la desasignación antes que de los borrados: va primera en el recuento
    previstos = { 'usuarios (propietarias desasignadas)': 1, ...previstos };
    await ejecucion.crearCuenta({ etiqueta: 'gerentec', rol: 'gerente', panaderiaId: panC, activa: false });
    previstos['usuarios (empleados)'] += 1;
    const [asignada] = await consultar(aux, 'SELECT panaderia_id, rol_id FROM pansys_test.usuarios WHERE id = ?', [adminC]);
    informe.comprobar('V15', 'la administradora queda asignada a la panadería de la que es propietaria',
      Number(asignada?.panaderia_id) === panC && Number(asignada?.rol_id) === 1, `panaderia_id = ${asignada?.panaderia_id ?? '(sin fila)'}`);

    // ---------- V16: dependencias mixtas en las tablas del SQL 005 ----------
    // El bloqueo de suite impide dos ejecuciones simultáneas (V2) y limpiar() solo se ejecuta una
    // vez: una limpieza abortada deja sus filas para revisión manual. Por eso, como en V11, la
    // segunda ejecución se representa con un grupo de cuentas propias disjunto: X e Y son
    // administradoras propias sin panadería, y cada una hace de ajena para la otra. Se comprueba
    // con comprobarAntesDeBorrar, la misma comprobación que limpiar() hace dentro de su transacción
    // antes del primer borrado; solo lee. Después de desvincular con UPDATE las referencias
    // cruzadas, ambos grupos quedan sin dependencias mixtas y la limpieza única lo retira todo.
    if (tablasRecuperacion.length !== TABLAS_RECUPERACION.length) {
      informe.comprobar('V16', 'las tablas del SQL 005 existen en pansys_test', false, `presentes: ${tablasRecuperacion.join(', ') || 'ninguna'}`);
    } else {
      await ejecucion.exigirBloqueo();
      const cuentaX = await ejecucion.crearCuenta({ etiqueta: 'v16x', rol: 'administrador', activa: false });
      previstos['usuarios (propietarias)'] += 1;
      const cuentaY = await ejecucion.crearCuenta({ etiqueta: 'v16y', rol: 'administrador', activa: false });
      previstos['usuarios (propietarias)'] += 1;
      const evento = async (usuario, panaderia, actor, paso) => {
        const id = await insertar(INSERTAR_EVENTO, [usuario, panaderia, actor, ejecucion.nombre('V16')]);
        previstos[`eventos_seguridad (${paso})`] = (previstos[`eventos_seguridad (${paso})`] ?? 0) + 1;
        return id;
      };
      const enlace = async (usuario, solicitante, paso) => {
        const id = await insertar(INSERTAR_ENLACE, [usuario, solicitante === null ? 'propio' : 'administrador', solicitante, ejecucion.nombre(`V16 enlace ${usuario}`)]);
        previstos[`restablecimientos_contrasena (${paso})`] = (previstos[`restablecimientos_contrasena (${paso})`] ?? 0) + 1;
        return id;
      };
      // Cruzadas entre X e Y (se limpian como "sin actor" y "sin solicitante" tras desvincularlas)
      const eventoCruzado = await evento(cuentaX, null, cuentaY, 'sin actor ni panadería');
      const enlaceCruzado = await enlace(cuentaX, cuentaY, 'sin solicitante');
      // Una fila por cada paso restante de limpiar() en estas tablas
      await evento(cuentaY, null, cuentaY, 'actor propio, sin panadería');
      await evento(empleado, panA, null, 'sin actor, panadería propia');
      await evento(empleado, panA, admin, 'actor propio, panadería propia');
      await enlace(empleado, admin, 'solicitante propio');
      v16Ejecutada = true;

      const contarFilas = async () => {
        const ids = [cuentaX, cuentaY, empleado, admin];
        const [e] = await consultar(aux, CONTAR_EVENTOS, [ids, ids]);
        const [r] = await consultar(aux, CONTAR_ENLACES, [ids, ids]);
        return [Number(e?.n), Number(r?.n)];
      };
      const filasAntes = await contarFilas();
      informe.comprobar('V16', 'filas creadas en las tablas del SQL 005 (4 eventos y 2 enlaces)',
        JSON.stringify(filasAntes) === '[4,2]', `eventos/enlaces = ${filasAntes.join('/')}`);
      // Error de la comprobación previa de limpiar() con un solo grupo como propio
      const comprobarGrupo = async (cuenta) => {
        try {
          await ejecucion.comprobarAntesDeBorrar({ usuarios: [cuenta], panaderias: [] });
          return null;
        } catch (error) {
          return error instanceof ErrorAislamiento ? error.message : `inesperado: ${codigoDe(error)}`;
        }
      };
      const esperarMixta = async (cuenta, grupo, descripcion) => {
        const mensaje = await comprobarGrupo(cuenta);
        informe.comprobar('V16', `con solo ${grupo} como propio, la limpieza aborta: ${descripcion}`,
          mensaje === `Dependencia mixta: 1 ${descripcion}`, mensaje ?? 'no abortó');
      };
      await esperarMixta(cuentaX, 'X', 'evento de una cuenta propia con un actor ajeno');
      await esperarMixta(cuentaY, 'Y', 'evento de una cuenta ajena con un actor propio');

      const desvincular = async (sql, params, descripcion) => {
        const resultado = await escribir(datos, 'datos', sql, params);
        informe.comprobar('V16', descripcion, resultado?.affectedRows === 1, `affectedRows = ${resultado?.affectedRows}`);
      };
      await desvincular(DESVINCULAR_EVENTO, [eventoCruzado, cuentaX, cuentaY], 'el UPDATE desvincula el actor del evento cruzado (1 fila)');
      await esperarMixta(cuentaX, 'X', 'enlace de una cuenta propia solicitado por una cuenta ajena');
      await esperarMixta(cuentaY, 'Y', 'enlace de una cuenta ajena solicitado por una cuenta propia');

      await desvincular(DESVINCULAR_ENLACE, [enlaceCruzado, cuentaX, cuentaY], 'el UPDATE desvincula el solicitante del enlace cruzado (1 fila)');
      const sinMixtas = [await comprobarGrupo(cuentaX), await comprobarGrupo(cuentaY)];
      informe.comprobar('V16', 'tras desvincular, ni X ni Y tienen dependencias mixtas', sinMixtas.every(m => m === null), sinMixtas.join(' | '));
      const filasDespues = await contarFilas();
      informe.comprobar('V16', 'las comprobaciones abortadas no retiraron ninguna fila',
        JSON.stringify(filasDespues) === JSON.stringify(filasAntes), `eventos/enlaces = ${filasDespues.join('/')}`);
    }

    // ---------- V3: al destruir una conexión, MySQL suelta sus bloqueos (con un bloqueo aparte) ----------
    const v3 = await abrirConexion(crearConexion, env, 'v3');
    const eventos = [];
    v3.on?.('end', () => eventos.push('end'));
    v3.on?.('error', (error) => eventos.push(`error:${error?.code ?? '?'}`));
    let tomado;
    try {
      [tomado] = await consultar(v3, 'SELECT GET_LOCK(?, 0) AS obtenido', [BLOQUEO_V3]);
    } finally {
      v3.destroy(); // también si GET_LOCK falló: la conexión no queda abierta
    }
    let libre = false;
    for (let i = 0; i < 20 && !libre; i++) {
      const [estado] = await consultar(aux, 'SELECT IS_USED_LOCK(?) AS dueno', [BLOQUEO_V3]);
      libre = estado?.dueno === null;
      if (!libre) await new Promise(resolve => setTimeout(resolve, 150));
    }
    informe.comprobar('V3', 'al destruir la conexión, MySQL suelta su bloqueo', Number(tomado?.obtenido) === 1 && libre);
    informe.nota(`eventos de mysql2 tras destroy(): ${eventos.length ? eventos.join(', ') : 'ninguno'} (dato informativo)`);
  } catch (error) {
    informe.comprobar('--', 'la verificación se interrumpió', false, codigoDe(error));
  } finally {
    // Sin transacciones ni bloqueos auxiliares abiertos durante la limpieza
    await cerrarConexiones();
  }

  // ---------- Limpieza: una sola vez y solo mediante limpiar() (V5) ----------
  if (ejecucion) {
    const limpieza = await ejecucion.limpiar();
    const evaluacion = evaluarLimpieza(limpieza);
    if (evaluacion.detener) {
      informe.comprobar('V5', 'limpieza de lo propio con limpiar()', false, limpieza?.resultado);
      evaluacion.lineas.forEach(l => salida(l));
    } else if (!escrituraIntentada) {
      // Detenida antes del primer INSERT (p. ej., por V14): no hay recuentos previstos que comparar,
      // pero la limpieza debe haber terminado sin borrar nada
      limpiezaCorrecta = true;
      informe.comprobar('V5', 'sin datos creados (detención previa al primer INSERT): limpiar() no borra nada',
        Object.keys(limpieza.borrados ?? {}).length === 0, JSON.stringify(limpieza.borrados));
    } else {
      limpiezaCorrecta = true;
      // Con las tablas del SQL 005, limpiar() informa también de sus pasos (0 si no había filas)
      const esperados = previstos === null ? null
        : ordenarPrevistos(previstos, ejecucion.pasosDeBorrado(tablasRecuperacion, { usuarios: ejecucion.ids('usuarios'), panaderias: ejecucion.ids('panaderias') }));
      informe.comprobar('V5', 'limpiar() borra lo propio con los recuentos previstos',
        esperados !== null && JSON.stringify(limpieza.borrados) === JSON.stringify(esperados), JSON.stringify(limpieza.borrados));
      try {
        const comprobacion = await abrir('comprobacion');
        const usuariosPropios = ejecucion.ids('usuarios').length ? ejecucion.ids('usuarios') : [0];
        const [u] = await consultar(comprobacion, 'SELECT COUNT(*) AS n FROM pansys_test.usuarios WHERE id IN (?)', [usuariosPropios]);
        const [p] = await consultar(comprobacion, 'SELECT COUNT(*) AS n FROM pansys_test.panaderias WHERE id IN (?)', [ejecucion.ids('panaderias').length ? ejecucion.ids('panaderias') : [0]]);
        const [pr] = await consultar(comprobacion, 'SELECT COUNT(*) AS n FROM pansys_test.productos WHERE panaderia_id IN (?)', [ejecucion.ids('panaderias').length ? ejecucion.ids('panaderias') : [0]]);
        informe.comprobar('V5', 'tras la limpieza no queda ninguna fila propia', [u, p, pr].every(f => Number(f?.n) === 0));
        if (v16Ejecutada) {
          const [e] = await consultar(comprobacion, CONTAR_EVENTOS, [usuariosPropios, usuariosPropios]);
          const [r] = await consultar(comprobacion, CONTAR_ENLACES, [usuariosPropios, usuariosPropios]);
          informe.comprobar('V16', 'tras la limpieza no queda ningún evento ni enlace de las cuentas propias',
            Number(e?.n) === 0 && Number(r?.n) === 0, `eventos/enlaces = ${e?.n}/${r?.n}`);
        }
      } catch (error) {
        informe.comprobar('V5', 'comprobación posterior a la limpieza', false, codigoDe(error));
      } finally {
        await cerrarConexiones();
      }
    }
    await ejecucion.cerrar().catch(() => {});
  }

  salida(informe.fallos.length || !limpiezaCorrecta
    ? `\nVerificación con fallos (${informe.fallos.join(', ') || 'limpieza'}). Revise la salida y tome la foto posterior.`
    : '\nTodas las comprobaciones de esta ejecución dieron OK. Compare ahora la foto posterior con la anterior (V9).');
  return informe.fallos.length || !limpiezaCorrecta ? 1 : 0;
};

if (require.main === module) {
  require('dotenv').config({ quiet: true });
  ejecutar()
    .then(codigo => { process.exitCode = codigo; })
    .catch(error => {
      console.error(`Verificación interrumpida: ${codigoDe(error)}`);
      process.exitCode = 1;
    });
}

module.exports = { BASE, ErrorVerificacion, verificarBase, abrirConexion, escribir, evaluarLimpieza, ejecutar };
