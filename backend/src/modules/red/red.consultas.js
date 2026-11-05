const { QueryTypes } = require('sequelize');
const { sequelize } = require('../../models/index');
const { exigirPanaderiaId, aUnidades } = require('../produccion/produccion.validaciones');
const { rechazo } = require('./red.errores');
const { TAMANO_PAGINA } = require('./red.validaciones');

// Lecturas de la red colaborativa (SOLO SELECT, sin bloqueos). Reglas:
// - la panadería propia es siempre la de la cuenta autenticada (req.panaderiaId), nunca del cliente;
// - SQL constante con reemplazos con nombre (ningún dato del cliente se concatena);
// - listas blancas de columnas: de otra panadería solo se comparten id, nombre y localidad, y de sus
//   materias primas id, nombre, unidad, cantidad disponible y un nivel calculado aquí. Nunca precios,
//   costos, stock mínimo, ventas, direcciones, teléfonos ni datos de cuentas;
// - movimientos solo de la panadería propia, y su precio de referencia solo en las salidas (en las
//   entradas es el precio de la proveedora, otra panadería).

const leer = (sql, replacements) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT });

// Nivel de disponibilidad, calculado en el servidor con aritmética exacta (diezmilésimas)
const nivelDisponibilidad = (cantidad, stockMinimo) => {
  const c = aUnidades(cantidad);
  if (c <= 0) return 'agotado';
  return c <= aUnidades(stockMinimo) ? 'bajo' : 'disponible';
};

const SQL = Object.freeze({
  DIRECTORIO: 'SELECT id, nombre, localidad, en_red FROM panaderias WHERE en_red = 1 OR id = :propia ORDER BY nombre, id',
  PANADERIAS_PAR: 'SELECT id, nombre, localidad, en_red FROM panaderias WHERE id IN (:propia, :otra)',
  DISPONIBILIDAD: 'SELECT id, nombre, unidad_medida, cantidad_disponible, stock_minimo FROM materia_prima WHERE panaderia_id = :otra AND estado = 1 ORDER BY nombre, id',
  RESUMEN: `SELECT
      (SELECT COUNT(*) FROM solicitudes_red WHERE panaderia_proveedora_id = :propia AND estado = 'pendiente') AS recibidas_pendientes,
      (SELECT COUNT(*) FROM solicitudes_red WHERE panaderia_solicitante_id = :propia AND estado = 'pendiente') AS enviadas_pendientes,
      (SELECT COUNT(*) FROM solicitudes_red WHERE (panaderia_solicitante_id = :propia OR panaderia_proveedora_id = :propia)
         AND estado = 'aceptada' AND cerrada_en >= NOW() - INTERVAL 30 DAY) AS transferencias_30_dias`,
  BANDEJA_RECIBIDAS: `SELECT s.id, s.estado, s.nota, s.motivo_rechazo, s.createdAt AS creada_en, s.cerrada_en,
      c.id AS contraparte_id, c.nombre AS contraparte_nombre, c.localidad AS contraparte_localidad,
      (SELECT COUNT(*) FROM solicitudes_red_detalle d WHERE d.solicitud_id = s.id) AS lineas
    FROM solicitudes_red s JOIN panaderias c ON c.id = s.panaderia_solicitante_id
    WHERE s.panaderia_proveedora_id = :propia AND (:estado IS NULL OR s.estado = :estado)
    ORDER BY s.createdAt DESC, s.id DESC LIMIT :limite OFFSET :desplazamiento`,
  TOTAL_RECIBIDAS: 'SELECT COUNT(*) AS total FROM solicitudes_red s WHERE s.panaderia_proveedora_id = :propia AND (:estado IS NULL OR s.estado = :estado)',
  BANDEJA_ENVIADAS: `SELECT s.id, s.estado, s.nota, s.motivo_rechazo, s.createdAt AS creada_en, s.cerrada_en,
      c.id AS contraparte_id, c.nombre AS contraparte_nombre, c.localidad AS contraparte_localidad,
      (SELECT COUNT(*) FROM solicitudes_red_detalle d WHERE d.solicitud_id = s.id) AS lineas
    FROM solicitudes_red s JOIN panaderias c ON c.id = s.panaderia_proveedora_id
    WHERE s.panaderia_solicitante_id = :propia AND (:estado IS NULL OR s.estado = :estado)
    ORDER BY s.createdAt DESC, s.id DESC LIMIT :limite OFFSET :desplazamiento`,
  TOTAL_ENVIADAS: 'SELECT COUNT(*) AS total FROM solicitudes_red s WHERE s.panaderia_solicitante_id = :propia AND (:estado IS NULL OR s.estado = :estado)',
  SOLICITUD: `SELECT s.id, s.estado, s.panaderia_solicitante_id, s.panaderia_proveedora_id, s.nota, s.motivo_rechazo,
      s.createdAt AS creada_en, s.cerrada_en,
      ps.nombre AS solicitante_nombre, ps.localidad AS solicitante_localidad,
      pp.nombre AS proveedora_nombre, pp.localidad AS proveedora_localidad
    FROM solicitudes_red s
      JOIN panaderias ps ON ps.id = s.panaderia_solicitante_id
      JOIN panaderias pp ON pp.id = s.panaderia_proveedora_id
    WHERE s.id = :id AND (s.panaderia_solicitante_id = :propia OR s.panaderia_proveedora_id = :propia)`,
  LINEAS: `SELECT id, linea, nombre_solicitado, unidad_medida, cantidad, materia_prima_destino_id, materia_prima_origen_id
    FROM solicitudes_red_detalle WHERE solicitud_id = :id ORDER BY linea`,
  EVENTOS: 'SELECT tipo, lado, createdAt AS fecha FROM eventos_red WHERE solicitud_id = :id ORDER BY createdAt, id',
  // El protocolo validado guarda en AMBOS movimientos el precio de la materia de ORIGEN (de la proveedora):
  // solo se devuelve en las salidas (precio propio); en las entradas sería el precio de otra panadería.
  MOVIMIENTOS: `SELECT m.id, m.tipo, m.materia_prima_id, mp.nombre AS materia_nombre, mp.unidad_medida, m.cantidad,
      m.saldo_anterior, m.saldo_posterior, CASE WHEN m.tipo = 'salida' THEN m.precio_unitario_referencia ELSE NULL END AS precio_unitario_referencia,
      m.createdAt AS fecha, d.solicitud_id
    FROM movimientos_red m
      JOIN materia_prima mp ON mp.id = m.materia_prima_id AND mp.panaderia_id = m.panaderia_id
      JOIN solicitudes_red_detalle d ON d.id = m.detalle_id
    WHERE m.panaderia_id = :propia
      AND (:desde IS NULL OR m.createdAt >= :desde)
      AND (:hasta IS NULL OR m.createdAt < DATE_ADD(:hasta, INTERVAL 1 DAY))
    ORDER BY m.createdAt DESC, m.id DESC LIMIT :limite OFFSET :desplazamiento`,
  TOTAL_MOVIMIENTOS: `SELECT COUNT(*) AS total FROM movimientos_red m WHERE m.panaderia_id = :propia
      AND (:desde IS NULL OR m.createdAt >= :desde)
      AND (:hasta IS NULL OR m.createdAt < DATE_ADD(:hasta, INTERVAL 1 DAY))`
});

const paginacion = (pagina) => ({ limite: TAMANO_PAGINA, desplazamiento: (pagina - 1) * TAMANO_PAGINA });
const panaderiaPublica = (id, nombre, localidad) => ({ id: Number(id), nombre, localidad: localidad ?? null });

class RedConsultas {

  // Directorio: panaderías en la red y la propia (aunque no esté en la red)
  async directorio(panaderiaId) {
    const propia = exigirPanaderiaId(panaderiaId);
    const filas = await leer(SQL.DIRECTORIO, { propia });
    return filas.map(p => ({ ...panaderiaPublica(p.id, p.nombre, p.localidad), en_red: Number(p.en_red) === 1, es_propia: Number(p.id) === propia }));
  }

  // Disponibilidad de otra panadería de la red. Las dos deben estar en la red. Una panadería que no
  // existe o que no está en la red responde igual (404), para no revelar cuáles existen.
  async disponibilidad(panaderiaId, otraId) {
    const propia = exigirPanaderiaId(panaderiaId);
    if (otraId === propia) throw rechazo('MISMA_PANADERIA');
    const par = await leer(SQL.PANADERIAS_PAR, { propia, otra: otraId });
    const yo = par.find(p => Number(p.id) === propia);
    const otra = par.find(p => Number(p.id) === otraId);
    if (!yo || Number(yo.en_red) !== 1) throw rechazo('FUERA_DE_RED');
    if (!otra || Number(otra.en_red) !== 1) throw rechazo('PANADERIA_NO_ENCONTRADA');
    const materias = await leer(SQL.DISPONIBILIDAD, { otra: otraId });
    return {
      panaderia: panaderiaPublica(otra.id, otra.nombre, otra.localidad),
      materias: materias.map(m => ({
        id: Number(m.id), nombre: m.nombre, unidad_medida: m.unidad_medida,
        cantidad_disponible: m.cantidad_disponible, nivel: nivelDisponibilidad(m.cantidad_disponible, m.stock_minimo)
      }))
    };
  }

  async resumen(panaderiaId) {
    const propia = exigirPanaderiaId(panaderiaId);
    const [r] = await leer(SQL.RESUMEN, { propia });
    return {
      recibidas_pendientes: Number(r?.recibidas_pendientes ?? 0),
      enviadas_pendientes: Number(r?.enviadas_pendientes ?? 0),
      transferencias_30_dias: Number(r?.transferencias_30_dias ?? 0)
    };
  }

  // Bandeja de recibidas (la propia es la proveedora) o enviadas (la propia es la solicitante)
  async bandeja(panaderiaId, { bandeja, estado, pagina }) {
    const propia = exigirPanaderiaId(panaderiaId);
    const recibidas = bandeja === 'recibidas';
    if (!recibidas && bandeja !== 'enviadas') throw new Error(`Bandeja no validada: ${bandeja}`);
    const filtros = { propia, estado: estado ?? null };
    const [filas, [total]] = await Promise.all([
      leer(recibidas ? SQL.BANDEJA_RECIBIDAS : SQL.BANDEJA_ENVIADAS, { ...filtros, ...paginacion(pagina) }),
      leer(recibidas ? SQL.TOTAL_RECIBIDAS : SQL.TOTAL_ENVIADAS, filtros)
    ]);
    return {
      bandeja, estado: estado ?? null, pagina, tamano_pagina: TAMANO_PAGINA, total: Number(total?.total ?? 0),
      solicitudes: filas.map(s => ({
        id: Number(s.id), estado: s.estado, nota: s.nota, motivo_rechazo: s.motivo_rechazo,
        creada_en: s.creada_en, cerrada_en: s.cerrada_en, lineas: Number(s.lineas),
        contraparte: panaderiaPublica(s.contraparte_id, s.contraparte_nombre, s.contraparte_localidad)
      }))
    };
  }

  // Detalle de una solicitud en la que participa la panadería propia (si no, 404)
  async detalle(panaderiaId, solicitudId) {
    const propia = exigirPanaderiaId(panaderiaId);
    const [s] = await leer(SQL.SOLICITUD, { id: solicitudId, propia });
    if (!s) throw rechazo('SOLICITUD_NO_ENCONTRADA');
    const [lineas, eventos] = await Promise.all([leer(SQL.LINEAS, { id: solicitudId }), leer(SQL.EVENTOS, { id: solicitudId })]);
    return {
      id: Number(s.id), estado: s.estado,
      rol: Number(s.panaderia_proveedora_id) === propia ? 'proveedora' : 'solicitante',
      solicitante: panaderiaPublica(s.panaderia_solicitante_id, s.solicitante_nombre, s.solicitante_localidad),
      proveedora: panaderiaPublica(s.panaderia_proveedora_id, s.proveedora_nombre, s.proveedora_localidad),
      nota: s.nota, motivo_rechazo: s.motivo_rechazo, creada_en: s.creada_en, cerrada_en: s.cerrada_en,
      lineas: lineas.map(l => ({
        id: Number(l.id), linea: Number(l.linea), nombre: l.nombre_solicitado, unidad_medida: l.unidad_medida,
        cantidad: l.cantidad, materia_prima_destino_id: Number(l.materia_prima_destino_id),
        materia_prima_origen_id: l.materia_prima_origen_id === null ? null : Number(l.materia_prima_origen_id)
      })),
      eventos: eventos.map(e => ({ tipo: e.tipo, lado: e.lado, fecha: e.fecha }))
    };
  }

  // Historial de movimientos de la panadería propia
  async movimientos(panaderiaId, { desde, hasta, pagina }) {
    const propia = exigirPanaderiaId(panaderiaId);
    const filtros = { propia, desde: desde ?? null, hasta: hasta ?? null };
    const [filas, [total]] = await Promise.all([
      leer(SQL.MOVIMIENTOS, { ...filtros, ...paginacion(pagina) }),
      leer(SQL.TOTAL_MOVIMIENTOS, filtros)
    ]);
    return {
      desde: desde ?? null, hasta: hasta ?? null, pagina, tamano_pagina: TAMANO_PAGINA, total: Number(total?.total ?? 0),
      movimientos: filas.map(m => ({
        id: Number(m.id), tipo: m.tipo, materia_prima_id: Number(m.materia_prima_id), materia_nombre: m.materia_nombre,
        unidad_medida: m.unidad_medida, cantidad: m.cantidad, saldo_anterior: m.saldo_anterior, saldo_posterior: m.saldo_posterior,
        precio_unitario_referencia: m.precio_unitario_referencia, fecha: m.fecha, solicitud_id: Number(m.solicitud_id)
      }))
    };
  }
}

module.exports = new RedConsultas();
module.exports.SQL = SQL;
module.exports.nivelDisponibilidad = nivelDisponibilidad;
