import { ROLES } from '../../lib/permisos';

// Roles de las cuentas. Cada administrador gestiona solo su panadería; los permisos los decide el
// backend, estas opciones solo evitan ofrecer cambios que rechazaría.
export const OPCIONES_ROL = [
  { valor: ROLES.PANADERO, etiqueta: 'Panadero', ayuda: 'Inventario, ventas, producción y recetas de su panadería.' },
  { valor: ROLES.GERENTE, etiqueta: 'Gerente', ayuda: 'Solo consulta de su panadería.' },
  { valor: ROLES.ADMINISTRADOR, etiqueta: 'Administrador', ayuda: 'Gestiona su panadería y las cuentas de su panadería.' }
];

// Roles que se pueden asignar desde la gestión de cuentas: el backend no crea ni asciende administradores
export const ROLES_ASIGNABLES = OPCIONES_ROL.filter(o => o.valor !== ROLES.ADMINISTRADOR);

// Opciones al editar: una cuenta administradora conserva su rol actual (y puede degradarse si las
// reglas lo permiten); a cualquier otra no se le ofrece el rol de administrador
export const opcionesRolPara = (rolActual) => (rolActual === ROLES.ADMINISTRADOR ? OPCIONES_ROL : ROLES_ASIGNABLES);

export const nombreRol = (rolId) => OPCIONES_ROL.find(o => o.valor === rolId)?.etiqueta ?? 'Sin rol';
