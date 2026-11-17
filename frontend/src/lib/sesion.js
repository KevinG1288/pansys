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

// ---- Sesión de ESTA pestaña ----------------------------------------------------------------
// localStorage es común a todas las pestañas del mismo origen: si en otra pestaña se inicia sesión
// con otra cuenta, el token guardado cambia. Cada pestaña recuerda el token con el que está
// trabajando (tokenPestana) y el cliente HTTP nunca envía en su nombre el token de otra cuenta:
// la petición se bloquea antes de salir y AuthProvider sincroniza la pestaña (cambio de cuenta o
// cierre de sesión). undefined = sin AuthProvider (se usa el token guardado, como antes).
let tokenPestana;
let alCambiarSesion = null;

export const CODIGO_SESION_CAMBIADA = 'SESION_CAMBIADA';
export const MENSAJE_SESION_CAMBIADA = 'La sesión cambió en otra pestaña. La operación no se realizó; revisa la cuenta activa.';

export const leerTokenGuardado = () => {
  try {
    return localStorage.getItem('token');
  } catch {
    return null;
  }
};

export const fijarTokenPestana = (token) => { tokenPestana = token ?? null; };
export const tokenDePestana = () => tokenPestana;

// AuthProvider registra cómo sincronizar la pestaña. Devuelve la función para anular el registro.
export const alDetectarCambioDeSesion = (fn) => {
  alCambiarSesion = fn;
  return () => {
    if (alCambiarSesion === fn) alCambiarSesion = null;
  };
};

// Identidad (id y panadería) que declara un JWT, SIN verificarlo: solo sirve para distinguir cuentas
// en el navegador; la autorización la decide siempre el backend al verificar la firma.
export const identidadToken = (token) => {
  try {
    const parte = String(token).split('.')[1];
    const datos = JSON.parse(atob(parte.replace(/-/g, '+').replace(/_/g, '/')));
    return Number.isSafeInteger(datos.id) ? { id: datos.id, panaderia_id: datos.panaderia_id ?? null } : null;
  } catch {
    return null;
  }
};

// Dos tokens de la MISMA cuenta y panadería (p. ej. el renovado tras cambiar la contraseña)
export const mismaCuenta = (a, b) => {
  const x = identidadToken(a), y = identidadToken(b);
  return Boolean(x && y && x.id === y.id && x.panaderia_id === y.panaderia_id);
};

export const errorSesionCambiada = () => Object.assign(new Error(MENSAJE_SESION_CAMBIADA), { codigo: CODIGO_SESION_CAMBIADA });

// Token con el que puede salir una petición de esta pestaña (null: sin sesión, sale sin token).
// Lanza errorSesionCambiada si la sesión guardada ya no es la de esta pestaña.
export const tokenParaPeticion = () => {
  const guardado = leerTokenGuardado();
  if (tokenPestana === undefined) return guardado;
  if (tokenPestana === null || guardado === tokenPestana) return tokenPestana;
  if (guardado && mismaCuenta(guardado, tokenPestana)) {
    tokenPestana = guardado; // misma cuenta, token renovado en otra pestaña
    return guardado;
  }
  alCambiarSesion?.();
  throw errorSesionCambiada();
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
