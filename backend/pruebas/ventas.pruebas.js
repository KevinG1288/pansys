// Pruebas de integración de Ventas: descuento de stock de productos, atomicidad, validaciones,
// aislamiento entre panaderías y permisos, integración con Producción, concurrencia y rollback.
//
// Aislamiento (pruebas/aislamiento.js): se ejecuta SOLO contra pansys_test, con el bloqueo de
// suite durante toda la ejecución. Crea una cuenta administradora temporal activa (propietaria),
// dos panaderías temporales A y B, una cuenta panadera en cada una y una gerente en A; todo ocurre
// en esas panaderías. El producto inactivo se crea con ejecucion.crearProducto(). Al terminar,
// ejecucion.limpiar() borra solo lo registrado por esta ejecución (una vez, sin reintentos). No hay
// ningún borrado ni ninguna escritura directa propia en esta suite.
//
// El servidor de la API arranca en un puerto asignado por el sistema (PORT=0) y la suite obtiene
// su dirección real; antes de enviar ningún token comprueba que responde con el runId propio.
//
// Código de salida 0 solo si todas las pruebas pasan y la limpieza es correcta.
//
// Uso (desde backend/):  npm run test:ventas   (o: node pruebas/ventas.pruebas.js)

// ---------- Barreras previas a cualquier carga o conexión ----------
const opcionesProhibidas = () => ['PANSYS_MODO_DEMO', 'PANSYS_SERVIR_FRONTEND'].filter(v => process.env[v] !== undefined);
if (opcionesProhibidas().length) {
  console.error(`Suite de Ventas cancelada: ${opcionesProhibidas().join(', ')} está definida. No se ha conectado nada ni escrito nada.`);
  process.exit(1);
}

process.env.DB_NAME = 'pansys_test';
process.env.PORT = '0'; // puerto asignado por el sistema: nunca coincide con otro proceso
require('dotenv').config({ quiet: true }); // no sobrescribe DB_NAME ni PORT
if (opcionesProhibidas().length) {
  console.error(`Suite de Ventas cancelada: ${opcionesProhibidas().join(', ')} está definida en el .env. No se ha conectado nada ni escrito nada.`);
  process.exit(1);
}

const jwt = require('jsonwebtoken');
const { sequelize, DetalleVenta } = require('../src/models/index');
const { iniciarEjecucion, limpiezaCorrecta, describirPendientes } = require('./aislamiento');

const resultados = [];
const registrar = (ok, descripcion, detalle = '') => {
  resultados.push({ ok, descripcion });
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${descripcion}${!ok && detalle ? ` -> ${detalle}` : ''}`);
};

// Estado de la ejecución: solo se envían peticiones con URL y tokens una vez confirmada la identidad
let ejecucion = null;
let servidor = null;
let URL = null;
const TOKENS = {};
const cuentas = {};
let panaderiaA = null;
let panaderiaB = null;

const pedir = async (metodo, ruta, usuario, body) => {
  if (!URL || !TOKENS[usuario]) throw new Error('No se envían peticiones: la identidad del servidor no está confirmada o el usuario no es temporal');
  const r = await fetch(URL + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKENS[usuario]}` },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let datos = null;
  try { datos = await r.json(); } catch { /* sin cuerpo */ }
  return { status: r.status, datos };
};

const esperar = async (descripcion, status, metodo, ruta, usuario, body) => {
  const r = await pedir(metodo, ruta, usuario, body);
  registrar(r.status === status, descripcion, `HTTP ${r.status}: ${JSON.stringify(r.datos)}`);
  return r.datos;
};

const igual = (descripcion, real, esperado) =>
  registrar(JSON.stringify(real) === JSON.stringify(esperado), descripcion,
    `obtenido ${JSON.stringify(real)}, esperado ${JSON.stringify(esperado)}`);

// ---------- Lecturas de la base, limitadas a las panaderías temporales A y B ----------
const propias = () => [panaderiaA, panaderiaB];

const stock = async (id) => (await sequelize.query(
  'SELECT cantidad_disponible AS d FROM pansys_test.productos WHERE id = ? AND panaderia_id IN (?)',
  { replacements: [id ?? 0, propias()] }))[0][0]?.d;

const contarVentas = async () => Number((await sequelize.query(
  'SELECT COUNT(*) AS n FROM pansys_test.ventas WHERE panaderia_id IN (?)', { replacements: [propias()] }))[0][0].n);

// Nombres exactos enviados por esta ejecución ('PRUEBA <runId> …': solo ella puede producirlos)
const nombresEnviados = new Set();
const nombre = (texto) => {
  const exacto = ejecucion.nombre(texto);
  nombresEnviados.add(exacto);
  return exacto;
};

// Filas con alguno de esos nombres exactos FUERA de las panaderías temporales (sin nombres no se
// consulta: IN () sería SQL inválido). La actividad de la demo no puede producirlos.
const contarNombresPropiosFuera = async () => {
  if (!nombresEnviados.size) return 0;
  const opciones = { replacements: [propias(), [...nombresEnviados]] };
  const productos = Number((await sequelize.query(
    'SELECT COUNT(*) AS n FROM pansys_test.productos WHERE panaderia_id NOT IN (?) AND nombre IN (?)', opciones))[0][0].n);
  const materias = Number((await sequelize.query(
    'SELECT COUNT(*) AS n FROM pansys_test.materia_prima WHERE panaderia_id NOT IN (?) AND nombre IN (?)', opciones))[0][0].n);
  return productos + materias;
};

const vender = (usuario, productos, extra = {}) => pedir('POST', '/api/ventas', usuario, { productos, ...extra });

// ---------- Servidor de la API (mismo ciclo de vida que inventario.pruebas.js) ----------
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
  // ---------- Protección: solo pansys_test (lecturas) ----------
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

  // ---------- Bloqueo de suite y datos propios ----------
  // iniciarEjecucion comprueba DB_NAME, la conexión dedicada y la de Sequelize, y toma el bloqueo
  ejecucion = await iniciarEjecucion({ suite: 'ventas', sequelize });
  console.log(`      runId de esta ejecución: ${ejecucion.runId} (filas marcadas con "prueba.ventas.${ejecucion.runId}." y "PRUEBA ${ejecucion.runId}")`);
  // Administradora ACTIVA: la venta del administrador necesita una cuenta administradora válida
  cuentas.admin = await ejecucion.crearCuenta({ etiqueta: 'admin', rol: 'administrador', activa: true });
  panaderiaA = await ejecucion.crearPanaderia({ etiqueta: 'A', propietariaId: cuentas.admin });
  panaderiaB = await ejecucion.crearPanaderia({ etiqueta: 'B', propietariaId: cuentas.admin });
  cuentas.panaderoa = await ejecucion.crearCuenta({ etiqueta: 'panaderoa', rol: 'panadero', panaderiaId: panaderiaA, activa: true });
  cuentas.panaderob = await ejecucion.crearCuenta({ etiqueta: 'panaderob', rol: 'panadero', panaderiaId: panaderiaB, activa: true });
  cuentas.gerentea = await ejecucion.crearCuenta({ etiqueta: 'gerentea', rol: 'gerente', panaderiaId: panaderiaA, activa: true });
  // Producto inactivo, creado con la escritura protegida del módulo (la API no permite desactivar
  // productos). Su nombre exacto también entra en la comprobación de aislamiento.
  nombre('Inactivo');
  const inactivoId = await ejecucion.crearProducto({ etiqueta: 'Inactivo', panaderiaId: panaderiaA, precio: 100, cantidad: 50, activo: false });

  // Tokens de las cuentas temporales: el middleware lee rol, panadería y estado de la base
  const firmar = (id, etiqueta, rol, rolId, panaderiaId) => jwt.sign({
    id, email: ejecucion.correo(etiqueta), rol, rol_id: rolId, panaderia_id: panaderiaId, version_sesion: 0
  }, process.env.JWT_SECRET, { expiresIn: '10m' });
  TOKENS.admin = firmar(cuentas.admin, 'admin', 'administrador', 1, null);
  TOKENS.panaderoa = firmar(cuentas.panaderoa, 'panaderoa', 'panadero', 2, panaderiaA);
  TOKENS.panaderob = firmar(cuentas.panaderob, 'panaderob', 'panadero', 2, panaderiaB);
  TOKENS.gerentea = firmar(cuentas.gerentea, 'gerentea', 'gerente', 3, panaderiaA);

  await arrancarServidor();

  const crearProductoApi = async (usuario, texto, precio, cantidad) => (await pedir('POST', '/api/ventas/productos', usuario, {
    nombre: nombre(texto), precio_venta: precio, ...(cantidad === undefined ? {} : { cantidad_disponible: cantidad })
  })).datos;
  await ejecucion.exigirBloqueo();
  const pan = await crearProductoApi('panaderoa', 'Pan', 500, 10);
  const torta = await crearProductoApi('panaderoa', 'Torta', 2000, 2);
  const sinStock = await crearProductoApi('panaderoa', 'Galleta sin stock', 300);
  const panB = await crearProductoApi('panaderob', 'Pan B', 500, 5);
  igual('los productos se crean en su panadería temporal', [pan?.panaderia_id, torta?.panaderia_id, sinStock?.panaderia_id, panB?.panaderia_id],
    [panaderiaA, panaderiaA, panaderiaA, panaderiaB]);

  // ---------- Descuento de stock ----------
  await ejecucion.exigirBloqueo();
  console.log('\n== Descuento de stock');
  const venta = await esperar('venta de 3 panes y 1 torta', 201, 'POST', '/api/ventas', 'panaderoa',
    { productos: [{ producto_id: pan?.id, cantidad: 3 }, { producto_id: torta?.id, cantidad: 1 }] });
  igual('total, empleado y panadería', [venta?.total, venta?.empleado_id, venta?.panaderia_id], [3500, cuentas.panaderoa, panaderiaA]);
  igual('stock descontado (pan 7, torta 1)', [await stock(pan?.id), await stock(torta?.id)], [7, 1]);
  const [detalles] = await sequelize.query(
    `SELECT d.producto_id, d.cantidad, d.subtotal FROM pansys_test.detalle_ventas d
     JOIN pansys_test.ventas v ON v.id = d.venta_id
     WHERE d.venta_id = ? AND v.panaderia_id IN (?) ORDER BY d.producto_id`, { replacements: [venta?.id ?? 0, propias()] });
  igual('detalle de la venta', detalles.map(d => [d.producto_id, d.cantidad, d.subtotal]), [[pan?.id, 3, 1500], [torta?.id, 1, 2000]]);

  // ---------- Stock insuficiente ----------
  await ejecucion.exigirBloqueo();
  console.log('\n== Stock insuficiente');
  const ventasAntes = await contarVentas();
  const sinTortas = await esperar('vender 2 tortas con 1 disponible -> 409', 409, 'POST', '/api/ventas', 'panaderoa',
    { productos: [{ producto_id: torta?.id, cantidad: 2 }] });
  igual('el mensaje indica producto, disponible y solicitado', /Torta \(disponible 1, solicitado 2\)/.test(sinTortas?.error ?? ''), true);
  await esperar('venta mixta con una línea sin stock -> 409', 409, 'POST', '/api/ventas', 'panaderoa',
    { productos: [{ producto_id: pan?.id, cantidad: 1 }, { producto_id: torta?.id, cantidad: 5 }] });
  igual('atomicidad: el pan de la venta rechazada no se descontó', [await stock(pan?.id), await stock(torta?.id)], [7, 1]);
  igual('ninguna venta registrada en los rechazos', await contarVentas(), ventasAntes);
  await esperar('producto sin stock inicial -> 409', 409, 'POST', '/api/ventas', 'panaderoa',
    { productos: [{ producto_id: sinStock?.id, cantidad: 1 }] });
  await esperar('vender exactamente el stock disponible', 201, 'POST', '/api/ventas', 'panaderoa',
    { productos: [{ producto_id: torta?.id, cantidad: 1 }] });
  igual('torta queda en 0', await stock(torta?.id), 0);
  await esperar('vender con stock 0 -> 409', 409, 'POST', '/api/ventas', 'panaderoa',
    { productos: [{ producto_id: torta?.id, cantidad: 1 }] });

  // ---------- Validaciones ----------
  await ejecucion.exigirBloqueo();
  console.log('\n== Validaciones');
  await esperar('sin productos -> 400', 400, 'POST', '/api/ventas', 'panaderoa', { productos: [] });
  await esperar('productos ausente -> 400', 400, 'POST', '/api/ventas', 'panaderoa', {});
  await esperar('cantidad 0 -> 400', 400, 'POST', '/api/ventas', 'panaderoa', { productos: [{ producto_id: pan?.id, cantidad: 0 }] });
  await esperar('cantidad 1.5 -> 400', 400, 'POST', '/api/ventas', 'panaderoa', { productos: [{ producto_id: pan?.id, cantidad: 1.5 }] });
  await esperar('cantidad negativa -> 400', 400, 'POST', '/api/ventas', 'panaderoa', { productos: [{ producto_id: pan?.id, cantidad: -2 }] });
  await esperar('producto repetido -> 400', 400, 'POST', '/api/ventas', 'panaderoa',
    { productos: [{ producto_id: pan?.id, cantidad: 1 }, { producto_id: pan?.id, cantidad: 1 }] });
  igual('validaciones: stock intacto', await stock(pan?.id), 7);

  // ---------- Aislamiento y permisos ----------
  await ejecucion.exigirBloqueo();
  console.log('\n== Aislamiento y permisos');
  await esperar('panadero de A vende producto de B -> 404', 404, 'POST', '/api/ventas', 'panaderoa', { productos: [{ producto_id: panB?.id, cantidad: 1 }] });
  await esperar('panadero de B vende producto de A -> 404', 404, 'POST', '/api/ventas', 'panaderob', { productos: [{ producto_id: pan?.id, cantidad: 1 }] });
  igual('stocks de ambas panaderías intactos', [await stock(pan?.id), await stock(panB?.id)], [7, 5]);
  await esperar('producto inactivo -> 404', 404, 'POST', '/api/ventas', 'panaderoa', { productos: [{ producto_id: inactivoId, cantidad: 1 }] });
  igual('el producto inactivo conserva su stock', await stock(inactivoId), 50);
  await esperar('gerente vende -> 403', 403, 'POST', '/api/ventas', 'gerentea', { productos: [{ producto_id: pan?.id, cantidad: 1 }] });
  const ventaAdmin = await esperar('admin vende indicando panaderia_id en el body (como el frontend)', 201, 'POST', '/api/ventas', 'admin',
    { panaderia_id: panaderiaA, empleado_id: 99, productos: [{ producto_id: pan?.id, cantidad: 1 }] });
  igual('empleado = usuario del token (se ignora empleado_id del cliente)', ventaAdmin?.empleado_id, cuentas.admin);
  igual('la venta del administrador queda en la panadería indicada', ventaAdmin?.panaderia_id, panaderiaA);
  igual('pan queda en 6', await stock(pan?.id), 6);

  // ---------- Integración con Producción ----------
  await ejecucion.exigirBloqueo();
  console.log('\n== Integración con Producción');
  const harina = await esperar('crear la harina en inventario -> 201', 201, 'POST', '/api/inventario', 'panaderoa', {
    nombre: nombre('Harina'), unidad_medida: 'kg', cantidad_disponible: 10, stock_minimo: 0, precio_unitario: 3000
  });
  const bizcocho = await crearProductoApi('panaderoa', 'Bizcocho', 800, 0);
  await esperar('crear la receta del bizcocho -> 201', 201, 'POST', `/api/produccion/recetas/${bizcocho?.id}`, 'panaderoa',
    { insumos: [{ materia_prima_id: harina?.id, cantidad_por_unidad: '0.1' }] });
  const orden = (await esperar('crear la orden de producción -> 201', 201, 'POST', '/api/produccion/ordenes', 'panaderoa',
    { producto_id: bizcocho?.id, cantidad_planificada: 5 }))?.orden;
  await esperar('finalizar la orden de producción -> 200', 200, 'PATCH', `/api/produccion/ordenes/${orden?.id}/finalizar`, 'panaderoa',
    { cantidad_producida: 5 });
  igual('producción suma 5 bizcochos', await stock(bizcocho?.id), 5);
  await esperar('vender los 5 bizcochos producidos', 201, 'POST', '/api/ventas', 'panaderoa', { productos: [{ producto_id: bizcocho?.id, cantidad: 5 }] });
  await esperar('vender uno más -> 409', 409, 'POST', '/api/ventas', 'panaderoa', { productos: [{ producto_id: bizcocho?.id, cantidad: 1 }] });
  igual('bizcocho queda en 0', await stock(bizcocho?.id), 0);

  // ---------- Concurrencia ----------
  await ejecucion.exigirBloqueo();
  console.log('\n== Concurrencia');
  const ultimo = await crearProductoApi('panaderoa', 'Ultimo pastel', 5000, 1);
  const simultaneas = await Promise.all([1, 2].map(() => vender('panaderoa', [{ producto_id: ultimo?.id, cantidad: 1 }])));
  igual('dos ventas simultáneas de la última unidad: 201 y 409', simultaneas.map(r => r.status).sort(), [201, 409]);
  igual('stock final 0 (sin negativos)', await stock(ultimo?.id), 0);

  // ---------- Error dentro de la transacción ----------
  await ejecucion.exigirBloqueo();
  console.log('\n== Error transaccional');
  const ventasT = await contarVentas();
  const errorOriginal = console.error;
  const bulkCreateOriginal = DetalleVenta.bulkCreate;
  let fallo;
  try {
    console.error = () => {};
    DetalleVenta.bulkCreate = async () => { throw new Error('Fallo simulado al guardar el detalle'); };
    fallo = await esperar('fallo al guardar el detalle -> 500', 500, 'POST', '/api/ventas', 'panaderoa', { productos: [{ producto_id: pan?.id, cantidad: 2 }] });
  } finally {
    // Se restauran siempre, aunque la petición o la aserción fallen
    DetalleVenta.bulkCreate = bulkCreateOriginal;
    console.error = errorOriginal;
  }
  igual('500 sin detalles internos', fallo?.error, 'Error interno del servidor');
  igual('rollback: stock y ventas intactos', [await stock(pan?.id), await contarVentas()], [6, ventasT]);

  // ---------- Invariantes (solo en las panaderías temporales) ----------
  await ejecucion.exigirBloqueo();
  console.log('\n== Invariantes');
  const [[negativos]] = await sequelize.query(
    'SELECT COUNT(*) AS n FROM pansys_test.productos WHERE panaderia_id IN (?) AND cantidad_disponible < 0', { replacements: [propias()] });
  igual('ningún producto de A o B con stock negativo', Number(negativos.n), 0);
  const [[huerfanas]] = await sequelize.query(
    `SELECT COUNT(*) AS n FROM pansys_test.ventas v LEFT JOIN pansys_test.detalle_ventas d ON d.venta_id = v.id
     WHERE v.panaderia_id IN (?) AND d.id IS NULL`, { replacements: [propias()] });
  igual('ninguna venta de A o B sin detalle', Number(huerfanas.n), 0);
  igual('se enviaron nombres de prueba (la comprobación siguiente no es vacía)', nombresEnviados.size > 0, true);
  igual('ninguna fila con nombres de esta ejecución fuera de las panaderías temporales', await contarNombresPropiosFuera(), 0);
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
