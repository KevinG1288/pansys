// E1e. NO se conecta al importar ni sin --ejecutar y DB_NAME=pansys_test.
// Evidencias fuera del repositorio, directorio nuevo. No ejecutar en una demo activa.
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const ESCENARIOS = [
  'Crear y consultar solicitud A→B', 'Aceptar varias líneas con origen compartido',
  'Rechazar y cancelar sin mover stock', 'Aceptación inválida sin efectos parciales',
  'Inventario y versiones después de transferir', 'Protección de pendientes y cambios ordinarios',
  'Creación frente a cambio estructural en ambos órdenes', 'Red frente a descuento de Producción',
  'Devolución de Producción frente a entrada de red', 'Permisos y aislamiento'
];
const validarInicio = (argv, env) => {
  if (argv.length !== 3 || argv[0] !== '--ejecutar' || argv[1] !== '--evidencia') throw new Error('Uso: node pruebas/red.pruebas.js --ejecutar --evidencia <directorio-nuevo-fuera-del-repositorio>');
  if (env.DB_NAME !== 'pansys_test') throw new Error('DB_NAME debe ser exactamente pansys_test antes de cargar módulos');
  for (const v of ['PANSYS_MODO_DEMO', 'PANSYS_SERVIR_FRONTEND', 'PANSYS_AUTORIZAR_BASE_PRODUCCION']) {
    if (env[v] !== undefined) throw new Error(`${v} debe estar ausente`);
  }
  const dir = path.resolve(argv[2]), raiz = path.resolve(__dirname, '../..');
  const relativo = path.relative(raiz, dir);
  if (!relativo || (!relativo.startsWith(`..${path.sep}`) && relativo !== '..' && !path.isAbsolute(relativo))) throw new Error('Las evidencias deben quedar fuera del repositorio');
  if (fs.existsSync(dir)) throw new Error('El directorio de evidencias ya existe: no se sobrescribe');
  return dir;
};
const esperarCondicion = async (fn, ms = 5000) => {
  const hasta = Date.now() + ms;
  do { if (await fn()) return; await new Promise(r => setTimeout(r, 25)); } while (Date.now() < hasta);
  throw new Error('Sincronización agotada: no se demostró la espera entre conexiones');
};

// Lista cerrada: Daemon por sí solo NO acredita que una sesión sea interna.
const clasificarSesiones = (filas, eventosHabilitados = 0) => {
  const internas = [], peligrosas = [];
  for (const f of filas) {
    const comun = f.TYPE === 'FOREGROUND' && f.PROCESSLIST_COMMAND === 'Daemon' && f.CONNECTION_TYPE === null && f.PROCESSLIST_DB === null;
    const gtid = comun && f.NAME === 'thread/sql/compress_gtid_table' && f.PROCESSLIST_USER === null && f.PROCESSLIST_HOST === null;
    const scheduler = comun && f.NAME === 'thread/sql/event_scheduler' && f.PROCESSLIST_USER === 'event_scheduler' && f.PROCESSLIST_HOST === 'localhost' && eventosHabilitados === 0;
    (gtid || scheduler ? internas : peligrosas).push(f);
  }
  return { internas, peligrosas };
};
const comprobarSesiones = async leer => {
  const filas = await leer(`SELECT THREAD_ID, NAME, TYPE, PROCESSLIST_ID, PROCESSLIST_USER,
    PROCESSLIST_HOST, PROCESSLIST_DB, PROCESSLIST_COMMAND, CONNECTION_TYPE
    FROM performance_schema.threads WHERE PROCESSLIST_ID IS NOT NULL AND PROCESSLIST_ID <> CONNECTION_ID()`);
  // Un scheduler interno puede ejecutar escrituras: exigir que no haya eventos habilitados.
  const eventos = await leer("SELECT COUNT(*) AS n FROM information_schema.EVENTS WHERE STATUS = 'ENABLED'");
  const resultado = clasificarSesiones(filas, Number(eventos[0].n));
  assert.equal(resultado.peligrosas.length, 0, 'Existen sesiones cliente o procesos no acreditados como internos');
  const trx = await leer('SELECT COUNT(*) AS n FROM information_schema.INNODB_TRX WHERE trx_mysql_thread_id <> CONNECTION_ID()');
  assert.equal(Number(trx[0].n), 0, 'Existen transacciones ajenas');
  return resultado.internas.map(f => ({ id: f.PROCESSLIST_ID, nombre: f.NAME }));
};

const carreraControlada = async ({ sequelize, leer, patron, primero, segundo, alObservar = () => {}, nombre, limite = 5000 }) => {
    let soltar, alcanzado, hilo, solicitante, temporizador;
    const puerta = new Promise(r => { soltar = r; });
    const llego = new Promise(r => { alcanzado = r; });
    sequelize.addHook('beforeQuery', nombre, (opciones, query) => {
      const id = Number(query.connection.threadId);
      if (hilo && opciones.transaction && id !== hilo && !solicitante) solicitante = id;
    });
    sequelize.addHook('afterQuery', nombre, async (opciones, query) => {
      if (!hilo && patron.test(query.sql || '') && opciones.transaction) {
        hilo = Number(query.connection.threadId); alcanzado(); await puerta;
      }
    });
    let p1, p2;
    try {
      p1 = primero(); p1.catch(() => {});
      await Promise.race([llego, new Promise((_, reject) => { temporizador = setTimeout(() => reject(new Error('No se alcanzó el bloqueo previsto')), 5000); })]);
      p2 = segundo(); p2.catch(() => {});
      await esperarCondicion(async () => (await leer(`SELECT 1 AS espera FROM performance_schema.data_lock_waits w
        JOIN performance_schema.threads b ON b.THREAD_ID = w.BLOCKING_THREAD_ID
        JOIN performance_schema.threads r ON r.THREAD_ID = w.REQUESTING_THREAD_ID
        WHERE b.PROCESSLIST_ID = ? AND r.PROCESSLIST_ID = ? LIMIT 1`, [hilo, solicitante || 0])).length > 0, limite);
      alObservar(hilo, solicitante);
      soltar(); return await Promise.all([p1, p2]);
    } finally {
      clearTimeout(temporizador); soltar(); sequelize.removeHook('afterQuery', nombre); sequelize.removeHook('beforeQuery', nombre);
      await Promise.allSettled([p1, p2].filter(Boolean));
    }
  };

async function ejecutar(argv = process.argv.slice(2), env = process.env) {
  const dir = validarInicio(argv, env); // Antes de dotenv, Sequelize, mysql2 o app.
  process.env.PORT = '0';
  require('../src/config/entorno');
  validarInicio(argv, process.env); // Comprobar también las opciones cargadas del .env.
  const { sequelize } = require('../src/models');
  assert.equal(sequelize.config.database, 'pansys_test');
  const { iniciarEjecucion, limpiezaCorrecta, TABLAS_RED } = require('./aislamiento');
  const foto = require('./foto_pansys_test');
  const jwt = require('jsonwebtoken');
  // Cada conexión nueva del pool verifica su base efectiva antes de poder utilizarse.
  sequelize.addHook('afterConnect', 'e1e-base', conexion => new Promise((resolve, reject) => {
    conexion.query('SELECT DATABASE() AS base', (error, filas) => {
      if (error) return reject(error);
      try { assert.equal(filas[0].base, 'pansys_test'); resolve(); } catch (e) { reject(e); }
    });
  }));
  let ejecucion, servidor, url, numero = 0, incierto = false, limpia = false;
  const cuentas = {}, tokens = {}, pans = {}, peticiones = new Set();
  const manifiesto = { base: 'pansys_test', runId: null, estado: 'preparando', escenarios: [], ids: {}, solicitudes: [] };
  fs.mkdirSync(dir); // Sin recursive: ruta nueva, padre existente.
  const guardar = () => fs.writeFileSync(path.join(dir, 'manifiesto.json'), JSON.stringify(manifiesto, null, 2));
  guardar();
  const leer = async (sql, replacements = []) => {
    try { return (await sequelize.query(sql, { replacements }))[0]; }
    catch (e) {
      if (e.original?.fatal || e.parent?.fatal || /Connection|Timeout/.test(e.name || '')) {
        incierto = true; ejecucion?.abortar('Conexión perdida o resultado incierto');
      }
      throw e;
    }
  };
  const base = async () => assert.equal((await leer('SELECT DATABASE() AS base'))[0].base, 'pansys_test');
  const guardarIds = async () => {
    if (!ejecucion) return;
    manifiesto.propios = ejecucion.pendientes();
    const propios = ejecucion.ids('panaderias');
    if (propios.length) {
      for (const t of ['materia_prima', 'productos', 'orden_produccion', 'movimientos_red', 'eventos_red']) {
        manifiesto.ids[t] = (await leer(`SELECT id FROM pansys_test.${t} WHERE panaderia_id IN (?) ORDER BY id`, [propios])).map(f => Number(f.id));
      }
      manifiesto.ids.solicitudes_red = (await leer('SELECT id FROM pansys_test.solicitudes_red WHERE panaderia_solicitante_id IN (?) AND panaderia_proveedora_id IN (?) ORDER BY id', [propios, propios])).map(f => Number(f.id));
      const ids = manifiesto.ids.solicitudes_red;
      manifiesto.ids.solicitudes_red_detalle = ids.length ? (await leer('SELECT id FROM pansys_test.solicitudes_red_detalle WHERE solicitud_id IN (?) ORDER BY id', [ids])).map(f => Number(f.id)) : [];
      const productos = manifiesto.ids.productos, ordenes = manifiesto.ids.orden_produccion;
      manifiesto.ids.receta_producto = productos.length ? (await leer('SELECT id FROM pansys_test.receta_producto WHERE producto_id IN (?) ORDER BY id', [productos])).map(f => Number(f.id)) : [];
      manifiesto.ids.insumo_usado = ordenes.length ? (await leer('SELECT id FROM pansys_test.insumo_usado WHERE orden_id IN (?) ORDER BY id', [ordenes])).map(f => Number(f.id)) : [];
      manifiesto.parejas = await leer('SELECT panaderia_menor_id, panaderia_mayor_id FROM pansys_test.red_parejas WHERE panaderia_menor_id IN (?) AND panaderia_mayor_id IN (?)', [propios, propios]);
    }
    guardar();
  };
  const pedir = (metodo, ruta, quien, body) => {
    const promesa = (async () => {
      await ejecucion.exigirBloqueo();
      assert.ok(url && tokens[quien]);
      const intento = { metodo, ruta, estado: 'enviando' };
      manifiesto.solicitudes.push(intento); guardar();
      try {
        const res = await fetch(url + ruta, { method: metodo, headers: { Authorization: `Bearer ${tokens[quien]}`, 'Content-Type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
        const datos = await res.json(); intento.estado = res.status; guardar();
        if (res.status >= 500) { incierto = true; ejecucion.abortar('Respuesta interna: conservar datos para revisión'); }
        return { status: res.status, datos };
      } catch (e) { incierto = true; ejecucion.abortar('Petición de resultado incierto'); intento.estado = 'incierta'; guardar(); throw e; }
    })();
    peticiones.add(promesa); promesa.then(() => peticiones.delete(promesa), () => peticiones.delete(promesa));
    return promesa;
  };
  const ok = async (status, ...args) => { const r = await pedir(...args); assert.equal(r.status, status, `${args[0]} ${args[1]}: ${JSON.stringify(r.datos)}`); return r.datos; };
  const materia = (lado, cantidad = 10, unidad = 'kg') => ok(201, 'POST', '/api/inventario', lado, {
    nombre: ejecucion.nombre(`Materia${++numero}`), unidad_medida: unidad, cantidad_disponible: cantidad, stock_minimo: 0, precio_unitario: 2
  });
  const fila = async id => {
    const filas = await leer('SELECT id, cantidad_disponible, version_fila, estado FROM pansys_test.materia_prima WHERE id = ? AND panaderia_id IN (?)', [id, Object.values(pans)]);
    assert.equal(filas.length, 1); return { cantidad: Math.round(Number(filas[0].cantidad_disponible) * 10000), version: Number(filas[0].version_fila), estado: Number(filas[0].estado) };
  };
  const solicitud = (destinos, cantidad = 1, lado = 'a') => ok(201, 'POST', '/api/red/solicitudes', lado, {
    proveedora_id: pans[lado === 'a' ? 'b' : 'a'], nota: ejecucion.nombre('Solicitud'),
    lineas: destinos.map(d => ({ materia_prima_destino_id: d.id, cantidad }))
  });
  const aceptar = (s, origen, quien = 'b') => pedir('POST', `/api/red/solicitudes/${s.id}/aceptar`, quien, {
    lineas: s.lineas.map(l => ({ detalle_id: l.id, materia_prima_origen_id: origen.id }))
  });
  const cierre = (s, tipo, quien) => ok(200, 'POST', `/api/red/solicitudes/${s.id}/${tipo}`, quien, tipo === 'rechazar' ? { motivo: 'Prueba E1e' } : {});
  const fotoPropia = async () => {
    const p = Object.values(pans), salida = {};
    for (const t of ['materia_prima', 'orden_produccion', 'movimientos_red', 'eventos_red']) salida[t] = await leer(`SELECT * FROM pansys_test.${t} WHERE panaderia_id IN (?) ORDER BY id`, [p]);
    salida.solicitudes = await leer('SELECT * FROM pansys_test.solicitudes_red WHERE panaderia_solicitante_id IN (?) AND panaderia_proveedora_id IN (?) ORDER BY id', [p, p]);
    salida.detalles = salida.solicitudes.length ? await leer('SELECT * FROM pansys_test.solicitudes_red_detalle WHERE solicitud_id IN (?) ORDER BY id', [salida.solicitudes.map(s => s.id)]) : [];
    salida.insumos = salida.orden_produccion.length ? await leer('SELECT * FROM pansys_test.insumo_usado WHERE orden_id IN (?) ORDER BY id', [salida.orden_produccion.map(o => o.id)]) : [];
    salida.parejas = await leer('SELECT * FROM pansys_test.red_parejas WHERE panaderia_menor_id IN (?) AND panaderia_mayor_id IN (?) ORDER BY panaderia_menor_id, panaderia_mayor_id', [p, p]);
    return salida;
  };
  const producto = async (lado, insumo) => {
    const id = await ejecucion.crearProducto({ etiqueta: `P${++numero}`, panaderiaId: pans[lado], precio: 5, cantidad: 0, activo: true });
    await ok(201, 'POST', `/api/produccion/recetas/${id}`, lado, { insumos: [{ materia_prima_id: insumo.id, cantidad_por_unidad: 1 }] }); return id;
  };
  const producir = (lado, id, cantidad) => pedir('POST', '/api/produccion/ordenes', lado, { producto_id: id, cantidad_planificada: cantidad });

  // Pausa tras un SELECT bloqueante REAL del primer actor. Se observa al segundo en
  // performance_schema.data_lock_waits antes de liberar al primero. Sin sleeps como prueba.
  const carrera = (patron, primero, segundo) => carreraControlada({ sequelize, leer, patron, primero, segundo,
    nombre: `e1e-${numero++}`, alObservar: (bloqueante, solicitante) => {
      manifiesto.esperas = (manifiesto.esperas || 0) + 1;
      (manifiesto.concurrencia ||= []).push({ bloqueante, solicitante }); guardar();
    } });
  const X = /FROM `materia_prima`[\s\S]*FOR UPDATE/i;
  const S = /SELECT id, nombre, unidad_medida, estado FROM materia_prima[\s\S]*FOR SHARE/i;
  const RX = /SELECT id, panaderia_id, unidad_medida, estado, cantidad_disponible, precio_unitario, version_fila FROM materia_prima[\s\S]*FOR UPDATE/i;
  let antes;
  try {
    await base();
    manifiesto.sesionesInternas = await comprobarSesiones(leer); guardar();
    // Comprobar permisos/instrumentación ANTES de crear datos: solo SELECT, ninguna concesión.
    await leer('SELECT w.REQUESTING_THREAD_ID, t.PROCESSLIST_ID FROM performance_schema.data_lock_waits w JOIN performance_schema.threads t ON t.THREAD_ID = w.REQUESTING_THREAD_ID LIMIT 0');
    const tablas = await leer("SELECT TABLE_NAME AS tabla FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'pansys_test' AND TABLE_NAME IN (?) AND ENGINE = 'InnoDB'", [TABLAS_RED]);
    assert.equal(tablas.length, 5, 'SQL006 ausente/incompleto: no se migra automáticamente');
    const columnas = await leer("SELECT COLUMN_NAME AS columna FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = 'pansys_test' AND TABLE_NAME = 'materia_prima' AND COLUMN_NAME = 'version_fila'");
    assert.equal(columnas.length, 1, 'Falta version_fila');
    ejecucion = await iniciarEjecucion({ suite: 'red', sequelize });
    manifiesto.runId = ejecucion.runId; guardar();
    antes = await foto.tomarFoto(); foto.guardarFoto(antes, path.join(dir, 'antes.json'));
    for (const lado of ['a', 'b']) {
      cuentas[`admin${lado}`] = await ejecucion.crearCuenta({ etiqueta: `admin${lado}`, rol: 'administrador', activa: true });
      await guardarIds();
      pans[lado] = await ejecucion.crearPanaderia({ etiqueta: lado.toUpperCase(), propietariaId: cuentas[`admin${lado}`], enRed: true });
      await guardarIds();
      await ejecucion.asignarPanaderia({ cuentaId: cuentas[`admin${lado}`], panaderiaId: pans[lado] });
      cuentas[lado] = await ejecucion.crearCuenta({ etiqueta: lado, rol: 'panadero', panaderiaId: pans[lado], activa: true });
    }
    cuentas.gerente = await ejecucion.crearCuenta({ etiqueta: 'gerente', rol: 'gerente', panaderiaId: pans.a, activa: true });
    for (const [quien, id] of Object.entries(cuentas)) tokens[quien] = jwt.sign({ id, version_sesion: 0 }, process.env.JWT_SECRET, { expiresIn: '10m' });
    await guardarIds();
    const app = require('../src/app');
    const listen = app.listen;
    app.listen = function (...args) { servidor = listen.apply(this, args); return servidor; };
    app.get(`/api/__aislamiento/${ejecucion.runId}`, (_, res) => res.json({ runId: ejecucion.runId }));
    try { await esperarCondicion(() => servidor?.listening, 10000); } finally { app.listen = listen; }
    const address = servidor.address(); const origen = address.family === 'IPv6' ? `http://[::1]:${address.port}` : `http://127.0.0.1:${address.port}`;
    const identidad = await fetch(`${origen}/api/__aislamiento/${ejecucion.runId}`, { signal: AbortSignal.timeout(3000) });
    assert.equal((await identidad.json()).runId, ejecucion.runId); url = origen;
    manifiesto.estado = 'ejecutando'; guardar();
    let d1, d2, o, s;
    const pruebas = [
      async () => {
        d1 = await materia('a', 0); d2 = await materia('a', 0); o = await materia('b', 10);
        s = await solicitud([d1, d2], 2);
        assert.equal(s.estado, 'pendiente'); assert.equal(s.lineas.length, 2);
        for (const [lado, bandeja] of [['a', 'enviadas'], ['b', 'recibidas']]) {
          const b = await ok(200, 'GET', `/api/red/solicitudes?bandeja=${bandeja}`, lado); assert.ok(b.solicitudes.some(x => x.id === s.id));
        }
        const dis = await ok(200, 'GET', `/api/red/panaderias/${pans.b}/disponibilidad`, 'a');
        assert.ok(dis.materias.some(m => m.id === o.id)); assert.ok(dis.materias.every(m => !('precio_unitario' in m) && !('stock_minimo' in m)));
        assert.ok((await ok(200, 'GET', '/api/red/panaderias', 'a')).some(p => p.id === pans.b));
        assert.ok((await ok(200, 'GET', '/api/red/resumen', 'b')).recibidas_pendientes >= 1);
      },
      async () => {
        assert.equal((await aceptar(s, o)).status, 200);
        assert.deepEqual(await fila(o.id), { cantidad: 60000, version: 1, estado: 1 });
        for (const d of [d1, d2]) assert.deepEqual(await fila(d.id), { cantidad: 20000, version: 1, estado: 1 });
        const propias = await fotoPropia(); const mov = propias.movimientos_red;
        assert.equal(mov.length, 4);
        for (const m of mov) assert.equal(Math.round((Number(m.saldo_posterior) - Number(m.saldo_anterior)) * 10000), (m.tipo === 'entrada' ? 1 : -1) * Math.round(Number(m.cantidad) * 10000));
        assert.equal(propias.eventos_red.filter(e => e.tipo === 'aceptada').length, 1);
        assert.equal(Number(propias.parejas[0].pendientes), 0);
        const historial = await ok(200, 'GET', '/api/red/movimientos', 'a'); assert.ok(historial.movimientos.every(m => m.tipo !== 'entrada' || m.precio_unitario_referencia === null));
      },
      async () => {
        const a = await fila(d1.id), b = await fila(o.id);
        await cierre(await solicitud([d1]), 'rechazar', 'b'); await cierre(await solicitud([d1]), 'cancelar', 'a');
        assert.deepEqual(await fila(d1.id), a); assert.deepEqual(await fila(o.id), b);
        assert.equal(Number((await fotoPropia()).parejas[0].pendientes), 0);
      },
      async () => {
        const inv = await solicitud([d1, d2], 4), previo = await fotoPropia();
        assert.equal((await aceptar(inv, o)).status, 409); assert.deepEqual(await fotoPropia(), previo);
        const g = await materia('b', 10, 'g'), previoUnidad = await fotoPropia();
        assert.equal((await aceptar(inv, g)).datos.codigo, 'UNIDAD_DISTINTA'); assert.deepEqual(await fotoPropia(), previoUnidad);
        await cierre(inv, 'cancelar', 'a');
      },
      async () => {
        for (const metodo of ['PUT', 'DELETE']) {
          const r = await pedir(metodo, `/api/inventario/${d1.id}`, 'a', { version_fila: 0, cantidad_disponible: 99 });
          assert.equal(r.status, 409); assert.equal(r.datos.codigo, 'VERSION_DESACTUALIZADA');
        }
        const pendiente = await solicitud([d1]);
        const [transferencia, antiguo] = await carrera(RX, () => aceptar(pendiente, o), () => pedir('PUT', `/api/inventario/${d1.id}`, 'a', { version_fila: 1, cantidad_disponible: 99 }));
        assert.equal(transferencia.status, 200); assert.equal(antiguo.status, 409); assert.equal(antiguo.datos.codigo, 'VERSION_DESACTUALIZADA');
        assert.deepEqual(await fila(d1.id), { cantidad: 30000, version: 2, estado: 1 });
        await ok(200, 'PUT', `/api/inventario/${d1.id}`, 'a', { version_fila: 2, stock_minimo: 1 });
        assert.equal((await fila(d1.id)).version, 3);
        const borrar = await materia('a'); await ok(200, 'DELETE', `/api/inventario/${borrar.id}`, 'a', { version_fila: 0 });
        assert.deepEqual(await fila(borrar.id), { cantidad: 100000, version: 1, estado: 0 });
      },
      async () => {
        const p = await solicitud([d2]);
        for (const campos of [{ nombre: ejecucion.nombre('Cambio') }, { unidad_medida: 'g' }, null]) {
          const r = await pedir(campos ? 'PUT' : 'DELETE', `/api/inventario/${d2.id}`, 'a', { version_fila: 1, ...campos });
          assert.equal(r.status, 409); assert.equal(r.datos.codigo, 'MATERIA_EN_SOLICITUD_PENDIENTE');
        }
        await ok(200, 'PUT', `/api/inventario/${d2.id}`, 'a', { version_fila: 1, precio_unitario: 3, stock_minimo: 1, cantidad_disponible: 3 });
        assert.equal((await fila(d2.id)).version, 2); await cierre(p, 'cancelar', 'a');
      },
      async () => {
        const d = await materia('a', 0);
        const [p, cambio] = await carrera(S, () => solicitud([d]), () => pedir('PUT', `/api/inventario/${d.id}`, 'a', { version_fila: 0, nombre: ejecucion.nombre('Bloqueado') }));
        assert.equal(cambio.status, 409); assert.equal(cambio.datos.codigo, 'MATERIA_EN_SOLICITUD_PENDIENTE'); await cierre(p, 'cancelar', 'a');
        const nuevo = ejecucion.nombre('Actualizado');
        const [edicion, nueva] = await carrera(X, () => pedir('PUT', `/api/inventario/${d.id}`, 'a', { version_fila: 0, nombre: nuevo }), () => solicitud([d]));
        assert.equal(edicion.status, 200); assert.equal(nueva.lineas[0].nombre, nuevo); await cierre(nueva, 'cancelar', 'a');
      },
      async () => {
        for (const redPrimero of [true, false]) {
          const dest = await materia('a', 0), orig = await materia('b', 5), p = await solicitud([dest], 4), prod = await producto('b', orig);
          const previo = await fotoPropia();
          const fRed = () => aceptar(p, orig), fProd = () => producir('b', prod, 4);
          const r = await carrera(redPrimero ? RX : X, redPrimero ? fRed : fProd, redPrimero ? fProd : fRed);
          assert.equal(r[0].status, redPrimero ? 200 : 201); assert.equal(r[1].status, 409);
          assert.deepEqual(await fila(orig.id), { cantidad: 10000, version: 1, estado: 1 });
          assert.equal((await fila(dest.id)).cantidad, redPrimero ? 40000 : 0);
          const posterior = await fotoPropia();
          assert.equal(posterior.orden_produccion.length - previo.orden_produccion.length, redPrimero ? 0 : 1);
          assert.equal(posterior.movimientos_red.length - previo.movimientos_red.length, redPrimero ? 2 : 0);
          if (!redPrimero) await cierre(p, 'cancelar', 'a');
        }
      },
      async () => {
        for (const inicial of [5, 99999999.9999]) {
        const dest = await materia('a', inicial), orig = await materia('b', 5), prod = await producto('a', dest);
        const orden = await producir('a', prod, 2); assert.equal(orden.status, 201);
        const p = await solicitud([dest], 1);
        const [dev, red] = await carrera(X, () => pedir('PATCH', `/api/produccion/ordenes/${orden.datos.orden.id}/cancelar`, 'a', { motivo: 'E1e', devolver_insumos: true }), () => aceptar(p, orig));
        assert.equal(dev.status, 200); assert.equal(red.status, inicial === 5 ? 200 : 409);
        assert.deepEqual(await fila(dest.id), { cantidad: inicial === 5 ? 60000 : 999999999999, version: inicial === 5 ? 3 : 2, estado: 1 });
        assert.deepEqual(await fila(orig.id), { cantidad: inicial === 5 ? 40000 : 50000, version: inicial === 5 ? 1 : 0, estado: 1 });
        if (inicial !== 5) { assert.equal(red.datos.codigo, 'TOPE'); await cierre(p, 'cancelar', 'a'); }
        }
      },
      async () => {
        const p = await solicitud([d1]), previo = await fotoPropia();
        for (const accion of ['aceptar', 'rechazar', 'cancelar']) {
          const r = await pedir('POST', `/api/red/solicitudes/${p.id}/${accion}`, 'gerente', { motivo: 'Prueba' }); assert.equal(r.status, 403);
        }
        assert.equal((await aceptar(p, o, 'a')).status, 403);
        assert.equal((await pedir('POST', `/api/red/solicitudes/${p.id}/cancelar`, 'b', {})).status, 403);
        assert.equal((await pedir('PUT', `/api/inventario/${d1.id}`, 'b', { version_fila: 2, precio_unitario: 9 })).status, 400);
        assert.equal((await pedir('DELETE', `/api/inventario/${d1.id}`, 'gerente', { version_fila: 2 })).status, 403);
        await ok(200, 'GET', `/api/red/solicitudes/${p.id}`, 'gerente');
        const ajena = await producir('b', await producto('a', d1), 1); assert.equal(ajena.status, 404);
        // La receta/producto de la comprobación anterior es propia; no comparar su presencia.
        const despues = await fotoPropia(); assert.deepEqual(despues, previo);
        await cierre(p, 'cancelar', 'a');
      }
    ];
    for (let i = 0; i < pruebas.length; i++) {
      await ejecucion.exigirBloqueo(); await pruebas[i]();
      manifiesto.escenarios.push({ numero: i + 1, nombre: ESCENARIOS[i], resultado: 'OK' }); await guardarIds();
      console.log(`OK ${i + 1}/10 ${ESCENARIOS[i]}`);
    }
  } catch (e) {
    manifiesto.error = e.code || e.message; manifiesto.estado = 'fallida';
    if (incierto || ejecucion?.escriturasInciertas.length || ejecucion?.escriturasDetenidas) ejecucion?.abortar('Resultado incierto: conservar manifiesto y registros');
    guardar();
  } finally {
    await Promise.allSettled([...peticiones]);
    if (servidor?.listening) await new Promise(resolve => { servidor.close(resolve); servidor.closeIdleConnections?.(); });
    if (ejecucion) {
      try {
        if (!incierto && ejecucion.estado === 'activa') await guardarIds();
        manifiesto.limpieza = await ejecucion.limpiar(); limpia = limpiezaCorrecta(manifiesto.limpieza);
        if (limpia) {
          for (const [t, ids] of Object.entries(manifiesto.ids)) {
            if (ids.length) assert.equal(Number((await leer(`SELECT COUNT(*) AS n FROM pansys_test.${t} WHERE id IN (?)`, [ids]))[0].n), 0, `Restos en ${t}`);
          }
          for (const par of manifiesto.parejas || []) assert.equal(Number((await leer('SELECT COUNT(*) AS n FROM pansys_test.red_parejas WHERE panaderia_menor_id = ? AND panaderia_mayor_id = ?', [par.panaderia_menor_id, par.panaderia_mayor_id]))[0].n), 0);
        }
        // Solo después de terminar las transacciones y limpieza, sin demo concurrente.
        if (!ejecucion.bloqueo.perdido) {
          const despues = await foto.tomarFoto(); foto.guardarFoto(despues, path.join(dir, 'despues.json'));
          manifiesto.comparacion = foto.compararFotos(antes, despues);
        }
      } catch (e) { limpia = false; manifiesto.errorLimpieza = e.code || e.message; }
      finally { await ejecucion.cerrar().catch(() => { limpia = false; }); }
    }
    await sequelize.close();
    const exito = !manifiesto.error && limpia && manifiesto.escenarios.length === 10 && manifiesto.comparacion?.sinDiferencias === true;
    manifiesto.estado = exito ? 'correcta' : 'requiere_revision'; guardar();
    console.log(`E1e ${exito ? 'correcta' : 'NO aprobada'}. Evidencias: ${dir}`);
  }
  return manifiesto.estado === 'correcta' ? 0 : 1;
}
if (require.main === module) ejecutar().then(c => { process.exitCode = c; }).catch(e => { console.error(`E1e cancelada: ${e.code || e.message}`); process.exitCode = 1; });
module.exports = { ESCENARIOS, validarInicio, esperarCondicion, clasificarSesiones, comprobarSesiones, carreraControlada, ejecutar };
