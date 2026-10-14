// Formatos de presentación en español de Colombia. Las fechas se interpretan siempre en la
// zona horaria de Bogotá (UTC-5, sin horario de verano), sin depender de la del navegador.
const ZONA_HORARIA = 'America/Bogota';

const pesos = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
  maximumFractionDigits: 0
});

// Hasta 4 decimales: es la precisión que maneja el inventario
const numero = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 4 });

// 'en-CA' produce AAAA-MM-DD, cómodo para comparar días
const dia = new Intl.DateTimeFormat('en-CA', {
  timeZone: ZONA_HORARIA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

const fechaHora = new Intl.DateTimeFormat('es-CO', {
  timeZone: ZONA_HORARIA,
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit'
});

export const formatCOP = (valor) => pesos.format(Number(valor) || 0);

export const formatNumber = (valor) => numero.format(Number(valor) || 0);

// Día (AAAA-MM-DD) en Bogotá de una fecha ISO o un Date
export const diaEnBogota = (fecha) => dia.format(new Date(fecha));

// La API envía createdAt en UTC (ISO 8601 con Z); `fecha` de las ventas se guarda en UTC
// y puede caer en el día siguiente, por eso "hoy" se calcula con createdAt.
export const esHoyEnBogota = (fechaISO, ahora = new Date()) => diaEnBogota(fechaISO) === diaEnBogota(ahora);

export const fechaHoraCorta = (fechaISO) => fechaHora.format(new Date(fechaISO));

const fechaCompleta = new Intl.DateTimeFormat('es-CO', {
  timeZone: ZONA_HORARIA,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric'
});

const hora = new Intl.DateTimeFormat('en-US', { timeZone: ZONA_HORARIA, hour: 'numeric', hourCycle: 'h23' });

// "martes, 13 de octubre de 2026" (en Bogotá)
export const fechaLarga = (fecha = new Date()) => fechaCompleta.format(new Date(fecha));

// Saludo según la hora de Bogotá
export const saludo = (fecha = new Date()) => {
  const h = Number(hora.format(new Date(fecha)));
  if (h < 12) return 'Buenos días';
  if (h < 19) return 'Buenas tardes';
  return 'Buenas noches';
};
