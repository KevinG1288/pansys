// Pruebas unitarias de la red colaborativa, etapa E1c (aceptar una solicitud y transferir el inventario):
// - SQL idéntico al de aceptar del protocolo validado en el ensayo E6 (pruebas/lib/operaciones.js del paquete
//   C:\PansysEnsayo\trabajo\sql006; cadenas copiadas aquí y, si el archivo existe, comparadas con él);
// - secuencia, orden de bloqueos (L1 pareja X -> L2 panaderías S -> L3 pendientes S y solicitud X ->
//   L4 TODAS las materias X en una sentencia, por id -> L5 detalle X al fijar el origen) y una única transacción;
// - efectos sobre una base simulada con estado y ROLLBACK que emula las restricciones del 006 implicadas
//   (chk_mred_saldos, uq_mred_detalle_tipo, fk_mred_salida/fk_mred_entrada, fk_dred_origen y las condiciones de
//   los UPDATE de stock): descuento en la proveedora, entrada en la solicitante, un UPDATE y una versión por
//   materia, movimientos con saldos exactos, origen fijado, estado, evento y contador;
// - atomicidad: ningún rechazo escribe nada y un fallo a mitad de las escrituras lo deshace todo;
// - permisos y aislamiento: solo la proveedora (de la sesión) acepta; el gerente no; el cliente no elige
//   panaderías, destinos ni cantidades; sin precios de otras panaderías en las respuestas.
// No usan la base de datos ni la red. Uso (desde backend/):  node pruebas/red.aceptar.unitarias.js
process.env.DB_HOST = 'base-inexistente.invalid';
process.env.DB_NAME = 'sin_base_pruebas_unitarias';
const net = require('net');
const tls = require('tls');
const redBloqueada = () => { throw new Error('Red bloqueada en las pruebas unitarias'); };
net.connect = net.createConnection = redBloqueada;
net.Socket.prototype.connect = redBloqueada;
tls.connect = redBloqueada;
require('dotenv').config({ quiet: true });

const fs = require('fs');

const resultados = [];
const igual = (descripcion, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  resultados.push(ok);
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${descripcion}${ok ? '' : ` -> obtenido ${JSON.stringify(real)}, esperado ${JSON.stringify(esperado)}`}`);
};
const resultado = (promesa) => promesa.then(r => ({ ok: true, r }), e => ({ ok: false, e }));
const respuesta = () => {
  const r = { statusCode: 200, cuerpo: undefined };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.cuerpo = b; return r; };
  return r;
};

// Cadenas de aceptar del protocolo validado (operaciones.js del ensayo E6)
const REFERENCIA = {
  BLOQUEAR_SOLICITUD_ACEPTAR: 'SELECT id, estado, panaderia_proveedora_id FROM solicitudes_red WHERE id = ? FOR UPDATE',
  BLOQUEAR_MATERIAS: 'SELECT id, panaderia_id, unidad_medida, estado, cantidad_disponible, precio_unitario, version_fila FROM materia_prima WHERE id IN (?) ORDER BY id FOR UPDATE',
  FIJAR_ORIGEN: 'UPDATE solicitudes_red_detalle SET materia_prima_origen_id = ?, updatedAt = NOW() WHERE id = ? AND solicitud_id = ? AND materia_prima_origen_id IS NULL',
  DESCONTAR: 'UPDATE materia_prima SET cantidad_disponible = cantidad_disponible - ?, version_fila = version_fila + 1, updatedAt = NOW() WHERE id = ? AND panaderia_id = ? AND estado = 1 AND version_fila = ? AND version_fila < 4294967294 AND cantidad_disponible >= ?',
  SUMAR: 'UPDATE materia_prima SET cantidad_disponible = cantidad_disponible + ?, version_fila = version_fila + 1, updatedAt = NOW() WHERE id = ? AND panaderia_id = ? AND estado = 1 AND version_fila = ? AND version_fila < 4294967294 AND cantidad_disponible <= 99999999.9999 - ?',
  INSERTAR_MOV_SALIDA: "INSERT INTO movimientos_red (detalle_id, tipo, panaderia_id, materia_prima_id, cantidad, saldo_anterior, saldo_posterior, precio_unitario_referencia, usuario_id, createdAt) VALUES (?, 'salida', ?, ?, ?, ?, ?, ?, ?, NOW())",
  INSERTAR_MOV_ENTRADA: "INSERT INTO movimientos_red (detalle_id, tipo, panaderia_id, materia_prima_id, cantidad, saldo_anterior, saldo_posterior, precio_unitario_referencia, usuario_id, createdAt) VALUES (?, 'entrada', ?, ?, ?, ?, ?, ?, ?, NOW())",
  CERRAR_ACEPTADA: "UPDATE solicitudes_red SET estado = 'aceptada', cerrada_por = ?, cerrada_en = NOW(), updatedAt = NOW() WHERE id = ? AND estado = 'pendiente'",
  INSERTAR_EVENTO_ACEPTADA: "INSERT INTO eventos_red (solicitud_id, tipo, lado, panaderia_id, actor_id, createdAt) VALUES (?, 'aceptada', 'proveedora', ?, ?, NOW())",
  BLOQUEAR_PAREJA: 'SELECT pendientes FROM red_parejas WHERE panaderia_menor_id = ? AND panaderia_mayor_id = ? FOR UPDATE',
  BLOQUEAR_PANADERIAS: 'SELECT id, en_red FROM panaderias WHERE id IN (?, ?) ORDER BY id FOR SHARE',
  LEER_PENDIENTES: "SELECT id FROM solicitudes_red FORCE INDEX (idx_sred_pareja) WHERE pareja_menor_id = ? AND pareja_mayor_id = ? AND estado = 'pendiente' FOR SHARE",
  CONTADOR_MENOS: 'UPDATE red_parejas SET pendientes = pendientes - 1, updatedAt = NOW() WHERE panaderia_menor_id = ? AND panaderia_mayor_id = ?'
};
const RUTA_REFERENCIA = 'C:/PansysEnsayo/trabajo/sql006/pruebas/lib/operaciones.js';

const U = (texto) => Math.round(Number(texto) * 10000);             // decimal -> diezmilésimas
const D = (u) => `${Math.trunc(u / 10000)}.${String(u % 10000).padStart(4, '0')}`;   // diezmilésimas -> texto
const MAX = 999999999999;
const LIM_VERSION = 4294967294;

const main = async () => {
  const { sequelize } = require('../src/models/index');
  const { ErrorNegocio } = require('../src/utils/errores');
  const op = require('../src/modules/red/red.operaciones');
  const consultas = require('../src/modules/red/red.consultas');
  const controller = require('../src/modules/red/red.controller');
  const router = require('../src/modules/red/red.routes');
  const S = op.SQL_OP;
  const C = consultas.SQL;

  // ---------- 1. SQL idéntico al protocolo
  console.log('\n== SQL del protocolo validado (aceptar, E6)');
  for (const [k, ref] of Object.entries(REFERENCIA)) igual(`${k} idéntico a la referencia`, S[k], ref);
  if (fs.existsSync(RUTA_REFERENCIA)) {
    const texto = fs.readFileSync(RUTA_REFERENCIA, 'utf8');
    igual('las 13 cadenas aparecen literalmente en operaciones.js del ensayo', Object.values(REFERENCIA).filter(r => !texto.includes(r)).length, 0);
  } else console.log(`AVISO no se encuentra ${RUTA_REFERENCIA}: se usan solo las cadenas copiadas`);
  igual('lecturas previas sin bloqueo (orígenes de la proveedora y líneas de la solicitud)',
    [S.ORIGENES_PREVIA, S.LINEAS_SOLICITUD].map(s => /^SELECT /.test(s) && !/FOR (UPDATE|SHARE)/.test(s)), [true, true]);

  // ---------- 2. Base simulada
  const BASE = () => ({
    panaderias: { 1: { en_red: 1, nombre: 'Uno', localidad: 'Kennedy' }, 2: { en_red: 1, nombre: 'Dos', localidad: 'Patio Bonito' }, 4: { en_red: 1, nombre: 'Cuatro', localidad: 'Bosa' } },
    materias: {
      101: { p: 1, unidad: 'kg', estado: 1, cant: U('6'), precio: U('3200'), v: 0 }, 102: { p: 1, unidad: 'kg', estado: 1, cant: U('4.5'), precio: U('4100'), v: 0 },
      103: { p: 1, unidad: 'g', estado: 1, cant: U('250'), precio: U('28'), v: 0 }, 104: { p: 1, unidad: 'kg', estado: 1, cant: 0, precio: 0, v: 0 },
      201: { p: 2, unidad: 'kg', estado: 1, cant: U('80'), precio: U('3100'), v: 0 }, 202: { p: 2, unidad: 'kg', estado: 1, cant: U('35'), precio: U('4000'), v: 0 },
      203: { p: 2, unidad: 'g', estado: 1, cant: U('4000'), precio: U('27'), v: 0 }, 204: { p: 2, unidad: 'kg', estado: 1, cant: U('1'), precio: U('3000'), v: 0 },
      205: { p: 2, unidad: 'kg', estado: 0, cant: U('50'), precio: U('3000'), v: 0 }, 206: { p: 2, unidad: 'l', estado: 1, cant: U('40'), precio: U('4200'), v: 0 },
      401: { p: 4, unidad: 'kg', estado: 1, cant: U('90'), precio: U('2900'), v: 0 }
    },
    parejas: {}, solicitudes: {}, detalles: {}, movimientos: [], eventos: [], sig: { mov: 1, ev: 1 }
  });
  let db;
  const llamadas = [];
  let tActual = null;
  let fallos = [];
  let ajustes = {};
  const clon = (o) => JSON.parse(JSON.stringify(o));
  const errorMysql = (errno) => { const e = new Error(`fallo simulado ${errno}`); e.parent = { errno }; e.original = { errno }; return e; };
  const clave = (a, b) => `${Math.min(a, b)},${Math.max(a, b)}`;

  // Solicitud pendiente de 1 (solicitante) a 2 (proveedora) con las líneas [destino, cantidad]
  const conSolicitud = (lineas, { id = 1, sol = 1, prov = 2 } = {}) => {
    db.solicitudes[id] = { sol, prov, estado: 'pendiente', cerrada_por: null };
    lineas.forEach(([destino, cantidad], i) => { const did = id * 100 + i + 1; db.detalles[did] = { sid: id, linea: i + 1, sol, prov, destino, origen: null, cant: U(cantidad) }; });
    const k = clave(sol, prov); db.parejas[k] = { pendientes: (db.parejas[k]?.pendientes ?? 0) + 1 };
  };

  const queryOriginal = sequelize.query;
  const transactionOriginal = sequelize.transaction;
  sequelize.transaction = async (fn) => {
    const copia = clon(db);
    const t = { id: Symbol('t') };
    tActual = t;
    llamadas.push({ sql: 'BEGIN' });
    try { const r = await fn(t); llamadas.push({ sql: 'COMMIT' }); return r; }
    catch (e) { db = copia; llamadas.push({ sql: 'ROLLBACK' }); throw e; }
    finally { tActual = null; }
  };
  sequelize.query = async (sql, opciones = {}) => {
    const rep = opciones.replacements;
    llamadas.push({ sql, rep, enTransaccion: !!opciones.transaction && opciones.transaction === tActual });
    const f = fallos.find(x => x.sql === sql && x.veces > 0 && (!x.cuando || x.cuando(rep)));
    if (f) { f.veces--; if (f.crear) throw f.crear(); if (f.filas !== undefined) return [undefined, f.filas]; }
    const M = db.materias;
    switch (sql) {
      case S.SOLICITUD_PREVIA: { const s = db.solicitudes[rep[0]]; return s && (s.sol === rep[1] || s.prov === rep[2]) ? [{ id: rep[0], panaderia_solicitante_id: s.sol, panaderia_proveedora_id: s.prov }] : []; }
      case S.ORIGENES_PREVIA: return rep[0].filter(id => M[id] && M[id].p === rep[1]).map(id => ({ id }));
      case S.BLOQUEAR_PAREJA: { const p = db.parejas[`${rep[0]},${rep[1]}`]; return p ? [{ pendientes: p.pendientes }] : []; }
      case S.BLOQUEAR_PANADERIAS: { const filas = rep.filter(id => db.panaderias[id]).sort((a, b) => a - b).map(id => ({ id, en_red: db.panaderias[id].en_red })); return ajustes.panaderias ? ajustes.panaderias(filas) : filas; }
      case S.LEER_PENDIENTES: return Object.entries(db.solicitudes).filter(([, s]) => Math.min(s.sol, s.prov) === rep[0] && Math.max(s.sol, s.prov) === rep[1] && s.estado === 'pendiente').map(([id]) => ({ id: Number(id) }));
      case S.BLOQUEAR_SOLICITUD_ACEPTAR: { const s = db.solicitudes[rep[0]]; return s ? [{ id: rep[0], estado: s.estado, panaderia_proveedora_id: s.prov }] : []; }
      case S.LINEAS_SOLICITUD: return Object.entries(db.detalles).filter(([, d]) => d.sid === rep[0]).sort(([, a], [, b]) => a.linea - b.linea)
        .map(([did, d]) => ({ id: Number(did), linea: d.linea, materia_prima_destino_id: d.destino, materia_prima_origen_id: d.origen, cantidad: d.cant / 10000 }));
      case S.BLOQUEAR_MATERIAS: return rep[0].filter(id => M[id]).sort((a, b) => a - b).map(id => ({ id, panaderia_id: M[id].p, unidad_medida: M[id].unidad, estado: M[id].estado, cantidad_disponible: M[id].cant / 10000, precio_unitario: M[id].precio / 10000, version_fila: M[id].v }));
      case S.FIJAR_ORIGEN: { const d = db.detalles[rep[1]]; if (!d || d.sid !== rep[2] || d.origen !== null) return [undefined, 0];
        if (!(M[rep[0]] && M[rep[0]].p === d.prov)) throw errorMysql(1216);       // fk_dred_origen
        d.origen = rep[0]; return [undefined, 1]; }
      case S.DESCONTAR: { const [t, id, p, v] = [U(rep[0]), rep[1], rep[2], rep[3]]; const m = M[id];
        if (!m || m.p !== p || m.estado !== 1 || m.v !== v || m.v >= LIM_VERSION || m.cant < t || U(rep[4]) !== t) return [undefined, 0];
        m.cant -= t; m.v++; return [undefined, 1]; }
      case S.SUMAR: { const [x, id, p, v] = [U(rep[0]), rep[1], rep[2], rep[3]]; const m = M[id];
        if (!m || m.p !== p || m.estado !== 1 || m.v !== v || m.v >= LIM_VERSION || m.cant > MAX - x || U(rep[4]) !== x) return [undefined, 0];
        m.cant += x; m.v++; return [undefined, 1]; }
      case S.INSERTAR_MOV_SALIDA: case S.INSERTAR_MOV_ENTRADA: {
        const tipo = sql === S.INSERTAR_MOV_SALIDA ? 'salida' : 'entrada';
        const [did, pan, mat, cant, antes, despues, precio, usuario] = rep;
        const d = db.detalles[did];
        if (db.movimientos.some(x => x.detalle_id === did && x.tipo === tipo)) throw errorMysql(1062);        // uq_mred_detalle_tipo
        const c = U(cant), a = U(antes), b = U(despues);
        if (!(c > 0 && a >= 0 && b >= 0 && (tipo === 'salida' ? b === a - c : b === a + c))) throw errorMysql(3819);   // chk_mred_saldos
        const ok = tipo === 'salida' ? d && d.origen === mat && d.prov === pan && d.cant === c : d && d.destino === mat && d.sol === pan && d.cant === c;
        if (!ok) throw errorMysql(1216);                                                                     // fk_mred_salida / fk_mred_entrada
        db.movimientos.push({ detalle_id: did, tipo, panaderia_id: pan, materia_prima_id: mat, cantidad: cant, saldo_anterior: antes, saldo_posterior: despues, precio_unitario_referencia: precio, usuario_id: usuario });
        return [db.sig.mov++, 1]; }
      case S.CERRAR_ACEPTADA: { const s = db.solicitudes[rep[1]]; if (!s || s.estado !== 'pendiente') return [undefined, 0]; Object.assign(s, { estado: 'aceptada', cerrada_por: rep[0] }); return [undefined, 1]; }
      case S.INSERTAR_EVENTO_ACEPTADA: { if (db.eventos.some(e => e.solicitud_id === rep[0] && e.tipo !== 'creada')) throw errorMysql(1062); db.eventos.push({ solicitud_id: rep[0], tipo: 'aceptada', lado: 'proveedora', panaderia_id: rep[1], actor_id: rep[2] }); return [db.sig.ev++, 1]; }
      case S.CONTADOR_MENOS: { const p = db.parejas[`${rep[0]},${rep[1]}`]; if (!p) return [undefined, 0]; if (p.pendientes - 1 < 0) throw errorMysql(1690); p.pendientes--; return [undefined, 1]; }
      case C.SOLICITUD: { const s = db.solicitudes[rep.id]; if (!s || (s.sol !== rep.propia && s.prov !== rep.propia)) return []; const P = db.panaderias;
        return [{ id: rep.id, estado: s.estado, panaderia_solicitante_id: s.sol, panaderia_proveedora_id: s.prov, nota: null, motivo_rechazo: null, creada_en: 'c', cerrada_en: 'x', solicitante_nombre: P[s.sol].nombre, solicitante_localidad: P[s.sol].localidad, proveedora_nombre: P[s.prov].nombre, proveedora_localidad: P[s.prov].localidad }]; }
      case C.LINEAS: return Object.entries(db.detalles).filter(([, d]) => d.sid === rep.id).map(([did, d]) => ({ id: Number(did), linea: d.linea, nombre_solicitado: 'n', unidad_medida: 'kg', cantidad: d.cant / 10000, materia_prima_destino_id: d.destino, materia_prima_origen_id: d.origen }));
      case C.EVENTOS: return db.eventos.filter(e => e.solicitud_id === rep.id).map(e => ({ tipo: e.tipo, lado: e.lado, fecha: 'f' }));
      default: throw new Error(`SQL no previsto en el doble: ${sql.slice(0, 90)}`);
    }
  };

  const nombre = (sql) => Object.entries(S).find(([, v]) => v === sql)?.[0] ?? (Object.values(C).includes(sql) ? 'LECTURA' : sql);
  const secuencia = (desde = 0) => llamadas.slice(desde).map(l => nombre(l.sql)).filter(n => n !== 'LECTURA');
  const capa = (sql) => ({ [S.BLOQUEAR_PAREJA]: 'L1', [S.BLOQUEAR_PANADERIAS]: 'L2', [S.LEER_PENDIENTES]: 'L3', [S.BLOQUEAR_SOLICITUD_ACEPTAR]: 'L3', [S.BLOQUEAR_MATERIAS]: 'L4', [S.FIJAR_ORIGEN]: 'L5' })[sql];
  const bloqueos = () => llamadas.map(l => capa(l.sql)).filter(Boolean);
  const escrituras = () => llamadas.filter(l => /^(INSERT|UPDATE)/.test(l.sql)).length;
  const reiniciar = () => { db = BASE(); llamadas.length = 0; fallos = []; ajustes = {}; };
  const aceptar = (lineas, extra = {}) => op.aceptar({ panaderiaId: 2, actorId: 8, solicitudId: 1, lineas, ...extra });
  const L = (detalleId, origen) => ({ detalleId, origen });
  // Rechazo sin escrituras ni cambios
  const rechazaSinCambios = async (descripcion, preparar, lineas, status, codigo, extra = {}) => {
    reiniciar(); preparar();
    const antes = clon(db);
    const r = await resultado(aceptar(lineas, extra));
    igual(descripcion, [r.ok, r.e?.status, r.e?.detalle?.codigo, JSON.stringify(db) === JSON.stringify(antes), escrituras()], [false, status, codigo, true, 0]);
    return r;
  };

  try {
    // ---------- 3. Aceptación válida con una línea
    console.log('\n== aceptación válida');
    reiniciar(); conSolicitud([[101, '5']]);
    const r1 = await aceptar([L(101, 201)]);
    igual('una línea: secuencia = previas sin bloqueo + aceptar del protocolo', secuencia(), ['BEGIN', 'SOLICITUD_PREVIA', 'ORIGENES_PREVIA', 'BLOQUEAR_PAREJA', 'BLOQUEAR_PANADERIAS', 'LEER_PENDIENTES',
      'BLOQUEAR_SOLICITUD_ACEPTAR', 'LINEAS_SOLICITUD', 'BLOQUEAR_MATERIAS', 'FIJAR_ORIGEN', 'DESCONTAR', 'SUMAR', 'INSERTAR_MOV_SALIDA', 'INSERTAR_MOV_ENTRADA', 'CERRAR_ACEPTADA', 'INSERTAR_EVENTO_ACEPTADA', 'CONTADOR_MENOS', 'COMMIT']);
    igual('una línea: bloqueos L1 -> L2 -> L3 (pendientes) -> L3 (solicitud X) -> L4 (materias X) -> L5 (detalle X)', bloqueos(), ['L1', 'L2', 'L3', 'L3', 'L4', 'L5']);
    igual('una línea: una sola transacción y toda sentencia dentro de ella', [llamadas.filter(l => l.sql === 'BEGIN').length, llamadas.filter(l => Object.values(S).includes(l.sql)).every(l => l.enTransaccion)], [1, true]);
    igual('una línea: materias bloqueadas en UNA sentencia, origen y destino ordenados por id', llamadas.find(l => l.sql === S.BLOQUEAR_MATERIAS).rep, [[101, 201]]);
    igual('una línea: descuento en la proveedora (80 -> 75, versión 1) y entrada en la solicitante (6 -> 11, versión 1)',
      [D(db.materias[201].cant), db.materias[201].v, D(db.materias[101].cant), db.materias[101].v], ['75.0000', 1, '11.0000', 1]);
    igual('una línea: movimientos de salida y entrada con saldos exactos, actor y precio de referencia del origen', db.movimientos, [
      { detalle_id: 101, tipo: 'salida', panaderia_id: 2, materia_prima_id: 201, cantidad: '5.0000', saldo_anterior: '80.0000', saldo_posterior: '75.0000', precio_unitario_referencia: '3100.0000', usuario_id: 8 },
      { detalle_id: 101, tipo: 'entrada', panaderia_id: 1, materia_prima_id: 101, cantidad: '5.0000', saldo_anterior: '6.0000', saldo_posterior: '11.0000', precio_unitario_referencia: '3100.0000', usuario_id: 8 }]);
    igual('una línea: origen fijado, solicitud aceptada por el actor, evento de la proveedora y contador a 0',
      [db.detalles[101].origen, db.solicitudes[1], db.eventos, db.parejas['1,2'].pendientes],
      [201, { sol: 1, prov: 2, estado: 'aceptada', cerrada_por: 8 }, [{ solicitud_id: 1, tipo: 'aceptada', lado: 'proveedora', panaderia_id: 2, actor_id: 8 }], 0]);
    igual('una línea: respuesta = detalle desde la proveedora, sin precios ni actores', [r1.rol, r1.estado, r1.lineas[0].materia_prima_origen_id, /precio|actor|usuario|creada_por/.test(JSON.stringify(r1))], ['proveedora', 'aceptada', 201, false]);

    // ---------- 4. Varias líneas y agrupación por materia
    reiniciar(); conSolicitud([[101, '5'], [102, '2.5'], [103, '100'], [104, '3']]);
    await aceptar([L(101, 201), L(102, 202), L(103, 203), L(104, 201)]);
    igual('varias líneas: un UPDATE por materia (dos líneas comparten el origen 201) y en orden de id',
      [llamadas.filter(l => l.sql === S.DESCONTAR).map(l => [l.rep[1], l.rep[0]]), llamadas.filter(l => l.sql === S.SUMAR).map(l => [l.rep[1], l.rep[0]])],
      [[[201, '8.0000'], [202, '2.5000'], [203, '100.0000']], [[101, '5.0000'], [102, '2.5000'], [103, '100.0000'], [104, '3.0000']]]);
    igual('varias líneas: una versión por materia aunque la usen dos líneas', [db.materias[201].v, db.materias[202].v, db.materias[203].v, db.materias[101].v, db.materias[104].v], [1, 1, 1, 1, 1]);
    igual('varias líneas: stock final exacto en las dos panaderías', [201, 202, 203, 101, 102, 103, 104].map(id => D(db.materias[id].cant)), ['72.0000', '32.5000', '3900.0000', '11.0000', '7.0000', '350.0000', '3.0000']);
    igual('varias líneas: saldos de salida encadenados sobre el mismo origen (80 -> 75 -> 72)',
      db.movimientos.filter(x => x.materia_prima_id === 201).map(x => [x.detalle_id, x.saldo_anterior, x.saldo_posterior]), [[101, '80.0000', '75.0000'], [104, '75.0000', '72.0000']]);
    igual('varias líneas: 2 movimientos por línea y todos los orígenes fijados', [db.movimientos.length, Object.values(db.detalles).every(d => d.origen !== null)], [8, true]);
    igual('consistencia: cada línea = su salida y su entrada (misma cantidad y materias), la suma por origen = lo descontado',
      Object.entries(db.detalles).every(([did, d]) => {
        const s = db.movimientos.find(x => x.detalle_id === Number(did) && x.tipo === 'salida'); const e = db.movimientos.find(x => x.detalle_id === Number(did) && x.tipo === 'entrada');
        return s && e && U(s.cantidad) === d.cant && U(e.cantidad) === d.cant && s.materia_prima_id === d.origen && e.materia_prima_id === d.destino;
      }) && U('80') - db.materias[201].cant === db.movimientos.filter(x => x.tipo === 'salida' && x.materia_prima_id === 201).reduce((a, x) => a + U(x.cantidad), 0), true);
    igual('consistencia: el contador coincide con las pendientes reales (0)', [db.parejas['1,2'].pendientes, Object.values(db.solicitudes).filter(s => s.estado === 'pendiente').length], [0, 0]);

    // ---------- 5. Precisión decimal
    reiniciar(); db.materias[204].cant = U('1'); conSolicitud([[104, '0.0001']]);
    await aceptar([L(101, 204)]);
    igual('precisión: 0,0001 exacto (1 -> 0,9999 y 0 -> 0,0001), sin redondeos', [D(db.materias[204].cant), D(db.materias[104].cant), db.movimientos.map(x => [x.cantidad, x.saldo_anterior, x.saldo_posterior])],
      ['0.9999', '0.0001', [['0.0001', '1.0000', '0.9999'], ['0.0001', '0.0000', '0.0001']]]);
    reiniciar(); db.materias[201].cant = U('99999999.9999'); db.materias[101].cant = U('99999989.9999'); conSolicitud([[101, '10']]);
    await aceptar([L(101, 201)]);
    igual('precisión: valores en el límite de DECIMAL(12,4) (99.999.999,9999) exactos', [D(db.materias[201].cant), D(db.materias[101].cant)], ['99999989.9999', '99999999.9999']);
    igual('precisión: todos los importes enviados con 4 decimales', llamadas.filter(l => [S.DESCONTAR, S.SUMAR].includes(l.sql)).every(l => /^\d+\.\d{4}$/.test(l.rep[0]) && /^\d+\.\d{4}$/.test(l.rep[4])), true);
    await rechazaSinCambios('tope: la entrada superaría 99.999.999,9999 -> 409 TOPE, nada escrito', () => { db.materias[101].cant = U('99999995'); conSolicitud([[101, '5']]); }, [L(101, 201)], 409, 'TOPE');

    // ---------- 6. Rechazos sin escrituras
    console.log('\n== rechazos (sin escrituras)');
    const insuf = await rechazaSinCambios('inventario insuficiente en una línea intermedia -> 409 INSUFICIENTE, nada escrito (ni las líneas 1 y 3)',
      () => conSolicitud([[101, '5'], [102, '2'], [103, '10']]), [L(101, 201), L(102, 204), L(103, 203)], 409, 'INSUFICIENTE');
    igual('  ... indica solo la línea afectada (stock propio de la proveedora)', insuf.e.detalle.lineas, [2]);
    await rechazaSinCambios('insuficiente por la SUMA de dos líneas sobre el mismo origen -> 409, nada escrito', () => { db.materias[204].cant = U('5'); conSolicitud([[101, '3'], [104, '3']]); }, [L(101, 204), L(102, 204)], 409, 'INSUFICIENTE');
    const ajeno = await rechazaSinCambios('origen de otra panadería -> 409 ORIGEN_NO_VALIDO, nada escrito', () => conSolicitud([[101, '5']]), [L(101, 401)], 409, 'ORIGEN_NO_VALIDO');
    igual('  ... sin bloquear nada (no se bloquean filas ajenas con datos del cliente)', bloqueos(), []);
    await rechazaSinCambios('origen = una materia de la propia solicitante -> 409 ORIGEN_NO_VALIDO', () => conSolicitud([[101, '5']]), [L(101, 102)], 409, 'ORIGEN_NO_VALIDO');
    await rechazaSinCambios('origen inexistente -> 409 ORIGEN_NO_VALIDO', () => conSolicitud([[101, '5']]), [L(101, 999)], 409, 'ORIGEN_NO_VALIDO');
    await rechazaSinCambios('origen inactivo (comprobado bajo bloqueo) -> 409 ORIGEN_NO_VALIDO', () => conSolicitud([[101, '5']]), [L(101, 205)], 409, 'ORIGEN_NO_VALIDO');
    await rechazaSinCambios('destino desactivado después de crear la solicitud -> 409 DESTINO_NO_VALIDO', () => { conSolicitud([[101, '5']]); db.materias[101].estado = 0; }, [L(101, 201)], 409, 'DESTINO_NO_VALIDO');
    await rechazaSinCambios('unidad distinta (l frente a kg) -> 409 UNIDAD_DISTINTA', () => conSolicitud([[101, '5']]), [L(101, 206)], 409, 'UNIDAD_DISTINTA');
    await rechazaSinCambios('versión agotada en el origen -> 409 VERSION_AGOTADA', () => { conSolicitud([[101, '5']]); db.materias[201].v = LIM_VERSION; }, [L(101, 201)], 409, 'VERSION_AGOTADA');
    await rechazaSinCambios('versión agotada en el destino -> 409 VERSION_AGOTADA', () => { conSolicitud([[101, '5']]); db.materias[101].v = LIM_VERSION; }, [L(101, 201)], 409, 'VERSION_AGOTADA');
    for (const estado of ['aceptada', 'rechazada', 'cancelada']) {
      await rechazaSinCambios(`solicitud ${estado} -> 409 YA_CERRADA, nada escrito`, () => { conSolicitud([[101, '5']]); db.solicitudes[1].estado = estado; db.parejas['1,2'].pendientes = 0; }, [L(101, 201)], 409, 'YA_CERRADA');
    }
    await rechazaSinCambios('aceptar desde la solicitante -> 403 LADO_NO_AUTORIZADO', () => conSolicitud([[101, '5']]), [L(101, 201)], 403, 'LADO_NO_AUTORIZADO', { panaderiaId: 1, actorId: 7 });
    igual('  ... sin bloquear nada', bloqueos(), []);
    await rechazaSinCambios('aceptar desde una panadería que no es parte -> 404 (no la revela)', () => conSolicitud([[101, '5']]), [L(101, 401)], 404, 'SOLICITUD_NO_ENCONTRADA', { panaderiaId: 4, actorId: 9 });
    await rechazaSinCambios('falta una línea -> 400 LINEAS_NO_COINCIDEN', () => conSolicitud([[101, '5'], [102, '1']]), [L(101, 201)], 400, 'LINEAS_NO_COINCIDEN');
    await rechazaSinCambios('una línea de otra solicitud -> 400 LINEAS_NO_COINCIDEN', () => { conSolicitud([[101, '5']]); conSolicitud([[102, '1']], { id: 2 }); }, [L(201, 202)], 400, 'LINEAS_NO_COINCIDEN');
    await rechazaSinCambios('la proveedora sale de la red (bajo bloqueo) -> 409 FUERA_DE_RED', () => { conSolicitud([[101, '5']]); ajustes.panaderias = (f) => f.map(x => (x.id === 2 ? { ...x, en_red: 0 } : x)); }, [L(101, 201)], 409, 'FUERA_DE_RED');
    await rechazaSinCambios('contador descuadrado -> 500 CONTADOR_DESCUADRADO', () => { conSolicitud([[101, '5']]); db.parejas['1,2'].pendientes = 3; }, [L(101, 201)], 500, 'CONTADOR_DESCUADRADO');
    { reiniciar(); const r = await resultado(op.aceptar({ panaderiaId: null, actorId: 8, solicitudId: 1, lineas: [L(101, 201)] })); igual('sin panadería autorizada -> error interno sin consultar', [r.ok, r.e instanceof ErrorNegocio, llamadas.length], [false, false, 0]); }

    // ---------- 7. Atomicidad: fallo a mitad de las escrituras -> todo se deshace
    console.log('\n== atomicidad');
    const sinTransferenciasParciales = async (descripcion, fallo, codigoEsperado) => {
      reiniciar(); conSolicitud([[101, '5'], [102, '2.5'], [103, '100']]);
      const antes = clon(db);
      fallos = [fallo];
      const res = respuesta(); const original = console.error; console.error = () => {};
      await controller.aceptar({ panaderiaId: 2, usuario: { id: 8, rol_id: 2 }, params: { id: '1' }, body: { lineas: [{ detalle_id: 101, materia_prima_origen_id: 201 }, { detalle_id: 102, materia_prima_origen_id: 202 }, { detalle_id: 103, materia_prima_origen_id: 203 }] } }, res);
      console.error = original;
      igual(descripcion, [res.statusCode, res.cuerpo.codigo ?? res.cuerpo.error, escrituras() > 0, llamadas.at(-1).sql, JSON.stringify(db) === JSON.stringify(antes)], [codigoEsperado[0], codigoEsperado[1], true, 'ROLLBACK', true]);
    };
    await sinTransferenciasParciales('el segundo descuento no afecta a ninguna fila (versión cambiada) -> 500 y se deshacen origen fijado y primer descuento',
      { sql: S.DESCONTAR, veces: 1, filas: 0, cuando: (rep) => rep[1] === 202 }, [500, 'Error interno del servidor']);
    await sinTransferenciasParciales('la última entrada no afecta a ninguna fila -> 500 y no queda ningún descuento',
      { sql: S.SUMAR, veces: 1, filas: 0, cuando: (rep) => rep[1] === 103 }, [500, 'Error interno del servidor']);
    await sinTransferenciasParciales('clave foránea (1216) en el último movimiento -> 409 CONFLICTO_INTEGRIDAD y todo deshecho',
      { sql: S.INSERTAR_MOV_ENTRADA, veces: 1, crear: () => errorMysql(1216), cuando: (rep) => rep[0] === 103 }, [409, 'CONFLICTO_INTEGRIDAD']);
    await sinTransferenciasParciales('clave foránea (1452) al fijar un origen -> 409 y todo deshecho', { sql: S.FIJAR_ORIGEN, veces: 1, crear: () => errorMysql(1452), cuando: (rep) => rep[1] === 102 }, [409, 'CONFLICTO_INTEGRIDAD']);
    await sinTransferenciasParciales('movimiento duplicado (1062, uq_mred_detalle_tipo) -> 409 CONFLICTO_DUPLICADO y todo deshecho', { sql: S.INSERTAR_MOV_SALIDA, veces: 1, crear: () => errorMysql(1062), cuando: (rep) => rep[0] === 102 }, [409, 'CONFLICTO_DUPLICADO']);
    await sinTransferenciasParciales('CHECK (3819) en un movimiento -> 409 CONFLICTO_RESTRICCION y todo deshecho', { sql: S.INSERTAR_MOV_SALIDA, veces: 1, crear: () => errorMysql(3819) }, [409, 'CONFLICTO_RESTRICCION']);
    await sinTransferenciasParciales('el cierre de la solicitud no afecta a ninguna fila -> 500 y todo deshecho', { sql: S.CERRAR_ACEPTADA, veces: 1, filas: 0 }, [500, 'Error interno del servidor']);
    await sinTransferenciasParciales('el contador no afecta a ninguna fila -> 500 y todo deshecho', { sql: S.CONTADOR_MENOS, veces: 1, filas: 0 }, [500, 'Error interno del servidor']);

    // ---------- 8. Concurrencia
    console.log('\n== concurrencia');
    { reiniciar(); conSolicitud([[101, '5'], [102, '2.5']]); fallos = [{ sql: S.BLOQUEAR_MATERIAS, veces: 1, crear: () => errorMysql(1213) }];
      const r = await resultado(aceptar([L(101, 201), L(102, 202)]));
      igual('interbloqueo (1213) al bloquear las materias: se reintenta la transacción COMPLETA y la transferencia se aplica una vez',
        [r.ok, llamadas.filter(l => l.sql === 'BEGIN').length, llamadas.filter(l => l.sql === 'ROLLBACK').length, llamadas.filter(l => l.sql === 'COMMIT').length, db.movimientos.length, D(db.materias[201].cant), db.materias[201].v],
        [true, 2, 1, 1, 4, '75.0000', 1]); }
    { reiniciar(); conSolicitud([[101, '5']]); fallos = [{ sql: S.DESCONTAR, veces: 1, crear: () => errorMysql(1213) }];
      const r = await resultado(aceptar([L(101, 201)]));
      igual('interbloqueo a mitad de las escrituras: el reintento parte del estado deshecho (origen sin fijar) y termina bien', [r.ok, db.movimientos.length, db.detalles[101].origen, D(db.materias[201].cant)], [true, 2, 201, '75.0000']); }
    { reiniciar(); conSolicitud([[101, '5']]); fallos = [{ sql: S.BLOQUEAR_PAREJA, veces: 3, crear: () => errorMysql(1213) }]; const antes = clon(db);
      const res = respuesta(); await controller.aceptar({ panaderiaId: 2, usuario: { id: 8 }, params: { id: '1' }, body: { lineas: [{ detalle_id: 101, materia_prima_origen_id: 201 }] } }, res);
      igual('tres interbloqueos seguidos: se agotan los reintentos -> 409 CONFLICTO_CONCURRENCIA y nada escrito', [res.statusCode, res.cuerpo.codigo, llamadas.filter(l => l.sql === 'BEGIN').length, JSON.stringify(db) === JSON.stringify(antes)], [409, 'CONFLICTO_CONCURRENCIA', 3, true]); }
    { reiniciar(); conSolicitud([[101, '5']]); fallos = [{ sql: S.BLOQUEAR_MATERIAS, veces: 1, crear: () => errorMysql(1205) }]; const antes = clon(db);
      const res = respuesta(); await controller.aceptar({ panaderiaId: 2, usuario: { id: 8 }, params: { id: '1' }, body: { lineas: [{ detalle_id: 101, materia_prima_origen_id: 201 }] } }, res);
      igual('espera de bloqueo agotada (1205) -> 409 con reintentar, sin reintento automático y nada escrito', [res.statusCode, res.cuerpo.reintentar, llamadas.filter(l => l.sql === 'BEGIN').length, JSON.stringify(db) === JSON.stringify(antes)], [409, true, 1, true]); }
    { reiniciar(); conSolicitud([[101, '5']]); await aceptar([L(101, 201)]); const r = await resultado(aceptar([L(101, 201)]));
      igual('dos aceptaciones de la misma solicitud (en serie bajo el bloqueo X): la segunda -> 409 YA_CERRADA y una sola transferencia',
        [r.e?.detalle?.codigo, db.movimientos.length, D(db.materias[201].cant), D(db.materias[101].cant), db.eventos.length, db.parejas['1,2'].pendientes], ['YA_CERRADA', 2, '75.0000', '11.0000', 1, 0]); }
    { reiniciar(); conSolicitud([[101, '5']]); fallos = [{ sql: S.DESCONTAR, veces: 1, filas: 0 }]; const antes = clon(db); const r = await resultado(aceptar([L(101, 201)]));
      igual('el stock cambió entre el bloqueo y el UPDATE (condición version_fila = ?): 0 filas -> error y todo deshecho', [r.ok, JSON.stringify(db) === JSON.stringify(antes)], [false, true]); }

    // ---------- 9. Controlador: sesión, validación, el cliente no elige panaderías ni cantidades
    console.log('\n== controlador');
    { reiniciar(); conSolicitud([[101, '5']]); const res = respuesta();
      await controller.aceptar({ panaderiaId: 2, usuario: { id: 8, rol_id: 2, panaderia_id: 2 }, params: { id: '1' }, query: { panaderia_id: 1 },
        body: { panaderia_id: 1, panaderia_solicitante_id: 4, lineas: [{ detalle_id: 101, materia_prima_origen_id: 201, materia_prima_destino_id: 401, cantidad: '999', panaderia_id: 4 }] } }, res);
      igual('aceptar vía API: 200; panadería y actor de la sesión; destino, cantidad y panaderías del cuerpo ignorados',
        [res.statusCode, db.solicitudes[1].cerrada_por, db.movimientos.map(x => [x.tipo, x.panaderia_id, x.materia_prima_id, x.cantidad]), D(db.materias[401].cant)],
        [200, 8, [['salida', 2, 201, '5.0000'], ['entrada', 1, 101, '5.0000']], '90.0000']); }
    for (const [descripcion, body] of [['sin líneas', {}], ['lista vacía', { lineas: [] }], ['línea repetida', { lineas: [{ detalle_id: 101, materia_prima_origen_id: 201 }, { detalle_id: 101, materia_prima_origen_id: 202 }] }],
      ['sin origen', { lineas: [{ detalle_id: 101 }] }], ['origen no entero', { lineas: [{ detalle_id: 101, materia_prima_origen_id: '2.5' }] }], ['21 líneas', { lineas: Array.from({ length: 21 }, (_, i) => ({ detalle_id: i + 1, materia_prima_origen_id: 201 })) }]]) {
      reiniciar(); conSolicitud([[101, '5']]); const res = respuesta();
      await controller.aceptar({ panaderiaId: 2, usuario: { id: 8 }, params: { id: '1' }, body }, res);
      igual(`aceptar ${descripcion} -> 400 sin consultar la base`, [res.statusCode, llamadas.length], [400, 0]);
    }
    { reiniciar(); const res = respuesta(); await controller.aceptar({ panaderiaId: 2, usuario: { id: 8 }, params: { id: 'x' }, body: { lineas: [{ detalle_id: 1, materia_prima_origen_id: 2 }] } }, res); igual('aceptar con id inválido -> 400', [res.statusCode, llamadas.length], [400, 0]); }
  } finally {
    sequelize.query = queryOriginal;
    sequelize.transaction = transactionOriginal;
  }

  // ---------- 10. Rutas y privacidad de los movimientos
  console.log('\n== rutas y privacidad');
  const ruta = router.stack.find(c => c.route && c.route.path === '/solicitudes/:id/aceptar');
  igual('ruta POST /solicitudes/:id/aceptar con verificarToken + permitirRoles + resolverPanaderia', [!!ruta, ruta && Object.keys(ruta.route.methods), ruta && ruta.route.stack.length], [true, ['post'], 4]);
  const permite = (rolId) => { let siguio = false; const res = respuesta(); ruta.route.stack[1].handle({ usuario: { rol_id: rolId } }, res, () => { siguio = true; }); return siguio ? 'next' : res.statusCode; };
  igual('aceptar: administrador y panadero pasan; gerente 403', [permite(1), permite(2), permite(3)], ['next', 'next', 403]);
  igual('movimientos: el precio de referencia solo se devuelve en las salidas (en las entradas es el de la proveedora)',
    /CASE WHEN m\.tipo = 'salida' THEN m\.precio_unitario_referencia ELSE NULL END AS precio_unitario_referencia/.test(C.MOVIMIENTOS), true);
  igual('ninguna otra consulta de lectura menciona precios', Object.entries(C).filter(([k, s]) => k !== 'MOVIMIENTOS' && /precio/i.test(s)).length, 0);

  const nFallos = resultados.filter(r => !r).length;
  console.log(`\nResultado: ${resultados.length - nFallos}/${resultados.length} correctas`);
  process.exitCode = nFallos ? 1 : 0;
};

main().catch((e) => { console.error('Error en las pruebas:', e); process.exitCode = 1; });
