import { BookOpenText, ChefHat, CircleUser, Handshake, LayoutDashboard, Package, ShoppingBasket, UserCog } from 'lucide-react';
import { ROLES } from '../../lib/permisos';

// Módulos del menú; cada id coincide con un valor de moduloActivo en Dashboard.js.
// `roles` limita quién ve el módulo (el backend sigue comprobando los permisos).
export const modulos = [
  { id: 'dashboard', etiqueta: 'Dashboard', icono: LayoutDashboard },
  { id: 'inventario', etiqueta: 'Inventario', icono: Package },
  { id: 'ventas', etiqueta: 'Ventas', icono: ShoppingBasket },
  { id: 'produccion', etiqueta: 'Producción', icono: ChefHat },
  { id: 'recetas', etiqueta: 'Recetas', icono: BookOpenText },
  { id: 'colaboracion', etiqueta: 'Red colaborativa', icono: Handshake },
  { id: 'cuentas', etiqueta: 'Cuentas', icono: UserCog, roles: [ROLES.ADMINISTRADOR] },
  { id: 'micuenta', etiqueta: 'Mi cuenta', icono: CircleUser }
];

// Módulos visibles para un rol
export const modulosPara = (rolId) => modulos.filter(m => !m.roles || m.roles.includes(rolId));

export const etiquetaModulo = (id) => modulos.find(m => m.id === id)?.etiqueta ?? 'Dashboard';
