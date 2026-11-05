import { Children, cloneElement, createContext, isValidElement, useContext } from 'react';
import { cn } from '../../lib/utils';

const Etiquetas = createContext([]);
const textoDe = contenido => Children.toArray(contenido).map(c => typeof c === 'string' || typeof c === 'number' ? c : isValidElement(c) ? textoDe(c.props.children) : '').join('');

// Tabla adaptada de components/ui/table.tsx del diseño de v0.
// El contenedor permite desplazamiento horizontal en pantallas estrechas.
export const Tabla = ({ className, children, adaptable = true, ...props }) => {
  const encabezado = Children.toArray(children).find(c => isValidElement(c) && c.type === TablaEncabezado);
  const fila = Children.toArray(encabezado?.props.children).find(isValidElement);
  const etiquetas = Children.toArray(fila?.props.children).map(c => isValidElement(c) ? textoDe(c.props.children) : '');
  return <Etiquetas.Provider value={etiquetas}>
  <div className="pansys-table-wrap w-full overflow-x-auto">
    <table role="table" className={cn('pansys-table w-full border-collapse text-sm', adaptable && 'pansys-table-responsive', className)} {...props}>
      {children}
    </table>
  </div>
  </Etiquetas.Provider>;
};

export const TablaEncabezado = ({ className, ...props }) => (
  <thead className={cn('border-y border-border/80 bg-muted/60', className)} {...props} />
);

export const TablaCuerpo = ({ className, ...props }) => (
  <tbody className={cn('divide-y divide-border/70', className)} {...props} />
);

export const TablaFila = ({ className, children, ...props }) => {
  const etiquetas = useContext(Etiquetas);
  const datos = Children.toArray(children).some(c => isValidElement(c) && c.type === TablaCelda);
  return <tr role="row" className={cn('transition-colors hover:bg-secondary/40', datos && 'pansys-data-row', className)} {...props}>
    {Children.toArray(children).map((c, i) => isValidElement(c) && c.type === TablaCelda ? cloneElement(c, { 'data-label': c.props['data-label'] ?? (c.props.colSpan > 1 ? '' : etiquetas[i]) }) : c)}
  </tr>;
};

export const TablaColumna = ({ className, ...props }) => (
  <th
    role="columnheader"
    scope="col"
    className={cn(
      'h-11 whitespace-nowrap px-3 text-left align-middle text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground first:pl-5 last:pr-5',
      className
    )}
    {...props}
  />
);

export const TablaCelda = ({ className, ...props }) => (
  <td role="cell" className={cn('px-3 py-3.5 align-middle first:pl-5 last:pr-5', className)} {...props} />
);
