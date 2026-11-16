// Pruebas unitarias de la red colaborativa, etapa E1b (crear, rechazar y cancelar solicitudes):
// - el SQL compartido con el protocolo validado en el ensayo E6 es IDÉNTICO al de referencia
//   (pruebas/lib/operaciones.js del paquete sql006 de ensayo, externo al repositorio; si existe, se compara con el
//   archivo; las cadenas de referencia también están copiadas aquí);
// - la secuencia de sentencias y el ORDEN DE BLOQUEOS (L1 pareja X -> L2 panaderías S -> L3 solicitudes
//   -> L4 materias S) coinciden con crear y cerrarSinTransferir del protocolo, y toda sentencia va en la
//   transacción de la operación;
// - efectos sobre una base simulada con estado (con deshacer en ROLLBACK): pareja y contador, solicitud,
//   líneas (nombre y unidad copiados de la materia), eventos (tipo, lado, panadería, actor) y cierres;
// - rechazos: fuera de la red, proveedora inexistente, límite de 10 pendientes, contador descuadrado,
//   destino ajeno o inactivo, panadería que no es parte (404) o del otro lado (403), ya cerrada (409),
//   sin motivo (400), y que ninguno deja escrituras;
// - concurrencia e integridad: interbloqueo reintentado, espera agotada (409), claves foráneas y
//   duplicados (409) con la transacción deshecha;
// - permisos: el gerente no puede escribir; la panadería y el actor salen de la sesión.
// No usan la base de datos ni la red. Uso (desde backend/):  node pruebas/red.operaciones.unitarias.js
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

// Cadenas del protocolo validado (operaciones.js del ensayo E6)
const REFERENCIA = {
  INSERTAR_PAREJA: 'INSERT INTO red_parejas (panaderia_menor_id, panaderia_mayor_id, pendientes, createdAt, updatedAt) VALUES (?, ?, 0, NOW(), NOW()) ON DUPLICATE KEY UPDATE updatedAt = updatedAt',
  BLOQUEAR_PAREJA: 'SELECT pendientes FROM red_parejas WHERE panaderia_menor_id = ? AND panaderia_mayor_id = ? FOR UPDATE',
  BLOQUEAR_PANADERIAS: 'SELECT id, en_red FROM panaderias WHERE id IN (?, ?) ORDER BY id FOR SHARE',
  LEER_PENDIENTES: "SELECT id FROM solicitudes_red FORCE INDEX (idx_sred_pareja) WHERE pareja_menor_id = ? AND pareja_mayor_id = ? AND estado = 'pendiente' FOR SHARE",
  BLOQUEAR_DESTINOS: 'SELECT id, nombre, unidad_medida, estado FROM materia_prima WHERE id IN (?) AND panaderia_id = ? ORDER BY id FOR SHARE',
  INSERTAR_EVENTO_CREADA: "INSERT INTO eventos_red (solicitud_id, tipo, lado, panaderia_id, actor_id, createdAt) VALUES (?, 'creada', 'solicitante', ?, ?, NOW())",
  CONTADOR_MAS: 'UPDATE red_parejas SET pendientes = pendientes + 1, updatedAt = NOW() WHERE panaderia_menor_id = ? AND panaderia_mayor_id = ?',
  BLOQUEAR_SOLICITUD: 'SELECT id, estado, panaderia_solicitante_id, panaderia_proveedora_id FROM solicitudes_red WHERE id = ? FOR UPDATE',
  INSERTAR_EVENTO_CIERRE: 'INSERT INTO eventos_red (solicitud_id, tipo, lado, panaderia_id, actor_id, createdAt) VALUES (?, ?, ?, ?, ?, NOW())',
  CONTADOR_MENOS: 'UPDATE red_parejas SET pendientes = pendientes - 1, updatedAt = NOW() WHERE panaderia_menor_id = ? AND panaderia_mayor_id = ?'
};
// Comparación opcional con el paquete de ensayo sql006 (fuera del repositorio): ruta en PANSYS_REFERENCIA_SQL006.
const RUTA_REFERENCIA = process.env.PANSYS_REFERENCIA_SQL006 || null;

const main = async () => {
  const { sequelize } = require('../src/models/index');
  const { ErrorNegocio } = require('../src/utils/errores');
  const op = require('../src/modules/red/red.operaciones');
  const consultas = require('../src/modules/red/red.consultas');
  const controller = require('../src/modules/red/red.controller');
  const router = require('../src/modules/red/red.routes');
  const S = op.SQL_OP;
  const C = consultas.SQL;

  // ---------- 1. SQL idéntico al protocolo validado
  console.log('\n== SQL del protocolo validado (E6)');
  for (const [k, ref] of Object.entries(REFERENCIA)) igual(`${k} idéntico a la referencia`, S[k], ref);
  if (RUTA_REFERENCIA && fs.existsSync(RUTA_REFERENCIA)) {
    const texto = fs.readFileSync(RUTA_REFERENCIA, 'utf8');
    igual('las cadenas de referencia aparecen literalmente en operaciones.js del ensayo', Object.values(REFERENCIA).filter(r => !texto.includes(r)).length, 0);
  } else {
    console.log(`AVISO ${RUTA_REFERENCIA ? `no se encuentra ${RUTA_REFERENCIA}` : "sin PANSYS_REFERENCIA_SQL006"}: se usan solo las cadenas copiadas`);
  }
  igual('INSERTAR_DETALLE y INSERTAR_SOLICITUD: mismas columnas que la referencia salvo id (AUTO_INCREMENT) y nota', [
    /^INSERT INTO solicitudes_red_detalle \(solicitud_id, linea, panaderia_solicitante_id, panaderia_proveedora_id, materia_prima_destino_id, materia_prima_origen_id, nombre_solicitado, unidad_medida, cantidad, createdAt, updatedAt\) VALUES \(\?, \?, \?, \?, \?, NULL, \?, \?, \?, NOW\(\), NOW\(\)\)$/.test(S.INSERTAR_DETALLE),
    /^INSERT INTO solicitudes_red \(panaderia_solicitante_id, panaderia_proveedora_id, estado, creada_por, nota, createdAt, updatedAt\) VALUES \(\?, \?, 'pendiente', \?, \?, NOW\(\), NOW\(\)\)$/.test(S.INSERTAR_SOLICITUD)], [true, true]);
  // Sentencias de crear, rechazar y cancelar (las de aceptar, que sí mueven inventario, se prueban en red.aceptar.unitarias.js)
  const CLAVES_E1B = ['PANADERIAS_PREVIA', 'SOLICITUD_PREVIA', 'INSERTAR_PAREJA', 'BLOQUEAR_PAREJA', 'BLOQUEAR_PANADERIAS', 'LEER_PENDIENTES', 'BLOQUEAR_DESTINOS', 'INSERTAR_SOLICITUD',
    'INSERTAR_DETALLE', 'INSERTAR_EVENTO_CREADA', 'CONTADOR_MAS', 'BLOQUEAR_SOLICITUD', 'CERRAR_RECHAZADA', 'CERRAR_CANCELADA', 'INSERTAR_EVENTO_CIERRE', 'CONTADOR_MENOS'];
  igual('ninguna escritura de crear, rechazar ni cancelar sobre columnas generadas, materia_prima ni movimientos (no tocan inventario)',
    CLAVES_E1B.map(k => S[k]).filter(s => /\bpareja_(menor|mayor)_id\b|\bsalida_|\bentrada_|\bsolicitante_id\b|\bproveedora_id\b|\bcierre_de\b|UPDATE materia_prima|INSERT INTO materia_prima|movimientos_red/.test(s) && /^(INSERT|UPDATE)/.test(s)).length, 0);
  igual('cierres: solo afectan a una solicitud pendiente', [/WHERE id = \? AND estado = 'pendiente'$/.test(S.CERRAR_RECHAZADA), /WHERE id = \? AND estado = 'pendiente'$/.test(S.CERRAR_CANCELADA)], [true, true]);

  // ---------- 2. Base simulada con estado y transacciones
  const BASE = () => ({
    panaderias: { 1: { en_red: 1, nombre: 'Uno', localidad: 'Kennedy' }, 2: { en_red: 1, nombre: 'Dos', localidad: 'Patio Bonito' }, 3: { en_red: 0, nombre: 'Tres', localidad: null }, 4: { en_red: 1, nombre: 'Cuatro', localidad: 'Bosa' } },
    materias: {
      101: { panaderia_id: 1, nombre: 'Harina de trigo', unidad_medida: 'kg', estado: 1 }, 102: { panaderia_id: 1, nombre: 'Azúcar', unidad_medida: 'kg', estado: 1 },
      103: { panaderia_id: 1, nombre: 'Inactiva', unidad_medida: 'kg', estado: 0 }, 201: { panaderia_id: 2, nombre: 'Harina de trigo', unidad_medida: 'kg', estado: 1 }
    },
    parejas: {}, solicitudes: {}, detalles: [], eventos: [], siguiente: { sol: 1, det: 1, ev: 1 }
  });
  let db = BASE();
  const llamadas = [];
  let tActual = null;
  let fallos = [];          // [{ sql, veces, crear: () => error }]
  let ajustes = {};         // { panaderiasBajoBloqueo: fn(rows) }
  const clon = (o) => JSON.parse(JSON.stringify(o));
  const errorMysql = (errno) => { const e = new Error(`fallo simulado ${errno}`); e.parent = { errno }; e.original = { errno }; return e; };
  const clave = (m, M) => `${m},${M}`;

  const queryOriginal = sequelize.query;
  const transactionOriginal = sequelize.transaction;
  sequelize.transaction = async (fn) => {
    const copia = clon(db);
    const t = { id: Symbol('t') };
    tActual = t;
    llamadas.push({ sql: 'BEGIN' });
    try {
      const r = await fn(t);
      llamadas.push({ sql: 'COMMIT' });
      return r;
    } catch (e) {
      db = copia;
      llamadas.push({ sql: 'ROLLBACK' });
      throw e;
    } finally {
      tActual = null;
    }
  };
  sequelize.query = async (sql, opciones = {}) => {
    const rep = opciones.replacements;
    llamadas.push({ sql, rep, enTransaccion: !!opciones.transaction && opciones.transaction === tActual });
    const f = fallos.find(x => x.sql === sql && x.veces > 0);
    if (f) { f.veces--; throw f.crear(); }
    const sol = db.solicitudes;
    switch (sql) {
      case S.PANADERIAS_PREVIA: return rep.filter(id => db.panaderias[id]).map(id => ({ id, en_red: db.panaderias[id].en_red }));
      case S.INSERTAR_PAREJA: { const k = clave(rep[0], rep[1]); const nueva = !db.parejas[k]; if (nueva) db.parejas[k] = { pendientes: 0 }; return [0, nueva ? 1 : 0]; }
      case S.BLOQUEAR_PAREJA: { const p = db.parejas[clave(rep[0], rep[1])]; return p ? [{ pendientes: p.pendientes }] : []; }
      case S.BLOQUEAR_PANADERIAS: { const filas = rep.filter(id => db.panaderias[id]).sort((a, b) => a - b).map(id => ({ id, en_red: db.panaderias[id].en_red })); return ajustes.panaderiasBajoBloqueo ? ajustes.panaderiasBajoBloqueo(filas) : filas; }
      case S.LEER_PENDIENTES: return Object.entries(sol).filter(([, s]) => Math.min(s.sol, s.prov) === rep[0] && Math.max(s.sol, s.prov) === rep[1] && s.estado === 'pendiente').map(([id]) => ({ id: Number(id) }));
      case S.BLOQUEAR_DESTINOS: return Object.entries(db.materias).filter(([id, m]) => rep[0].includes(Number(id)) && m.panaderia_id === rep[1]).sort(([a], [b]) => a - b).map(([id, m]) => ({ id: Number(id), nombre: m.nombre, unidad_medida: m.unidad_medida, estado: m.estado }));
      case S.INSERTAR_SOLICITUD: { const id = db.siguiente.sol++; sol[id] = { sol: rep[0], prov: rep[1], estado: 'pendiente', creada_por: rep[2], nota: rep[3], cerrada_por: null, motivo: null }; return [id, 1]; }
      case S.INSERTAR_DETALLE: { const id = db.siguiente.det++; db.detalles.push({ id, solicitud_id: rep[0], linea: rep[1], sol: rep[2], prov: rep[3], destino: rep[4], nombre: rep[5], unidad: rep[6], cantidad: rep[7] }); return [id, 1]; }
      case S.INSERTAR_EVENTO_CREADA: { if (db.eventos.some(e => e.solicitud_id === rep[0] && e.tipo === 'creada')) throw errorMysql(1062); db.eventos.push({ solicitud_id: rep[0], tipo: 'creada', lado: 'solicitante', panaderia_id: rep[1], actor_id: rep[2] }); return [db.siguiente.ev++, 1]; }
      case S.INSERTAR_EVENTO_CIERRE: { if (db.eventos.some(e => e.solicitud_id === rep[0] && e.tipo !== 'creada')) throw errorMysql(1062); db.eventos.push({ solicitud_id: rep[0], tipo: rep[1], lado: rep[2], panaderia_id: rep[3], actor_id: rep[4] }); return [db.siguiente.ev++, 1]; }
      case S.CONTADOR_MAS: { const p = db.parejas[clave(rep[0], rep[1])]; if (!p) return [undefined, 0]; if (p.pendientes + 1 > 10) throw errorMysql(3819); p.pendientes++; return [undefined, 1]; }
      case S.CONTADOR_MENOS: { const p = db.parejas[clave(rep[0], rep[1])]; if (!p) return [undefined, 0]; if (p.pendientes - 1 < 0) throw errorMysql(1690); p.pendientes--; return [undefined, 1]; }
      case S.SOLICITUD_PREVIA: { const s = sol[rep[0]]; return s && (s.sol === rep[1] || s.prov === rep[2]) ? [{ id: rep[0], panaderia_solicitante_id: s.sol, panaderia_proveedora_id: s.prov }] : []; }
      case S.BLOQUEAR_SOLICITUD: { const s = sol[rep[0]]; return s ? [{ id: rep[0], estado: s.estado, panaderia_solicitante_id: s.sol, panaderia_proveedora_id: s.prov }] : []; }
      case S.CERRAR_RECHAZADA: { const s = sol[rep[2]]; if (!s || s.estado !== 'pendiente') return [undefined, 0]; Object.assign(s, { estado: 'rechazada', motivo: rep[0], cerrada_por: rep[1] }); return [undefined, 1]; }
      case S.CERRAR_CANCELADA: { const s = sol[rep[1]]; if (!s || s.estado !== 'pendiente') return [undefined, 0]; Object.assign(s, { estado: 'cancelada', cerrada_por: rep[0] }); return [undefined, 1]; }
      // Lecturas de red.consultas (detalle devuelto tras el COMMIT)
      case C.SOLICITUD: { const s = sol[rep.id]; if (!s || (s.sol !== rep.propia && s.prov !== rep.propia)) return []; const P = db.panaderias;
        return [{ id: rep.id, estado: s.estado, panaderia_solicitante_id: s.sol, panaderia_proveedora_id: s.prov, nota: s.nota, motivo_rechazo: s.motivo, creada_en: 'c', cerrada_en: s.estado === 'pendiente' ? null : 'x',
          solicitante_nombre: P[s.sol].nombre, solicitante_localidad: P[s.sol].localidad, proveedora_nombre: P[s.prov].nombre, proveedora_localidad: P[s.prov].localidad }]; }
      case C.LINEAS: return db.detalles.filter(d => d.solicitud_id === rep.id).map(d => ({ id: d.id, linea: d.linea, nombre_solicitado: d.nombre, unidad_medida: d.unidad, cantidad: Number(d.cantidad), materia_prima_destino_id: d.destino, materia_prima_origen_id: null }));
      case C.EVENTOS: return db.eventos.filter(e => e.solicitud_id === rep.id).map(e => ({ tipo: e.tipo, lado: e.lado, fecha: 'f' }));
      default: throw new Error(`SQL no previsto en el doble: ${sql.slice(0, 80)}`);
    }
  };

  const nombreDe = (sql) => Object.entries(S).find(([, v]) => v === sql)?.[0] ?? (Object.entries(C).find(([, v]) => v === sql)?.[0] ? 'LECTURA_DETALLE' : sql);
  const secuencia = (desde) => llamadas.slice(desde).map(l => nombreDe(l.sql)).filter(n => n !== 'LECTURA_DETALLE');
  const capa = (sql) => (sql === S.BLOQUEAR_PAREJA ? 'L1' : sql === S.BLOQUEAR_PANADERIAS ? 'L2' : (sql === S.LEER_PENDIENTES || sql === S.BLOQUEAR_SOLICITUD) ? 'L3' : sql === S.BLOQUEAR_DESTINOS ? 'L4' : null);
  const bloqueos = (desde) => llamadas.slice(desde).map(l => capa(l.sql)).filter(Boolean);
  const escrituras = (desde) => llamadas.slice(desde).filter(l => /^(INSERT|UPDATE)/.test(l.sql)).length;
  const todasEnTransaccion = (desde) => llamadas.slice(desde).filter(l => Object.values(S).includes(l.sql)).every(l => l.enTransaccion);
  const reiniciar = () => { db = BASE(); llamadas.length = 0; fallos = []; ajustes = {}; };
  const crear = (extra = {}) => op.crear({ panaderiaId: 1, actorId: 7, proveedoraId: 2, nota: 'Urgente', lineas: [{ linea: 1, destino: 101, cantidad: 50000 }, { linea: 2, destino: 102, cantidad: 2500 }], ...extra });

  try {
    // ---------- 3. Crear
    console.log('\n== crear');
    reiniciar();
    const d1 = await crear();
    igual('crear: secuencia idéntica al protocolo (previa sin bloqueo + crear de operaciones.js, 2 líneas)', secuencia(0),
      ['BEGIN', 'PANADERIAS_PREVIA', 'INSERTAR_PAREJA', 'BLOQUEAR_PAREJA', 'BLOQUEAR_PANADERIAS', 'LEER_PENDIENTES', 'BLOQUEAR_DESTINOS', 'INSERTAR_SOLICITUD', 'INSERTAR_DETALLE', 'INSERTAR_DETALLE', 'INSERTAR_EVENTO_CREADA', 'CONTADOR_MAS', 'COMMIT']);
    igual('crear: orden de bloqueos L1 -> L2 -> L3 -> L4', bloqueos(0), ['L1', 'L2', 'L3', 'L4']);
    igual('crear: toda sentencia del protocolo en la transacción de la operación', todasEnTransaccion(0), true);
    igual('crear: la pareja usa (menor, mayor) y los destinos se bloquean en UNA sentencia con la panadería propia',
      [llamadas.find(l => l.sql === S.BLOQUEAR_PAREJA).rep, llamadas.find(l => l.sql === S.BLOQUEAR_DESTINOS).rep], [[1, 2], [[101, 102], 1]]);
    igual('crear: estado tras el COMMIT (pareja con 1 pendiente, solicitud, líneas copiadas de la materia, evento)', [
      db.parejas['1,2'], db.solicitudes[1],
      db.detalles.map(d => [d.linea, d.destino, d.nombre, d.unidad, d.cantidad, d.sol, d.prov]),
      db.eventos], [{ pendientes: 1 }, { sol: 1, prov: 2, estado: 'pendiente', creada_por: 7, nota: 'Urgente', cerrada_por: null, motivo: null },
      [[1, 101, 'Harina de trigo', 'kg', '5.0000', 1, 2], [2, 102, 'Azúcar', 'kg', '0.2500', 1, 2]], [{ solicitud_id: 1, tipo: 'creada', lado: 'solicitante', panaderia_id: 1, actor_id: 7 }]]);
    igual('crear: devuelve el detalle desde la panadería propia (rol solicitante, sin datos de cuentas)', [d1.id, d1.rol, d1.estado, d1.proveedora, d1.lineas.length, Object.keys(d1).includes('creada_por')],
      [1, 'solicitante', 'pendiente', { id: 2, nombre: 'Dos', localidad: 'Patio Bonito' }, 2, false]);
    llamadas.length = 0;
    await crear({ lineas: [{ linea: 1, destino: 101, cantidad: 10000 }] });
    igual('crear: segunda solicitud de la misma pareja reutiliza la fila (ON DUPLICATE KEY) y el contador sube a 2', [Object.keys(db.parejas), db.parejas['1,2'].pendientes], [['1,2'], 2]);

    const sinEscrituras = async (descripcion, preparar, args, codigo, status) => {
      reiniciar(); preparar();
      const antes = clon(db);
      const r = await resultado(crear(args));
      igual(descripcion, [r.ok, r.e?.status, r.e?.detalle?.codigo, JSON.stringify(db) === JSON.stringify(antes)], [false, status, codigo, true]);
      return r;
    };
    await sinEscrituras('crear: panadería propia fuera de la red -> 409 FUERA_DE_RED, nada escrito', () => { db.panaderias[1].en_red = 0; }, {}, 'FUERA_DE_RED', 409);
    igual('  ... y sin bloquear ni escribir', [bloqueos(0).length, escrituras(0)], [0, 0]);
    await sinEscrituras('crear: proveedora fuera de la red -> 404, nada escrito', () => {}, { proveedoraId: 3 }, 'PANADERIA_NO_ENCONTRADA', 404);
    await sinEscrituras('crear: proveedora inexistente -> el mismo 404 (sin error de clave foránea)', () => {}, { proveedoraId: 99 }, 'PANADERIA_NO_ENCONTRADA', 404);
    igual('  ... sin intentar insertar la pareja', escrituras(0), 0);
    await sinEscrituras('crear: la proveedora sale de la red entre la previa y el bloqueo -> 409 FUERA_DE_RED y la pareja insertada se deshace',
      () => { ajustes.panaderiasBajoBloqueo = (filas) => filas.map(f => (f.id === 2 ? { ...f, en_red: 0 } : f)); }, {}, 'FUERA_DE_RED', 409);
    igual('  ... con ROLLBACK', llamadas.at(-1).sql, 'ROLLBACK');
    await sinEscrituras('crear: 10 pendientes en la pareja -> 409 LIMITE_PENDIENTES, nada escrito',
      () => { db.parejas['1,2'] = { pendientes: 10 }; for (let i = 1; i <= 10; i++) db.solicitudes[100 + i] = { sol: i % 2 ? 1 : 2, prov: i % 2 ? 2 : 1, estado: 'pendiente' }; }, {}, 'LIMITE_PENDIENTES', 409);
    { reiniciar(); db.parejas['1,2'] = { pendientes: 9 }; for (let i = 1; i <= 9; i++) db.solicitudes[100 + i] = { sol: 1, prov: 2, estado: 'pendiente' }; db.solicitudes[120] = { sol: 1, prov: 2, estado: 'rechazada' }; db.siguiente.sol = 200;
      const r = await resultado(crear()); igual('crear: con 9 pendientes (y una cerrada) se crea la 10.ª y el contador queda en 10', [r.ok, db.parejas['1,2'].pendientes], [true, 10]); }
    const descuadre = await sinEscrituras('crear: contador distinto de las pendientes reales -> 500 CONTADOR_DESCUADRADO, nada escrito', () => { db.parejas['1,2'] = { pendientes: 3 }; }, {}, 'CONTADOR_DESCUADRADO', 500);
    igual('  ... es ErrorNegocio con código (se responde sin detalles internos)', descuadre.e instanceof ErrorNegocio, true);
    await sinEscrituras('crear: destino de otra panadería -> 409 MATERIA_INACTIVA_O_AJENA, nada escrito', () => {}, { lineas: [{ linea: 1, destino: 201, cantidad: 10000 }] }, 'MATERIA_INACTIVA_O_AJENA', 409);
    await sinEscrituras('crear: destino inactivo -> 409, nada escrito', () => {}, { lineas: [{ linea: 1, destino: 103, cantidad: 10000 }] }, 'MATERIA_INACTIVA_O_AJENA', 409);
    await sinEscrituras('crear: destino inexistente junto a uno válido -> 409, nada escrito', () => {}, { lineas: [{ linea: 1, destino: 101, cantidad: 1 }, { linea: 2, destino: 999, cantidad: 1 }] }, 'MATERIA_INACTIVA_O_AJENA', 409);
    { reiniciar(); const r = await resultado(crear({ proveedoraId: 1 })); igual('crear: proveedora = propia -> 400 sin consultar', [r.e?.status, llamadas.length], [400, 0]); }
    { reiniciar(); const r = await resultado(crear({ panaderiaId: null })); igual('crear: sin panadería autorizada -> error interno sin consultar', [r.ok, r.e instanceof ErrorNegocio, llamadas.length], [false, false, 0]); }
    { reiniciar(); const r = await resultado(crear({ lineas: [{ linea: 1, destino: 101, cantidad: 1 }, { linea: 2, destino: 101, cantidad: 2 }] })); igual('crear: destinos repetidos sin validar -> error interno sin consultar', [r.ok, r.e instanceof ErrorNegocio, llamadas.length], [false, false, 0]); }

    // ---------- 4. Rechazar y cancelar
    console.log('\n== rechazar y cancelar');
    const conSolicitud = async () => { reiniciar(); await crear(); llamadas.length = 0; };
    await conSolicitud();
    const dr = await op.rechazar({ panaderiaId: 2, actorId: 8, solicitudId: 1, motivo: 'Sin existencias' });
    igual('rechazar: secuencia = previa sin bloqueo + cerrarSinTransferir del protocolo (sin insertar la pareja)', secuencia(0),
      ['BEGIN', 'SOLICITUD_PREVIA', 'BLOQUEAR_PAREJA', 'BLOQUEAR_PANADERIAS', 'LEER_PENDIENTES', 'BLOQUEAR_SOLICITUD', 'CERRAR_RECHAZADA', 'INSERTAR_EVENTO_CIERRE', 'CONTADOR_MENOS', 'COMMIT']);
    igual('rechazar: bloqueos L1 -> L2 -> L3 (pendientes S) -> L3 (fila X)', bloqueos(0), ['L1', 'L2', 'L3', 'L3']);
    igual('rechazar: todo en la transacción', todasEnTransaccion(0), true);
    igual('rechazar: estado, motivo, actor, evento en el lado proveedora y contador a 0', [db.solicitudes[1].estado, db.solicitudes[1].motivo, db.solicitudes[1].cerrada_por, db.eventos.at(-1), db.parejas['1,2'].pendientes],
      ['rechazada', 'Sin existencias', 8, { solicitud_id: 1, tipo: 'rechazada', lado: 'proveedora', panaderia_id: 2, actor_id: 8 }, 0]);
    igual('rechazar: devuelve el detalle desde la proveedora', [dr.rol, dr.estado, dr.motivo_rechazo], ['proveedora', 'rechazada', 'Sin existencias']);

    await conSolicitud();
    await op.cancelar({ panaderiaId: 1, actorId: 7, solicitudId: 1 });
    igual('cancelar: secuencia del protocolo', secuencia(0), ['BEGIN', 'SOLICITUD_PREVIA', 'BLOQUEAR_PAREJA', 'BLOQUEAR_PANADERIAS', 'LEER_PENDIENTES', 'BLOQUEAR_SOLICITUD', 'CERRAR_CANCELADA', 'INSERTAR_EVENTO_CIERRE', 'CONTADOR_MENOS', 'COMMIT']);
    igual('cancelar: estado, actor, sin motivo, evento en el lado solicitante y contador a 0', [db.solicitudes[1].estado, db.solicitudes[1].cerrada_por, db.solicitudes[1].motivo, db.eventos.at(-1), db.parejas['1,2'].pendientes],
      ['cancelada', 7, null, { solicitud_id: 1, tipo: 'cancelada', lado: 'solicitante', panaderia_id: 1, actor_id: 7 }, 0]);

    const cierreFalla = async (descripcion, fn, status, codigo, { sinBloqueos = false } = {}) => {
      await conSolicitud();
      const antes = clon(db);
      const r = await resultado(fn());
      igual(descripcion, [r.ok, r.e?.status, r.e?.detalle?.codigo, JSON.stringify(db) === JSON.stringify(antes), escrituras(0)], [false, status, codigo, true, 0]);
      if (sinBloqueos) igual('  ... sin tomar ningún bloqueo', bloqueos(0).length, 0);
    };
    await cierreFalla('rechazar por la solicitante -> 403 LADO_NO_AUTORIZADO, nada escrito', () => op.rechazar({ panaderiaId: 1, actorId: 7, solicitudId: 1, motivo: 'x' }), 403, 'LADO_NO_AUTORIZADO', { sinBloqueos: true });
    await cierreFalla('cancelar por la proveedora -> 403 LADO_NO_AUTORIZADO, nada escrito', () => op.cancelar({ panaderiaId: 2, actorId: 8, solicitudId: 1 }), 403, 'LADO_NO_AUTORIZADO', { sinBloqueos: true });
    await cierreFalla('rechazar por una panadería que no es parte -> 404 (no la revela), nada escrito', () => op.rechazar({ panaderiaId: 4, actorId: 9, solicitudId: 1, motivo: 'x' }), 404, 'SOLICITUD_NO_ENCONTRADA', { sinBloqueos: true });
    await cierreFalla('cancelar por una panadería que no es parte -> 404, nada escrito', () => op.cancelar({ panaderiaId: 4, actorId: 9, solicitudId: 1 }), 404, 'SOLICITUD_NO_ENCONTRADA', { sinBloqueos: true });
    await cierreFalla('rechazar una solicitud inexistente -> 404', () => op.rechazar({ panaderiaId: 2, actorId: 8, solicitudId: 77, motivo: 'x' }), 404, 'SOLICITUD_NO_ENCONTRADA', { sinBloqueos: true });
    for (const estado of ['rechazada', 'cancelada', 'aceptada']) {
      await conSolicitud(); db.solicitudes[1].estado = estado; db.parejas['1,2'].pendientes = 0;
      const antes = clon(db);
      const r1 = await resultado(op.rechazar({ panaderiaId: 2, actorId: 8, solicitudId: 1, motivo: 'x' }));
      const r2 = await resultado(op.cancelar({ panaderiaId: 1, actorId: 7, solicitudId: 1 }));
      igual(`solicitud ${estado}: rechazar y cancelar -> 409 YA_CERRADA, nada escrito`, [r1.e?.status, r1.e?.detalle?.codigo, r2.e?.status, r2.e?.detalle?.codigo, JSON.stringify(db) === JSON.stringify(antes), escrituras(0)], [409, 'YA_CERRADA', 409, 'YA_CERRADA', true, 0]);
    }
    { await conSolicitud(); const r = await resultado(op.rechazar({ panaderiaId: 2, actorId: 8, solicitudId: 1, motivo: null })); igual('rechazar sin motivo validado -> error interno sin consultar', [r.ok, r.e instanceof ErrorNegocio, llamadas.length], [false, false, 0]); }
    { await conSolicitud(); delete db.parejas['1,2']; const antes = clon(db); const r = await resultado(op.cancelar({ panaderiaId: 1, actorId: 7, solicitudId: 1 })); igual('cerrar sin fila de pareja -> 409 PAREJA_INEXISTENTE, nada escrito', [r.e?.status, r.e?.detalle?.codigo, JSON.stringify(db) === JSON.stringify(antes)], [409, 'PAREJA_INEXISTENTE', true]); }
    { await conSolicitud(); db.parejas['1,2'].pendientes = 4; const antes = clon(db); const r = await resultado(op.cancelar({ panaderiaId: 1, actorId: 7, solicitudId: 1 })); igual('cerrar con el contador descuadrado -> 500 CONTADOR_DESCUADRADO, nada escrito', [r.e?.status, r.e?.detalle?.codigo, JSON.stringify(db) === JSON.stringify(antes)], [500, 'CONTADOR_DESCUADRADO', true]); }
    { await conSolicitud(); await op.cancelar({ panaderiaId: 1, actorId: 7, solicitudId: 1 }); const r = await resultado(op.cancelar({ panaderiaId: 1, actorId: 7, solicitudId: 1 }));
      igual('cancelación repetida (doble clic): la segunda -> 409 YA_CERRADA, un solo evento de cierre', [r.e?.detalle?.codigo, db.eventos.filter(e => e.tipo !== 'creada').length, db.parejas['1,2'].pendientes], ['YA_CERRADA', 1, 0]); }
    { await conSolicitud(); await op.rechazar({ panaderiaId: 2, actorId: 8, solicitudId: 1, motivo: 'x' }); const r = await resultado(op.cancelar({ panaderiaId: 1, actorId: 7, solicitudId: 1 }));
      igual('rechazar y cancelar a la vez (en serie bajo bloqueo): la segunda -> 409 YA_CERRADA', [r.e?.detalle?.codigo, db.solicitudes[1].estado, db.eventos.filter(e => e.tipo !== 'creada').length], ['YA_CERRADA', 'rechazada', 1]); }

    // ---------- 5. Concurrencia e integridad
    console.log('\n== concurrencia e integridad');
    { reiniciar(); fallos = [{ sql: S.BLOQUEAR_PAREJA, veces: 1, crear: () => errorMysql(1213) }]; const r = await resultado(crear());
      igual('interbloqueo (1213) en el primer intento: se reintenta la transacción completa y se crea UNA solicitud', [r.ok, Object.keys(db.solicitudes).length, db.parejas['1,2'].pendientes, llamadas.filter(l => l.sql === 'ROLLBACK').length, llamadas.filter(l => l.sql === 'COMMIT').length], [true, 1, 1, 1, 1]); }
    const viaControlador = async (preparar, fn) => { const res = respuesta(); preparar(); const original = console.error; console.error = () => {}; await fn(res); console.error = original; return res; };
    const reqCrear = { panaderiaId: 1, usuario: { id: 7, rol_id: 2, panaderia_id: 1 }, params: {}, query: {}, body: { proveedora_id: 2, lineas: [{ materia_prima_destino_id: 101, cantidad: '5' }], panaderia_id: 99 } };
    { reiniciar(); const res = await viaControlador(() => { fallos = [{ sql: S.BLOQUEAR_PAREJA, veces: 1, crear: () => errorMysql(1205) }]; }, (r) => controller.crear(reqCrear, r));
      igual('espera de bloqueo agotada (1205) -> 409 CONFLICTO_CONCURRENCIA con reintentar, nada escrito', [res.statusCode, res.cuerpo.codigo, res.cuerpo.reintentar, Object.keys(db.solicitudes).length], [409, 'CONFLICTO_CONCURRENCIA', true, 0]); }
    for (const errno of [1216, 1452]) {
      reiniciar();
      const res = await viaControlador(() => { fallos = [{ sql: S.INSERTAR_DETALLE, veces: 1, crear: () => errorMysql(errno) }]; }, (r) => controller.crear(reqCrear, r));
      igual(`clave foránea ${errno} al insertar una línea -> 409 CONFLICTO_INTEGRIDAD y la solicitud, la pareja y el contador se deshacen`, [res.statusCode, res.cuerpo.codigo, Object.keys(db.solicitudes).length, Object.keys(db.parejas).length, llamadas.at(-1).sql], [409, 'CONFLICTO_INTEGRIDAD', 0, 0, 'ROLLBACK']);
    }
    { await conSolicitud(); const res = await viaControlador(() => { fallos = [{ sql: S.INSERTAR_EVENTO_CIERRE, veces: 1, crear: () => errorMysql(1062) }]; }, (r) => controller.cancelar({ ...reqCrear, params: { id: '1' }, body: {} }, r));
      igual('segundo cierre bloqueado por uq_ered_un_cierre (1062) -> 409 CONFLICTO_DUPLICADO y el cierre se deshace', [res.statusCode, res.cuerpo.codigo, db.solicitudes[1].estado, db.parejas['1,2'].pendientes], [409, 'CONFLICTO_DUPLICADO', 'pendiente', 1]); }
    { await conSolicitud(); const res = await viaControlador(() => { fallos = [{ sql: S.CONTADOR_MENOS, veces: 1, crear: () => errorMysql(1690) }]; }, (r) => controller.cancelar({ ...reqCrear, params: { id: '1' }, body: {} }, r));
      igual('error interno en el último paso -> 500 sin detalles y todo se deshace', [res.statusCode, res.cuerpo, db.solicitudes[1].estado, db.eventos.length], [500, { error: 'Error interno del servidor' }, 'pendiente', 1]); }

    // ---------- 6. Controladores: sesión, validación y aislamiento
    console.log('\n== controladores');
    { reiniciar(); const res = respuesta(); await controller.crear(reqCrear, res);
      igual('crear vía API: 201, panadería y actor de la sesión (panaderia_id 99 del cliente ignorado)', [res.statusCode, db.solicitudes[1].sol, db.solicitudes[1].creada_por, JSON.stringify(llamadas).includes('99')], [201, 1, 7, false]); }
    for (const [descripcion, body] of [['sin proveedora', { lineas: [{ materia_prima_destino_id: 101, cantidad: 1 }] }], ['sin líneas', { proveedora_id: 2 }],
      ['cantidad 0', { proveedora_id: 2, lineas: [{ materia_prima_destino_id: 101, cantidad: 0 }] }], ['destino repetido', { proveedora_id: 2, lineas: [{ materia_prima_destino_id: 101, cantidad: 1 }, { materia_prima_destino_id: 101, cantidad: 1 }] }],
      ['21 líneas', { proveedora_id: 2, lineas: Array.from({ length: 21 }, (_, i) => ({ materia_prima_destino_id: i + 1, cantidad: 1 })) }], ['proveedora propia', { proveedora_id: 1, lineas: [{ materia_prima_destino_id: 101, cantidad: 1 }] }],
      ['nota de 256', { proveedora_id: 2, nota: 'x'.repeat(256), lineas: [{ materia_prima_destino_id: 101, cantidad: 1 }] }]]) {
      reiniciar(); const res = respuesta(); await controller.crear({ ...reqCrear, body }, res);
      igual(`crear ${descripcion} -> 400 sin consultar la base`, [res.statusCode, llamadas.length], [400, 0]);
    }
    for (const [descripcion, body] of [['sin motivo', {}], ['motivo en blanco', { motivo: '  ' }], ['motivo de 256', { motivo: 'x'.repeat(256) }], ['motivo no texto', { motivo: 5 }]]) {
      await conSolicitud(); const res = respuesta(); await controller.rechazar({ ...reqCrear, panaderiaId: 2, usuario: { id: 8 }, params: { id: '1' }, body }, res);
      igual(`rechazar ${descripcion} -> 400 sin consultar la base`, [res.statusCode, llamadas.length, db.solicitudes[1].estado], [400, 0, 'pendiente']);
    }
    { await conSolicitud(); const res = respuesta(); await controller.rechazar({ ...reqCrear, panaderiaId: 2, usuario: { id: 8 }, params: { id: 'abc' }, body: { motivo: 'x' } }, res); igual('rechazar con id inválido -> 400', [res.statusCode, llamadas.length], [400, 0]); }
    { await conSolicitud(); const res = respuesta(); await controller.rechazar({ ...reqCrear, panaderiaId: 2, usuario: { id: 8 }, params: { id: '1' }, body: { motivo: ' Sin stock ', panaderia_id: 1 } }, res);
      igual('rechazar vía API: 200, actor de la sesión, motivo recortado; panaderia_id del cuerpo ignorado', [res.statusCode, db.solicitudes[1].cerrada_por, db.solicitudes[1].motivo, res.cuerpo.rol], [200, 8, 'Sin stock', 'proveedora']); }
    { await conSolicitud(); const res = respuesta(); await controller.cancelar({ ...reqCrear, panaderiaId: 2, usuario: { id: 8 }, params: { id: '1' }, body: { panaderia_id: 1 } }, res);
      igual('cancelar desde la proveedora aunque el cuerpo diga panaderia_id 1 -> 403 (la panadería sale de la sesión)', [res.statusCode, res.cuerpo.codigo, db.solicitudes[1].estado], [403, 'LADO_NO_AUTORIZADO', 'pendiente']); }
    { await conSolicitud(); const res = respuesta(); await controller.detalle({ ...reqCrear, panaderiaId: 4, params: { id: '1' } }, res); igual('aislamiento: una tercera panadería no ve la solicitud (404)', [res.statusCode, res.cuerpo.codigo], [404, 'SOLICITUD_NO_ENCONTRADA']); }
  } finally {
    sequelize.query = queryOriginal;
    sequelize.transaction = transactionOriginal;
  }

  // ---------- 7. Rutas: permisos de escritura
  console.log('\n== rutas');
  const capas = router.stack.filter(c => c.route).map(c => [Object.keys(c.route.methods)[0], c.route.path, c.route.stack.length]);
  igual('rutas: 6 GET de lectura y 4 POST de escritura (aceptar, E1c), cada una con 3 middleware', capas, [
    ['get', '/panaderias', 4], ['get', '/panaderias/:id/disponibilidad', 4], ['get', '/resumen', 4], ['get', '/solicitudes', 4], ['get', '/solicitudes/:id', 4], ['get', '/movimientos', 4],
    ['post', '/solicitudes', 4], ['post', '/solicitudes/:id/aceptar', 4], ['post', '/solicitudes/:id/rechazar', 4], ['post', '/solicitudes/:id/cancelar', 4]]);
  for (const ruta of router.stack.filter(c => c.route && c.route.methods.post)) {
    const permite = (rolId) => { let siguio = false; const res = respuesta(); ruta.route.stack[1].handle({ usuario: { rol_id: rolId } }, res, () => { siguio = true; }); return siguio ? 'next' : res.statusCode; };
    igual(`POST ${ruta.route.path}: administrador y panadero pasan; gerente 403`, [permite(1), permite(2), permite(3)], ['next', 'next', 403]);
    let siguio = false; const r = { usuario: { panaderia_id: 5 }, body: { panaderia_id: 99 } }; ruta.route.stack[2].handle(r, respuesta(), () => { siguio = true; });
    igual(`POST ${ruta.route.path}: resolverPanaderia toma la panadería de la cuenta`, [siguio, r.panaderiaId], [true, 5]);
  }
  const codigoRutas = fs.readFileSync(require.resolve('../src/modules/red/red.routes.js'), 'utf8').split(/\r?\n/).filter(l => !l.trim().startsWith('//')).join('\n');
  igual('red.routes.js: escritura = verificarToken + ADMINISTRADOR y PANADERO (sin GERENTE) + resolverPanaderia(); los 4 POST la usan',
    [/const escritura = \[verificarToken, permitirRoles\(ADMINISTRADOR, PANADERO\), resolverPanaderia\(\)\]/.test(codigoRutas), (codigoRutas.match(/router\.post\('[^']+', \.\.\.escritura, /g) ?? []).length], [true, 4]);

  const nFallos = resultados.filter(r => !r).length;
  console.log(`\nResultado: ${resultados.length - nFallos}/${resultados.length} correctas`);
  process.exitCode = nFallos ? 1 : 0;
};

main().catch((e) => { console.error('Error en las pruebas:', e); process.exitCode = 1; });
