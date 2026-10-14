// Pruebas de integración del módulo de Producción.
// Se ejecutan SOLO contra la base pansys_test (ver database/pruebas/crear_pansys_test.sql):
// borran y crean datos, por lo que abortan si la base conectada es otra.
//
// Uso (desde backend/):  npm run test:produccion

process.env.DB_NAME = 'pansys_test';
process.env.PORT = process.env.PORT_PRUEBAS || '3101';
require('dotenv').config({ quiet: true });

const jwt = require('jsonwebtoken');
const { sequelize, InsumoUsado, OrdenProduccion } = require('../src/models/index');

const URL = `http://localhost:${process.env.PORT}`;
const P = '/api/produccion';

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

// Verifica el código HTTP y devuelve el cuerpo
const esperar = async (descripcion, status, metodo, ruta, usuario, body) => {
  const r = await pedir(metodo, ruta, usuario, body);
  registrar(r.status === status, descripcion, `HTTP ${r.status}: ${JSON.stringify(r.datos)}`);
  return r.datos;
};

const igual = (descripcion, real, esperado) =>
  registrar(JSON.stringify(real) === JSON.stringify(esperado), descripcion,
    `obtenido ${JSON.stringify(real)}, esperado ${JSON.stringify(esperado)}`);

// Stock real (FLOAT leído como DECIMAL)
const stock = async (id) => {
  const [[fila]] = await sequelize.query(
    'SELECT CAST(cantidad_disponible AS DECIMAL(16,4)) AS d FROM materia_prima WHERE id = ?',
    { replacements: [id] }
  );
  return Number(fila.d);
};

const stockProducto = async (id) => {
  const [[fila]] = await sequelize.query('SELECT cantidad_disponible AS d FROM productos WHERE id = ?', { replacements: [id] });
  return fila.d;
};

const contarOrdenes = async () => (await sequelize.query('SELECT COUNT(*) AS n FROM orden_produccion'))[0][0].n;

const insumosDe = async (ordenId) => (await sequelize.query(
  `SELECT materia_prima_id, cantidad_por_unidad, cantidad_usada, cantidad_consumida, cantidad_devuelta, cantidad_mermada
   FROM insumo_usado WHERE orden_id = ? ORDER BY materia_prima_id`, { replacements: [ordenId] }
))[0].map(f => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, Number(v)])));

// Ajusta el stock de una materia prima mediante la API (como lo haría el panadero)
const fijarStock = (id, cantidad) =>
  pedir('PUT', `/api/inventario/${id}`, 'panadero1', { cantidad_disponible: cantidad });

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

  // ---------- Datos base mediante la API ----------
  const crearInsumo = async (usuario, nombre, cantidad, minimo, precio) => (await pedir('POST', '/api/inventario', usuario, {
    nombre, unidad_medida: 'kg', cantidad_disponible: cantidad, stock_minimo: minimo, precio_unitario: precio
  })).datos;
  const harina = await crearInsumo('panadero1', 'Harina', 10, 2, 3000);
  const azucar = await crearInsumo('panadero1', 'Azúcar', 5, 1, 4000);
  const mantequilla = await crearInsumo('panadero1', 'Mantequilla', 0.3, 0.1, 20000);
  const levadura = await crearInsumo('panadero1', 'Levadura (g)', 25000.125, 0, 1);
  const harinaP2 = await crearInsumo('panadero2', 'Harina P2', 20, 2, 3000);

  const crearProducto = async (usuario, nombre) => (await pedir('POST', '/api/ventas/productos', usuario, {
    nombre, precio_venta: 500, cantidad_disponible: 0
  })).datos;
  const pan = await crearProducto('panadero1', 'Pan');
  const panSinReceta = await crearProducto('panadero1', 'Pan sin receta');
  const panLevadura = await crearProducto('panadero1', 'Pan de levadura');
  const panP2 = await crearProducto('panadero2', 'Pan P2');

  const recetaPan = { insumos: [
    { materia_prima_id: harina.id, cantidad_por_unidad: '0.125' },
    { materia_prima_id: azucar.id, cantidad_por_unidad: 0.03 },
    { materia_prima_id: mantequilla.id, cantidad_por_unidad: '0.0075' }
  ] };

  // ---------- Recetas ----------
  console.log('\n== Recetas');
  const receta = await esperar('panadero1 crea receta', 201, 'POST', `${P}/recetas/${pan.id}`, 'panadero1', recetaPan);
  igual('receta con 3 insumos', receta?.insumos?.length, 3);
  await esperar('crear la misma receta otra vez -> 409', 409, 'POST', `${P}/recetas/${pan.id}`, 'panadero1', recetaPan);
  await esperar('gerente consulta receta', 200, 'GET', `${P}/recetas/${pan.id}`, 'gerente1');
  await esperar('gerente crea receta -> 403', 403, 'POST', `${P}/recetas/${panSinReceta.id}`, 'gerente1', recetaPan);
  await esperar('panadero2 consulta receta de P1 -> 404', 404, 'GET', `${P}/recetas/${pan.id}`, 'panadero2');
  await esperar('panadero1 crea receta en producto de P2 -> 404', 404, 'POST', `${P}/recetas/${panP2.id}`, 'panadero1', recetaPan);
  await esperar('receta con insumo de otra panadería -> 404', 404, 'PUT', `${P}/recetas/${pan.id}`, 'panadero1',
    { insumos: [{ materia_prima_id: harinaP2.id, cantidad_por_unidad: 1 }] });
  await esperar('admin mezcla panadería (pide P2 para producto de P1) -> 404', 404, 'PUT',
    `${P}/recetas/${pan.id}?panaderia_id=2`, 'admin', recetaPan);
  await esperar('PUT receta inexistente -> 404', 404, 'PUT', `${P}/recetas/${panSinReceta.id}`, 'panadero1', recetaPan);
  await esperar('DELETE receta inexistente -> 404', 404, 'DELETE', `${P}/recetas/${panSinReceta.id}`, 'panadero1');
  await esperar('admin lista recetas de P1', 200, 'GET', `${P}/recetas?panaderia_id=1`, 'admin');
  await esperar('receta de levadura', 201, 'POST', `${P}/recetas/${panLevadura.id}`, 'panadero1',
    { insumos: [{ materia_prima_id: levadura.id, cantidad_por_unidad: '0.125' }] });

  // ---------- Cálculo ----------
  console.log('\n== Cálculo');
  const calc40 = await esperar('calcular 40 panes', 200, 'GET', `${P}/calcular?producto_id=${pan.id}&cantidad=40`, 'panadero1');
  igual('necesarios para 40 (harina, azúcar, mantequilla)', calc40?.insumos?.map(i => i.necesario), [5, 1.2, 0.3]);
  igual('alcanza para 40', calc40?.alcanza, true);
  igual('costo estimado 40', calc40?.costo_total_estimado, 25800);
  const calc41 = await esperar('calcular 41 panes', 200, 'GET', `${P}/calcular?producto_id=${pan.id}&cantidad=41`, 'gerente1');
  igual('no alcanza para 41 (falta 0,0075 de mantequilla)', [calc41?.alcanza, calc41?.insumos?.[2]?.faltante], [false, 0.0075]);
  await esperar('calcular producto sin receta -> 422', 422, 'GET', `${P}/calcular?producto_id=${panSinReceta.id}&cantidad=1`, 'panadero1');

  // ---------- Falta de existencias ----------
  console.log('\n== Falta de existencias');
  const antes = [await stock(harina.id), await stock(azucar.id), await stock(mantequilla.id)];
  const sinStock = await esperar('orden de 41 sin stock -> 409', 409, 'POST', `${P}/ordenes`, 'panadero1',
    { producto_id: pan.id, cantidad_planificada: 41 });
  igual('faltantes informados', sinStock?.faltantes?.map(f => f.materia_prima_id), [mantequilla.id]);
  igual('stock sin cambios tras el 409', [await stock(harina.id), await stock(azucar.id), await stock(mantequilla.id)], antes);
  igual('ninguna orden creada', await contarOrdenes(), 0);

  // ---------- Crear y finalizar ----------
  console.log('\n== Crear y finalizar');
  const creada = await esperar('orden de 40 (usa toda la mantequilla)', 201, 'POST', `${P}/ordenes`, 'panadero1',
    { producto_id: pan.id, cantidad_planificada: 40, observaciones: 'Lote de prueba' });
  const ordenA = creada?.orden;
  igual('stock descontado exacto', [await stock(harina.id), await stock(azucar.id), await stock(mantequilla.id)], [5, 3.8, 0]);
  igual('empleado y panadería de la orden', [ordenA?.empleado_id, ordenA?.panaderia_id, ordenA?.estado], [2, 1, 'en_proceso']);
  igual('costo de insumos guardado', ordenA?.costo_insumos, 25800);
  igual('alerta de stock bajo para mantequilla', creada?.alertas_stock_bajo?.map(a => a.materia_prima_id), [mantequilla.id]);

  await esperar('cambiar receta después de crear la orden', 200, 'PUT', `${P}/recetas/${pan.id}`, 'panadero1',
    { insumos: [{ materia_prima_id: harina.id, cantidad_por_unidad: 1 }] });
  igual('la orden conserva su copia histórica', (await insumosDe(ordenA.id)).map(i => [i.cantidad_por_unidad, i.cantidad_usada]),
    [[0.125, 5], [0.03, 1.2], [0.0075, 0.3]]);
  await esperar('restaurar receta original', 200, 'PUT', `${P}/recetas/${pan.id}`, 'panadero1', recetaPan);

  await esperar('panadero2 consulta orden de P1 -> 404', 404, 'GET', `${P}/ordenes/${ordenA.id}`, 'panadero2');
  await esperar('panadero2 finaliza orden de P1 -> 404', 404, 'PATCH', `${P}/ordenes/${ordenA.id}/finalizar`, 'panadero2', { cantidad_producida: 1 });
  await esperar('gerente finaliza -> 403', 403, 'PATCH', `${P}/ordenes/${ordenA.id}/finalizar`, 'gerente1', { cantidad_producida: 1 });
  await esperar('gerente consulta la orden', 200, 'GET', `${P}/ordenes/${ordenA.id}`, 'gerente1');
  await esperar('producida mayor que planificada -> 400', 400, 'PATCH', `${P}/ordenes/${ordenA.id}/finalizar`, 'panadero1', { cantidad_producida: 41 });
  const finalizada = await esperar('finalizar con 38 producidos', 200, 'PATCH', `${P}/ordenes/${ordenA.id}/finalizar`, 'panadero1', { cantidad_producida: 38 });
  igual('estado, producida y cerrado_por', [finalizada?.estado, finalizada?.cantidad_producida, finalizada?.cerrado_por], ['finalizada', 38, 2]);
  igual('producto terminado sumado', await stockProducto(pan.id), 38);
  igual('consumida = descontada', (await insumosDe(ordenA.id)).map(i => [i.cantidad_consumida, i.cantidad_devuelta, i.cantidad_mermada]),
    [[5, 0, 0], [1.2, 0, 0], [0.3, 0, 0]]);
  await esperar('finalizar dos veces -> 409', 409, 'PATCH', `${P}/ordenes/${ordenA.id}/finalizar`, 'panadero1', { cantidad_producida: 1 });
  await esperar('cancelar una orden finalizada -> 409', 409, 'PATCH', `${P}/ordenes/${ordenA.id}/cancelar`, 'panadero1',
    { motivo: 'x', devolver_insumos: true });

  // ---------- Cancelaciones ----------
  console.log('\n== Cancelaciones');
  await fijarStock(harina.id, 10);
  await fijarStock(azucar.id, 5);
  await fijarStock(mantequilla.id, 1);
  const crear8 = async () => (await pedir('POST', `${P}/ordenes`, 'panadero1', { producto_id: pan.id, cantidad_planificada: 8 })).datos.orden;

  const ordenB = await crear8();
  await esperar('cancelar sin devolver', 200, 'PATCH', `${P}/ordenes/${ordenB.id}/cancelar`, 'panadero1',
    { motivo: 'Masa dañada', devolver_insumos: false });
  igual('sin devolución: stock queda descontado', [await stock(harina.id), await stock(azucar.id), await stock(mantequilla.id)], [9, 4.76, 0.94]);
  igual('sin devolución: todo es merma', (await insumosDe(ordenB.id)).map(i => [i.cantidad_consumida, i.cantidad_devuelta, i.cantidad_mermada]),
    [[0, 0, 1], [0, 0, 0.24], [0, 0, 0.06]]);

  const ordenC = await crear8();
  const cancelC = await esperar('cancelar devolviendo todo', 200, 'PATCH', `${P}/ordenes/${ordenC.id}/cancelar`, 'panadero1',
    { motivo: 'Cambio de plan', devolver_insumos: true });
  igual('devolución total: stock restaurado', [await stock(harina.id), await stock(azucar.id), await stock(mantequilla.id)], [9, 4.76, 0.94]);
  igual('devolución total: insumos_devueltos y desglose', [cancelC?.insumos_devueltos,
    (await insumosDe(ordenC.id)).map(i => [i.cantidad_devuelta, i.cantidad_mermada])], [true, [[1, 0], [0.24, 0], [0.06, 0]]]);

  const ordenD = await crear8();
  await esperar('cancelar con devolución parcial', 200, 'PATCH', `${P}/ordenes/${ordenD.id}/cancelar`, 'panadero1',
    { motivo: 'Parcial', devolver_insumos: true, insumos: [
      { materia_prima_id: harina.id, cantidad_devuelta: '0.5' },
      { materia_prima_id: azucar.id, cantidad_devuelta: 0 }
    ] });
  igual('devolución parcial: stock', [await stock(harina.id), await stock(azucar.id), await stock(mantequilla.id)], [8.5, 4.52, 0.88]);
  igual('devolución parcial: desglose', (await insumosDe(ordenD.id)).map(i => [i.cantidad_devuelta, i.cantidad_mermada]),
    [[0.5, 0.5], [0, 0.24], [0, 0.06]]);

  const ordenE = await crear8();
  const stockE = [await stock(harina.id), await stock(azucar.id), await stock(mantequilla.id)];
  await esperar('devolver más de lo descontado -> 400', 400, 'PATCH', `${P}/ordenes/${ordenE.id}/cancelar`, 'panadero1',
    { motivo: 'x', devolver_insumos: true, insumos: [{ materia_prima_id: harina.id, cantidad_devuelta: '1.0001' }] });
  await esperar('devolver insumo ajeno a la orden -> 400', 400, 'PATCH', `${P}/ordenes/${ordenE.id}/cancelar`, 'panadero1',
    { motivo: 'x', devolver_insumos: true, insumos: [{ materia_prima_id: levadura.id, cantidad_devuelta: 1 }] });
  await esperar('devolución repetida -> 400', 400, 'PATCH', `${P}/ordenes/${ordenE.id}/cancelar`, 'panadero1',
    { motivo: 'x', devolver_insumos: true, insumos: [
      { materia_prima_id: harina.id, cantidad_devuelta: 0.1 }, { materia_prima_id: harina.id, cantidad_devuelta: 0.1 }
    ] });
  igual('tras los rechazos: stock intacto', [await stock(harina.id), await stock(azucar.id), await stock(mantequilla.id)], stockE);
  igual('tras los rechazos: la orden sigue en proceso', (await OrdenProduccion.findByPk(ordenE.id)).estado, 'en_proceso');
  await esperar('cancelar orden E', 200, 'PATCH', `${P}/ordenes/${ordenE.id}/cancelar`, 'panadero1', { motivo: 'x', devolver_insumos: true });
  await esperar('cancelar dos veces -> 409', 409, 'PATCH', `${P}/ordenes/${ordenE.id}/cancelar`, 'panadero1', { motivo: 'x', devolver_insumos: true });

  // ---------- Precisión con FLOAT ----------
  console.log('\n== Precisión');
  await esperar('orden de 1000 panes de levadura', 201, 'POST', `${P}/ordenes`, 'panadero1', { producto_id: panLevadura.id, cantidad_planificada: 1000 });
  igual('25000,125 - 125 = 24875,125 exacto', await stock(levadura.id), 24875.125);

  // ---------- Precios y costos inválidos ----------
  console.log('\n== Precios y costos inválidos');
  const ordenesAntesPrecios = await contarOrdenes();

  // Inventario acepta precios negativos; producción debe rechazarlos con 422 sin descontar nada
  const sal = await crearInsumo('panadero1', 'Sal', 100, 0, -5);
  const panSalado = await crearProducto('panadero1', 'Pan salado');
  await pedir('POST', `${P}/recetas/${panSalado.id}`, 'panadero1', { insumos: [{ materia_prima_id: sal.id, cantidad_por_unidad: '0.01' }] });
  await esperar('calcular con precio negativo -> 422', 422, 'GET', `${P}/calcular?producto_id=${panSalado.id}&cantidad=10`, 'panadero1');
  const negativo = await esperar('orden con precio negativo -> 422', 422, 'POST', `${P}/ordenes`, 'panadero1', { producto_id: panSalado.id, cantidad_planificada: 10 });
  igual('precio negativo: insumo señalado y sin detalles internos', [negativo?.materias_primas, Object.keys(negativo ?? {}).sort()],
    [[sal.id], ['error', 'materias_primas']]);
  igual('precio negativo: stock intacto', await stock(sal.id), 100);

  // Costo de 20.000.000 kg × 900.000 = 18 billones > DECIMAL(12,2): 400 antes de descontar
  const vainilla = await crearInsumo('panadero1', 'Vainilla', 30000000, 0, 900000);
  const postre = await crearProducto('panadero1', 'Postre');
  await pedir('POST', `${P}/recetas/${postre.id}`, 'panadero1', { insumos: [{ materia_prima_id: vainilla.id, cantidad_por_unidad: 200 }] });
  const excesivo = await esperar('orden con costo mayor que DECIMAL(12,2) -> 400', 400, 'POST', `${P}/ordenes`, 'panadero1',
    { producto_id: postre.id, cantidad_planificada: 100000 });
  igual('costo excesivo: mensaje sobre el costo', /costo/i.test(excesivo?.error ?? ''), true);
  igual('costo excesivo: stock intacto', await stock(vainilla.id), 30000000);
  igual('precios y costos inválidos: ninguna orden creada', await contarOrdenes(), ordenesAntesPrecios);

  // ---------- Concurrencia ----------
  console.log('\n== Concurrencia');
  await fijarStock(harina.id, 1.5);
  const dobles = await Promise.all([1, 2].map(() =>
    pedir('POST', `${P}/ordenes`, 'panadero1', { producto_id: pan.id, cantidad_planificada: 8 })));
  igual('dos órdenes simultáneas con harina para una: 201 y 409', dobles.map(r => r.status).sort(), [201, 409]);
  igual('harina final 0,5 (sin stock negativo)', await stock(harina.id), 0.5);

  const abierta = dobles.find(r => r.status === 201).datos.orden;
  const carrera = await Promise.all([
    pedir('PATCH', `${P}/ordenes/${abierta.id}/finalizar`, 'panadero1', { cantidad_producida: 8 }),
    pedir('PATCH', `${P}/ordenes/${abierta.id}/cancelar`, 'panadero1', { motivo: 'carrera', devolver_insumos: true })
  ]);
  igual('finalizar y cancelar a la vez: solo una gana', carrera.map(r => r.status).sort(), [200, 409]);

  // ---------- Errores dentro de la transacción ----------
  console.log('\n== Errores transaccionales');
  await fijarStock(harina.id, 10);
  const stockT = [await stock(harina.id), await stock(azucar.id), await stock(mantequilla.id)];
  const ordenesT = await contarOrdenes();
  const errorOriginal = console.error;
  const bulkCreateOriginal = InsumoUsado.bulkCreate;
  const createOriginal = OrdenProduccion.create;

  // Falla después de descontar el stock y crear la orden
  console.error = () => {};
  InsumoUsado.bulkCreate = async () => { throw new Error('Fallo simulado al guardar insumos'); };
  await esperar('fallo interno a mitad de transacción -> 500', 500, 'POST', `${P}/ordenes`, 'panadero1', { producto_id: pan.id, cantidad_planificada: 8 });
  InsumoUsado.bulkCreate = bulkCreateOriginal;
  console.error = errorOriginal;
  igual('rollback: stock intacto', [await stock(harina.id), await stock(azucar.id), await stock(mantequilla.id)], stockT);
  igual('rollback: ninguna orden nueva', await contarOrdenes(), ordenesT);

  // Deadlock simulado en el primer intento: se reintenta y se completa una sola vez
  let intentos = 0;
  OrdenProduccion.create = async function (...args) {
    intentos++;
    if (intentos === 1) throw Object.assign(new Error('Deadlock simulado'), { parent: { errno: 1213 } });
    return createOriginal.apply(this, args);
  };
  await esperar('deadlock simulado: se reintenta y crea la orden', 201, 'POST', `${P}/ordenes`, 'panadero1', { producto_id: pan.id, cantidad_planificada: 8 });
  OrdenProduccion.create = createOriginal;
  igual('dos intentos, una sola orden y un solo descuento', [intentos, await contarOrdenes() - ordenesT, await stock(harina.id)], [2, 1, 9]);

  // Espera de bloqueo agotada: conflicto recuperable, sin reintento automático
  const stockL = await stock(harina.id);
  OrdenProduccion.create = async () => { throw Object.assign(new Error('Lock wait simulado'), { parent: { errno: 1205 } }); };
  const conflicto = await esperar('lock wait timeout -> 409 recuperable', 409, 'POST', `${P}/ordenes`, 'panadero1', { producto_id: pan.id, cantidad_planificada: 8 });
  OrdenProduccion.create = createOriginal;
  igual('respuesta indica reintentar', [conflicto?.codigo, conflicto?.reintentar], ['CONFLICTO_CONCURRENCIA', true]);
  igual('lock wait: stock intacto', await stock(harina.id), stockL);

  // ---------- Invariantes finales ----------
  console.log('\n== Invariantes');
  const [incoherentes] = await sequelize.query(`
    SELECT i.id FROM insumo_usado i JOIN orden_produccion o ON o.id = i.orden_id
    WHERE (o.estado = 'en_proceso' AND (i.cantidad_consumida + i.cantidad_devuelta + i.cantidad_mermada) <> 0)
       OR (o.estado = 'finalizada' AND (i.cantidad_consumida <> i.cantidad_usada OR i.cantidad_devuelta <> 0 OR i.cantidad_mermada <> 0))
       OR (o.estado = 'cancelada' AND (i.cantidad_consumida <> 0 OR i.cantidad_devuelta + i.cantidad_mermada <> i.cantidad_usada))`);
  igual('cantidades coherentes con el estado de cada orden', incoherentes.length, 0);
  const [[negativos]] = await sequelize.query('SELECT COUNT(*) AS n FROM materia_prima WHERE cantidad_disponible < 0');
  igual('ninguna materia prima con stock negativo', negativos.n, 0);
};

main()
  .catch(error => registrar(false, 'Ejecución abortada', error.message))
  .finally(async () => {
    const fallidas = resultados.filter(r => !r.ok).length;
    console.log(`\n${resultados.length - fallidas}/${resultados.length} pruebas correctas`);
    await sequelize.close().catch(() => {});
    process.exit(fallidas > 0 ? 1 : 0);
  });
