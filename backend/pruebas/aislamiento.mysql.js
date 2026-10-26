// Verificación de pruebas/aislamiento.js contra MySQL real (hipótesis V1-V10 del plan). Escribe
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
  const { iniciarEjecucion, ErrorAislamiento, NOMBRE_BLOQUEO } = require('./aislamiento');
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

    // ---------- Datos propios (solo con el bloqueo vigente) ----------
    await ejecucion.exigirBloqueo();
    // Antes del primer INSERT: si el proceso se interrumpe, el runId ya está a la vista
    informe.nota(`runId de esta ejecución: ${ejecucion.runId} (filas marcadas con "prueba.verificacion.${ejecucion.runId}." y "PRUEBA ${ejecucion.runId}")`);
    const insertar = async (sql, params) => (await escribir(datos, 'datos', sql, params)).insertId;
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
    } else {
      limpiezaCorrecta = true;
      informe.comprobar('V5', 'limpiar() borra lo propio con los recuentos previstos',
        previstos !== null && JSON.stringify(limpieza.borrados) === JSON.stringify(previstos), JSON.stringify(limpieza.borrados));
      try {
        const comprobacion = await abrir('comprobacion');
        const [u] = await consultar(comprobacion, 'SELECT COUNT(*) AS n FROM pansys_test.usuarios WHERE id IN (?)', [ejecucion.ids('usuarios').length ? ejecucion.ids('usuarios') : [0]]);
        const [p] = await consultar(comprobacion, 'SELECT COUNT(*) AS n FROM pansys_test.panaderias WHERE id IN (?)', [ejecucion.ids('panaderias').length ? ejecucion.ids('panaderias') : [0]]);
        const [pr] = await consultar(comprobacion, 'SELECT COUNT(*) AS n FROM pansys_test.productos WHERE panaderia_id IN (?)', [ejecucion.ids('panaderias').length ? ejecucion.ids('panaderias') : [0]]);
        informe.comprobar('V5', 'tras la limpieza no queda ninguna fila propia', [u, p, pr].every(f => Number(f?.n) === 0));
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
