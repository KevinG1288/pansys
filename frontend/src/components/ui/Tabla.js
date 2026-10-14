import { cn } from '../../lib/utils';

// Tabla adaptada de components/ui/table.tsx del diseño de v0.
// El contenedor permite desplazamiento horizontal en pantallas estrechas.
export const Tabla = ({ className, children, ...props }) => (
  <div className="w-full overflow-x-auto">
    <table className={cn('w-full border-collapse text-sm', className)} {...props}>
      {children}
    </table>
  </div>
);

export const TablaEncabezado = ({ className, ...props }) => (
  <thead className={cn('border-b border-border', className)} {...props} />
);

export const TablaCuerpo = ({ className, ...props }) => (
  <tbody className={cn('divide-y divide-border/70', className)} {...props} />
);

export const TablaFila = ({ className, ...props }) => (
  <tr className={cn('transition-colors hover:bg-secondary/40', className)} {...props} />
);

export const TablaColumna = ({ className, ...props }) => (
  <th
    scope="col"
    className={cn(
      'h-10 whitespace-nowrap px-3 text-left align-middle text-xs font-medium uppercase tracking-wide text-muted-foreground first:pl-5 last:pr-5',
      className
    )}
    {...props}
  />
);

export const TablaCelda = ({ className, ...props }) => (
  <td className={cn('px-3 py-3 align-middle first:pl-5 last:pr-5', className)} {...props} />
);
