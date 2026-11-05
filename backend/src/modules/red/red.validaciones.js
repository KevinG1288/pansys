const { ErrorNegocio } = require('../../utils/errores');
const { parsearId, parsearEntero, parsearCantidad, parsearFecha } = require('../produccion/produccion.validaciones');

// Validación de la entrada de la red colaborativa. Nunca se lee un panaderia_id del cliente: la
// panadería propia es siempre req.panaderiaId (resolverPanaderia, desde la cuenta autenticada).
// Límites del SQL 006: hasta 20 líneas por solicitud (chk_dred_linea), un destino por solicitud
// (uq_dred_destino), cantidad > 0 en DECIMAL(12,4) (chk_dred_cantidad), nota y motivo VARCHAR(255)
// no vacíos (chk_sred_nota, chk_sred_motivo).

const MAX_LINEAS = 20;
const MAX_TEXTO_RED = 255;
const TAMANO_PAGINA = 20;
const MAX_PAGINA = 10000;
const BANDEJAS = ['recibidas', 'enviadas'];
const ESTADOS = ['pendiente', 'aceptada', 'rechazada', 'cancelada'];

// Texto opcional (o requerido) recortado, de como mucho 255 caracteres; vacío = null
const parsearTextoRed = (valor, campo, { requerido = false } = {}) => {
  if (valor === undefined || valor === null || valor === '') {
    if (requerido) throw new ErrorNegocio(`${campo} es requerido`, 400);
    return null;
  }
  if (typeof valor !== 'string') throw new ErrorNegocio(`${campo} debe ser texto`, 400);
  const texto = valor.trim();
  if (!texto) {
    if (requerido) throw new ErrorNegocio(`${campo} es requerido`, 400);
    return null;
  }
  if (texto.length > MAX_TEXTO_RED) throw new ErrorNegocio(`${campo} admite máximo ${MAX_TEXTO_RED} caracteres`, 400);
  return texto;
};

// ---------- Consultas (query string y parámetros de ruta)
const parsearPanaderiaRed = (valor) => parsearId(valor, 'panaderia');
const parsearSolicitudId = (valor) => parsearId(valor, 'solicitud');

const parsearPagina = (valor) => (valor === undefined || valor === '' ? 1 : parsearEntero(valor, 'pagina', 1, MAX_PAGINA));

const parsearFiltrosBandeja = (query = {}) => {
  const bandeja = query.bandeja;
  if (!BANDEJAS.includes(bandeja)) throw new ErrorNegocio(`bandeja debe ser ${BANDEJAS.join(' o ')}`, 400);
  let estado = null;
  if (query.estado !== undefined && query.estado !== '') {
    if (!ESTADOS.includes(query.estado)) throw new ErrorNegocio(`estado debe ser uno de: ${ESTADOS.join(', ')}`, 400);
    estado = query.estado;
  }
  return { bandeja, estado, pagina: parsearPagina(query.pagina) };
};

const parsearFiltrosMovimientos = (query = {}) => {
  const desde = parsearFecha(query.desde, 'desde');
  const hasta = parsearFecha(query.hasta, 'hasta');
  if (desde && hasta && desde > hasta) throw new ErrorNegocio('desde no puede ser posterior a hasta', 400);
  return { desde, hasta, pagina: parsearPagina(query.pagina) };
};

// ---------- Cuerpos de las operaciones de escritura (E1b y E1c; aquí solo se validan)

// Crear: { proveedora_id, nota?, lineas: [{ materia_prima_destino_id, cantidad }] }
// Devuelve las líneas numeradas 1..n con la cantidad en diezmilésimas.
const parsearCrearSolicitud = (cuerpo, panaderiaId) => {
  const datos = cuerpo ?? {};
  const proveedoraId = parsearId(datos.proveedora_id, 'proveedora_id');
  if (proveedoraId === panaderiaId) throw new ErrorNegocio('La panadería proveedora debe ser otra panadería de la red', 400, { codigo: 'MISMA_PANADERIA' });
  const nota = parsearTextoRed(datos.nota, 'nota');
  if (!Array.isArray(datos.lineas) || datos.lineas.length < 1 || datos.lineas.length > MAX_LINEAS) {
    throw new ErrorNegocio(`lineas debe tener entre 1 y ${MAX_LINEAS} elementos`, 400);
  }
  const vistos = new Set();
  const lineas = datos.lineas.map((l, i) => {
    const destino = parsearId(l?.materia_prima_destino_id, `lineas[${i}].materia_prima_destino_id`);
    if (vistos.has(destino)) throw new ErrorNegocio('Cada materia prima de destino solo puede aparecer una vez', 400);
    vistos.add(destino);
    return { linea: i + 1, destino, cantidad: parsearCantidad(l?.cantidad, `lineas[${i}].cantidad`) };
  });
  return { proveedoraId, nota, lineas };
};

// Aceptar: { lineas: [{ detalle_id, materia_prima_origen_id }] } (todas las líneas de la solicitud;
// la correspondencia exacta con las líneas reales se comprueba en la operación)
const parsearAceptarSolicitud = (cuerpo) => {
  const datos = cuerpo ?? {};
  if (!Array.isArray(datos.lineas) || datos.lineas.length < 1 || datos.lineas.length > MAX_LINEAS) {
    throw new ErrorNegocio(`lineas debe tener entre 1 y ${MAX_LINEAS} elementos`, 400);
  }
  const vistos = new Set();
  return {
    lineas: datos.lineas.map((l, i) => {
      const detalleId = parsearId(l?.detalle_id, `lineas[${i}].detalle_id`);
      if (vistos.has(detalleId)) throw new ErrorNegocio('Cada línea solo puede aparecer una vez', 400);
      vistos.add(detalleId);
      return { detalleId, origen: parsearId(l?.materia_prima_origen_id, `lineas[${i}].materia_prima_origen_id`) };
    })
  };
};

// Rechazar: { motivo } obligatorio
const parsearRechazo = (cuerpo) => ({ motivo: parsearTextoRed((cuerpo ?? {}).motivo, 'motivo', { requerido: true }) });

module.exports = {
  MAX_LINEAS, MAX_TEXTO_RED, TAMANO_PAGINA, BANDEJAS, ESTADOS,
  parsearTextoRed, parsearPanaderiaRed, parsearSolicitudId, parsearPagina,
  parsearFiltrosBandeja, parsearFiltrosMovimientos,
  parsearCrearSolicitud, parsearAceptarSolicitud, parsearRechazo
};
