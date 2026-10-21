// Lectura de campos de formulario. Devuelven { valor } listo para enviar o { error } para mostrar;
// nunca devuelven cadenas vacías, null, NaN ni números negativos.

const MENSAJE_OBLIGATORIO = 'Este campo es obligatorio';

// Máximo de las columnas DECIMAL(12,4) de materia_prima (cantidades y precio), igual que el backend
export const MAXIMO_DECIMAL_12_4 = 99999999.9999;

// Texto: recorta los espacios de los extremos
export const leerTexto = (entrada, { obligatorio = true, maximo = 255 } = {}) => {
  const texto = typeof entrada === 'string' ? entrada.trim() : '';
  if (obligatorio && !texto) return { error: MENSAJE_OBLIGATORIO };
  if (texto.length > maximo) return { error: `Máximo ${maximo} caracteres` };
  return { valor: texto };
};

// Número ≥ 0 escrito en el formulario (acepta coma o punto decimal) convertido a número JSON
export const leerNumero = (entrada, { decimales = 4, entero = false, maximo = Infinity } = {}) => {
  let texto = '';
  if (typeof entrada === 'number') texto = String(entrada);
  else if (typeof entrada === 'string') texto = entrada.trim();
  if (!texto) return { error: MENSAJE_OBLIGATORIO };

  const patron = entero ? /^\d+$/ : new RegExp(`^\\d+([.,]\\d{1,${decimales}})?$`);
  if (!patron.test(texto)) {
    return {
      error: entero
        ? 'Debe ser un número entero mayor o igual a 0'
        : `Debe ser un número mayor o igual a 0 con máximo ${decimales} decimales`
    };
  }

  const numero = Number(texto.replace(',', '.'));
  if (numero > maximo) return { error: `No puede superar ${maximo.toLocaleString('es-CO', { maximumFractionDigits: 4 })}` };
  return { valor: numero };
};

// Aplica { campo: (entrada) => { valor } | { error } } a los valores de un formulario
export const validar = (valores, reglas) => {
  const datos = {};
  const errores = {};
  Object.entries(reglas).forEach(([campo, leer]) => {
    const resultado = leer(valores[campo]);
    if (resultado.error) errores[campo] = resultado.error;
    else datos[campo] = resultado.valor;
  });
  return { datos, errores, valido: Object.keys(errores).length === 0 };
};

const PATRON_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Email recortado; mismo patrón y longitud máxima que el backend
export const validarEmail = (entrada) => {
  const email = typeof entrada === 'string' ? entrada.trim() : '';
  if (!email) return { error: MENSAJE_OBLIGATORIO };
  if (email.length > 255 || !PATRON_EMAIL.test(email)) return { error: 'Escribe un correo válido' };
  return { valor: email };
};

// Política de contraseñas, la misma que exige el backend (utils/contrasenas.js):
// mínimo 8 caracteres, máximo 72 bytes (límite de bcrypt), al menos una letra y un número
export const validarContrasena = (contrasena) => {
  if (!contrasena) return MENSAJE_OBLIGATORIO;
  if (contrasena.length < 8) return 'Debe tener al menos 8 caracteres';
  const bytes = encodeURIComponent(contrasena).replace(/%[0-9A-F]{2}/gi, 'x').length;
  if (bytes > 72) return 'Es demasiado larga (máximo 72 bytes)';
  if (!/\p{L}/u.test(contrasena) || !/\d/.test(contrasena)) return 'Debe incluir al menos una letra y un número';
  return null;
};
