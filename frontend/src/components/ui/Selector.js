import { useId } from 'react';
import { cn } from '../../lib/utils';
import { estiloControl } from './Campo';

// Lista desplegable con etiqueta, ayuda y error accesibles (mismo estilo que Campo).
// En React 19 `ref` llega como prop y se reenvía al <select> con el resto de props.
const Selector = ({ etiqueta, error, ayuda, id, className, children, ...props }) => {
  const idGenerado = useId();
  const idCampo = id ?? idGenerado;
  const idAyuda = ayuda ? `${idCampo}-ayuda` : null;
  const idError = error ? `${idCampo}-error` : null;
  const descritoPor = [idAyuda, idError].filter(Boolean).join(' ') || undefined;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={idCampo} className="text-sm font-medium">{etiqueta}</label>
      <select
        id={idCampo}
        aria-invalid={error ? true : undefined}
        aria-describedby={descritoPor}
        className={cn(estiloControl, 'pr-8')}
        {...props}
      >
        {children}
      </select>
      {ayuda && <p id={idAyuda} className="text-xs text-muted-foreground">{ayuda}</p>}
      {error && <p id={idError} className="text-xs font-medium text-destructive">{error}</p>}
    </div>
  );
};

export default Selector;
