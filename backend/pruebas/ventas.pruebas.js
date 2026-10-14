// Pruebas de integración de Ventas (descuento de stock de productos).
// Se ejecutan SOLO contra la base pansys_test (ver database/pruebas/crear_pansys_test.sql):
// borran y crean datos, por lo que abortan si la base conectada es otra.
//
// Uso (desde backend/):  npm run test:ventas

process.env.DB_NAME = 'pansys_test';
process.env.PORT = process.env.PORT_PRUEBAS || '3104';
require('dotenv').config({ quiet: true });

const jwt = require('jsonwebtoken');
const { sequelize, DetalleVenta } = require('../src/models/index');

const URL = `http://localhost:${process.env.PORT}`;

// Usuarios creados por crear_pansys_test.sql
const firmar = (datos) => jwt.sign(datos, process.env.JWT_SECRET, { expiresIn: '10m' });
const TOKENS = {
  admin: firmar({ id: 1, email: 'admin@pansys.test', rol: 'administrador', rol_id: 1, panaderia_id: null }),
  panadero1: firmar({ id: 2, email: 'panadero1@pansys.test', rol: 'panadero', rol_id: 2, panaderia_id: 1 }),
  panadero2: firmar({ id: 3, email: 'panadero2@pansys.test', rol: 'panadero', rol_id: 2, panaderia_id: 2 }),
  gerente1: firmar({ id: 4, email: 'gerente1@pansys.test', rol: 'gerente', rol_id: 3, panaderia_id: 1 })
};

const resultados = [];
const registrar = (ok, descripcion, detalle = '') => {
  resultados.push({ ok, descripcion });
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${descripcion}${!ok && detalle ? ` -> ${detalle}` : ''}`);
};

const pedir = async (metodo, ruta, usuario, body) => {
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

const stock = async (id) =>
  (await sequelize.query('SELECT cantidad_disponible AS d FROM productos WHERE id = ?', { replacements: [id] }))[0][0].d;

const contarVentas = async () => (await sequelize.query('SELECT COUNT(*) AS n FROM ventas'))[0][0].n;

const vender = (usuario, productos, extra = {}) => pedir('POST', '/api/ventas', usuario, { productos, ...extra });

const esperarServidor = async () => {
  for (let i = 0; i < 40; i++) {
    try { await fetch(URL); return; } catch { await new Promise(r => setTimeout(r, 250)); }
  }
  throw new Error('El servidor de pruebas no arrancó');
};

const main = async () => {
  // ---------- Protección: solo pansys_test ----------
  await sequelize.authenticate();
  const [[{ base }]] = await sequelize.query('SELECT DATABASE() AS base');
  if (base !== 'pansys_test') {
    throw new Error(`Base conectada "${base}": las pruebas solo se ejecutan sobre pansys_test`);
  }

  // ---------- Limpieza de datos de ejecuciones anteriores ----------
  for (const tabla of ['insumo_usado', 'orden_produccion', 'receta_producto', 'detalle_ventas', 'ventas', 'productos', 'materia_prima']) {
    await sequelize.query(`DELETE FROM \`${tabla}\``);
  }

  require('../src/app');
  await esperarServidor();

  const crearProducto = async (usuario, nombre, precio, cantidad) => (await pedir('POST', '/api/ventas/productos', usuario, {
    nombre, precio_venta: precio, ...(cantidad === undefined ? {} : { cantidad_disponible: cantidad })
  })).datos;
  const pan = await crearProducto('panadero1', 'Pan', 500, 10);
  const torta = await crearProducto('panadero1', 'Torta', 2000, 2);
  const sinStock = await crearProducto('panadero1', 'Galleta sin stock', 300);
  const inactivo = await crearProducto('panadero1', 'Producto inactivo', 100, 50);
  const panP2 = await crearProducto('panadero2', 'Pan P2', 500, 5);
  await sequelize.query('UPDATE productos SET estado = 0 WHERE id = ?', { replacements: [inactivo.id] });

  // ---------- Descuento de stock ----------
  console.log('\n== Descuento de stock');
  const venta = await esperar('venta de 3 panes y 1 torta', 201, 'POST', '/api/ventas', 'panadero1',
    { productos: [{ producto_id: pan.id, cantidad: 3 }, { producto_id: torta.id, cantidad: 1 }] });
  igual('total, empleado y panadería', [venta?.total, venta?.empleado_id, venta?.panaderia_id], [3500, 2, 1]);
  igual('stock descontado (pan 7, torta 1)', [await stock(pan.id), await stock(torta.id)], [7, 1]);
  const [detalles] = await sequelize.query('SELECT producto_id, cantidad, subtotal FROM detalle_ventas WHERE venta_id = ? ORDER BY producto_id', { replacements: [venta.id] });
  igual('detalle de la venta', detalles.map(d => [d.producto_id, d.cantidad, d.subtotal]), [[pan.id, 3, 1500], [torta.id, 1, 2000]]);

  // ---------- Stock insuficiente ----------
  console.log('\n== Stock insuficiente');
  const ventasAntes = await contarVentas();
  const sinTortas = await esperar('vender 2 tortas con 1 disponible -> 409', 409, 'POST', '/api/ventas', 'panadero1',
    { productos: [{ producto_id: torta.id, cantidad: 2 }] });
  igual('el mensaje indica producto, disponible y solicitado', /Torta \(disponible 1, solicitado 2\)/.test(sinTortas?.error ?? ''), true);
  await esperar('venta mixta con una línea sin stock -> 409', 409, 'POST', '/api/ventas', 'panadero1',
    { productos: [{ producto_id: pan.id, cantidad: 1 }, { producto_id: torta.id, cantidad: 5 }] });
  igual('atomicidad: el pan de la venta rechazada no se descontó', [await stock(pan.id), await stock(torta.id)], [7, 1]);
  igual('ninguna venta registrada en los rechazos', await contarVentas(), ventasAntes);
  await esperar('producto sin stock inicial -> 409', 409, 'POST', '/api/ventas', 'panadero1',
    { productos: [{ producto_id: sinStock.id, cantidad: 1 }] });
  await esperar('vender exactamente el stock disponible', 201, 'POST', '/api/ventas', 'panadero1',
    { productos: [{ producto_id: torta.id, cantidad: 1 }] });
  igual('torta queda en 0', await stock(torta.id), 0);
  await esperar('vender con stock 0 -> 409', 409, 'POST', '/api/ventas', 'panadero1',
    { productos: [{ producto_id: torta.id, cantidad: 1 }] });

  // ---------- Validaciones ----------
  console.log('\n== Validaciones');
  await esperar('sin productos -> 400', 400, 'POST', '/api/ventas', 'panadero1', { productos: [] });
  await esperar('productos ausente -> 400', 400, 'POST', '/api/ventas', 'panadero1', {});
  await esperar('cantidad 0 -> 400', 400, 'POST', '/api/ventas', 'panadero1', { productos: [{ producto_id: pan.id, cantidad: 0 }] });
  await esperar('cantidad 1.5 -> 400', 400, 'POST', '/api/ventas', 'panadero1', { productos: [{ producto_id: pan.id, cantidad: 1.5 }] });
  await esperar('cantidad negativa -> 400', 400, 'POST', '/api/ventas', 'panadero1', { productos: [{ producto_id: pan.id, cantidad: -2 }] });
  await esperar('producto repetido -> 400', 400, 'POST', '/api/ventas', 'panadero1',
    { productos: [{ producto_id: pan.id, cantidad: 1 }, { producto_id: pan.id, cantidad: 1 }] });
  igual('validaciones: stock intacto', await stock(pan.id), 7);

  // ---------- Aislamiento y permisos ----------
  console.log('\n== Aislamiento y permisos');
  await esperar('panadero1 vende producto de P2 -> 404', 404, 'POST', '/api/ventas', 'panadero1', { productos: [{ producto_id: panP2.id, cantidad: 1 }] });
  await esperar('panadero2 vende producto de P1 -> 404', 404, 'POST', '/api/ventas', 'panadero2', { productos: [{ producto_id: pan.id, cantidad: 1 }] });
  igual('stocks de ambas panaderías intactos', [await stock(pan.id), await stock(panP2.id)], [7, 5]);
  await esperar('producto inactivo -> 404', 404, 'POST', '/api/ventas', 'panadero1', { productos: [{ producto_id: inactivo.id, cantidad: 1 }] });
  await esperar('gerente vende -> 403', 403, 'POST', '/api/ventas', 'gerente1', { productos: [{ producto_id: pan.id, cantidad: 1 }] });
  const ventaAdmin = await esperar('admin vende indicando panaderia_id en el body (como el frontend)', 201, 'POST', '/api/ventas', 'admin',
    { panaderia_id: 1, empleado_id: 99, productos: [{ producto_id: pan.id, cantidad: 1 }] });
  igual('empleado = usuario del token (se ignora empleado_id del cliente)', ventaAdmin?.empleado_id, 1);
  igual('pan queda en 6', await stock(pan.id), 6);

  // ---------- Integración con Producción ----------
  console.log('\n== Integración con Producción');
  const harina = (await pedir('POST', '/api/inventario', 'panadero1', {
    nombre: 'Harina', unidad_medida: 'kg', cantidad_disponible: 10, stock_minimo: 0, precio_unitario: 3000
  })).datos;
  const bizcocho = await crearProducto('panadero1', 'Bizcocho', 800, 0);
  await pedir('POST', `/api/produccion/recetas/${bizcocho.id}`, 'panadero1', { insumos: [{ materia_prima_id: harina.id, cantidad_por_unidad: '0.1' }] });
  const orden = (await pedir('POST', '/api/produccion/ordenes', 'panadero1', { producto_id: bizcocho.id, cantidad_planificada: 5 })).datos.orden;
  await pedir('PATCH', `/api/produccion/ordenes/${orden.id}/finalizar`, 'panadero1', { cantidad_producida: 5 });
  igual('producción suma 5 bizcochos', await stock(bizcocho.id), 5);
  await esperar('vender los 5 bizcochos producidos', 201, 'POST', '/api/ventas', 'panadero1', { productos: [{ producto_id: bizcocho.id, cantidad: 5 }] });
  await esperar('vender uno más -> 409', 409, 'POST', '/api/ventas', 'panadero1', { productos: [{ producto_id: bizcocho.id, cantidad: 1 }] });
  igual('bizcocho queda en 0', await stock(bizcocho.id), 0);

  // ---------- Concurrencia ----------
  console.log('\n== Concurrencia');
  const ultimo = await crearProducto('panadero1', 'Último pastel', 5000, 1);
  const simultaneas = await Promise.all([1, 2].map(() => vender('panadero1', [{ producto_id: ultimo.id, cantidad: 1 }])));
  igual('dos ventas simultáneas de la última unidad: 201 y 409', simultaneas.map(r => r.status).sort(), [201, 409]);
  igual('stock final 0 (sin negativos)', await stock(ultimo.id), 0);

  // ---------- Error dentro de la transacción ----------
  console.log('\n== Error transaccional');
  const ventasT = await contarVentas();
  const errorOriginal = console.error;
  const bulkCreateOriginal = DetalleVenta.bulkCreate;
  console.error = () => {};
  DetalleVenta.bulkCreate = async () => { throw new Error('Fallo simulado al guardar el detalle'); };
  const fallo = await esperar('fallo al guardar el detalle -> 500', 500, 'POST', '/api/ventas', 'panadero1', { productos: [{ producto_id: pan.id, cantidad: 2 }] });
  DetalleVenta.bulkCreate = bulkCreateOriginal;
  console.error = errorOriginal;
  igual('500 sin detalles internos', fallo?.error, 'Error interno del servidor');
  igual('rollback: stock y ventas intactos', [await stock(pan.id), await contarVentas()], [6, ventasT]);

  // ---------- Invariantes ----------
  console.log('\n== Invariantes');
  const [[negativos]] = await sequelize.query('SELECT COUNT(*) AS n FROM productos WHERE cantidad_disponible < 0');
  igual('ningún producto con stock negativo', negativos.n, 0);
  const [[huerfanas]] = await sequelize.query('SELECT COUNT(*) AS n FROM ventas v LEFT JOIN detalle_ventas d ON d.venta_id = v.id WHERE d.id IS NULL');
  igual('ninguna venta sin detalle', huerfanas.n, 0);
};

main()
  .catch(error => registrar(false, 'Ejecución abortada', error.message))
  .finally(async () => {
    const fallidas = resultados.filter(r => !r.ok).length;
    console.log(`\n${resultados.length - fallidas}/${resultados.length} pruebas correctas`);
    await sequelize.close().catch(() => {});
    process.exit(fallidas > 0 ? 1 : 0);
  });
