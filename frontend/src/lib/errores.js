const MENSAJE_POR_DEFECTO = 'Ocurrió un error inesperado. Inténtalo de nuevo.';

// Mensaje legible de un error de Axios: primero el que envía el backend ({ error }),
// después uno de conexión y, por último, el mensaje por defecto.
export const mensajeError = (error, porDefecto = MENSAJE_POR_DEFECTO) => {
  const delServidor = error?.response?.data?.error;
  if (typeof delServidor === 'string' && delServidor.trim()) return delServidor;
  if (error?.request && !error?.response) return 'No se pudo conectar con el servidor.';
  return porDefecto;
};
