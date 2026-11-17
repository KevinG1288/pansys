const MENSAJE_POR_DEFECTO = 'Ocurrió un error inesperado. Inténtalo de nuevo.';

// Mensaje legible de un error de Axios: primero el que envía el backend ({ error }),
// después uno de conexión y, por último, el mensaje por defecto.
export const mensajeError = (error, porDefecto = MENSAJE_POR_DEFECTO) => {
  // Petición bloqueada en el navegador porque la sesión cambió en otra pestaña (lib/sesion.js)
  if (error?.codigo === 'SESION_CAMBIADA' && typeof error.message === 'string') return error.message;
  const delServidor = error?.response?.data?.error;
  if (typeof delServidor === 'string' && delServidor.trim()) return delServidor;
  if (error?.request && !error?.response) return 'No se pudo conectar con el servidor.';
  return porDefecto;
};
