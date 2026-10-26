// Pruebas de integración de Inventario con materia_prima en DECIMAL(12,4) (SQL 003):
// formato, rango y precisión de cantidades y precio, valores inválidos y stock bajo.
//
// Aislamiento (pruebas/aislamiento.js): se ejecuta SOLO contra pansys_test, con el bloqueo de
// suite durante toda la ejecución. Crea una cuenta administradora temporal (inactiva), una
// panadería temporal suya y una cuenta panadera temporal activa en ella; todas las operaciones de
// inventario ocurren en esa panadería. Al terminar, ejecucion.limpiar() borra solo lo registrado
// por esta ejecución (una vez, sin reintentos). No hay ningún borrado propio en esta suite.
//
// El servidor de la API arranca en un puerto asignado por el sistema (PORT=0) y la suite obtiene
// su dirección real; antes de enviar ningún token comprueba que responde con el runId propio.
//
// Código de salida 0 solo si todas las pruebas pasan y la limpieza es correcta.
//
// Uso (desde backend/):  node pruebas/inventario.pruebas.js

// ---------- Barreras previas a cualquier carga o conexión ----------
const opcionesProhibidas = () => ['PANSYS_MODO_DEMO', 'PANSYS_SERVIR_FRONTEND'].filter(v => process.env[v] !== undefined);
if (opcionesProhibidas().length) {
  console.error(`Suite de Inventario cancelada: ${opcionesProhibidas().join(', ')} está definida. No se ha conectado nada ni escrito nada.`);
  process.exit(1);
}

process.env.DB_NAME = 'pansys_test';
process.env.PORT = '0'; // puerto asignado por el sistema: nunca coincide con otro proceso
require('dotenv').config({ quiet: true }); // no sobrescribe DB_NAME ni PORT
if (opcionesProhibidas().length) {
  console.error(`Suite de Inventario cancelada: ${opcionesProhibidas().join(', ')} está definida en el .env. No se ha conectado nada ni escrito nada.`);
  process.exit(1);
}

const jwt = require('jsonwebtoken');
const { sequelize } = require('../src/models/index');
const { iniciarEjecucion, limpiezaCorrecta, describirPendientes } = require('./aislamiento');

const MAXIMO = '99999999.9999';

const resultados = [];
const registrar = (ok, descripcion, detalle = '') => {
  resultados.push({ ok, descripcion });
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${descripcion}${!ok && detalle ? ` -> ${detalle}` : ''}`);
};

// Estado de la ejecución: solo se envían peticiones con URL y token una vez confirmada la identidad
let ejecucion = null;
let servidor = null;
let panaderiaId = null;
let URL = null;
let TOKEN = null;

const pedir = async (metodo, ruta, body) => {
  if (!URL || !TOKEN) throw new Error('No se envían peticiones: la identidad del servidor no está confirmada');
  const r = await fetch(URL + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let datos = null;
  try { datos = await r.json(); } catch { /* sin cuerpo */ }
  return { status: r.status, datos };
};

const esperar = async (descripcion, status, metodo, ruta, body) => {
  const r = await pedir(metodo, ruta, body);
  registrar(r.status === status, descripcion, `HTTP ${r.status}: ${JSON.stringify(r.datos)}`);
  return r.datos;
};

const igual = (descripcion, real, esperado) =>
  registrar(JSON.stringify(real) === JSON.stringify(esperado), descripcion,
    `obtenido ${JSON.stringify(real)}, esperado ${JSON.stringify(esperado)}`);

// ---------- Lecturas de la base, limitadas a la panadería temporal ----------
// Valores exactos guardados en la base, como texto (sin pasar por números de JavaScript)
const enBase = async (id) => (await sequelize.query(
  `SELECT CAST(cantidad_disponible AS CHAR) AS disponible, CAST(stock_minimo AS CHAR) AS minimo,
          CAST(precio_unitario AS CHAR) AS precio FROM pansys_test.materia_prima WHERE id = ? AND panaderia_id = ?`,
  { replacements: [id ?? 0, panaderiaId] }))[0][0];

const contar = async () => Number((await sequelize.query(
  'SELECT COUNT(*) AS n FROM pansys_test.materia_prima WHERE panaderia_id = ?', { replacements: [panaderiaId] }))[0][0].n);

// Nombres exactos enviados por esta ejecución ('PRUEBA <runId> …': solo ella puede producirlos)
const nombresEnviados = new Set();

// Materias primas con alguno de esos nombres exactos FUERA de la panadería temporal. La actividad
// legítima de la demo no puede producirlos, así que no da fallos falsos. Sin nombres no se consulta
// (IN () sería SQL inválido).
const contarNombresPropiosFuera = async () => {
  if (!nombresEnviados.size) return 0;
  return Number((await sequelize.query(
    'SELECT COUNT(*) AS n FROM pansys_test.materia_prima WHERE panaderia_id <> ? AND nombre IN (?)',
    { replacements: [panaderiaId, [...nombresEnviados]] }))[0][0].n);
};

const insumo = (nombre, extra = {}) => {
  const exacto = ejecucion.nombre(nombre);
  nombresEnviados.add(exacto);
  return { nombre: exacto, unidad_medida: 'kg', ...extra };
};

// ---------- Servidor de la API ----------
// app.js llama a app.listen() de forma asíncrona (después de sequelize.authenticate()). Sustituir
// app.listen en el mismo turno síncrono que el require garantiza capturar el servidor real.
const arrancarServidor = async () => {
  const app = require('../src/app');
  const listenOriginal = app.listen;
  app.listen = function (...args) {
    servidor = listenOriginal.apply(this, args);
    return servidor;
  };
  // Ruta de identidad: solo este proceso conoce el runId
  app.get(`/api/__aislamiento/${ejecucion.runId}`, (req, res) => res.json({ runId: ejecucion.runId }));

  for (let i = 0; i < 40 && !servidor?.listening; i++) await new Promise(r => setTimeout(r, 250));
  if (!servidor?.listening) throw new Error('El servidor de pruebas no llegó a escuchar (ver el error de arranque de app.js)');
  const direccion = servidor.address();
  if (!direccion || typeof direccion !== 'object' || !Number.isInteger(direccion.port) || direccion.port <= 0) {
    throw new Error('No se pudo obtener la dirección real del servidor de pruebas');
  }
  // Bucle local de la misma familia en la que escucha el servidor propio
  const base = direccion.family === 'IPv6' || direccion.family === 6 ? `http://[::1]:${direccion.port}` : `http://127.0.0.1:${direccion.port}`;

  // Identidad: petición sin token ni cuerpo; solo si devuelve el runId propio se habilitan las pruebas
  let identidad = null;
  try {
    const r = await fetch(`${base}/api/__aislamiento/${ejecucion.runId}`);
    identidad = r.status === 200 ? await r.json() : null;
  } catch { /* identidad no confirmada */ }
  if (identidad?.runId !== ejecucion.runId) throw new Error('El servidor no confirmó el runId de esta ejecución: no se ejecutan las pruebas');
  URL = base;
  console.log(`Servidor de pruebas propio confirmado en el puerto ${direccion.port}`);
};

const cerrarServidor = () => new Promise((resolve, reject) => {
  if (!servidor?.listening) return resolve();
  const limite = setTimeout(() => reject(new Error('el servidor no se cerró en 5 s')), 5000);
  servidor.close((error) => { clearTimeout(limite); error ? reject(error) : resolve(); });
  servidor.closeAllConnections?.();
});

const main = async () => {
  // ---------- Protección: solo pansys_test y con el esquema de producción (lecturas) ----------
  await sequelize.authenticate();
  const [[{ base }]] = await sequelize.query('SELECT DATABASE() AS base');
  if (base !== 'pansys_test') {
    throw new Error(`Base conectada "${base}": las pruebas solo se ejecutan sobre pansys_test`);
  }
  // El backend requiere usuarios.version_sesion (SQL 004): sin ella, toda petición autenticada falla
  const [versionSesion] = await sequelize.query(`
    SELECT COUNT(*) AS n FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = 'pansys_test' AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'version_sesion'`);
  if (Number(versionSesion[0].n) !== 1) {
    throw new Error('pansys_test no tiene usuarios.version_sesion: aplique database/pruebas/004_version_sesion_pansys_test.sql');
  }
  const [tipos] = await sequelize.query(`
    SELECT COLUMN_NAME AS c, COLUMN_TYPE AS t, IS_NULLABLE AS n, COLUMN_DEFAULT AS d FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = 'pansys_test' AND TABLE_NAME = 'materia_prima'
      AND COLUMN_NAME IN ('cantidad_disponible', 'stock_minimo', 'precio_unitario')`);
  if (tipos.length !== 3 || !tipos.every(f => f.t === 'decimal(12,4)' && f.n === 'NO' && f.d === '0.0000')) {
    throw new Error(`materia_prima de pansys_test no es DECIMAL(12,4) NOT NULL DEFAULT 0.0000: ${JSON.stringify(tipos)}`);
  }

  // ---------- Bloqueo de suite y datos propios ----------
  // iniciarEjecucion comprueba DB_NAME, la conexión dedicada y la de Sequelize, y toma el bloqueo
  ejecucion = await iniciarEjecucion({ suite: 'inventario', sequelize });
  console.log(`      runId de esta ejecución: ${ejecucion.runId} (filas marcadas con "prueba.inventario.${ejecucion.runId}." y "PRUEBA ${ejecucion.runId}")`);
  const adminId = await ejecucion.crearCuenta({ etiqueta: 'admin', rol: 'administrador', activa: false });
  panaderiaId = await ejecucion.crearPanaderia({ etiqueta: 'Inventario', propietariaId: adminId });
  const panaderoId = await ejecucion.crearCuenta({ etiqueta: 'panadero', rol: 'panadero', panaderiaId, activa: true });
  // Token de la cuenta temporal: el middleware lee rol, panadería y estado de la base
  TOKEN = jwt.sign({
    id: panaderoId, email: ejecucion.correo('panadero'), rol: 'panadero', rol_id: 2,
    panaderia_id: panaderiaId, version_sesion: 0
  }, process.env.JWT_SECRET, { expiresIn: '10m' });

  await arrancarServidor();

  // ---------- Cantidades fraccionarias y precios con decimales ----------
  await ejecucion.exigirBloqueo();
  console.log('\n== Precisión: ida y vuelta exacta');
  const fino = await esperar('crear con 4 decimales en las tres columnas -> 201', 201, 'POST', '/api/inventario',
    insumo('Fino', { cantidad_disponible: 0.0001, stock_minimo: 0.125, precio_unitario: 12.3456 }));
  igual('la respuesta devuelve números con sus 4 decimales',
    [fino?.cantidad_disponible, fino?.stock_minimo, fino?.precio_unitario], [0.0001, 0.125, 12.3456]);
  igual('se crea en la panadería temporal', fino?.panaderia_id, panaderiaId);
  igual('en la base quedan exactos', await enBase(fino?.id), { disponible: '0.0001', minimo: '0.1250', precio: '12.3456' });
  const leido = (await pedir('GET', `/api/inventario/${fino?.id}`)).datos;
  igual('GET devuelve los mismos números', [leido?.cantidad_disponible, leido?.stock_minimo, leido?.precio_unitario], [0.0001, 0.125, 12.3456]);

  const texto = await esperar('valores como texto con punto decimal -> 201', 201, 'POST', '/api/inventario',
    insumo('Texto', { cantidad_disponible: '25000.125', stock_minimo: ' 2.5 ', precio_unitario: '0.0125' }));
  igual('el texto se convierte en número', [texto?.cantidad_disponible, texto?.stock_minimo, texto?.precio_unitario], [25000.125, 2.5, 0.0125]);
  igual('en la base: 25000.1250 / 2.5000 / 0.0125', await enBase(texto?.id), { disponible: '25000.1250', minimo: '2.5000', precio: '0.0125' });

  const porDefecto = await esperar('sin cantidades ni precio -> 201 con 0', 201, 'POST', '/api/inventario', insumo('PorDefecto'));
  igual('valores por defecto 0', await enBase(porDefecto?.id), { disponible: '0.0000', minimo: '0.0000', precio: '0.0000' });
  await esperar('cero explícito -> 201', 201, 'POST', '/api/inventario',
    insumo('Cero', { cantidad_disponible: 0, stock_minimo: '0', precio_unitario: '0.0000' }));

  // ---------- Valores límite ----------
  await ejecucion.exigirBloqueo();
  console.log('\n== Valores límite de DECIMAL(12,4)');
  const maximo = await esperar('máximo 99.999.999,9999 en las tres columnas -> 201', 201, 'POST', '/api/inventario',
    insumo('Maximo', { cantidad_disponible: MAXIMO, stock_minimo: MAXIMO, precio_unitario: MAXIMO }));
  igual('el máximo se guarda exacto', await enBase(maximo?.id), { disponible: MAXIMO, minimo: MAXIMO, precio: MAXIMO });
  igual('y se devuelve exacto', maximo?.cantidad_disponible, 99999999.9999);

  const antes = await contar();
  for (const [campo, valor] of [
    ['cantidad_disponible', '100000000'], ['stock_minimo', 100000000], ['precio_unitario', '100000000.0000'],
    ['precio_unitario', '99999999.99999']
  ]) {
    const r = await pedir('POST', '/api/inventario', insumo('Fuera', { [campo]: valor }));
    registrar(r.status === 400 && !/out of range|sql/i.test(r.datos?.error ?? ''), `${campo} = ${valor} -> 400 sin detalles internos`,
      `HTTP ${r.status}: ${JSON.stringify(r.datos)}`);
  }
  igual('ningún valor fuera de rango creó filas', await contar(), antes);

  // ---------- Valores inválidos ----------
  await ejecucion.exigirBloqueo();
  console.log('\n== Valores inválidos');
  const invalidos = [
    ['más de 4 decimales (número)', 1.23456],
    ['más de 4 decimales (texto)', '1.23456'],
    ['negativo', -1],
    ['negativo como texto', '-0.5'],
    ['null', null],
    ['texto vacío', ''],
    ['texto no numérico', 'abc'],
    ['coma decimal', '1,5'],
    ['notación científica', '1e3'],
    ['número muy pequeño (1e-7)', 0.0000001],
    ['booleano', true],
    ['lista', [1]],
    ['objeto', { valor: 1 }]
  ];
  for (const campo of ['cantidad_disponible', 'precio_unitario']) {
    for (const [descripcion, valor] of invalidos) {
      const r = await pedir('POST', '/api/inventario', insumo('Invalido', { [campo]: valor }));
      registrar(r.status === 400 && (r.datos?.error ?? '').includes(campo), `${campo}: ${descripcion} -> 400 que nombra el campo`,
        `HTTP ${r.status}: ${JSON.stringify(r.datos)}`);
    }
  }
  igual('ningún valor inválido creó filas', await contar(), antes);

  // ---------- Edición ----------
  await ejecucion.exigirBloqueo();
  console.log('\n== Edición (PUT)');
  const editado = await esperar('editar solo el precio con 4 decimales -> 200', 200, 'PUT', `/api/inventario/${fino?.id}`,
    { precio_unitario: '7.0005' });
  igual('el precio cambia y lo demás se conserva', await enBase(fino?.id), { disponible: '0.0001', minimo: '0.1250', precio: '7.0005' });
  igual('la respuesta devuelve el precio exacto', editado?.precio_unitario, 7.0005);
  await esperar('editar con valor inválido -> 400', 400, 'PUT', `/api/inventario/${fino?.id}`, { cantidad_disponible: '5.12345' });
  await esperar('editar fuera de rango -> 400', 400, 'PUT', `/api/inventario/${fino?.id}`, { stock_minimo: '100000000' });
  igual('las ediciones rechazadas no cambian nada', await enBase(fino?.id), { disponible: '0.0001', minimo: '0.1250', precio: '7.0005' });

  // ---------- Stock bajo en el límite ----------
  await ejecucion.exigirBloqueo();
  console.log('\n== Stock bajo en el límite');
  const igualMinimo = (await pedir('POST', '/api/inventario', insumo('IgualMinimo', { cantidad_disponible: '2.5', stock_minimo: '2.5' }))).datos;
  const porEncima = (await pedir('POST', '/api/inventario', insumo('PorEncima', { cantidad_disponible: '2.5001', stock_minimo: '2.5' }))).datos;
  const porDebajo = (await pedir('POST', '/api/inventario', insumo('PorDebajo', { cantidad_disponible: '2.4999', stock_minimo: '2.5' }))).datos;
  const bajos = ((await pedir('GET', '/api/inventario/stock-bajo')).datos ?? []).map(i => i.id);
  igual('disponible = mínimo aparece en stock bajo', bajos.includes(igualMinimo?.id), true);
  igual('0,0001 por debajo aparece en stock bajo', bajos.includes(porDebajo?.id), true);
  igual('0,0001 por encima NO aparece', bajos.includes(porEncima?.id), false);
  const bajosAjenos = bajos.length ? Number((await sequelize.query(
    'SELECT COUNT(*) AS n FROM pansys_test.materia_prima WHERE id IN (?) AND panaderia_id <> ?', { replacements: [bajos, panaderiaId] }))[0][0].n) : 0;
  igual('stock bajo solo devuelve materias primas de la panadería temporal', bajosAjenos, 0);

  // ---------- Invariantes ----------
  await ejecucion.exigirBloqueo();
  console.log('\n== Invariantes');
  const [[negativos]] = await sequelize.query(
    'SELECT COUNT(*) AS n FROM pansys_test.materia_prima WHERE panaderia_id = ? AND (cantidad_disponible < 0 OR stock_minimo < 0 OR precio_unitario < 0)',
    { replacements: [panaderiaId] });
  igual('ninguna materia prima de la prueba con valores negativos', Number(negativos.n), 0);
  igual('las 8 materias primas creadas están en la panadería temporal', await contar(), 8);
  igual('se enviaron nombres de prueba (la comprobación siguiente no es vacía)', nombresEnviados.size > 0, true);
  igual('ninguna petición de la suite creó materias primas fuera de la panadería temporal (por nombre exacto)', await contarNombresPropiosFuera(), 0);
};

main()
  .catch(error => registrar(false, 'Ejecución abortada', error.message))
  .finally(async () => {
    // Cierre ordenado: (1) el servidor deja de aceptar peticiones; (2) una sola limpieza, por la
    // conexión dedicada; (3) solo después se libera el bloqueo y se cierra la conexión dedicada;
    // (4) Sequelize. Los fallos de cierre se informan además de los errores anteriores.
    const problemasCierre = [];
    try { await cerrarServidor(); } catch (error) { problemasCierre.push(`servidor: ${error.message}`); }

    let limpieza = null;
    if (ejecucion) {
      limpieza = await ejecucion.limpiar(); // nunca lanza; no se reintenta
      const correcta = limpiezaCorrecta(limpieza);
      registrar(correcta, 'limpieza de lo propio con ejecucion.limpiar()', `resultado: ${limpieza?.resultado}`);
      if (!correcta) describirPendientes(limpieza).forEach(l => console.log(`      ${l}`));
      try { await ejecucion.cerrar(); } catch (error) { problemasCierre.push(`conexión dedicada: ${error.message}`); }
    } else {
      registrar(false, 'no hubo ejecución aislada (no se escribió nada en pansys_test)');
    }
    try { await sequelize.close(); } catch (error) { problemasCierre.push(`Sequelize: ${error.message}`); }
    problemasCierre.forEach(p => registrar(false, `cierre: ${p}`));

    const fallidas = resultados.filter(r => !r.ok).length;
    const codigo = fallidas === 0 && limpiezaCorrecta(limpieza) ? 0 : 1;
    console.log(`\n${resultados.length - fallidas}/${resultados.length} pruebas correctas`);
    if (codigo !== 0 && ejecucion) console.log(`runId de esta ejecución: ${ejecucion.runId}`);
    process.exit(codigo);
  });
