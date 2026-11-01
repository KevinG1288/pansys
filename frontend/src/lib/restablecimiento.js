// Token del enlace de restablecimiento. El backend lo envía en el fragmento de la URL
// (/restablecer#token=…): el navegador nunca manda el fragmento al servidor ni lo incluye en
// Referer. Aquí solo se lee y se borra de la barra de direcciones; nunca se registra ni se muestra.

// Mismo formato que genera el backend (src/utils/tokens.js): 32 bytes en base64url, 43 caracteres
const FORMATO_TOKEN = /^[A-Za-z0-9_-]{43}$/;

// Token con formato válido del fragmento (#token=…), o null si no hay o no tiene el formato
export const leerTokenDelFragmento = (hash) => {
  const texto = typeof hash === 'string' ? hash.replace(/^#/, '') : '';
  if (!texto) return null;
  const token = new URLSearchParams(texto).get('token');
  return token && FORMATO_TOKEN.test(token) ? token : null;
};

// Quita el fragmento de la URL actual sin recargar ni añadir una entrada al historial
export const limpiarFragmento = (ventana = window) => {
  const { location, history } = ventana;
  if (!location.hash) return;
  history.replaceState(history.state, '', `${location.pathname}${location.search}`);
};
