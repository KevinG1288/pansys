const { QueryTypes } = require('sequelize');
const { sequelize } = require('../../models/index');
const { enTransaccion } = require('../../utils/transaccion');
const { exigirPanaderiaId, aDecimal4, aUnidades } = require('../produccion/produccion.validaciones');
const { rechazo } = require('./red.errores');
const redConsultas = require('./red.consultas');

// Escrituras de la red colaborativa (E1b: crear, rechazar y cancelar; E1c: aceptar con transferencia).
// Siguen PASO A PASO el protocolo validado en el ensayo E6 (pruebas/lib/operaciones.js del paquete
// C:\PansysEnsayo\trabajo\sql006, funciones crear y cerrarSinTransferir), con el mismo SQL y el mismo
// orden global de bloqueos:
//   L1 red_parejas (X) -> L2 panaderias (S, por id) -> L3 solicitudes_red (S del rango de pendientes de la
//   pareja; X de la fila) -> L4 materia_prima (S de los destinos, por id) -> L6 inserciones.
// Adaptaciones (sin cambiar el orden ni las comprobaciones): los id son AUTO_INCREMENT (el ensayo los
// fijaba), la solicitud guarda la nota y el rechazo su motivo, y una solicitud puede tener hasta 20 líneas.
// Lecturas previas SIN bloqueo (no forman parte del orden de bloqueos): en crear, la existencia de las
// panaderías (para no provocar un error de clave foránea al insertar la pareja); en rechazar y cancelar,
// las panaderías de la solicitud (columnas que nunca cambian), necesarias para bloquear primero la pareja.
// Todo se vuelve a comprobar bajo bloqueo. Un rechazo deshace la transacción completa (enTransaccion).

const SQL_OP = Object.freeze({
  // Lecturas previas sin bloqueo
  PANADERIAS_PREVIA: 'SELECT id, en_red FROM panaderias WHERE id IN (?, ?)',
  SOLICITUD_PREVIA: 'SELECT id, panaderia_solicitante_id, panaderia_proveedora_id FROM solicitudes_red WHERE id = ? AND (panaderia_solicitante_id = ? OR panaderia_proveedora_id = ?)',
  // Protocolo validado (bloquearParejaYPanaderias)
  INSERTAR_PAREJA: 'INSERT INTO red_parejas (panaderia_menor_id, panaderia_mayor_id, pendientes, createdAt, updatedAt) VALUES (?, ?, 0, NOW(), NOW()) ON DUPLICATE KEY UPDATE updatedAt = updatedAt',
  BLOQUEAR_PAREJA: 'SELECT pendientes FROM red_parejas WHERE panaderia_menor_id = ? AND panaderia_mayor_id = ? FOR UPDATE',
  BLOQUEAR_PANADERIAS: 'SELECT id, en_red FROM panaderias WHERE id IN (?, ?) ORDER BY id FOR SHARE',
  LEER_PENDIENTES: "SELECT id FROM solicitudes_red FORCE INDEX (idx_sred_pareja) WHERE pareja_menor_id = ? AND pareja_mayor_id = ? AND estado = 'pendiente' FOR SHARE",
  // crear
  BLOQUEAR_DESTINOS: 'SELECT id, nombre, unidad_medida, estado FROM materia_prima WHERE id IN (?) AND panaderia_id = ? ORDER BY id FOR SHARE',
  INSERTAR_SOLICITUD: "INSERT INTO solicitudes_red (panaderia_solicitante_id, panaderia_proveedora_id, estado, creada_por, nota, createdAt, updatedAt) VALUES (?, ?, 'pendiente', ?, ?, NOW(), NOW())",
  INSERTAR_DETALLE: 'INSERT INTO solicitudes_red_detalle (solicitud_id, linea, panaderia_solicitante_id, panaderia_proveedora_id, materia_prima_destino_id, materia_prima_origen_id, nombre_solicitado, unidad_medida, cantidad, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, NOW(), NOW())',
  INSERTAR_EVENTO_CREADA: "INSERT INTO eventos_red (solicitud_id, tipo, lado, panaderia_id, actor_id, createdAt) VALUES (?, 'creada', 'solicitante', ?, ?, NOW())",
  CONTADOR_MAS: 'UPDATE red_parejas SET pendientes = pendientes + 1, updatedAt = NOW() WHERE panaderia_menor_id = ? AND panaderia_mayor_id = ?',
  // rechazar y cancelar (cerrarSinTransferir)
  BLOQUEAR_SOLICITUD: 'SELECT id, estado, panaderia_solicitante_id, panaderia_proveedora_id FROM solicitudes_red WHERE id = ? FOR UPDATE',
  CERRAR_RECHAZADA: "UPDATE solicitudes_red SET estado = 'rechazada', motivo_rechazo = ?, cerrada_por = ?, cerrada_en = NOW(), updatedAt = NOW() WHERE id = ? AND estado = 'pendiente'",
  CERRAR_CANCELADA: "UPDATE solicitudes_red SET estado = 'cancelada', cerrada_por = ?, cerrada_en = NOW(), updatedAt = NOW() WHERE id = ? AND estado = 'pendiente'",
  INSERTAR_EVENTO_CIERRE: 'INSERT INTO eventos_red (solicitud_id, tipo, lado, panaderia_id, actor_id, createdAt) VALUES (?, ?, ?, ?, ?, NOW())',
  CONTADOR_MENOS: 'UPDATE red_parejas SET pendientes = pendientes - 1, updatedAt = NOW() WHERE panaderia_menor_id = ? AND panaderia_mayor_id = ?',
  // aceptar (E1c). Lecturas sin bloqueo: los orígenes indicados deben ser de la proveedora antes de bloquear
  // nada (no se bloquean filas de otras panaderías con datos del cliente) y las líneas de la solicitud,
  // leídas con la solicitud ya bloqueada (X), antes de L4.
  ORIGENES_PREVIA: 'SELECT id FROM materia_prima WHERE id IN (?) AND panaderia_id = ?',
  LINEAS_SOLICITUD: 'SELECT id, linea, materia_prima_destino_id, materia_prima_origen_id, cantidad FROM solicitudes_red_detalle WHERE solicitud_id = ? ORDER BY linea',
  // Protocolo validado (aceptar de operaciones.js)
  BLOQUEAR_SOLICITUD_ACEPTAR: 'SELECT id, estado, panaderia_proveedora_id FROM solicitudes_red WHERE id = ? FOR UPDATE',
  BLOQUEAR_MATERIAS: 'SELECT id, panaderia_id, unidad_medida, estado, cantidad_disponible, precio_unitario, version_fila FROM materia_prima WHERE id IN (?) ORDER BY id FOR UPDATE',
  FIJAR_ORIGEN: 'UPDATE solicitudes_red_detalle SET materia_prima_origen_id = ?, updatedAt = NOW() WHERE id = ? AND solicitud_id = ? AND materia_prima_origen_id IS NULL',
  DESCONTAR: 'UPDATE materia_prima SET cantidad_disponible = cantidad_disponible - ?, version_fila = version_fila + 1, updatedAt = NOW() WHERE id = ? AND panaderia_id = ? AND estado = 1 AND version_fila = ? AND version_fila < 4294967294 AND cantidad_disponible >= ?',
  SUMAR: 'UPDATE materia_prima SET cantidad_disponible = cantidad_disponible + ?, version_fila = version_fila + 1, updatedAt = NOW() WHERE id = ? AND panaderia_id = ? AND estado = 1 AND version_fila = ? AND version_fila < 4294967294 AND cantidad_disponible <= 99999999.9999 - ?',
  INSERTAR_MOV_SALIDA: "INSERT INTO movimientos_red (detalle_id, tipo, panaderia_id, materia_prima_id, cantidad, saldo_anterior, saldo_posterior, precio_unitario_referencia, usuario_id, createdAt) VALUES (?, 'salida', ?, ?, ?, ?, ?, ?, ?, NOW())",
  INSERTAR_MOV_ENTRADA: "INSERT INTO movimientos_red (detalle_id, tipo, panaderia_id, materia_prima_id, cantidad, saldo_anterior, saldo_posterior, precio_unitario_referencia, usuario_id, createdAt) VALUES (?, 'entrada', ?, ?, ?, ?, ?, ?, ?, NOW())",
  CERRAR_ACEPTADA: "UPDATE solicitudes_red SET estado = 'aceptada', cerrada_por = ?, cerrada_en = NOW(), updatedAt = NOW() WHERE id = ? AND estado = 'pendiente'",
  INSERTAR_EVENTO_ACEPTADA: "INSERT INTO eventos_red (solicitud_id, tipo, lado, panaderia_id, actor_id, createdAt) VALUES (?, 'aceptada', 'proveedora', ?, ?, NOW())"
});

const LIMITE_VERSION = 4294967294;       // chk_materia_prima_version_fila (< 4294967295): la última versión válida
const MAX_UNIDADES = 999999999999;       // 99.999.999,9999 en diezmilésimas (DECIMAL(12,4))

const LIMITE_PENDIENTES = 10;            // chk_rpar_pendientes (pendientes <= 10)
const par = (a, b) => (a < b ? [a, b] : [b, a]);

// Acceso a la base dentro de la transacción t (toda sentencia lleva la transacción)
const conTransaccion = (t) => ({
  leer: (sql, replacements) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction: t }),
  insertar: async (sql, replacements) => {
    const [id, filas] = await sequelize.query(sql, { replacements, type: QueryTypes.INSERT, transaction: t });
    return { id, filas };
  },
  actualizar: async (sql, replacements) => {
    const [, filas] = await sequelize.query(sql, { replacements, type: QueryTypes.UPDATE, transaction: t });
    return filas;
  }
});

// exigeFilas del protocolo: una escritura que no afecta exactamente a las filas previstas es un error
// interno (la transacción se deshace)
const exigirFilas = (filas, esperadas, paso) => {
  if (filas !== esperadas) throw new Error(`Red colaborativa: ${paso} afectó ${filas} filas (se esperaban ${esperadas})`);
};

// L1 y L2 y recuento de pendientes (bloquearParejaYPanaderias del protocolo)
async function bloquearParejaYPanaderias(db, menor, mayor, { insertar = false } = {}) {
  if (insertar) await db.insertar(SQL_OP.INSERTAR_PAREJA, [menor, mayor]);
  const pareja = await db.leer(SQL_OP.BLOQUEAR_PAREJA, [menor, mayor]);
  if (pareja.length !== 1) throw rechazo('PAREJA_INEXISTENTE');
  const panaderias = await db.leer(SQL_OP.BLOQUEAR_PANADERIAS, [menor, mayor]);
  const pendientes = await db.leer(SQL_OP.LEER_PENDIENTES, [menor, mayor]);
  if (Number(pareja[0].pendientes) !== pendientes.length) {
    // El contador debe coincidir con las pendientes reales: si no, es un fallo de integridad (no se toca nada)
    throw rechazo('CONTADOR_DESCUADRADO');
  }
  return { panaderias, pendientes };
}

const enRed = (panaderias) => panaderias.length === 2 && panaderias.every(p => Number(p.en_red) === 1);

class RedOperaciones {

  // Crear una solicitud desde la panadería propia (solicitante) hacia otra de la red (proveedora)
  async crear({ panaderiaId, actorId, proveedoraId, nota, lineas }) {
    const sol = exigirPanaderiaId(panaderiaId);
    const prov = proveedoraId;
    if (prov === sol) throw rechazo('MISMA_PANADERIA');
    const [menor, mayor] = par(sol, prov);
    const destinos = [...new Set(lineas.map(l => l.destino))];
    if (destinos.length !== lineas.length) throw new Error('Red colaborativa: líneas sin validar (destinos repetidos)');

    const solicitudId = await enTransaccion(sequelize, async (t) => {
      const db = conTransaccion(t);
      // Previa sin bloqueo: la proveedora debe existir y estar en la red (si no, 404 sin revelar cuál falla)
      const previa = await db.leer(SQL_OP.PANADERIAS_PREVIA, [sol, prov]);
      const yo = previa.find(p => Number(p.id) === sol);
      const otra = previa.find(p => Number(p.id) === prov);
      if (!yo || Number(yo.en_red) !== 1) throw rechazo('FUERA_DE_RED');
      if (!otra || Number(otra.en_red) !== 1) throw rechazo('PANADERIA_NO_ENCONTRADA');

      // Protocolo validado
      const { panaderias, pendientes } = await bloquearParejaYPanaderias(db, menor, mayor, { insertar: true });
      if (!enRed(panaderias)) throw rechazo('FUERA_DE_RED');
      if (pendientes.length >= LIMITE_PENDIENTES) throw rechazo('LIMITE_PENDIENTES');
      const filasDestino = await db.leer(SQL_OP.BLOQUEAR_DESTINOS, [destinos, sol]);
      const porId = new Map(filasDestino.map(m => [Number(m.id), m]));
      if (filasDestino.length !== destinos.length || !destinos.every(d => porId.has(d) && Number(porId.get(d).estado) === 1)) {
        throw rechazo('MATERIA_INACTIVA_O_AJENA');
      }
      const solicitud = await db.insertar(SQL_OP.INSERTAR_SOLICITUD, [sol, prov, actorId, nota ?? null]);
      exigirFilas(solicitud.filas, 1, 'insertar_solicitud');
      for (const l of lineas) {
        const m = porId.get(l.destino);
        const detalle = await db.insertar(SQL_OP.INSERTAR_DETALLE, [solicitud.id, l.linea, sol, prov, l.destino, m.nombre, m.unidad_medida, aDecimal4(l.cantidad)]);
        exigirFilas(detalle.filas, 1, `insertar_detalle linea ${l.linea}`);
      }
      const evento = await db.insertar(SQL_OP.INSERTAR_EVENTO_CREADA, [solicitud.id, sol, actorId]);
      exigirFilas(evento.filas, 1, 'insertar_evento');
      exigirFilas(await db.actualizar(SQL_OP.CONTADOR_MAS, [menor, mayor]), 1, 'contador_mas');
      return solicitud.id;
    });
    return redConsultas.detalle(sol, solicitudId);
  }

  // Rechazar (solo la proveedora) o cancelar (solo la solicitante) una solicitud pendiente, sin tocar
  // el inventario (cerrarSinTransferir del protocolo)
  async cerrar({ panaderiaId, actorId, solicitudId, tipo, motivo }) {
    const propia = exigirPanaderiaId(panaderiaId);
    if (tipo !== 'rechazada' && tipo !== 'cancelada') throw new Error(`Red colaborativa: cierre no válido ${tipo}`);
    if (tipo === 'rechazada' && !motivo) throw new Error('Red colaborativa: rechazo sin motivo validado');

    await enTransaccion(sequelize, async (t) => {
      const db = conTransaccion(t);
      // Previa sin bloqueo: panaderías de la solicitud (no cambian nunca). Ajena -> 404 sin revelarla.
      const [previa] = await db.leer(SQL_OP.SOLICITUD_PREVIA, [solicitudId, propia, propia]);
      if (!previa) throw rechazo('SOLICITUD_NO_ENCONTRADA');
      const sol = Number(previa.panaderia_solicitante_id);
      const prov = Number(previa.panaderia_proveedora_id);
      if (tipo === 'rechazada' && prov !== propia) throw rechazo('LADO_NO_AUTORIZADO', { accion: 'rechazar' });
      if (tipo === 'cancelada' && sol !== propia) throw rechazo('LADO_NO_AUTORIZADO', { accion: 'cancelar' });
      const [menor, mayor] = par(sol, prov);

      // Protocolo validado
      await bloquearParejaYPanaderias(db, menor, mayor);
      const filas = await db.leer(SQL_OP.BLOQUEAR_SOLICITUD, [solicitudId]);
      if (filas.length !== 1 || filas[0].estado !== 'pendiente') throw rechazo('YA_CERRADA');
      if (Number(filas[0].panaderia_solicitante_id) !== sol || Number(filas[0].panaderia_proveedora_id) !== prov) {
        throw new Error('Red colaborativa: las panaderías de la solicitud cambiaron');
      }
      const cerradas = tipo === 'rechazada'
        ? await db.actualizar(SQL_OP.CERRAR_RECHAZADA, [motivo, actorId, solicitudId])
        : await db.actualizar(SQL_OP.CERRAR_CANCELADA, [actorId, solicitudId]);
      exigirFilas(cerradas, 1, 'cerrar');
      const lado = tipo === 'cancelada' ? 'solicitante' : 'proveedora';
      const panaderiaActor = tipo === 'cancelada' ? sol : prov;
      const evento = await db.insertar(SQL_OP.INSERTAR_EVENTO_CIERRE, [solicitudId, tipo, lado, panaderiaActor, actorId]);
      exigirFilas(evento.filas, 1, 'evento_cierre');
      exigirFilas(await db.actualizar(SQL_OP.CONTADOR_MENOS, [menor, mayor]), 1, 'contador_menos');
    });
    return redConsultas.detalle(propia, solicitudId);
  }

  // Aceptar una solicitud recibida (solo la proveedora) y transferir el inventario de forma atómica
  // (aceptar del protocolo). lineasCliente: [{ detalleId, origen }] para TODAS las líneas de la solicitud;
  // el cliente solo elige la materia de origen de cada línea: destino, cantidad y panaderías salen de la base.
  async aceptar({ panaderiaId, actorId, solicitudId, lineas: lineasCliente }) {
    const propia = exigirPanaderiaId(panaderiaId);
    const origenesCliente = [...new Set(lineasCliente.map(l => l.origen))];

    await enTransaccion(sequelize, async (t) => {
      const db = conTransaccion(t);
      // Previas sin bloqueo
      const [previa] = await db.leer(SQL_OP.SOLICITUD_PREVIA, [solicitudId, propia, propia]);
      if (!previa) throw rechazo('SOLICITUD_NO_ENCONTRADA');
      const sol = Number(previa.panaderia_solicitante_id);
      const prov = Number(previa.panaderia_proveedora_id);
      if (prov !== propia) throw rechazo('LADO_NO_AUTORIZADO', { accion: 'aceptar' });
      const propiosPrevia = await db.leer(SQL_OP.ORIGENES_PREVIA, [origenesCliente, prov]);
      if (propiosPrevia.length !== origenesCliente.length) throw rechazo('ORIGEN_NO_VALIDO');
      const [menor, mayor] = par(sol, prov);

      // Protocolo validado: L1, L2 y pendientes (L3 S)
      const { panaderias } = await bloquearParejaYPanaderias(db, menor, mayor);
      if (!enRed(panaderias)) throw rechazo('FUERA_DE_RED');
      // L3 X: la solicitud
      const filas = await db.leer(SQL_OP.BLOQUEAR_SOLICITUD_ACEPTAR, [solicitudId]);
      if (filas.length !== 1 || filas[0].estado !== 'pendiente') throw rechazo('YA_CERRADA');
      if (Number(filas[0].panaderia_proveedora_id) !== prov) throw new Error('Red colaborativa: la proveedora de la solicitud cambió');

      // Líneas reales (con la solicitud bloqueada): el cliente debe indicar exactamente esas líneas
      const lineasDb = await db.leer(SQL_OP.LINEAS_SOLICITUD, [solicitudId]);
      const origenDe = new Map(lineasCliente.map(l => [l.detalleId, l.origen]));
      if (lineasDb.length === 0 || lineasDb.length !== lineasCliente.length || !lineasDb.every(l => origenDe.has(Number(l.id)))) {
        throw rechazo('LINEAS_NO_COINCIDEN');
      }
      if (lineasDb.some(l => l.materia_prima_origen_id !== null)) throw new Error('Red colaborativa: línea pendiente con origen ya fijado');
      const lineas = lineasDb.map(l => ({ did: Number(l.id), linea: Number(l.linea), destino: Number(l.materia_prima_destino_id), origen: origenDe.get(Number(l.id)), unidades: aUnidades(l.cantidad) }));

      // L4: todas las materias (orígenes y destinos) en UNA sentencia, por id
      const ids = [...new Set(lineas.flatMap(l => [l.destino, l.origen]))].sort((a, b) => a - b);
      const materias = await db.leer(SQL_OP.BLOQUEAR_MATERIAS, [ids]);
      const m = new Map(materias.map(x => [Number(x.id), x]));

      // Comprobaciones del protocolo (antes de escribir nada)
      const salida = new Map(); const entrada = new Map();
      for (const l of lineas) {
        const o = m.get(l.origen); const d = m.get(l.destino);
        if (!o || Number(o.panaderia_id) !== prov || Number(o.estado) !== 1) throw rechazo('ORIGEN_NO_VALIDO', { linea: l.linea });
        if (!d || Number(d.panaderia_id) !== sol || Number(d.estado) !== 1) throw rechazo('DESTINO_NO_VALIDO', { linea: l.linea });
        if (o.unidad_medida !== d.unidad_medida) throw rechazo('UNIDAD_DISTINTA', { linea: l.linea });
        if (entrada.has(l.destino)) throw new Error('Red colaborativa: destino repetido en una solicitud (uq_dred_destino)');
        salida.set(l.origen, (salida.get(l.origen) || 0) + l.unidades);
        entrada.set(l.destino, l.unidades);
      }
      const insuficientes = [...salida].filter(([o, total]) => aUnidades(m.get(o).cantidad_disponible) < total).map(([o]) => o);
      if (insuficientes.length) throw rechazo('INSUFICIENTE', { lineas: lineas.filter(l => insuficientes.includes(l.origen)).map(l => l.linea) });
      if ([...entrada].some(([d, x]) => aUnidades(m.get(d).cantidad_disponible) + x > MAX_UNIDADES)) throw rechazo('TOPE');
      if ([...salida.keys(), ...entrada.keys()].some(id => Number(m.get(id).version_fila) >= LIMITE_VERSION)) throw rechazo('VERSION_AGOTADA');

      // Escrituras, en el orden del protocolo; cada una exige exactamente 1 fila
      for (const l of lineas) exigirFilas(await db.actualizar(SQL_OP.FIJAR_ORIGEN, [l.origen, l.did, solicitudId]), 1, `fijar_origen ${l.did}`);
      for (const o of [...salida.keys()].sort((a, b) => a - b)) {
        const total = aDecimal4(salida.get(o));
        exigirFilas(await db.actualizar(SQL_OP.DESCONTAR, [total, o, prov, Number(m.get(o).version_fila), total]), 1, `descontar ${o}`);
      }
      for (const d of [...entrada.keys()].sort((a, b) => a - b)) {
        const x = aDecimal4(entrada.get(d));
        exigirFilas(await db.actualizar(SQL_OP.SUMAR, [x, d, sol, Number(m.get(d).version_fila), x]), 1, `sumar ${d}`);
      }
      const restante = new Map([...salida.keys()].map(o => [o, aUnidades(m.get(o).cantidad_disponible)]));
      for (const l of lineas) {
        const precio = aDecimal4(aUnidades(m.get(l.origen).precio_unitario));
        const antesO = restante.get(l.origen); restante.set(l.origen, antesO - l.unidades);
        const antesD = aUnidades(m.get(l.destino).cantidad_disponible);
        const s = await db.insertar(SQL_OP.INSERTAR_MOV_SALIDA, [l.did, prov, l.origen, aDecimal4(l.unidades), aDecimal4(antesO), aDecimal4(antesO - l.unidades), precio, actorId]);
        exigirFilas(s.filas, 1, `mov_salida ${l.did}`);
        const e = await db.insertar(SQL_OP.INSERTAR_MOV_ENTRADA, [l.did, sol, l.destino, aDecimal4(l.unidades), aDecimal4(antesD), aDecimal4(antesD + l.unidades), precio, actorId]);
        exigirFilas(e.filas, 1, `mov_entrada ${l.did}`);
      }
      exigirFilas(await db.actualizar(SQL_OP.CERRAR_ACEPTADA, [actorId, solicitudId]), 1, 'cerrar_aceptada');
      const evento = await db.insertar(SQL_OP.INSERTAR_EVENTO_ACEPTADA, [solicitudId, prov, actorId]);
      exigirFilas(evento.filas, 1, 'evento_aceptada');
      exigirFilas(await db.actualizar(SQL_OP.CONTADOR_MENOS, [menor, mayor]), 1, 'contador_menos');
    });
    return redConsultas.detalle(propia, solicitudId);
  }

  rechazar({ panaderiaId, actorId, solicitudId, motivo }) {
    return this.cerrar({ panaderiaId, actorId, solicitudId, tipo: 'rechazada', motivo });
  }

  cancelar({ panaderiaId, actorId, solicitudId }) {
    return this.cerrar({ panaderiaId, actorId, solicitudId, tipo: 'cancelada' });
  }
}

module.exports = new RedOperaciones();
module.exports.SQL_OP = SQL_OP;
module.exports.LIMITE_PENDIENTES = LIMITE_PENDIENTES;
module.exports.LIMITE_VERSION = LIMITE_VERSION;
