// Respuestas finales de la API (I1). Se montan en src/app.js después de todas las rutas.
// No cambian ninguna respuesta existente: los controladores siguen respondiendo sus propios errores
// con responderError. Esto solo cubre lo que antes llegaba al manejador por defecto de Express
// (HTML): rutas /api inexistentes, cuerpos JSON mal formados o demasiado grandes y cualquier error
// no controlado. Nunca se devuelven ni se registran mensajes, SQL ni cuerpos: solo nombre y código.

// /api/... sin ruta que lo atienda
const rutaApiNoEncontrada = (req, res) => res.status(404).json({ error: 'Ruta no encontrada' });

// eslint-disable-next-line no-unused-vars -- Express reconoce el manejador de errores por sus 4 parámetros
const manejadorFinalDeErrores = (error, req, res, next) => {
  if (res.headersSent) return next(error);
  const tipo = error?.type;
  // Errores del lector de JSON de Express (body-parser)
  if (tipo === 'entity.parse.failed') return res.status(400).json({ error: 'El cuerpo de la petición no es un JSON válido' });
  if (tipo === 'entity.too.large') return res.status(413).json({ error: 'El cuerpo de la petición es demasiado grande' });
  const status = Number(error?.status ?? error?.statusCode);
  if (tipo && Number.isInteger(status) && status >= 400 && status < 500) return res.status(status).json({ error: 'Petición no válida' });
  // Cualquier otro: 500 genérico. Se registra solo el nombre y el código (sin mensaje ni datos).
  console.error(`Error no controlado: ${error?.name ?? 'Error'}${error?.code ? ` (${error.code})` : ''}`);
  return res.status(500).json({ error: 'Error interno del servidor' });
};

module.exports = { rutaApiNoEncontrada, manejadorFinalDeErrores };
