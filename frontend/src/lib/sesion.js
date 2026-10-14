import { mensajeError } from './errores';

// Canal entre el cliente HTTP (services/api.js) y AuthContext para cerrar la sesión cuando el
// backend responde 401 (token inválido o caducado, cuenta inexistente o desactivada).
// Un 403 no cierra la sesión: la cuenta es válida pero no tiene permiso para esa acción.

// Peticiones cuyo 401 lo gestiona la propia pantalla (credenciales incorrectas en el Login)
const RUTAS_SIN_CIERRE = ['/api/auth/login'];

let suscriptor = null;

// Registra quién cierra la sesión (AuthProvider). Devuelve la función para anular el registro.
export const alInvalidarSesion = (fn) => {
  suscriptor = fn;
  return () => {
    if (suscriptor === fn) suscriptor = null;
  };
};

const ruta = (url) => {
  try {
    return new URL(url ?? '', 'http://localhost').pathname;
  } catch {
    return '';
  }
};

const tokenEnviado = (config) => {
  const cabeceras = config?.headers;
  const valor = typeof cabeceras?.get === 'function' ? cabeceras.get('Authorization') : cabeceras?.Authorization;
  return typeof valor === 'string' ? valor.replace(/^Bearer\s+/i, '') : null;
};

// Solo invalida la sesión un 401 de una petición hecha con el token de la sesión actual:
// así una respuesta tardía de una sesión anterior no cierra la nueva, y tras el primer 401
// (que borra el token) los demás 401 en curso se ignoran y no hay cierres ni redirecciones repetidos.
export const esSesionInvalida = (error, tokenActual) => {
  if (error?.response?.status !== 401) return false;
  if (RUTAS_SIN_CIERRE.includes(ruta(error.config?.url))) return false;
  return Boolean(tokenActual) && tokenEnviado(error.config) === tokenActual;
};

export const notificarErrorDeAutenticacion = (error) => {
  let tokenActual = null;
  try {
    tokenActual = localStorage.getItem('token');
  } catch {
    tokenActual = null;
  }
  if (!esSesionInvalida(error, tokenActual)) return false;
  suscriptor?.(mensajeError(error, 'Tu sesión ya no es válida.'));
  return true;
};
