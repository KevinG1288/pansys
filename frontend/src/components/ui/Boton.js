import { LoaderCircle } from 'lucide-react';
import { cn } from '../../lib/utils';

const VARIANTES = {
  primario: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 active:bg-primary/95',
  contorno: 'border border-border bg-card text-foreground hover:bg-secondary',
  fantasma: 'text-foreground hover:bg-secondary',
  peligro: 'bg-destructive text-white shadow-sm hover:bg-destructive/90'
};

const TAMANOS = {
  md: 'min-h-11 px-4 py-2.5 text-sm',
  sm: 'min-h-9 px-3 py-2 text-xs',
  icono: 'size-11'
};

// Botón del diseño. `cargando` lo deshabilita y lo anuncia (aria-busy) para evitar envíos duplicados.
// En React 19 `ref` llega como prop y se reenvía al <button> con el resto de props.
const Boton = ({
  variante = 'primario',
  tamano = 'md',
  cargando = false,
  disabled,
  type = 'button',
  className,
  children,
  ...props
}) => (
  <button
    type={type}
    disabled={disabled || cargando}
    aria-busy={cargando || undefined}
    className={cn(
      'pansys-button inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-control font-semibold transition-colors duration-150',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
      'disabled:cursor-not-allowed disabled:opacity-50',
      VARIANTES[variante],
      TAMANOS[tamano],
      className
    )}
    {...props}
  >
    {cargando && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
    {children}
  </button>
);

export default Boton;
