import { mensajeError } from './errores';
import { diaEnBogota, esHoyEnBogota, fechaHoraCorta, formatCOP, formatNumber } from './formato';
import { puedeEscribir, ROLES } from './permisos';
import { leerNumero, leerTexto, validar } from './validacion';

describe('formato', () => {
  test('formatCOP muestra pesos colombianos sin decimales', () => {
    expect(formatCOP(3000)).toMatch(/^\$\s?3\.000$/);
    expect(formatCOP(25800.4)).toMatch(/^\$\s?25\.800$/);
    expect(formatCOP(0)).toMatch(/^\$\s?0$/);
  });

  test('formatNumber usa coma decimal y hasta 4 decimales', () => {
    expect(formatNumber(0.125)).toBe('0,125');
    expect(formatNumber(1234.56789)).toBe('1.234,5679');
    expect(formatNumber(10)).toBe('10');
  });

  test('diaEnBogota convierte de UTC a la fecha de Bogotá (UTC-5)', () => {
    expect(diaEnBogota('2026-10-14T04:59:59.000Z')).toBe('2026-10-13');
    expect(diaEnBogota('2026-10-14T05:00:00.000Z')).toBe('2026-10-14');
  });

  test('esHoyEnBogota respeta la medianoche de Bogotá y no la de UTC', () => {
    const ahora = new Date('2026-10-14T03:00:00.000Z'); // 13 de octubre, 22:00 en Bogotá
    expect(esHoyEnBogota('2026-10-14T04:59:59.000Z', ahora)).toBe(true);  // 23:59:59 del 13
    expect(esHoyEnBogota('2026-10-13T05:00:00.000Z', ahora)).toBe(true);  // 00:00 del 13
    expect(esHoyEnBogota('2026-10-14T05:00:00.000Z', ahora)).toBe(false); // 00:00 del 14
    expect(esHoyEnBogota('2026-10-13T04:59:59.000Z', ahora)).toBe(false); // 23:59:59 del 12
  });

  test('fechaHoraCorta muestra la hora de Bogotá', () => {
    expect(fechaHoraCorta('2026-10-14T02:30:00.000Z')).toMatch(/13.*oct.*9:30/i);
  });
});

describe('mensajeError', () => {
  test('usa el mensaje que envía el backend', () => {
    const error = { response: { status: 409, data: { error: 'Stock insuficiente: Torta (disponible 1, solicitado 2)' } } };
    expect(mensajeError(error)).toBe('Stock insuficiente: Torta (disponible 1, solicitado 2)');
  });

  test('distingue un fallo de conexión', () => {
    expect(mensajeError({ request: {} })).toBe('No se pudo conectar con el servidor.');
  });

  test('usa el mensaje por defecto si el backend no envía uno útil', () => {
    expect(mensajeError({ response: { data: { error: '  ' } } }, 'No se pudo guardar')).toBe('No se pudo guardar');
    expect(mensajeError(new Error('x'))).toBe('Ocurrió un error inesperado. Inténtalo de nuevo.');
    expect(mensajeError(undefined)).toBe('Ocurrió un error inesperado. Inténtalo de nuevo.');
  });
});

describe('puedeEscribir (réplica de permitirRoles(ADMINISTRADOR, PANADERO))', () => {
  test('identificadores iguales a los del backend', () => {
    expect(ROLES).toEqual({ ADMINISTRADOR: 1, PANADERO: 2, GERENTE: 3 });
  });

  test('administrador y panadero pueden escribir; gerente no', () => {
    expect(puedeEscribir({ rol_id: 1 })).toBe(true);
    expect(puedeEscribir({ rol_id: 2 })).toBe(true);
    expect(puedeEscribir({ rol_id: 3 })).toBe(false);
  });

  test('sin rol_id o con un tipo distinto no puede escribir (el backend respondería 401 o 403)', () => {
    expect(puedeEscribir({})).toBe(false);
    expect(puedeEscribir(null)).toBe(false);
    expect(puedeEscribir(undefined)).toBe(false);
    expect(puedeEscribir({ rol_id: '1' })).toBe(false);
    expect(puedeEscribir({ rol_id: 4 })).toBe(false);
  });
});

describe('leerTexto', () => {
  test('recorta los espacios de los extremos', () => {
    expect(leerTexto('  Harina de trigo  ')).toEqual({ valor: 'Harina de trigo' });
  });

  test('rechaza textos vacíos, solo espacios o que no son texto', () => {
    expect(leerTexto('')).toHaveProperty('error');
    expect(leerTexto('   ')).toHaveProperty('error');
    expect(leerTexto(null)).toHaveProperty('error');
    expect(leerTexto(12)).toHaveProperty('error');
  });

  test('respeta el máximo de caracteres', () => {
    expect(leerTexto('a'.repeat(255))).toEqual({ valor: 'a'.repeat(255) });
    expect(leerTexto('a'.repeat(256))).toHaveProperty('error');
  });
});

describe('leerNumero', () => {
  test('convierte el texto del formulario en número JSON', () => {
    expect(leerNumero('10')).toEqual({ valor: 10 });
    expect(leerNumero('0')).toEqual({ valor: 0 });
    expect(leerNumero(' 7 ')).toEqual({ valor: 7 });
    expect(leerNumero('12,5')).toEqual({ valor: 12.5 });
    expect(leerNumero('0.1250')).toEqual({ valor: 0.125 });
    expect(leerNumero(12.5)).toEqual({ valor: 12.5 });
  });

  test('nunca devuelve cadenas vacías, null, NaN ni negativos', () => {
    ['', '   ', null, undefined, 'abc', '-3', '1e3', '1.2.3', '.5', '5.', NaN].forEach(entrada => {
      const resultado = leerNumero(entrada);
      expect(resultado).toHaveProperty('error');
      expect(resultado).not.toHaveProperty('valor');
    });
  });

  test('limita los decimales', () => {
    expect(leerNumero('1.2345')).toEqual({ valor: 1.2345 });
    expect(leerNumero('1.23456')).toHaveProperty('error');
    expect(leerNumero('1.23', { decimales: 2 })).toEqual({ valor: 1.23 });
    expect(leerNumero('1.234', { decimales: 2 })).toHaveProperty('error');
  });

  test('entero: solo dígitos', () => {
    expect(leerNumero('15', { entero: true })).toEqual({ valor: 15 });
    expect(leerNumero('1.5', { entero: true })).toHaveProperty('error');
    expect(leerNumero('1,5', { entero: true })).toHaveProperty('error');
  });

  test('respeta el máximo', () => {
    expect(leerNumero('1000000', { maximo: 1000000 })).toEqual({ valor: 1000000 });
    expect(leerNumero('1000000.5', { maximo: 1000000 })).toHaveProperty('error');
  });
});

describe('validar', () => {
  const reglas = {
    nombre: (v) => leerTexto(v),
    cantidad_disponible: (v) => leerNumero(v)
  };

  test('devuelve los datos convertidos cuando todo es válido', () => {
    expect(validar({ nombre: ' Azúcar ', cantidad_disponible: '5' }, reglas)).toEqual({
      datos: { nombre: 'Azúcar', cantidad_disponible: 5 },
      errores: {},
      valido: true
    });
  });

  test('reúne los errores de cada campo', () => {
    const { errores, valido } = validar({ nombre: '', cantidad_disponible: '-1' }, reglas);
    expect(valido).toBe(false);
    expect(Object.keys(errores).sort()).toEqual(['cantidad_disponible', 'nombre']);
  });
});
