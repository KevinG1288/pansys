const { ErrorNegocio } = require('../../utils/errores');

// Las cantidades se manejan como enteros en diezmilésimas (4 decimales) para que las
// operaciones sean exactas: 0,125 kg -> 1250 unidades.
const ESCALA = 10000;
const MAX_UNIDADES = 999999999999;          // 99.999.999,9999 = máximo de DECIMAL(12,4)
const MAX_CANTIDAD_ORDEN = 100000;
const MAX_TEXTO = 500;
const MAX_ID = 2147483647;

const PATRON_ENTERO = /^\d+$/;
const PATRON_DECIMAL = /^\d+(\.\d{1,4})?$/;
const PATRON_FECHA = /^\d{4}-\d{2}-\d{2}$/;

const ESTADOS_ORDEN = ['en_proceso', 'finalizada', 'cancelada'];

// Convierte un valor DECIMAL(12,4) leído de la BD (número exacto gracias a decimalNumbers)
// a diezmilésimas. Hasta 12 dígitos el resultado es exacto: cabe en un entero seguro de JS.
const aUnidades = (valor) => Math.round(Number(valor) * ESCALA);

const deUnidades = (unidades) => unidades / ESCALA;

// Texto exacto con 4 decimales para columnas DECIMAL(12,4) (unidades >= 0)
const aDecimal4 = (unidades) =>
  `${Math.trunc(unidades / ESCALA)}.${String(unidades % ESCALA).padStart(4, '0')}`;

// Texto exacto con 2 decimales a partir de centavos (BigInt, >= 0): 1234n -> '12.34'
const centavosATexto = (centavos) =>
  `${centavos / 100n}.${String(centavos % 100n).padStart(2, '0')}`;

// Redondeo a centavos (mitad hacia arriba) de un importe en diezmilésimas (BigInt, >= 0)
const diezmilesimasACentavos = (unidades) => (unidades + 50n) / 100n;

// Solo se aceptan números o textos numéricos (no listas, objetos ni booleanos)
const comoTexto = (valor) =>
  (typeof valor === 'number' || typeof valor === 'string') ? String(valor).trim() : '';

const parsearId = (valor, campo) => {
  const texto = comoTexto(valor);
  const id = Number(texto);
  if (!PATRON_ENTERO.test(texto) || id <= 0 || id > MAX_ID) {
    throw new ErrorNegocio(`${campo} inválido`, 400);
  }
  return id;
};

const parsearEntero = (valor, campo, minimo, maximo) => {
  const texto = comoTexto(valor);
  const numero = Number(texto);
  if (!PATRON_ENTERO.test(texto) || numero < minimo || numero > maximo) {
    throw new ErrorNegocio(`${campo} debe ser un número entero entre ${minimo} y ${maximo}`, 400);
  }
  return numero;
};

// Devuelve la cantidad en diezmilésimas
const parsearCantidad = (valor, campo, { permitirCero = false } = {}) => {
  const texto = comoTexto(valor);
  if (!PATRON_DECIMAL.test(texto)) {
    throw new ErrorNegocio(`${campo} debe ser un número no negativo con máximo 4 decimales`, 400);
  }
  const [entero, decimales = ''] = texto.split('.');
  const unidades = Number(entero) * ESCALA + Number(decimales.padEnd(4, '0'));
  if (unidades > MAX_UNIDADES) {
    throw new ErrorNegocio(`${campo} supera el máximo permitido`, 400);
  }
  if (!permitirCero && unidades === 0) {
    throw new ErrorNegocio(`${campo} debe ser mayor que 0`, 400);
  }
  return unidades;
};

const parsearTexto = (valor, campo, { requerido = false } = {}) => {
  if (valor === undefined || valor === null || valor === '') {
    if (requerido) throw new ErrorNegocio(`${campo} es requerido`, 400);
    return null;
  }
  if (typeof valor !== 'string') {
    throw new ErrorNegocio(`${campo} debe ser texto`, 400);
  }
  const texto = valor.trim();
  if (requerido && !texto) throw new ErrorNegocio(`${campo} es requerido`, 400);
  if (texto.length > MAX_TEXTO) {
    throw new ErrorNegocio(`${campo} admite máximo ${MAX_TEXTO} caracteres`, 400);
  }
  return texto || null;
};

const parsearFecha = (valor, campo) => {
  if (valor === undefined || valor === '') return null;
  const texto = typeof valor === 'string' ? valor : '';
  const fecha = new Date(`${texto}T00:00:00Z`);
  if (!PATRON_FECHA.test(texto) || Number.isNaN(fecha.getTime()) || fecha.toISOString().slice(0, 10) !== texto) {
    throw new ErrorNegocio(`${campo} debe tener el formato AAAA-MM-DD`, 400);
  }
  return texto;
};

// Fecha local del servidor en formato AAAA-MM-DD
const fechaHoy = () => {
  const d = new Date();
  const dos = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
};

module.exports = {
  ESTADOS_ORDEN,
  MAX_CANTIDAD_ORDEN,
  MAX_UNIDADES,
  aUnidades,
  deUnidades,
  aDecimal4,
  centavosATexto,
  diezmilesimasACentavos,
  parsearId,
  parsearEntero,
  parsearCantidad,
  parsearTexto,
  parsearFecha,
  fechaHoy
};
