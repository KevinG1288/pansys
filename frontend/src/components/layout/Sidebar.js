import { ChevronRight, LogOut, Store } from 'lucide-react';
import { cn } from '../../lib/utils';
import Logo from './Logo';
import { modulosPara } from './navegacion';

// Menú lateral (escritorio y móvil). No navega por URL: cambia moduloActivo en Dashboard.js.
// Solo muestra los módulos del rol del usuario (`rolId`).
const Sidebar = ({ activo, rolId, onSeleccionar, onLogout }) => (
  <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
    <div className="shrink-0 px-5 pb-5 pt-5">
      <Logo />
    </div>

    <div className="mx-4 mb-4 flex shrink-0 items-center gap-3 rounded-xl border border-sidebar-border bg-sidebar-accent/60 px-3 py-2.5">
      <Store className="size-4 text-sidebar-primary" aria-hidden="true" />
      <p className="truncate text-xs font-medium text-sidebar-accent-foreground">Mi panadería</p>
    </div>

    <nav aria-label="Módulos principales" className="pansys-sidebar-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3">
      {[['Inicio', ['dashboard']], ['Operación', ['inventario', 'ventas', 'produccion', 'recetas']], ['Colaboración', ['colaboracion']], ['Administración', ['cuentas', 'micuenta']]].map(([grupo, ids]) => (
      <div key={grupo} className="mb-3 last:mb-0">
      <p className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-sidebar-foreground/80">{grupo}</p>
      <ul className="flex flex-col gap-1">
        {modulosPara(rolId).filter(m => ids.includes(m.id)).map(({ id, etiqueta, icono: Icono }) => {
          const esActivo = activo === id;
          return (
            <li key={id}>
              <button
                type="button"
                onClick={() => onSeleccionar(id)}
                aria-current={esActivo ? 'page' : undefined}
                className={cn(
                  'flex min-h-11 w-full items-center gap-3 rounded-control px-3 py-2 text-left text-sm font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
                  esActivo
                    ? 'bg-sidebar-primary text-sidebar-primary-foreground font-semibold shadow-[inset_3px_0_0_rgb(var(--sidebar-accent-foreground))]'
                    : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                )}
              >
                <Icono className="size-[18px]" aria-hidden="true" />
                <span className="flex-1">{etiqueta}</span>
                {esActivo && <ChevronRight className="size-3.5 opacity-70" aria-hidden="true" />}
              </button>
            </li>
          );
        })}
      </ul>
      </div>))}
    </nav>

    <div className="shrink-0 border-t border-sidebar-border px-3 py-3">
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
