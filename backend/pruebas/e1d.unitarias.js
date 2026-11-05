// E1d: solo dobles en memoria. Se bloquea toda conexión antes de cargar modelos.
process.env.DB_HOST = 'base-inexistente.invalid';
process.env.DB_NAME = 'sin_base_pruebas_unitarias';
const net = require('net');
const tls = require('tls');
const bloquear = () => { throw new Error('Red prohibida en pruebas unitarias E1d'); };
net.connect = net.createConnection = net.Socket.prototype.connect = tls.connect = bloquear;
const assert = require('node:assert/strict');
const { sequelize, MateriaPrima, Producto, RecetaProducto, OrdenProduccion, InsumoUsado } = require('../src/models');
const inventario = require('../src/modules/inventario/inventario.service');
const controller = require('../src/modules/inventario/inventario.controller');
const ordenes = require('../src/modules/produccion/ordenes.service');
const { enTransaccion } = require('../src/utils/transaccion');
const { LIMITE_VERSION, parsearVersion } = require('../src/utils/version-fila');
const { Op } = require('sequelize');
let casos = 0;
const test = async (nombre, fn) => { await fn(); casos++; console.log(`OK ${nombre}`); };
const codigo = (c) => e => e.detalle?.codigo === c;
const clone = x => JSON.parse(JSON.stringify(x));
let db, eventos, pendientes, fallo, cola = Promise.resolve();
const reset = () => {
  db = { materias: [1, 2].map(id => ({ id, panaderia_id: 20, nombre: `Materia ${id}`, unidad_medida: 'kg', estado: true,
    cantidad_disponible: 10, stock_minimo: 0, precio_unitario: 1, version_fila: 0 })), orden: null, insumos: [] };
  eventos = []; pendientes = []; fallo = null;
};
// Serializa los intentos simulando la exclusión de la fila; restaura TODO el estado al fallar.
sequelize.transaction = async (opciones, callback) => {
  const fn = callback || opciones;
  const anterior = cola; let liberar;
  cola = new Promise(r => { liberar = r; }); await anterior;
  const antes = clone(db);
  const t = { LOCK: { UPDATE: 'UPDATE' }, isolationLevel: callback ? opciones.isolationLevel : undefined };
  eventos.push(['begin', t.isolationLevel]);
  try { const r = await fn(t); eventos.push(['commit']); return r; }
  catch (e) { db = antes; eventos.push(['rollback']); throw e; }
  finally { liberar(); }
};
const coincide = (m, w) => (w.id === undefined || (Array.isArray(w.id) ? w.id.includes(m.id) : m.id === Number(w.id))) &&
  (w.panaderia_id === undefined || m.panaderia_id === w.panaderia_id);
MateriaPrima.findOne = async o => {
  if (o.lock) assert.equal(o.lock, o.transaction.LOCK.UPDATE);
  eventos.push([o.lock ? 'materia-X' : 'lectura', o.where.id]);
  const m = db.materias.find(m => coincide(m, o.where)); return m ? clone(m) : null;
};
MateriaPrima.findAll = async o => {
  const filas = db.materias.filter(m => coincide(m, o.where)).sort((a, b) => a.id - b.id);
  if (o.lock) { assert.deepEqual(o.order, [['id', 'ASC']]); eventos.push(['materias-X', filas.map(m => m.id)]); }
  return filas.map(m => ({ ...clone(m), get: c => ({ disponible: m.cantidad_disponible, minimo: m.stock_minimo, precio: m.precio_unitario, version_fila: m.version_fila })[c] }));
};
MateriaPrima.create = async datos => { db.materias.push({ id: 3, ...datos }); return datos; };
MateriaPrima.update = async (campos, o) => {
  assert.ok(o.transaction); eventos.push(['update', o.where.id]);
  if (fallo === o.where.id) return [0];
  const m = db.materias.find(m => coincide(m, o.where));
  if (!m || m.version_fila !== o.where.version_fila || (o.where.estado !== undefined && m.estado !== o.where.estado)) return [0];
  if (o.where.cantidad_disponible?.[Op.gte] !== undefined && m.cantidad_disponible < Number(o.where.cantidad_disponible[Op.gte])) return [0];
  if (o.where.cantidad_disponible?.[Op.lte] !== undefined && m.cantidad_disponible > Number(o.where.cantidad_disponible[Op.lte])) return [0];
  assert.equal(campos.version_fila.val, 'version_fila + 1');
  for (const [c, v] of Object.entries(campos)) {
    if (c === 'version_fila') m[c]++;
    else if (v?.val) {
      const match = /^cantidad_disponible ([+-]) ([\d.]+)$/.exec(v.val); assert.ok(match);
      m[c] = (Math.round(m[c] * 10000) + (match[1] === '+' ? 1 : -1) * Math.round(Number(match[2]) * 10000)) / 10000;
    } else m[c] = v;
  }
  return [1];
};
sequelize.query = async (sql, o) => {
  assert.equal(o.transaction.isolationLevel, 'READ COMMITTED');
  assert.ok(eventos.some(e => e[0] === 'materia-X'));
  assert.doesNotMatch(sql, /FOR SHARE|FOR UPDATE/i);
  assert.equal(o.replacements.propia, 20);
  eventos.push(['pendientes']); return pendientes.filter(p => p.destino === o.replacements.id);
};
Producto.findOne = async () => ({ id: 40, panaderia_id: 20 });
RecetaProducto.findAll = async () => [2, 1].sort().map(materia_prima_id => ({ materia_prima_id, cantidad_por_unidad: 1 }));
OrdenProduccion.create = async datos => { db.orden = { id: 5, ...datos }; return db.orden; };
OrdenProduccion.findOne = async o => { if (o.lock) eventos.push(['orden-X']); return db.orden ? clone(db.orden) : null; };
OrdenProduccion.update = async campos => { Object.assign(db.orden, campos); return [1]; };
InsumoUsado.bulkCreate = async filas => { db.insumos = clone(filas); };
InsumoUsado.findAll = async () => db.insumos.map((i, index) => ({ ...clone(i), update: async campos => Object.assign(db.insumos[index], campos) }));
const crear = () => ordenes.crear({ producto_id: 40, cantidad_planificada: 2, version_fila: 999 }, 20, 11);
const cancelar = datos => ordenes.cancelar(5, { motivo: 'Prueba', devolver_insumos: true, ...datos }, 20, 11);

(async () => {
  await test('validación estricta, incluidos 0 y límite', async () => {
    for (const v of [undefined, null, true, '0', -1, 0.5, Infinity, NaN, LIMITE_VERSION + 1]) assert.throws(() => parsearVersion(v), e => e.status === 400);
    assert.equal(parsearVersion(0), 0); assert.equal(parsearVersion(LIMITE_VERSION), LIMITE_VERSION);
  });
  await test('POST ignora versión, estado y panadería del cliente', async () => {
    reset(); const r = await inventario.crear({ nombre: 'Sal', version_fila: 99, estado: false, panaderia_id: 99 }, 20);
    assert.equal(r.version_fila, 0); assert.equal(r.panaderia_id, 20); assert.equal(r.estado, undefined);
  });
  await test('PUT ordinario incrementa sin consultar pendientes ni cambiar aislamiento', async () => {
    reset(); pendientes = [{ destino: 1 }]; const r = await inventario.actualizar(1, { version_fila: 0, cantidad_disponible: '2.1234', precio_unitario: 2, stock_minimo: 1 }, 20);
    assert.equal(r.version_fila, 1); assert.equal(r.cantidad_disponible, 2.1234);
    assert.ok(!eventos.some(e => e[0] === 'pendientes')); assert.equal(eventos[0][1], undefined);
  });
  await test('nombre/unidad iguales no consultan pendientes; PUT vacío incrementa', async () => {
    reset(); pendientes = [{ destino: 1 }];
    await inventario.actualizar(1, { version_fila: 0, nombre: 'Materia 1', unidad_medida: 'kg' }, 20);
    assert.ok(!eventos.some(e => e[0] === 'pendientes'));
    assert.equal((await inventario.actualizar(1, { version_fila: 1 }, 20)).version_fila, 2);
  });
  await test('cambios estructurales y DELETE rechazan pendientes de cualquier pareja', async () => {
    for (const campos of [{ nombre: 'Nuevo' }, { unidad_medida: 'g' }, null]) {
      reset(); pendientes = [{ destino: 1, pareja: [20, 30] }, { destino: 1, pareja: [20, 40] }]; const antes = clone(db);
      await assert.rejects(campos ? inventario.actualizar(1, { version_fila: 0, ...campos }, 20) : inventario.eliminar(1, 20, 0), codigo('MATERIA_EN_SOLICITUD_PENDIENTE'));
      assert.deepEqual(db, antes); assert.ok(eventos.some(e => e[0] === 'rollback'));
    }
  });
  await test('PUT estructural y DELETE válidos; desactivación no se repite', async () => {
    reset(); await inventario.actualizar(1, { version_fila: 0, nombre: 'Nuevo' }, 20);
    await inventario.eliminar(1, 20, 1); assert.equal(db.materias[0].version_fila, 2); assert.equal(db.materias[0].estado, false);
    await assert.rejects(inventario.eliminar(1, 20, 2), codigo('MATERIA_INACTIVA'));
  });
  await test('PUT/PUT, PUT/DELETE y DELETE/DELETE concurrentes: una sola versión gana', async () => {
    for (const par of [['put', 'put'], ['put', 'delete'], ['delete', 'delete']]) {
      reset(); const r = await Promise.allSettled(par.map(tipo => tipo === 'put' ? inventario.actualizar(1, { version_fila: 0, precio_unitario: 2 }, 20) : inventario.eliminar(1, 20, 0)));
      assert.equal(r.filter(x => x.status === 'fulfilled').length, 1);
      assert.equal(r.find(x => x.status === 'rejected').reason.detalle.codigo, 'VERSION_DESACTUALIZADA'); assert.equal(db.materias[0].version_fila, 1);
    }
  });
  await test('límite y penúltima versión, sin desbordamiento', async () => {
    reset(); db.materias[0].version_fila = LIMITE_VERSION - 1;
    await inventario.actualizar(1, { version_fila: LIMITE_VERSION - 1 }, 20);
    await assert.rejects(inventario.eliminar(1, 20, LIMITE_VERSION), codigo('VERSION_AGOTADA'));
  });
  await test('aislamiento: materia ajena no se lee ni escribe', async () => {
    reset(); await assert.rejects(inventario.actualizar(1, { version_fila: 0 }, 21), e => e.status === 400);
    assert.equal(db.materias[0].version_fila, 0);
  });
  await test('DELETE controller exige versión del cuerpo', async () => {
    reset(); const res = { status(c) { this.codigo = c; return this; }, json(b) { this.body = b; } };
    await controller.eliminar({ params: { id: 1 }, panaderiaId: 20, body: {} }, res); assert.equal(res.codigo, 400);
  });
  await test('Producción descuenta con versión bloqueada y orden ascendente', async () => {
    reset(); await crear(); assert.deepEqual(db.materias.map(m => [m.cantidad_disponible, m.version_fila]), [[8, 1], [8, 1]]);
    assert.deepEqual(eventos.find(e => e[0] === 'materias-X')[1], [1, 2]);
    await assert.rejects(inventario.actualizar(1, { version_fila: 0, cantidad_disponible: 10 }, 20), codigo('VERSION_DESACTUALIZADA'));
  });
  await test('fallo en segundo descuento revierte primero y no crea orden', async () => {
    reset(); const antes = clone(db); fallo = 2; await assert.rejects(crear(), codigo('VERSION_DESACTUALIZADA')); assert.deepEqual(db, antes);
  });
  await test('versión agotada y stock insuficiente rechazan antes de descontar', async () => {
    reset(); db.materias[1].version_fila = LIMITE_VERSION; await assert.rejects(crear(), codigo('VERSION_AGOTADA')); assert.ok(!eventos.some(e => e[0] === 'update'));
    reset(); db.materias[1].cantidad_disponible = 0; await assert.rejects(crear(), e => e.status === 409); assert.ok(!eventos.some(e => e[0] === 'update'));
  });
  await test('cancelación devuelve a materia inactiva; bloquea todas antes de escribir', async () => {
    reset(); await crear(); eventos = []; db.materias[0].estado = false;
    await cancelar(); assert.deepEqual(db.materias.map(m => [m.cantidad_disponible, m.version_fila]), [[10, 2], [10, 2]]);
    assert.equal(db.materias[0].estado, false);
    assert.ok(eventos.findIndex(e => e[0] === 'materias-X') < eventos.findIndex(e => e[0] === 'update'));
    await assert.rejects(cancelar(), e => e.status === 409);
  });
  await test('devolución parcial o cero solo incrementa materias efectivamente devueltas', async () => {
    reset(); await crear(); await cancelar({ insumos: [{ materia_prima_id: 1, cantidad_devuelta: 0.5 }, { materia_prima_id: 2, cantidad_devuelta: 0 }] });
    assert.deepEqual(db.materias.map(m => [m.cantidad_disponible, m.version_fila]), [[8.5, 2], [8, 1]]);
    reset(); await crear(); eventos = []; await cancelar({ devolver_insumos: false }); assert.ok(!eventos.some(e => e[0] === 'materias-X' || e[0] === 'update'));
  });
  await test('devolución: agotamiento, tope y fallo intermedio revierten toda la orden', async () => {
    for (const tipo of ['version', 'tope', 'fallo']) {
      reset(); await crear(); if (tipo === 'version') db.materias[1].version_fila = LIMITE_VERSION;
      if (tipo === 'tope') db.materias[1].cantidad_disponible = 99999999.9999;
      if (tipo === 'fallo') fallo = 2;
      const antes = clone(db); await assert.rejects(cancelar(), e => e.status === 409); assert.deepEqual(db, antes);
    }
  });
  await test('reintentos conservan opciones; 1205 y negocio no se reintentan', async () => {
    const opciones = { isolationLevel: 'READ COMMITTED' }; let llamadas = 0;
    const fake = { transaction: async (o, fn) => { assert.equal(o, opciones); llamadas++; return fn(); } };
    await enTransaccion(fake, async () => { if (llamadas < 3) throw { errno: 1213 }; }, 3, opciones); assert.equal(llamadas, 3);
    for (const errno of [1205, 1213]) { llamadas = 0; await assert.rejects(enTransaccion(fake, async () => { throw Object.assign(new Error(), { errno }); }, 3, opciones)); assert.equal(llamadas, errno === 1213 ? 3 : 1); }
  });
  await test('E1b real frente a cambio estructural: ambos órdenes, pareja nueva y FOR SHARE hasta commit', async () => {
    const red = require('../src/modules/red/red.operaciones');
    const consultas = require('../src/modules/red/red.consultas');
    const detalleOriginal = consultas.detalle;
    const queryOriginal = sequelize.query;
    let compartido, nombreCopiado;
    consultas.detalle = async () => ({ id: 10 });
    sequelize.query = async (sql, o) => {
      const S = red.SQL_OP, rep = o.replacements;
      if (!Object.values(S).includes(sql)) return queryOriginal(sql, o);
      assert.ok(o.transaction);
      switch (sql) {
        case S.PANADERIAS_PREVIA:
        case S.BLOQUEAR_PANADERIAS: return [{ id: 20, en_red: 1 }, { id: 30, en_red: 1 }];
        case S.INSERTAR_PAREJA: return [0, 1];
        case S.BLOQUEAR_PAREJA: return [{ pendientes: 0 }];
        case S.LEER_PENDIENTES: return [];
        case S.BLOQUEAR_DESTINOS:
          assert.match(sql, /ORDER BY id FOR SHARE$/);
          compartido = o.transaction;
          return db.materias.filter(m => rep[0].includes(m.id)).map(m => clone(m));
        case S.INSERTAR_SOLICITUD: assert.equal(o.transaction, compartido); return [10, 1];
        case S.INSERTAR_DETALLE:
          assert.equal(o.transaction, compartido); nombreCopiado = rep[5]; pendientes.push({ destino: rep[4] }); return [11, 1];
        case S.INSERTAR_EVENTO_CREADA: assert.equal(o.transaction, compartido); return [12, 1];
        case S.CONTADOR_MAS: assert.equal(o.transaction, compartido); return [undefined, 1];
        default: throw new Error('SQL inesperado en doble E1b');
      }
    };
    const solicitar = () => red.crear({ panaderiaId: 20, actorId: 11, proveedoraId: 30, lineas: [{ linea: 1, destino: 1, cantidad: 10000 }] });
    try {
      reset();
      const r = await Promise.allSettled([solicitar(), inventario.actualizar(1, { version_fila: 0, nombre: 'Nuevo' }, 20)]);
      assert.equal(r[0].status, 'fulfilled'); assert.equal(r[1].reason.detalle.codigo, 'MATERIA_EN_SOLICITUD_PENDIENTE');
      reset();
      await Promise.all([inventario.actualizar(1, { version_fila: 0, nombre: 'Nuevo' }, 20), solicitar()]);
      assert.equal(nombreCopiado, 'Nuevo');
      reset();
      const borrado = await Promise.allSettled([inventario.eliminar(1, 20, 0), solicitar()]);
      assert.equal(borrado[0].status, 'fulfilled'); assert.equal(borrado[1].reason.detalle.codigo, 'MATERIA_INACTIVA_O_AJENA');
    } finally { sequelize.query = queryOriginal; consultas.detalle = detalleOriginal; }
  });
  await test('interbloqueo tras escritura: rollback y reintento incrementan solo una vez', async () => {
    reset(); const update = MateriaPrima.update; let intentos = 0;
    MateriaPrima.update = async (...args) => {
      const r = await update(...args);
      if (++intentos === 1) throw Object.assign(new Error('interbloqueo simulado'), { errno: 1213 });
      return r;
    };
    try {
      await inventario.actualizar(1, { version_fila: 0, nombre: 'Nuevo' }, 20);
      assert.equal(db.materias[0].version_fila, 1); assert.equal(intentos, 2);
      assert.equal(eventos.filter(e => e[0] === 'rollback').length, 1);
      assert.ok(eventos.filter(e => e[0] === 'begin').every(e => e[1] === 'READ COMMITTED'));
    } finally { MateriaPrima.update = update; }
  });
  await test('fallo al guardar históricos revierte stock y versiones de Producción', async () => {
    reset(); const antes = clone(db); const guardar = InsumoUsado.bulkCreate;
    InsumoUsado.bulkCreate = async () => { throw new Error('históricos simulados'); };
    try { await assert.rejects(crear(), /históricos simulados/); assert.deepEqual(db, antes); }
    finally { InsumoUsado.bulkCreate = guardar; }
  });
  console.log(`${casos}/${casos} casos E1d correctos (sin MySQL)`);
})().catch(e => { console.error(e); process.exitCode = 1; });
