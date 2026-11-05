// Pruebas unitarias de la red colaborativa, etapa E1a (lectura):
// - modelos: MateriaPrima.version_fila y Panaderia.localidad (SQL 006);
// - red.validaciones: parámetros de consulta y cuerpos de las operaciones (límites del SQL 006);
// - red.errores: rechazos de negocio y errores de MySQL (1216/1217/1451/1452 -> 409 sin depender del
//   nombre de la restricción; 3819 y 1062 -> 409; 1205/1213 -> 409 con reintentar; otros -> 500 sin detalles);
// - red.consultas con sequelize.query sustituido por un doble: panadería siempre de la sesión, SQL
//   constante con reemplazos, listas blancas (sin precios, costos, stock mínimo, ventas ni datos personales
//   de otras panaderías), nivel de disponibilidad, 404/409 de la disponibilidad y del detalle, paginación;
// - red.controller: la panadería es req.panaderiaId y se ignora cualquier panaderia_id del cliente;
// - red.routes: solo GET, cadena común de lectura con los tres roles y resolverPanaderia();
// - app.js monta /api/red.
// No usan la base de datos ni la red. Uso (desde backend/):  node pruebas/red.unitarias.js
// Seguridad: la conexión apunta a un host que no existe (.invalid) y toda conexión de red queda bloqueada.
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
const path = require('path');

const resultados = [];
const igual = (descripcion, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  resultados.push(ok);
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${descripcion}${ok ? '' : ` -> obtenido ${JSON.stringify(real)}, esperado ${JSON.stringify(esperado)}`}`);
};
const lanza = (fn) => { try { fn(); return null; } catch (e) { return e; } };
const resultado = (promesa) => promesa.then(r => ({ ok: true, r }), e => ({ ok: false, e }));
const leer = (relativa) => fs.readFileSync(path.join(__dirname, relativa), 'utf8');

// Respuesta simulada de Express
const respuesta = () => {
  const r = { statusCode: 200, cuerpo: undefined };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.cuerpo = b; return r; };
  return r;
};

const main = async () => {
  const { sequelize, MateriaPrima, Panaderia } = require('../src/models/index');
  const { ErrorNegocio } = require('../src/utils/errores');
  const v = require('../src/modules/red/red.validaciones');
  const er = require('../src/modules/red/red.errores');
  const consultas = require('../src/modules/red/red.consultas');
  const controller = require('../src/modules/red/red.controller');
  const router = require('../src/modules/red/red.routes');

  // ---------- Modelos
  console.log('\n== modelos (SQL 006)');
  const vf = MateriaPrima.rawAttributes.version_fila;
  igual('MateriaPrima.version_fila: INT UNSIGNED NOT NULL DEFAULT 0', [!!vf, vf?.type?.key, !!vf?.type?.options?.unsigned, vf?.allowNull, vf?.defaultValue], [true, 'INTEGER', true, false, 0]);
  const loc = Panaderia.rawAttributes.localidad;
  igual('Panaderia.localidad: VARCHAR(100) NULL', [!!loc, loc?.type?.key, loc?.type?.options?.length, loc?.allowNull], [true, 'STRING', 100, true]);

  // ---------- Validaciones
  console.log('\n== red.validaciones');
  const err400 = (fn) => { const e = lanza(fn); return e instanceof ErrorNegocio ? e.status : (e ? 'otro' : 'sin error'); };
  igual('panaderia y solicitud: enteros positivos', [v.parsearPanaderiaRed('2'), v.parsearSolicitudId(7), err400(() => v.parsearPanaderiaRed('0')), err400(() => v.parsearPanaderiaRed('1.5')), err400(() => v.parsearSolicitudId('x'))], [2, 7, 400, 400, 400]);
  igual('bandeja obligatoria (recibidas|enviadas), estado opcional del ENUM, pagina 1..10000',
    [v.parsearFiltrosBandeja({ bandeja: 'recibidas' }), v.parsearFiltrosBandeja({ bandeja: 'enviadas', estado: 'pendiente', pagina: '3' }),
      err400(() => v.parsearFiltrosBandeja({})), err400(() => v.parsearFiltrosBandeja({ bandeja: 'todas' })), err400(() => v.parsearFiltrosBandeja({ bandeja: 'recibidas', estado: 'borrada' })),
      err400(() => v.parsearFiltrosBandeja({ bandeja: 'recibidas', pagina: '0' })), err400(() => v.parsearFiltrosBandeja({ bandeja: 'recibidas', pagina: '10001' }))],
    [{ bandeja: 'recibidas', estado: null, pagina: 1 }, { bandeja: 'enviadas', estado: 'pendiente', pagina: 3 }, 400, 400, 400, 400, 400]);
  igual('movimientos: fechas AAAA-MM-DD opcionales y desde <= hasta',
    [v.parsearFiltrosMovimientos({}), v.parsearFiltrosMovimientos({ desde: '2026-11-01', hasta: '2026-11-05', pagina: 2 }),
      err400(() => v.parsearFiltrosMovimientos({ desde: '2026-02-30' })), err400(() => v.parsearFiltrosMovimientos({ desde: '2026-11-06', hasta: '2026-11-05' }))],
    [{ desde: null, hasta: null, pagina: 1 }, { desde: '2026-11-01', hasta: '2026-11-05', pagina: 2 }, 400, 400]);
  const linea = (destino, cantidad) => ({ materia_prima_destino_id: destino, cantidad });
  igual('crear: líneas numeradas 1..n y cantidades en diezmilésimas',
    v.parsearCrearSolicitud({ proveedora_id: 2, nota: '  Urgente  ', lineas: [linea(101, '5'), linea(102, '0.2500')] }, 1),
    { proveedoraId: 2, nota: 'Urgente', lineas: [{ linea: 1, destino: 101, cantidad: 50000 }, { linea: 2, destino: 102, cantidad: 2500 }] });
  igual('crear: nota vacía o solo espacios -> null (chk_sred_nota)', [v.parsearCrearSolicitud({ proveedora_id: 2, nota: '   ', lineas: [linea(1, 1)] }, 1).nota], [null]);
  const e1 = lanza(() => v.parsearCrearSolicitud({ proveedora_id: 1, lineas: [linea(1, 1)] }, 1));
  igual('crear: proveedora = propia -> 400 MISMA_PANADERIA', [e1?.status, e1?.detalle?.codigo], [400, 'MISMA_PANADERIA']);
  igual('crear: 0 o 21 líneas, destino repetido, cantidad 0, negativa, 5 decimales o sobre el máximo -> 400', [
    err400(() => v.parsearCrearSolicitud({ proveedora_id: 2, lineas: [] }, 1)),
    err400(() => v.parsearCrearSolicitud({ proveedora_id: 2, lineas: Array.from({ length: 21 }, (_, i) => linea(i + 1, 1)) }, 1)),
    err400(() => v.parsearCrearSolicitud({ proveedora_id: 2, lineas: [linea(5, 1), linea(5, 2)] }, 1)),
    err400(() => v.parsearCrearSolicitud({ proveedora_id: 2, lineas: [linea(5, '0')] }, 1)),
    err400(() => v.parsearCrearSolicitud({ proveedora_id: 2, lineas: [linea(5, '-1')] }, 1)),
    err400(() => v.parsearCrearSolicitud({ proveedora_id: 2, lineas: [linea(5, '1.00001')] }, 1)),
    err400(() => v.parsearCrearSolicitud({ proveedora_id: 2, lineas: [linea(5, '100000000')] }, 1)),
    err400(() => v.parsearCrearSolicitud({ proveedora_id: 2, nota: 'x'.repeat(256), lineas: [linea(5, 1)] }, 1)),
    err400(() => v.parsearCrearSolicitud(null, 1))], [400, 400, 400, 400, 400, 400, 400, 400, 400]);
  igual('crear: 20 líneas es el máximo válido', v.parsearCrearSolicitud({ proveedora_id: 2, lineas: Array.from({ length: 20 }, (_, i) => linea(i + 1, 1)) }, 1).lineas.length, 20);
  igual('aceptar: líneas con detalle y origen; repetida o vacía -> 400', [
    v.parsearAceptarSolicitud({ lineas: [{ detalle_id: 9, materia_prima_origen_id: 201 }] }),
    err400(() => v.parsearAceptarSolicitud({ lineas: [] })),
    err400(() => v.parsearAceptarSolicitud({ lineas: [{ detalle_id: 9, materia_prima_origen_id: 1 }, { detalle_id: 9, materia_prima_origen_id: 2 }] })),
    err400(() => v.parsearAceptarSolicitud({ lineas: [{ detalle_id: 9 }] }))], [{ lineas: [{ detalleId: 9, origen: 201 }] }, 400, 400, 400]);
  igual('rechazar: motivo obligatorio, recortado y de 255 como mucho', [v.parsearRechazo({ motivo: ' Sin stock ' }), err400(() => v.parsearRechazo({})), err400(() => v.parsearRechazo({ motivo: '   ' })), err400(() => v.parsearRechazo({ motivo: 'x'.repeat(256) })), v.parsearRechazo({ motivo: 'x'.repeat(255) }).motivo.length],
    [{ motivo: 'Sin stock' }, 400, 400, 400, 255]);

  // ---------- Errores
  console.log('\n== red.errores');
  const conErrno = (errno, forma) => { const e = new Error('mensaje interno de MySQL'); if (forma === 'parent') e.parent = { errno }; else if (forma === 'original') e.original = { errno }; else e.errno = errno; return e; };
  for (const errno of [1216, 1217, 1451, 1452]) {
    for (const forma of ['parent', 'original', 'directo']) {
      const r = respuesta(); er.responderErrorRed(r, conErrno(errno, forma));
      igual(`errno ${errno} (${forma}) -> 409 CONFLICTO_INTEGRIDAD sin el mensaje interno`, [r.statusCode, r.cuerpo.codigo, JSON.stringify(r.cuerpo).includes('interno de MySQL')], [409, 'CONFLICTO_INTEGRIDAD', false]);
    }
  }
  const casosErr = [[3819, 409, 'CONFLICTO_RESTRICCION'], [1062, 409, 'CONFLICTO_DUPLICADO'], [1213, 409, 'CONFLICTO_CONCURRENCIA'], [1205, 409, 'CONFLICTO_CONCURRENCIA']];
  for (const [errno, status, codigo] of casosErr) { const r = respuesta(); er.responderErrorRed(r, conErrno(errno, 'parent')); igual(`errno ${errno} -> ${status} ${codigo}`, [r.statusCode, r.cuerpo.codigo], [status, codigo]); }
  { const r = respuesta(); const original = console.error; console.error = () => {}; er.responderErrorRed(r, new Error('detalle secreto')); console.error = original; igual('error genérico -> 500 sin detalles', [r.statusCode, r.cuerpo], [500, { error: 'Error interno del servidor' }]); }
  { const r = respuesta(); er.responderErrorRed(r, er.rechazo('INSUFICIENTE', { lineas: [1] })); igual('rechazo -> su HTTP, mensaje, código y detalle', [r.statusCode, r.cuerpo.codigo, r.cuerpo.lineas, typeof r.cuerpo.error], [409, 'INSUFICIENTE', [1], 'string']); }
  igual('rechazo con un código desconocido -> error interno (no de negocio)', [lanza(() => er.rechazo('INVENTADO')) instanceof ErrorNegocio, !!lanza(() => er.rechazo('INVENTADO'))], [false, true]);
  const codigosProtocolo = ['FUERA_DE_RED', 'PAREJA_INEXISTENTE', 'LIMITE_PENDIENTES', 'MATERIA_INACTIVA_O_AJENA', 'YA_CERRADA', 'ORIGEN_NO_VALIDO', 'DESTINO_NO_VALIDO', 'UNIDAD_DISTINTA', 'INSUFICIENTE', 'TOPE', 'VERSION_AGOTADA', 'VERSION_DESACTUALIZADA', 'MATERIA_EN_SOLICITUD_PENDIENTE'];
  igual('todos los rechazos del protocolo validado (operaciones.js) tienen respuesta, y son 409', codigosProtocolo.every(c => er.RECHAZOS[c] && er.RECHAZOS[c][0] === 409), true);

  // ---------- Consultas con sequelize.query simulado
  console.log('\n== red.consultas');
  const llamadas = [];
  let guion = () => [];
  const queryOriginal = sequelize.query;
  sequelize.query = async (sql, opciones) => { llamadas.push({ sql, opciones }); return guion(sql, opciones?.replacements ?? {}); };
  const S = consultas.SQL;
  try {
    // Directorio
    guion = () => [{ id: 2, nombre: 'Dos', localidad: 'Patio Bonito', en_red: 1 }, { id: 1, nombre: 'Uno', localidad: null, en_red: 0 }];
    llamadas.length = 0;
    const dir = await consultas.directorio(1);
    igual('directorio: SQL y panadería de la sesión', [llamadas[0].sql === S.DIRECTORIO, llamadas[0].opciones.replacements, llamadas[0].opciones.type], [true, { propia: 1 }, 'SELECT']);
    igual('directorio: solo id, nombre, localidad, en_red y es_propia', dir, [{ id: 2, nombre: 'Dos', localidad: 'Patio Bonito', en_red: true, es_propia: false }, { id: 1, nombre: 'Uno', localidad: null, en_red: false, es_propia: true }]);

    // Disponibilidad
    const par = (enRedPropia, enRedOtra, conOtra = true) => [{ id: 1, nombre: 'Uno', localidad: 'K', en_red: enRedPropia }, ...(conOtra ? [{ id: 2, nombre: 'Dos', localidad: 'P', en_red: enRedOtra }] : [])];
    const materiasOtra = [
      { id: 201, nombre: 'Harina', unidad_medida: 'kg', cantidad_disponible: 80, stock_minimo: 20, precio_unitario: 3100 },
      { id: 202, nombre: 'Azúcar', unidad_medida: 'kg', cantidad_disponible: 10, stock_minimo: 10 },
      { id: 203, nombre: 'Levadura', unidad_medida: 'g', cantidad_disponible: 0, stock_minimo: 0 },
      { id: 204, nombre: 'Sal', unidad_medida: 'kg', cantidad_disponible: 0.0001, stock_minimo: 0 }];
    guion = (sql) => (sql === S.PANADERIAS_PAR ? par(1, 1) : materiasOtra);
    llamadas.length = 0;
    const disp = await consultas.disponibilidad(1, 2);
    igual('disponibilidad: lee el par (propia de la sesión) y las materias activas de la otra', [llamadas.map(l => l.sql === S.PANADERIAS_PAR ? 'par' : l.sql === S.DISPONIBILIDAD ? 'materias' : '?'), llamadas[0].opciones.replacements, llamadas[1].opciones.replacements], [['par', 'materias'], { propia: 1, otra: 2 }, { otra: 2 }]);
    igual('disponibilidad: cantidad exacta y nivel; sin precio ni stock mínimo', disp, {
      panaderia: { id: 2, nombre: 'Dos', localidad: 'P' },
      materias: [{ id: 201, nombre: 'Harina', unidad_medida: 'kg', cantidad_disponible: 80, nivel: 'disponible' },
        { id: 202, nombre: 'Azúcar', unidad_medida: 'kg', cantidad_disponible: 10, nivel: 'bajo' },
        { id: 203, nombre: 'Levadura', unidad_medida: 'g', cantidad_disponible: 0, nivel: 'agotado' },
        { id: 204, nombre: 'Sal', unidad_medida: 'kg', cantidad_disponible: 0.0001, nivel: 'disponible' }]
    });
    const errDisp = async (propiaEnRed, otraEnRed, conOtra, otraId = 2) => {
      guion = (sql) => (sql === S.PANADERIAS_PAR ? par(propiaEnRed, otraEnRed, conOtra) : materiasOtra);
      llamadas.length = 0;
      const r = await resultado(consultas.disponibilidad(1, otraId));
      return [r.ok, r.e?.status, r.e?.detalle?.codigo, llamadas.some(l => l.sql === S.DISPONIBILIDAD)];
    };
    igual('disponibilidad: propia fuera de la red -> 409 FUERA_DE_RED sin leer materias', await errDisp(0, 1, true), [false, 409, 'FUERA_DE_RED', false]);
    igual('disponibilidad: otra fuera de la red -> 404 (no revela que existe) sin leer materias', await errDisp(1, 0, true), [false, 404, 'PANADERIA_NO_ENCONTRADA', false]);
    igual('disponibilidad: otra inexistente -> el mismo 404', await errDisp(1, 1, false), [false, 404, 'PANADERIA_NO_ENCONTRADA', false]);
    igual('disponibilidad: la propia -> 400 MISMA_PANADERIA sin consultar', await errDisp(1, 1, true, 1), [false, 400, 'MISMA_PANADERIA', false]);
    igual('nivel: límites exactos (0 agotado; igual al mínimo bajo; 0,0001 sobre el mínimo disponible)',
      [consultas.nivelDisponibilidad(0, 5), consultas.nivelDisponibilidad(5, 5), consultas.nivelDisponibilidad(5.0001, 5), consultas.nivelDisponibilidad(0.1, 0)], ['agotado', 'bajo', 'disponible', 'disponible']);

    // Resumen
    guion = () => [{ recibidas_pendientes: 2, enviadas_pendientes: 1, transferencias_30_dias: 3 }];
    llamadas.length = 0;
    igual('resumen: recuentos de la panadería de la sesión', [await consultas.resumen(1), llamadas[0].opciones.replacements], [{ recibidas_pendientes: 2, enviadas_pendientes: 1, transferencias_30_dias: 3 }, { propia: 1 }]);

    // Bandejas
    const filaBandeja = { id: 5, estado: 'pendiente', nota: null, motivo_rechazo: null, creada_en: 'f', cerrada_en: null, contraparte_id: 2, contraparte_nombre: 'Dos', contraparte_localidad: 'P', lineas: 2, creada_por: 77 };
    guion = (sql) => (/COUNT\(\*\) AS total/.test(sql) && !/LIMIT/.test(sql) ? [{ total: 21 }] : [filaBandeja]);
    for (const [bandeja, sqlEsperado, totalEsperado] of [['recibidas', S.BANDEJA_RECIBIDAS, S.TOTAL_RECIBIDAS], ['enviadas', S.BANDEJA_ENVIADAS, S.TOTAL_ENVIADAS]]) {
      llamadas.length = 0;
      const b = await consultas.bandeja(1, { bandeja, estado: 'pendiente', pagina: 2 });
      igual(`bandeja ${bandeja}: SQL propio, filtro de estado y página 2 (desplazamiento 20)`,
        [llamadas.map(l => l.sql === sqlEsperado ? 'lista' : l.sql === totalEsperado ? 'total' : '?').sort(), llamadas.find(l => l.sql === sqlEsperado).opciones.replacements],
        [['lista', 'total'], { propia: 1, estado: 'pendiente', limite: 20, desplazamiento: 20 }]);
      igual(`bandeja ${bandeja}: lista blanca (sin creada_por ni otros campos)`, [b.total, b.solicitudes], [21, [{ id: 5, estado: 'pendiente', nota: null, motivo_rechazo: null, creada_en: 'f', cerrada_en: null, lineas: 2, contraparte: { id: 2, nombre: 'Dos', localidad: 'P' } }]]);
    }
    igual('bandeja recibidas filtra por proveedora = propia; enviadas por solicitante = propia',
      [/WHERE s\.panaderia_proveedora_id = :propia/.test(S.BANDEJA_RECIBIDAS) && /WHERE s\.panaderia_proveedora_id = :propia/.test(S.TOTAL_RECIBIDAS),
        /WHERE s\.panaderia_solicitante_id = :propia/.test(S.BANDEJA_ENVIADAS) && /WHERE s\.panaderia_solicitante_id = :propia/.test(S.TOTAL_ENVIADAS)], [true, true]);
    { llamadas.length = 0; const r = await resultado(consultas.bandeja(1, { bandeja: 'otra', estado: null, pagina: 1 })); igual('bandeja no validada -> error interno sin consultar', [r.ok, r.e instanceof ErrorNegocio, llamadas.length], [false, false, 0]); }

    // Detalle
    const cab = { id: 5, estado: 'aceptada', panaderia_solicitante_id: 1, panaderia_proveedora_id: 2, nota: 'n', motivo_rechazo: null, creada_en: 'a', cerrada_en: 'b', solicitante_nombre: 'Uno', solicitante_localidad: 'K', proveedora_nombre: 'Dos', proveedora_localidad: 'P', creada_por: 9 };
    guion = (sql) => (sql === S.SOLICITUD ? [cab] : sql === S.LINEAS ? [{ id: 9, linea: 1, nombre_solicitado: 'Harina', unidad_medida: 'kg', cantidad: 5, materia_prima_destino_id: 101, materia_prima_origen_id: 201 }]
      : [{ tipo: 'creada', lado: 'solicitante', fecha: 'a', actor_id: 3 }, { tipo: 'aceptada', lado: 'proveedora', fecha: 'b', actor_id: 4 }]);
    llamadas.length = 0;
    const det = await consultas.detalle(1, 5);
    igual('detalle: la cabecera exige que la panadería de la sesión sea parte', [llamadas[0].sql === S.SOLICITUD, llamadas[0].opciones.replacements, /AND \(s\.panaderia_solicitante_id = :propia OR s\.panaderia_proveedora_id = :propia\)/.test(S.SOLICITUD)], [true, { id: 5, propia: 1 }, true]);
    igual('detalle: rol, panaderías públicas, líneas y eventos sin actores', det, {
      id: 5, estado: 'aceptada', rol: 'solicitante', solicitante: { id: 1, nombre: 'Uno', localidad: 'K' }, proveedora: { id: 2, nombre: 'Dos', localidad: 'P' },
      nota: 'n', motivo_rechazo: null, creada_en: 'a', cerrada_en: 'b',
      lineas: [{ id: 9, linea: 1, nombre: 'Harina', unidad_medida: 'kg', cantidad: 5, materia_prima_destino_id: 101, materia_prima_origen_id: 201 }],
      eventos: [{ tipo: 'creada', lado: 'solicitante', fecha: 'a' }, { tipo: 'aceptada', lado: 'proveedora', fecha: 'b' }]
    });
    guion = () => [];
    llamadas.length = 0;
    { const r = await resultado(consultas.detalle(3, 5)); igual('detalle de una solicitud ajena -> 404 sin leer líneas ni eventos', [r.ok, r.e?.status, r.e?.detalle?.codigo, llamadas.length], [false, 404, 'SOLICITUD_NO_ENCONTRADA', 1]); }

    // Movimientos
    guion = (sql) => (sql === S.TOTAL_MOVIMIENTOS ? [{ total: 1 }] : [{ id: 1, tipo: 'entrada', materia_prima_id: 101, materia_nombre: 'Harina', unidad_medida: 'kg', cantidad: 5, saldo_anterior: 6, saldo_posterior: 11, precio_unitario_referencia: 3100, fecha: 'f', solicitud_id: 5, usuario_id: 7 }]);
    llamadas.length = 0;
    const mov = await consultas.movimientos(1, { desde: '2026-11-01', hasta: null, pagina: 1 });
    igual('movimientos: solo de la panadería de la sesión, con filtros y página', [llamadas.find(l => l.sql === S.MOVIMIENTOS).opciones.replacements, /WHERE m\.panaderia_id = :propia/.test(S.MOVIMIENTOS) && /WHERE m\.panaderia_id = :propia/.test(S.TOTAL_MOVIMIENTOS)],
      [{ propia: 1, desde: '2026-11-01', hasta: null, limite: 20, desplazamiento: 0 }, true]);
    igual('movimientos: lista blanca (sin usuario_id)', mov.movimientos, [{ id: 1, tipo: 'entrada', materia_prima_id: 101, materia_nombre: 'Harina', unidad_medida: 'kg', cantidad: 5, saldo_anterior: 6, saldo_posterior: 11, precio_unitario_referencia: 3100, fecha: 'f', solicitud_id: 5 }]);

    // Sin panadería autorizada: error interno sin enviar ninguna consulta
    for (const [nombre, fn] of [['directorio', () => consultas.directorio(null)], ['disponibilidad', () => consultas.disponibilidad(undefined, 2)], ['resumen', () => consultas.resumen(0)],
      ['bandeja', () => consultas.bandeja('1', { bandeja: 'recibidas', pagina: 1 })], ['detalle', () => consultas.detalle(NaN, 5)], ['movimientos', () => consultas.movimientos(-1, { pagina: 1 })]]) {
      llamadas.length = 0;
      const r = await resultado(fn());
      igual(`${nombre} sin panadería autorizada -> error interno y ninguna consulta`, [r.ok, r.e instanceof ErrorNegocio, llamadas.length], [false, false, 0]);
    }

    // ---------- Controlador: la panadería es req.panaderiaId; se ignora la del cliente
    console.log('\n== red.controller');
    const capturas = [];
    guion = (sql, rep) => { capturas.push(rep); if (sql === S.PANADERIAS_PAR) return par(1, 1); if (/COUNT\(\*\) AS total/.test(sql) && !/LIMIT/.test(sql)) return [{ total: 0 }]; if (sql === S.SOLICITUD) return [cab]; if (sql === S.RESUMEN) return [{}]; return []; };
    const req = (extra) => ({ panaderiaId: 1, usuario: { id: 3, rol_id: 3, panaderia_id: 1 }, params: {}, query: { panaderia_id: 99 }, body: { panaderia_id: 99 }, ...extra });
    for (const [nombre, r] of [['directorio', req()], ['disponibilidad', req({ params: { id: '2' } })], ['resumen', req()], ['bandeja', req({ query: { bandeja: 'enviadas', panaderia_id: 99 } })],
      ['detalle', req({ params: { id: '5' } })], ['movimientos', req()]]) {
      capturas.length = 0;
      const res = respuesta();
      await controller[nombre](r, res);
      igual(`${nombre}: 200 y solo la panadería de la sesión en las consultas (panaderia_id 99 del cliente ignorado)`,
        [res.statusCode, capturas.length > 0, capturas.every(c => c.propia === undefined || c.propia === 1), JSON.stringify(capturas).includes('99')], [200, true, true, false]);
    }
    { const res = respuesta(); await controller.disponibilidad(req({ params: { id: 'abc' } }), res); igual('disponibilidad con id inválido -> 400', res.statusCode, 400); }
    { const res = respuesta(); await controller.bandeja(req({ query: {} }), res); igual('bandeja sin bandeja -> 400', res.statusCode, 400); }
    { guion = () => []; const res = respuesta(); await controller.detalle(req({ params: { id: '5' } }), res); igual('detalle ajeno -> 404 SOLICITUD_NO_ENCONTRADA', [res.statusCode, res.cuerpo.codigo], [404, 'SOLICITUD_NO_ENCONTRADA']); }
    { guion = () => { const e = new Error('x'); e.parent = { errno: 1216 }; throw e; }; const res = respuesta(); await controller.directorio(req(), res); igual('error de integridad en una lectura -> 409 sin detalles', [res.statusCode, res.cuerpo.codigo], [409, 'CONFLICTO_INTEGRIDAD']); }
  } finally {
    sequelize.query = queryOriginal;
  }

  // ---------- Revisión del SQL de lectura (listas blancas y SQL constante)
  console.log('\n== revisión del SQL');
  const sqls = Object.entries(consultas.SQL);
  igual('todas las consultas son SELECT', sqls.filter(([, s]) => !/^\s*SELECT\s/.test(s)).map(([k]) => k), []);
  igual('ninguna escritura ni bloqueo en las lecturas', sqls.filter(([, s]) => /\b(INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|CREATE|FOR UPDATE|FOR SHARE|LOCK)\b/i.test(s)).map(([k]) => k), []);
  igual('sin SELECT *', sqls.filter(([, s]) => /SELECT\s+\*|\.\*/.test(s)).map(([k]) => k), []);
  igual('precio_unitario solo en MOVIMIENTOS (precio de referencia de la propia panadería)', sqls.filter(([, s]) => /precio/i.test(s)).map(([k]) => k), ['MOVIMIENTOS']);
  igual('stock_minimo solo en DISPONIBILIDAD (para el nivel; no se devuelve)', sqls.filter(([, s]) => /stock_minimo/.test(s)).map(([k]) => k), ['DISPONIBILIDAD']);
  igual('sin datos personales ni de ventas: direccion, telefono, email, contrasena, usuario_id, creada_por, cerrada_por, actor_id, ventas, costo',
    sqls.filter(([, s]) => /direccion|telefono|email|contrasena|usuario_id|creada_por|cerrada_por|actor_id|ventas|costo/i.test(s)).map(([k]) => k), []);
  const codigoConsultas = leer('../src/modules/red/red.consultas.js');
  const bloqueSQL = codigoConsultas.slice(codigoConsultas.indexOf('const SQL = Object.freeze({'), codigoConsultas.indexOf('});', codigoConsultas.indexOf('const SQL = Object.freeze({')));
  igual('SQL constante: sin interpolación ${...} en las consultas', /\$\{/.test(bloqueSQL), false);
  igual('disponibilidad: solo materias activas de la otra panadería', /WHERE panaderia_id = :otra AND estado = 1/.test(consultas.SQL.DISPONIBILIDAD), true);
  igual('detalle: líneas y eventos de la solicitud ya autorizada', [/WHERE solicitud_id = :id/.test(consultas.SQL.LINEAS), /WHERE solicitud_id = :id/.test(consultas.SQL.EVENTOS)], [true, true]);
  igual('directorio: solo panaderías en la red o la propia', /WHERE en_red = 1 OR id = :propia/.test(consultas.SQL.DIRECTORIO), true);

  // ---------- Rutas
  console.log('\n== red.routes y app.js');
  // Las rutas de escritura (E1b) se comprueban en red.operaciones.unitarias.js
  const capas = router.stack.filter(c => c.route && c.route.methods.get).map(c => ({ ruta: c.route.path, metodos: Object.keys(c.route.methods), capas: c.route.stack.length }));
  igual('rutas de lectura: 6 GET, cada una con 3 middleware y su controlador', capas, [
    { ruta: '/panaderias', metodos: ['get'], capas: 4 }, { ruta: '/panaderias/:id/disponibilidad', metodos: ['get'], capas: 4 },
    { ruta: '/resumen', metodos: ['get'], capas: 4 }, { ruta: '/solicitudes', metodos: ['get'], capas: 4 },
    { ruta: '/solicitudes/:id', metodos: ['get'], capas: 4 }, { ruta: '/movimientos', metodos: ['get'], capas: 4 }]);
  const verificarToken = require('../src/middlewares/auth.middleware');
  const primera = router.stack.find(c => c.route).route.stack;
  igual('primer middleware: verificarToken', primera[0].handle === verificarToken, true);
  const permite = (rolId) => { let siguio = false; const res = respuesta(); primera[1].handle({ usuario: { rol_id: rolId } }, res, () => { siguio = true; }); return siguio ? 'next' : res.statusCode; };
  igual('lectura permitida a administrador, panadero y gerente; rol desconocido 403', [permite(1), permite(2), permite(3), permite(9)], ['next', 'next', 'next', 403]);
  { const r = { usuario: { panaderia_id: 4 }, query: { panaderia_id: 99 }, body: { panaderia_id: 99 } }; let siguio = false; primera[2].handle(r, respuesta(), () => { siguio = true; }); igual('resolverPanaderia: la panadería sale de la cuenta (4), no del cliente (99)', [siguio, r.panaderiaId], [true, 4]); }
  { const res = respuesta(); let siguio = false; primera[2].handle({ usuario: { panaderia_id: null } }, res, () => { siguio = true; }); igual('cuenta sin panadería -> 403', [siguio, res.statusCode], [false, 403]); }
  const codigoRutas = leer('../src/modules/red/red.routes.js').split(/\r?\n/).filter(l => !l.trim().startsWith('//')).join('\n');
  igual('red.routes.js: resolverPanaderia() sin opciones y en la cadena común de lectura; las 6 GET usan lectura; ninguna PUT, PATCH ni DELETE',
    [/const lectura = \[[^\]]*resolverPanaderia\(\)\]/.test(codigoRutas), (codigoRutas.match(/resolverPanaderia\(/g) ?? []).length === (codigoRutas.match(/resolverPanaderia\(\)/g) ?? []).length,
      /router\.(put|patch|delete)\(/.test(codigoRutas), (codigoRutas.match(/router\.get\('[^']+', \.\.\.lectura, /g) ?? []).length], [true, true, false, 6]);
  const app = leer('../src/app.js');
  igual('app.js monta /api/red con las rutas de la red', [/require\('\.\/modules\/red\/red\.routes'\)/.test(app), /app\.use\('\/api\/red', redRoutes\)/.test(app)], [true, true]);

  const fallos = resultados.filter(r => !r).length;
  console.log(`\nResultado: ${resultados.length - fallos}/${resultados.length} correctas`);
  process.exitCode = fallos ? 1 : 0;
};

main().catch((e) => { console.error('Error en las pruebas:', e); process.exitCode = 1; });
