import { useId } from 'react';
import { cn } from '../../lib/utils';

// Estilo de los controles de formulario (también lo usan buscadores y selectores)
export const estiloControl = cn(
  'h-10 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground shadow-sm',
  'placeholder:text-muted-foreground',
  'focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/20',
  'disabled:cursor-not-allowed disabled:opacity-60',
  'aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-destructive/20'
);

// Campo de formulario con etiqueta, ayuda y error accesibles.
// En React 19 `ref` llega como prop y se reenvía al <input> con el resto de props.
const Campo = ({ etiqueta, error, ayuda, id, className, ...props }) => {
  const idGenerado = useId();
  const idCampo = id ?? idGenerado;
  const idAyuda = ayuda ? `${idCampo}-ayuda` : null;
  const idError = error ? `${idCampo}-error` : null;
  const descritoPor = [idAyuda, idError].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={idCampo} className="text-sm font-medium">{etiqueta}</label>
      <input
        id={idCampo}
        aria-invalid={error ? true : undefined}
        aria-describedby={descritoPor}
        className={estiloControl}
        {...props}
      />
      {ayuda && <p id={idAyuda} className="text-xs text-muted-foreground">{ayuda}</p>}
      {error && <p id={idError} className="text-xs font-medium text-destructive">{error}</p>}
    </div>
  );
};

export default Campo;
