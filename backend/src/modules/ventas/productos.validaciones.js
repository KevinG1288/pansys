const { ErrorNegocio } = require('../../utils/errores');

// Validación de los datos de productos que envía el cliente (RF-12 crear, RF-13 editar).
// Los límites son los mismos que aplica el formulario del frontend (FormularioProducto.js).
// panaderia_id, estado, id y las fechas los fija siempre el servidor: si llegan en el cuerpo, la
// petición se rechaza (400) en lugar de ignorarlos en silencio.

// Alta: nombre, precios y existencia inicial
const CAMPOS_CREACION = ['nombre', 'precio_compra', 'precio_venta', 'cantidad_disponible'];
// Edición (RF-13): solo nombre y precios. Las existencias cambian únicamente con ventas y producción
const CAMPOS_EDICION = ['nombre', 'precio_compra', 'precio_venta'];

const MAX_NOMBRE = 255;                 // productos.nombre VARCHAR(255)
const MAX_PRECIO = 100000000;           // 100.000.000 COP
const MAX_CANTIDAD_INICIAL = 100000;    // unidades enteras

const PATRON_PRECIO = /^\d+(\.\d{1,2})?$/;   // número >= 0 con máximo 2 decimales
const PATRON_ENTERO = /^\d+$/;

// Solo números finitos o textos numéricos: nunca booleanos, listas, objetos, NaN ni Infinity
const textoNumerico = (valor) => {
  if (typeof valor === 'number') return Number.isFinite(valor) ? String(valor) : '';
  if (typeof valor === 'string') return valor.trim();
  return '';
};

// Cada lector devuelve el valor normalizado o undefined si no es válido
const LECTORES = {
  nombre: (valor) => {
    if (typeof valor !== 'string') return undefined;
    const texto = valor.trim();
    return texto && texto.length <= MAX_NOMBRE ? texto : undefined;
  },
  precio_compra: (valor) => leerPrecio(valor),
  precio_venta: (valor) => leerPrecio(valor),
  cantidad_disponible: (valor) => {
    const texto = textoNumerico(valor);
    const numero = Number(texto);
    return PATRON_ENTERO.test(texto) && numero <= MAX_CANTIDAD_INICIAL ? numero : undefined;
  }
};

function leerPrecio(valor) {
  const texto = textoNumerico(valor);
  const numero = Number(texto);
  return PATRON_PRECIO.test(texto) && numero <= MAX_PRECIO ? numero : undefined;
}

// Un cuerpo ausente (petición sin JSON) o que no es un objeto se trata como vacío
const comoObjeto = (datos) => (datos && typeof datos === 'object' && !Array.isArray(datos) ? datos : {});

const rechazarNoPermitidos = (datos, permitidos) => {
  const extra = Object.keys(datos).filter(c => !permitidos.includes(c));
  if (extra.length > 0) {
    throw new ErrorNegocio(`Campos no permitidos: ${extra.join(', ')}`, 400);
  }
};

// Lee los campos presentes en `datos`, en el orden de `campos`; exige los de `obligatorios`
const leerCampos = (datos, campos, obligatorios) => {
  const valores = {};
  const invalidos = [];
  for (const campo of campos) {
    const presente = datos[campo] !== undefined;
    if (!presente) {
      if (obligatorios.includes(campo)) invalidos.push(campo);
      continue;
    }
    const valor = LECTORES[campo](datos[campo]);
    if (valor === undefined) invalidos.push(campo);
    else valores[campo] = valor;
  }
  if (invalidos.length > 0) {
    throw new ErrorNegocio(`Campos requeridos o inválidos: ${invalidos.join(', ')}`, 400);
  }
  return valores;
};

// Alta: nombre y precio de venta obligatorios; precio de compra y existencia inicial opcionales
// (la base aplica su valor por defecto, 0)
const validarCreacionProducto = (datos) => {
  const cuerpo = comoObjeto(datos);
  rechazarNoPermitidos(cuerpo, CAMPOS_CREACION);
  return leerCampos(cuerpo, CAMPOS_CREACION, ['nombre', 'precio_venta']);
};

// Edición: al menos uno de nombre, precio_compra o precio_venta; ningún otro campo
const validarEdicionProducto = (datos) => {
  const cuerpo = comoObjeto(datos);
  rechazarNoPermitidos(cuerpo, CAMPOS_EDICION);
  const valores = leerCampos(cuerpo, CAMPOS_EDICION, []);
  if (Object.keys(valores).length === 0) {
    throw new ErrorNegocio(`Indique al menos un campo para editar: ${CAMPOS_EDICION.join(', ')}`, 400);
  }
  return valores;
};

module.exports = {
  CAMPOS_CREACION,
  CAMPOS_EDICION,
  MAX_NOMBRE,
  MAX_PRECIO,
  MAX_CANTIDAD_INICIAL,
  validarCreacionProducto,
  validarEdicionProducto
};
