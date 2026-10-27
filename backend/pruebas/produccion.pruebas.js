// Pruebas de integración del módulo de Producción: recetas, cálculo, órdenes (crear, finalizar,
// cancelar con y sin devolución), precisión DECIMAL(12,4), concurrencia y errores transaccionales.
//
// Aislamiento (pruebas/aislamiento.js): se ejecuta SOLO contra pansys_test, con el bloqueo de
// suite durante toda la ejecución. Crea una cuenta administradora temporal activa (propietaria),
// dos panaderías temporales A y B, una cuenta panadera en cada una y una gerente en A; todo ocurre
// en esas panaderías. Al terminar, ejecucion.limpiar() borra solo lo registrado por esta ejecución
// (una vez, sin reintentos). No hay ningún borrado ni ninguna escritura directa propia en esta suite.
//
// El caso de una materia prima con precio negativo (dato heredado que la API ya no permite crear)
// no se simula escribiendo en la base: lo cubre pruebas/produccion.unitarias.js sobre el servicio.
//
// El servidor de la API arranca en un puerto asignado por el sistema (PORT=0) y la suite obtiene
// su dirección real; antes de enviar ningún token comprueba que responde con el runId propio.
//
// Código de salida 0 solo si todas las pruebas pasan y la limpieza es correcta.
//
// Uso (desde backend/):  npm run test:produccion   (o: node pruebas/produccion.pruebas.js)

// ---------- Barreras previas a cualquier carga o conexión ----------
const opcionesProhibidas = () => ['PANSYS_MODO_DEMO', 'PANSYS_SERVIR_FRONTEND'].filter(v => process.env[v] !== undefined);
if (opcionesProhibidas().length) {
  console.error(`Suite de Producción cancelada: ${opcionesProhibidas().join(', ')} está definida. No se ha conectado nada ni escrito nada.`);
  process.exit(1);
}

process.env.DB_NAME = 'pansys_test';
process.env.PORT = '0'; // puerto asignado por el sistema: nunca coincide con otro proceso
require('dotenv').config({ quiet: true }); // no sobrescribe DB_NAME ni PORT
if (opcionesProhibidas().length) {
  console.error(`Suite de Producción cancelada: ${opcionesProhibidas().join(', ')} está definida en el .env. No se ha conectado nada ni escrito nada.`);
  process.exit(1);
}

const jwt = require('jsonwebtoken');
const { sequelize, InsumoUsado, OrdenProduccion } = require('../src/models/index');
const { iniciarEjecucion, limpiezaCorrecta, describirPendientes } = require('./aislamiento');

const P = '/api/produccion';

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

// Verifica el código HTTP y devuelve el cuerpo
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

// Stock real leído directamente de la base (DECIMAL(12,4))
const stock = async (id) => {
  const [[fila]] = await sequelize.query(
    'SELECT CAST(cantidad_disponible AS DECIMAL(16,4)) AS d FROM pansys_test.materia_prima WHERE id = ? AND panaderia_id IN (?)',
    { replacements: [id ?? 0, propias()] }
  );
  return fila ? Number(fila.d) : null;
};

const stockProducto = async (id) => (await sequelize.query(
  'SELECT cantidad_disponible AS d FROM pansys_test.productos WHERE id = ? AND panaderia_id IN (?)',
  { replacements: [id ?? 0, propias()] }))[0][0]?.d;

const contarOrdenes = async () => Number((await sequelize.query(
  'SELECT COUNT(*) AS n FROM pansys_test.orden_produccion WHERE panaderia_id IN (?)', { replacements: [propias()] }))[0][0].n);

const estadoOrden = async (id) => (await sequelize.query(
  'SELECT estado FROM pansys_test.orden_produccion WHERE id = ? AND panaderia_id IN (?)',
  { replacements: [id ?? 0, propias()] }))[0][0]?.estado;

// Insumos de una orden propia (la orden debe ser de una panadería temporal)
const insumosDe = async (ordenId) => (await sequelize.query(
  `SELECT i.materia_prima_id, i.cantidad_por_unidad, i.cantidad_usada, i.cantidad_consumida, i.cantidad_devuelta, i.cantidad_mermada
   FROM pansys_test.insumo_usado i JOIN pansys_test.orden_produccion o ON o.id = i.orden_id
   WHERE i.orden_id = ? AND o.panaderia_id IN (?) ORDER BY i.materia_prima_id`, { replacements: [ordenId ?? 0, propias()] }
))[0].map(f => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, Number(v)])));

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

// Ajusta el stock de una materia prima mediante la API (como lo haría el panadero)
const fijarStock = (id, cantidad) =>
  pedir('PUT', `/api/inventario/${id}`, 'panaderoa', { cantidad_disponible: cantidad });

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
  // pansys_test debe tener el mismo esquema que pansys_db (SQL 003): si no, las pruebas no valen
  const [tipos] = await sequelize.query(`
    SELECT COLUMN_NAME AS c, COLUMN_TYPE AS t, IS_NULLABLE AS n FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = 'pansys_test' AND TABLE_NAME = 'materia_prima'
      AND COLUMN_NAME IN ('cantidad_disponible', 'stock_minimo', 'precio_unitario')`);
  if (tipos.length !== 3 || !tipos.every(f => f.t === 'decimal(12,4)' && f.n === 'NO')) {
    throw new Error(`materia_prima de pansys_test no es DECIMAL(12,4) NOT NULL: ${JSON.stringify(tipos)}`);
  }

  // ---------- Bloqueo de suite y datos propios ----------
  // iniciarEjecucion comprueba DB_NAME, la conexión dedicada y la de Sequelize, y toma el bloqueo
  ejecucion = await iniciarEjecucion({ suite: 'produccion', sequelize });
  console.log(`      runId de esta ejecución: ${ejecucion.runId} (filas marcadas con "prueba.produccion.${ejecucion.runId}." y "PRUEBA ${ejecucion.runId}")`);
  // Administradora ACTIVA: el administrador consulta y edita recetas de una panadería concreta
  cuentas.admin = await ejecucion.crearCuenta({ etiqueta: 'admin', rol: 'administrador', activa: true });
  panaderiaA = await ejecucion.crearPanaderia({ etiqueta: 'A', propietariaId: cuentas.admin });
  panaderiaB = await ejecucion.crearPanaderia({ etiqueta: 'B', propietariaId: cuentas.admin });
  cuentas.panaderoa = await ejecucion.crearCuenta({ etiqueta: 'panaderoa', rol: 'panadero', panaderiaId: panaderiaA, activa: true });
  cuentas.panaderob = await ejecucion.crearCuenta({ etiqueta: 'panaderob', rol: 'panadero', panaderiaId: panaderiaB, activa: true });
  cuentas.gerentea = await ejecucion.crearCuenta({ etiqueta: 'gerentea', rol: 'gerente', panaderiaId: panaderiaA, activa: true });

  // Tokens de las cuentas temporales: el middleware lee rol, panadería y estado de la base
  const firmar = (id, etiqueta, rol, rolId, panaderiaId) => jwt.sign({
    id, email: ejecucion.correo(etiqueta), rol, rol_id: rolId, panaderia_id: panaderiaId, version_sesion: 0
  }, process.env.JWT_SECRET, { expiresIn: '10m' });
  TOKENS.admin = firmar(cuentas.admin, 'admin', 'administrador', 1, null);
  TOKENS.panaderoa = firmar(cuentas.panaderoa, 'panaderoa', 'panadero', 2, panaderiaA);
  TOKENS.panaderob = firmar(cuentas.panaderob, 'panaderob', 'panadero', 2, panaderiaB);
  TOKENS.gerentea = firmar(cuentas.gerentea, 'gerentea', 'gerente', 3, panaderiaA);

  await arrancarServidor();

  // ---------- Datos base mediante la API, en las panaderías temporales ----------
  await ejecucion.exigirBloqueo();
  const crearInsumo = async (usuario, texto, cantidad, minimo, precio) => (await pedir('POST', '/api/inventario', usuario, {
    nombre: nombre(texto), unidad_medida: 'kg', cantidad_disponible: cantidad, stock_minimo: minimo, precio_unitario: precio
  })).datos;
  const harina = await crearInsumo('panaderoa', 'Harina', 10, 2, 3000);
  const azucar = await crearInsumo('panaderoa', 'Azúcar', 5, 1, 4000);
  const mantequilla = await crearInsumo('panaderoa', 'Mantequilla', 0.3, 0.1, 20000);
  const levadura = await crearInsumo('panaderoa', 'Levadura (g)', 25000.125, 0, 1);
  const harinaB = await crearInsumo('panaderob', 'Harina B', 20, 2, 3000);

  const crearProducto = async (usuario, texto) => (await pedir('POST', '/api/ventas/productos', usuario, {
    nombre: nombre(texto), precio_venta: 500, cantidad_disponible: 0
  })).datos;
  const pan = await crearProducto('panaderoa', 'Pan');
  const panSinReceta = await crearProducto('panaderoa', 'Pan sin receta');
  const panLevadura = await crearProducto('panaderoa', 'Pan de levadura');
  const panB = await crearProducto('panaderob', 'Pan B');
  igual('insumos y productos se crean en su panadería temporal',
    [harina?.panaderia_id, harinaB?.panaderia_id, pan?.panaderia_id, panB?.panaderia_id], [panaderiaA, panaderiaB, panaderiaA, panaderiaB]);

  const recetaPan = { insumos: [
    { materia_prima_id: harina?.id, cantidad_por_unidad: '0.125' },
    { materia_prima_id: azucar?.id, cantidad_por_unidad: 0.03 },
    { materia_prima_id: mantequilla?.id, cantidad_por_unidad: '0.0075' }
  ] };

  // ---------- Recetas ----------
  await ejecucion.exigirBloqueo();
  console.log('\n== Recetas');
  const receta = await esperar('panadero de A crea receta', 201, 'POST', `${P}/recetas/${pan?.id}`, 'panaderoa', recetaPan);
  igual('receta con 3 insumos', receta?.insumos?.length, 3);
  await esperar('crear la misma receta otra vez -> 409', 409, 'POST', `${P}/recetas/${pan?.id}`, 'panaderoa', recetaPan);
  await esperar('gerente consulta receta', 200, 'GET', `${P}/recetas/${pan?.id}`, 'gerentea');
  await esperar('gerente crea receta -> 403', 403, 'POST', `${P}/recetas/${panSinReceta?.id}`, 'gerentea', recetaPan);
  await esperar('panadero de B consulta receta de A -> 404', 404, 'GET', `${P}/recetas/${pan?.id}`, 'panaderob');
  await esperar('panadero de A crea receta en producto de B -> 404', 404, 'POST', `${P}/recetas/${panB?.id}`, 'panaderoa', recetaPan);
  await esperar('receta con insumo de otra panadería -> 404', 404, 'PUT', `${P}/recetas/${pan?.id}`, 'panaderoa',
    { insumos: [{ materia_prima_id: harinaB?.id, cantidad_por_unidad: 1 }] });
  await esperar('admin mezcla panadería (pide B para producto de A) -> 404', 404, 'PUT',
    `${P}/recetas/${pan?.id}?panaderia_id=${panaderiaB}`, 'admin', recetaPan);
  await esperar('PUT receta inexistente -> 404', 404, 'PUT', `${P}/recetas/${panSinReceta?.id}`, 'panaderoa', recetaPan);
  await esperar('DELETE receta inexistente -> 404', 404, 'DELETE', `${P}/recetas/${panSinReceta?.id}`, 'panaderoa');
  const recetasA = await esperar('admin lista recetas de A', 200, 'GET', `${P}/recetas?panaderia_id=${panaderiaA}`, 'admin');
  igual('el listado de A solo contiene productos de A', Array.isArray(recetasA) && recetasA.every(r => r.panaderia_id === panaderiaA), true);
  await esperar('receta de levadura', 201, 'POST', `${P}/recetas/${panLevadura?.id}`, 'panaderoa',
    { insumos: [{ materia_prima_id: levadura?.id, cantidad_por_unidad: '0.125' }] });

  // ---------- Cálculo ----------
  await ejecucion.exigirBloqueo();
  console.log('\n== Cálculo');
  const calc40 = await esperar('calcular 40 panes', 200, 'GET', `${P}/calcular?producto_id=${pan?.id}&cantidad=40`, 'panaderoa');
  igual('necesarios para 40 (harina, azúcar, mantequilla)', calc40?.insumos?.map(i => i.necesario), [5, 1.2, 0.3]);
  igual('alcanza para 40', calc40?.alcanza, true);
  igual('costo estimado 40', calc40?.costo_total_estimado, 25800);
  const calc41 = await esperar('calcular 41 panes', 200, 'GET', `${P}/calcular?producto_id=${pan?.id}&cantidad=41`, 'gerentea');
  igual('no alcanza para 41 (falta 0,0075 de mantequilla)', [calc41?.alcanza, calc41?.insumos?.[2]?.faltante], [false, 0.0075]);
  await esperar('calcular producto sin receta -> 422', 422, 'GET', `${P}/calcular?producto_id=${panSinReceta?.id}&cantidad=1`, 'panaderoa');

  // ---------- Falta de existencias ----------
  await ejecucion.exigirBloqueo();
  console.log('\n== Falta de existencias');
  const antes = [await stock(harina?.id), await stock(azucar?.id), await stock(mantequilla?.id)];
  const sinStock = await esperar('orden de 41 sin stock -> 409', 409, 'POST', `${P}/ordenes`, 'panaderoa',
    { producto_id: pan?.id, cantidad_planificada: 41 });
  igual('faltantes informados', sinStock?.faltantes?.map(f => f.materia_prima_id), [mantequilla?.id]);
  igual('stock sin cambios tras el 409', [await stock(harina?.id), await stock(azucar?.id), await stock(mantequilla?.id)], antes);
  igual('ninguna orden creada en las panaderías temporales', await contarOrdenes(), 0);

  // ---------- Crear y finalizar ----------
  await ejecucion.exigirBloqueo();
  console.log('\n== Crear y finalizar');
  const creada = await esperar('orden de 40 (usa toda la mantequilla)', 201, 'POST', `${P}/ordenes`, 'panaderoa',
    { producto_id: pan?.id, cantidad_planificada: 40, observaciones: 'Lote de prueba' });
  const ordenA = creada?.orden;
  igual('stock descontado exacto', [await stock(harina?.id), await stock(azucar?.id), await stock(mantequilla?.id)], [5, 3.8, 0]);
  igual('empleado y panadería de la orden', [ordenA?.empleado_id, ordenA?.panaderia_id, ordenA?.estado], [cuentas.panaderoa, panaderiaA, 'en_proceso']);
  igual('costo de insumos guardado', ordenA?.costo_insumos, 25800);
  igual('alerta de stock bajo para mantequilla', creada?.alertas_stock_bajo?.map(a => a.materia_prima_id), [mantequilla?.id]);

  await esperar('cambiar receta después de crear la orden', 200, 'PUT', `${P}/recetas/${pan?.id}`, 'panaderoa',
    { insumos: [{ materia_prima_id: harina?.id, cantidad_por_unidad: 1 }] });
  igual('la orden conserva su copia histórica', (await insumosDe(ordenA?.id)).map(i => [i.cantidad_por_unidad, i.cantidad_usada]),
    [[0.125, 5], [0.03, 1.2], [0.0075, 0.3]]);
  await esperar('restaurar receta original', 200, 'PUT', `${P}/recetas/${pan?.id}`, 'panaderoa', recetaPan);

  await esperar('panadero de B consulta orden de A -> 404', 404, 'GET', `${P}/ordenes/${ordenA?.id}`, 'panaderob');
  await esperar('panadero de B finaliza orden de A -> 404', 404, 'PATCH', `${P}/ordenes/${ordenA?.id}/finalizar`, 'panaderob', { cantidad_producida: 1 });
  await esperar('gerente finaliza -> 403', 403, 'PATCH', `${P}/ordenes/${ordenA?.id}/finalizar`, 'gerentea', { cantidad_producida: 1 });
  await esperar('gerente consulta la orden', 200, 'GET', `${P}/ordenes/${ordenA?.id}`, 'gerentea');
  await esperar('producida mayor que planificada -> 400', 400, 'PATCH', `${P}/ordenes/${ordenA?.id}/finalizar`, 'panaderoa', { cantidad_producida: 41 });
  const finalizada = await esperar('finalizar con 38 producidos', 200, 'PATCH', `${P}/ordenes/${ordenA?.id}/finalizar`, 'panaderoa', { cantidad_producida: 38 });
  igual('estado, producida y cerrado_por', [finalizada?.estado, finalizada?.cantidad_producida, finalizada?.cerrado_por], ['finalizada', 38, cuentas.panaderoa]);
  igual('producto terminado sumado', await stockProducto(pan?.id), 38);
  igual('consumida = descontada', (await insumosDe(ordenA?.id)).map(i => [i.cantidad_consumida, i.cantidad_devuelta, i.cantidad_mermada]),
    [[5, 0, 0], [1.2, 0, 0], [0.3, 0, 0]]);
  await esperar('finalizar dos veces -> 409', 409, 'PATCH', `${P}/ordenes/${ordenA?.id}/finalizar`, 'panaderoa', { cantidad_producida: 1 });
  await esperar('cancelar una orden finalizada -> 409', 409, 'PATCH', `${P}/ordenes/${ordenA?.id}/cancelar`, 'panaderoa',
    { motivo: 'x', devolver_insumos: true });

  // ---------- Cancelaciones ----------
  await ejecucion.exigirBloqueo();
  console.log('\n== Cancelaciones');
  await fijarStock(harina?.id, 10);
  await fijarStock(azucar?.id, 5);
  await fijarStock(mantequilla?.id, 1);
  const crear8 = async () => (await pedir('POST', `${P}/ordenes`, 'panaderoa', { producto_id: pan?.id, cantidad_planificada: 8 })).datos?.orden;

  const ordenB = await crear8();
  await esperar('cancelar sin devolver', 200, 'PATCH', `${P}/ordenes/${ordenB?.id}/cancelar`, 'panaderoa',
    { motivo: 'Masa dañada', devolver_insumos: false });
  igual('sin devolución: stock queda descontado', [await stock(harina?.id), await stock(azucar?.id), await stock(mantequilla?.id)], [9, 4.76, 0.94]);
  igual('sin devolución: todo es merma', (await insumosDe(ordenB?.id)).map(i => [i.cantidad_consumida, i.cantidad_devuelta, i.cantidad_mermada]),
    [[0, 0, 1], [0, 0, 0.24], [0, 0, 0.06]]);

  const ordenC = await crear8();
  const cancelC = await esperar('cancelar devolviendo todo', 200, 'PATCH', `${P}/ordenes/${ordenC?.id}/cancelar`, 'panaderoa',
    { motivo: 'Cambio de plan', devolver_insumos: true });
  igual('devolución total: stock restaurado', [await stock(harina?.id), await stock(azucar?.id), await stock(mantequilla?.id)], [9, 4.76, 0.94]);
  igual('devolución total: insumos_devueltos y desglose', [cancelC?.insumos_devueltos,
    (await insumosDe(ordenC?.id)).map(i => [i.cantidad_devuelta, i.cantidad_mermada])], [true, [[1, 0], [0.24, 0], [0.06, 0]]]);

  const ordenD = await crear8();
  await esperar('cancelar con devolución parcial', 200, 'PATCH', `${P}/ordenes/${ordenD?.id}/cancelar`, 'panaderoa',
    { motivo: 'Parcial', devolver_insumos: true, insumos: [
      { materia_prima_id: harina?.id, cantidad_devuelta: '0.5' },
      { materia_prima_id: azucar?.id, cantidad_devuelta: 0 }
    ] });
  igual('devolución parcial: stock', [await stock(harina?.id), await stock(azucar?.id), await stock(mantequilla?.id)], [8.5, 4.52, 0.88]);
  igual('devolución parcial: desglose', (await insumosDe(ordenD?.id)).map(i => [i.cantidad_devuelta, i.cantidad_mermada]),
    [[0.5, 0.5], [0, 0.24], [0, 0.06]]);

  const ordenE = await crear8();
  const stockE = [await stock(harina?.id), await stock(azucar?.id), await stock(mantequilla?.id)];
  await esperar('devolver más de lo descontado -> 400', 400, 'PATCH', `${P}/ordenes/${ordenE?.id}/cancelar`, 'panaderoa',
    { motivo: 'x', devolver_insumos: true, insumos: [{ materia_prima_id: harina?.id, cantidad_devuelta: '1.0001' }] });
  await esperar('devolver insumo ajeno a la orden -> 400', 400, 'PATCH', `${P}/ordenes/${ordenE?.id}/cancelar`, 'panaderoa',
    { motivo: 'x', devolver_insumos: true, insumos: [{ materia_prima_id: levadura?.id, cantidad_devuelta: 1 }] });
  await esperar('devolución repetida -> 400', 400, 'PATCH', `${P}/ordenes/${ordenE?.id}/cancelar`, 'panaderoa',
    { motivo: 'x', devolver_insumos: true, insumos: [
      { materia_prima_id: harina?.id, cantidad_devuelta: 0.1 }, { materia_prima_id: harina?.id, cantidad_devuelta: 0.1 }
    ] });
  igual('tras los rechazos: stock intacto', [await stock(harina?.id), await stock(azucar?.id), await stock(mantequilla?.id)], stockE);
  igual('tras los rechazos: la orden sigue en proceso', await estadoOrden(ordenE?.id), 'en_proceso');
  await esperar('cancelar orden E', 200, 'PATCH', `${P}/ordenes/${ordenE?.id}/cancelar`, 'panaderoa', { motivo: 'x', devolver_insumos: true });
  await esperar('cancelar dos veces -> 409', 409, 'PATCH', `${P}/ordenes/${ordenE?.id}/cancelar`, 'panaderoa', { motivo: 'x', devolver_insumos: true });

  // ---------- Precisión ----------
  await ejecucion.exigirBloqueo();
  console.log('\n== Precisión');
  await esperar('orden de 1000 panes de levadura', 201, 'POST', `${P}/ordenes`, 'panaderoa', { producto_id: panLevadura?.id, cantidad_planificada: 1000 });
  igual('25000,125 - 125 = 24875,125 exacto', await stock(levadura?.id), 24875.125);

  // ---------- Costos inválidos ----------
  // (El precio negativo heredado se prueba en produccion.unitarias.js: la API no permite crearlo
  // y la suite no escribe directamente en la base.)
  await ejecucion.exigirBloqueo();
  console.log('\n== Costos inválidos');
  const ordenesAntesCostos = await contarOrdenes();
  // Costo de 20.000.000 kg × 900.000 = 18 billones > DECIMAL(12,2): 400 antes de descontar
  const vainilla = await crearInsumo('panaderoa', 'Vainilla', 30000000, 0, 900000);
  const postre = await crearProducto('panaderoa', 'Postre');
  await pedir('POST', `${P}/recetas/${postre?.id}`, 'panaderoa', { insumos: [{ materia_prima_id: vainilla?.id, cantidad_por_unidad: 200 }] });
  const excesivo = await esperar('orden con costo mayor que DECIMAL(12,2) -> 400', 400, 'POST', `${P}/ordenes`, 'panaderoa',
    { producto_id: postre?.id, cantidad_planificada: 100000 });
  igual('costo excesivo: mensaje sobre el costo', /costo/i.test(excesivo?.error ?? ''), true);
  igual('costo excesivo: stock intacto', await stock(vainilla?.id), 30000000);
  igual('costo excesivo: ninguna orden creada', await contarOrdenes(), ordenesAntesCostos);

  // ---------- Precisión de DECIMAL(12,4) en costos y stock ----------
  await ejecucion.exigirBloqueo();
  console.log('\n== Precisión de DECIMAL(12,4) en costos y stock');
  const filaInsumo = async (ordenId) => (await sequelize.query(
    `SELECT CAST(i.precio_unitario AS CHAR) AS precio, CAST(i.costo AS CHAR) AS costo
     FROM pansys_test.insumo_usado i JOIN pansys_test.orden_produccion o ON o.id = i.orden_id
     WHERE i.orden_id = ? AND o.panaderia_id IN (?)`, { replacements: [ordenId ?? 0, propias()] }))[0];
  const costoOrden = async (ordenId) => (await sequelize.query(
    'SELECT CAST(costo_insumos AS CHAR) AS c FROM pansys_test.orden_produccion WHERE id = ? AND panaderia_id IN (?)',
    { replacements: [ordenId ?? 0, propias()] }))[0][0]?.c;
  const recetaUnica = async (texto, insumoId, porUnidad) => {
    const producto = await crearProducto('panaderoa', texto);
    await pedir('POST', `${P}/recetas/${producto?.id}`, 'panaderoa', { insumos: [{ materia_prima_id: insumoId, cantidad_por_unidad: porUnidad }] });
    return producto;
  };

  // Precio con 4 decimales: 12,5 kg × 12,3456 = 154,32 exacto (con el precio redondeado a 12,35 saldría 154,38)
  const azafran = await crearInsumo('panaderoa', 'Azafrán', 100, 0, 12.3456);
  igual('inventario conserva el precio con 4 decimales', azafran?.precio_unitario, 12.3456);
  const panAzafran = await recetaUnica('Pan de azafrán', azafran?.id, '0.0125');
  const calcAzafran = await esperar('calcular con precio de 4 decimales', 200, 'GET', `${P}/calcular?producto_id=${panAzafran?.id}&cantidad=1000`, 'panaderoa');
  igual('calcular: precio sin redondear y costo exacto',
    [calcAzafran?.insumos?.[0]?.precio_unitario, calcAzafran?.insumos?.[0]?.costo_estimado, calcAzafran?.costo_total_estimado],
    [12.3456, 154.32, 154.32]);
  const ordenAzafran = await esperar('orden con precio de 4 decimales', 201, 'POST', `${P}/ordenes`, 'panaderoa', { producto_id: panAzafran?.id, cantidad_planificada: 1000 });
  const ordenAzafranId = ordenAzafran?.orden?.id;
  igual('orden: costo de la línea y de la orden exactos (154.32)',
    [(await filaInsumo(ordenAzafranId))[0]?.costo, await costoOrden(ordenAzafranId)], ['154.32', '154.32']);
  igual('orden: copia histórica del precio redondeada a centavos (columna DECIMAL(12,2))', (await filaInsumo(ordenAzafranId))[0]?.precio, '12.35');
  igual('orden: stock descontado exacto (100 - 12,5)', await stock(azafran?.id), 87.5);

  // Redondeo a centavos, una sola vez por línea y mitad hacia arriba
  const anis = await crearInsumo('panaderoa', 'Anís', 10, 0, '0.005');
  const clavo = await crearInsumo('panaderoa', 'Clavo', 10, 0, '0.005');
  const panEspeciado = await crearProducto('panaderoa', 'Pan especiado');
  await pedir('POST', `${P}/recetas/${panEspeciado?.id}`, 'panaderoa', { insumos: [
    { materia_prima_id: anis?.id, cantidad_por_unidad: '0.001' }, { materia_prima_id: clavo?.id, cantidad_por_unidad: '0.001' }
  ] });
  const calcEspeciado = await esperar('calcular con costos de medio centavo', 200, 'GET', `${P}/calcular?producto_id=${panEspeciado?.id}&cantidad=1000`, 'panaderoa');
  igual('1 kg × 0,005 = 0,005 -> 0,01 por línea; total = suma de líneas (0,02)',
    [calcEspeciado?.insumos?.map(i => i.costo_estimado), calcEspeciado?.costo_total_estimado], [[0.01, 0.01], 0.02]);

  // Descuento exacto sin tolerancia: se puede consumir exactamente todo el stock, ni 0,0001 más
  const pimienta = await crearInsumo('panaderoa', 'Pimienta', '0.0003', 0, 1);
  const panPimienta = await recetaUnica('Pan de pimienta', pimienta?.id, '0.0001');
  await esperar('consumir exactamente el stock (0,0003)', 201, 'POST', `${P}/ordenes`, 'panaderoa', { producto_id: panPimienta?.id, cantidad_planificada: 3 });
  igual('stock queda exactamente en 0', await stock(pimienta?.id), 0);
  const sinPimienta = await esperar('0,0001 más de lo disponible -> 409', 409, 'POST', `${P}/ordenes`, 'panaderoa', { producto_id: panPimienta?.id, cantidad_planificada: 1 });
  igual('faltante exacto de 0,0001', sinPimienta?.faltantes?.[0]?.faltante, 0.0001);

  // Acumulación: 10 órdenes de 0,1 sobre un stock de 1 dejan exactamente 0 (con FLOAT se desviaría)
  const comino = await crearInsumo('panaderoa', 'Comino', 1, 0, 1000);
  const panComino = await recetaUnica('Pan de comino', comino?.id, '0.1');
  const estadosComino = [];
  for (let i = 0; i < 10; i++) {
    estadosComino.push((await pedir('POST', `${P}/ordenes`, 'panaderoa', { producto_id: panComino?.id, cantidad_planificada: 1 })).status);
  }
  igual('10 órdenes de 0,1 aceptadas', estadosComino.every(st => st === 201), true);
  igual('stock final exactamente 0', await stock(comino?.id), 0);
  await esperar('una orden más -> 409', 409, 'POST', `${P}/ordenes`, 'panaderoa', { producto_id: panComino?.id, cantidad_planificada: 1 });

  // Devolver insumos no puede superar el máximo de DECIMAL(12,4): 409 claro, sin 500 ni cambios
  const canela = await crearInsumo('panaderoa', 'Canela', 10, 0, 1);
  const panCanela = await recetaUnica('Pan de canela', canela?.id, '2.5');
  const ordenCanela = await esperar('orden de canela', 201, 'POST', `${P}/ordenes`, 'panaderoa', { producto_id: panCanela?.id, cantidad_planificada: 1 });
  const ordenCanelaId = ordenCanela?.orden?.id;
  await fijarStock(canela?.id, '99999999.9999');
  const desbordada = await esperar('cancelar devolviendo por encima del máximo -> 409', 409, 'PATCH',
    `${P}/ordenes/${ordenCanelaId}/cancelar`, 'panaderoa', { motivo: 'x', devolver_insumos: true });
  igual('409 indica la materia prima y no expone detalles internos',
    [desbordada?.materia_prima_id, /out of range/i.test(desbordada?.error ?? '')], [canela?.id, false]);
  igual('rollback: stock en el máximo y orden en proceso',
    [await stock(canela?.id), await estadoOrden(ordenCanelaId)], [99999999.9999, 'en_proceso']);
  await fijarStock(canela?.id, '99999997.4999');
  await esperar('con margen, la devolución se aplica', 200, 'PATCH', `${P}/ordenes/${ordenCanelaId}/cancelar`, 'panaderoa', { motivo: 'x', devolver_insumos: true });
  igual('devolución exacta: 99.999.997,4999 + 2,5', await stock(canela?.id), 99999999.9999);

  // ---------- Concurrencia ----------
  await ejecucion.exigirBloqueo();
  console.log('\n== Concurrencia');
  await fijarStock(harina?.id, 1.5);
  const dobles = await Promise.all([1, 2].map(() =>
    pedir('POST', `${P}/ordenes`, 'panaderoa', { producto_id: pan?.id, cantidad_planificada: 8 })));
  igual('dos órdenes simultáneas con harina para una: 201 y 409', dobles.map(r => r.status).sort(), [201, 409]);
  igual('harina final 0,5 (sin stock negativo)', await stock(harina?.id), 0.5);

  const abierta = dobles.find(r => r.status === 201)?.datos?.orden;
  const carrera = await Promise.all([
    pedir('PATCH', `${P}/ordenes/${abierta?.id}/finalizar`, 'panaderoa', { cantidad_producida: 8 }),
    pedir('PATCH', `${P}/ordenes/${abierta?.id}/cancelar`, 'panaderoa', { motivo: 'carrera', devolver_insumos: true })
  ]);
  igual('finalizar y cancelar a la vez: solo una gana', carrera.map(r => r.status).sort(), [200, 409]);

  // ---------- Errores dentro de la transacción ----------
  // Cada sustitución de un método de modelo se restaura en un finally, aunque la petición o la
  // aserción fallen: el resto de la suite (y la limpieza) usan siempre los métodos originales.
  await ejecucion.exigirBloqueo();
  console.log('\n== Errores transaccionales');
  await fijarStock(harina?.id, 10);
  const stockT = [await stock(harina?.id), await stock(azucar?.id), await stock(mantequilla?.id)];
  const ordenesT = await contarOrdenes();
  const errorOriginal = console.error;
  const bulkCreateOriginal = InsumoUsado.bulkCreate;
  const createOriginal = OrdenProduccion.create;

  // Falla después de descontar el stock y crear la orden
  try {
    console.error = () => {};
    InsumoUsado.bulkCreate = async () => { throw new Error('Fallo simulado al guardar insumos'); };
    await esperar('fallo interno a mitad de transacción -> 500', 500, 'POST', `${P}/ordenes`, 'panaderoa', { producto_id: pan?.id, cantidad_planificada: 8 });
  } finally {
    InsumoUsado.bulkCreate = bulkCreateOriginal;
    console.error = errorOriginal;
  }
  igual('rollback: stock intacto', [await stock(harina?.id), await stock(azucar?.id), await stock(mantequilla?.id)], stockT);
  igual('rollback: ninguna orden nueva', await contarOrdenes(), ordenesT);

  // Deadlock simulado en el primer intento: se reintenta y se completa una sola vez
  let intentos = 0;
  try {
    OrdenProduccion.create = async function (...args) {
      intentos++;
      if (intentos === 1) throw Object.assign(new Error('Deadlock simulado'), { parent: { errno: 1213 } });
      return createOriginal.apply(this, args);
    };
    await esperar('deadlock simulado: se reintenta y crea la orden', 201, 'POST', `${P}/ordenes`, 'panaderoa', { producto_id: pan?.id, cantidad_planificada: 8 });
  } finally {
    OrdenProduccion.create = createOriginal;
  }
  igual('dos intentos, una sola orden y un solo descuento', [intentos, await contarOrdenes() - ordenesT, await stock(harina?.id)], [2, 1, 9]);

  // Espera de bloqueo agotada: conflicto recuperable, sin reintento automático
  const stockL = await stock(harina?.id);
  let conflicto;
  try {
    OrdenProduccion.create = async () => { throw Object.assign(new Error('Lock wait simulado'), { parent: { errno: 1205 } }); };
    conflicto = await esperar('lock wait timeout -> 409 recuperable', 409, 'POST', `${P}/ordenes`, 'panaderoa', { producto_id: pan?.id, cantidad_planificada: 8 });
  } finally {
    OrdenProduccion.create = createOriginal;
  }
  igual('respuesta indica reintentar', [conflicto?.codigo, conflicto?.reintentar], ['CONFLICTO_CONCURRENCIA', true]);
  igual('lock wait: stock intacto', await stock(harina?.id), stockL);
  igual('los métodos sustituidos quedan restaurados', [InsumoUsado.bulkCreate === bulkCreateOriginal, OrdenProduccion.create === createOriginal, console.error === errorOriginal], [true, true, true]);

  // ---------- Invariantes (solo en las panaderías temporales) ----------
  await ejecucion.exigirBloqueo();
  console.log('\n== Invariantes');
  const [incoherentes] = await sequelize.query(`
    SELECT i.id FROM pansys_test.insumo_usado i JOIN pansys_test.orden_produccion o ON o.id = i.orden_id
    WHERE o.panaderia_id IN (?) AND (
          (o.estado = 'en_proceso' AND (i.cantidad_consumida + i.cantidad_devuelta + i.cantidad_mermada) <> 0)
       OR (o.estado = 'finalizada' AND (i.cantidad_consumida <> i.cantidad_usada OR i.cantidad_devuelta <> 0 OR i.cantidad_mermada <> 0))
       OR (o.estado = 'cancelada' AND (i.cantidad_consumida <> 0 OR i.cantidad_devuelta + i.cantidad_mermada <> i.cantidad_usada)))`,
  { replacements: [propias()] });
  igual('cantidades coherentes con el estado de cada orden de A o B', incoherentes.length, 0);
  const [[negativos]] = await sequelize.query(
    'SELECT COUNT(*) AS n FROM pansys_test.materia_prima WHERE panaderia_id IN (?) AND cantidad_disponible < 0', { replacements: [propias()] });
  igual('ninguna materia prima de A o B con stock negativo', Number(negativos.n), 0);
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
