import { LogOut, Store } from 'lucide-react';
import { cn } from '../../lib/utils';
import Logo from './Logo';
import { modulosPara } from './navegacion';

// Menú lateral (escritorio y móvil). No navega por URL: cambia moduloActivo en Dashboard.js.
// Solo muestra los módulos del rol del usuario (`rolId`).
const Sidebar = ({ activo, rolId, onSeleccionar, onLogout }) => (
  <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
    <div className="px-5 pb-8 pt-6">
      <Logo />
    </div>

    <div className="mx-4 mb-6 flex items-center gap-3 rounded-xl border border-sidebar-border bg-sidebar-accent/60 px-3 py-2.5">
      <Store className="size-4 text-sidebar-primary" aria-hidden="true" />
      <p className="truncate text-xs font-medium text-sidebar-accent-foreground">Mi panadería</p>
    </div>

    <nav aria-label="Módulos principales" className="flex-1 px-3">
      <p className="px-3 pb-2 text-[11px] font-medium uppercase tracking-[0.14em] opacity-50">Módulos</p>
      <ul className="flex flex-col gap-1">
        {modulosPara(rolId).map(({ id, etiqueta, icono: Icono }) => {
          const esActivo = activo === id;
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => onSeleccionar(id)}
                aria-current={esActivo ? 'page' : undefined}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
                  esActivo
                    ? 'bg-sidebar-primary text-sidebar-primary-foreground shadow-sm'
                    : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                )}
              >
                <Icono className="size-[18px]" aria-hidden="true" />
                <span className="flex-1">{etiqueta}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>

    <div className="border-t border-sidebar-border px-3 py-4">
      <button
        type="button"
        onClick={onLogout}
        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm text-sidebar-foreground/75 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
      >
        <LogOut className="size-[18px]" aria-hidden="true" />
        Cerrar sesión
      </button>
    </div>
  </div>
);

export default Sidebar;
