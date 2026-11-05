import { cn } from '../../lib/utils';

// Navegación visual de secciones: conserva botones, permisos y manejadores del módulo.
const Secciones = ({ etiqueta, items, activo, onCambiar }) => (
  <nav aria-label={etiqueta} className="pansys-secciones flex gap-1 overflow-x-auto rounded-xl border border-border bg-muted/70 p-1.5">
    {items.map(({ id, nombre, icono: Icono }) => <button key={id} type="button" aria-current={activo === id ? 'page' : undefined}
      onClick={() => onCambiar(id)} className={cn('flex min-h-11 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        activo === id ? 'bg-card text-primary shadow-sm ring-1 ring-border/70' : 'text-muted-foreground hover:bg-card/60 hover:text-foreground')}>
      {Icono && <Icono className="size-4" aria-hidden="true" />}{nombre}
    </button>)}
  </nav>
);
export default Secciones;
