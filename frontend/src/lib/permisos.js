// Identificadores fijos de la tabla roles (iguales a backend/src/config/roles.js)
export const ROLES = Object.freeze({
  ADMINISTRADOR: 1,
  PANADERO: 2,
  GERENTE: 3
});

// Réplica, solo para la interfaz, de la regla de escritura del backend en inventario y ventas:
// permitirRoles(ADMINISTRADOR, PANADERO). Los permisos los sigue decidiendo el backend.
export const puedeEscribir = (usuario) =>
  [ROLES.ADMINISTRADOR, ROLES.PANADERO].includes(usuario?.rol_id);
