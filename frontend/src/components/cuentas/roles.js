import { ROLES } from '../../lib/permisos';

// Roles que se pueden asignar desde la gestión de cuentas
export const OPCIONES_ROL = [
  { valor: ROLES.PANADERO, etiqueta: 'Panadero', ayuda: 'Inventario, ventas, producción y recetas de su panadería.' },
  { valor: ROLES.GERENTE, etiqueta: 'Gerente', ayuda: 'Solo consulta de su panadería.' },
  { valor: ROLES.ADMINISTRADOR, etiqueta: 'Administrador', ayuda: 'Acceso total a las dos panaderías y a las cuentas.' }
];

export const nombreRol = (rolId) => OPCIONES_ROL.find(o => o.valor === rolId)?.etiqueta ?? 'Sin rol';
