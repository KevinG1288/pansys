import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { cn } from '../../lib/utils';

// Los errores se anuncian de inmediato (alert); éxito e información, de forma cortés (status)
const TIPOS = {
  error: { icono: CircleAlert, rol: 'alert', clases: 'border-destructive/30 bg-destructive/5 text-destructive' },
  exito: { icono: CircleCheck, rol: 'status', clases: 'border-success/30 bg-success/10 text-success' },
  info: { icono: Info, rol: 'status', clases: 'border-border bg-secondary text-secondary-foreground' }
};

// Mensaje en la página (sustituye a alert())
const Aviso = ({ tipo = 'info', titulo, id, className, onCerrar, children }) => {
  const { icono: Icono, rol, clases } = TIPOS[tipo];

  return (
    <div id={id} role={rol} className={cn('flex items-start gap-3 rounded-xl border px-4 py-3 text-sm', clases, className)}>
      <Icono className="mt-0.5 size-4" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {titulo && <p className="font-semibold">{titulo}</p>}
        <div className={cn('text-foreground/90', titulo && 'mt-0.5')}>{children}</div>
      </div>
      {onCerrar && (
        <button
          type="button"
          onClick={onCerrar}
          aria-label="Cerrar aviso"
          className="rounded-md p-1 text-foreground/70 hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      )}
    </div>
  );
};

export default Aviso;
