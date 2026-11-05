import { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import Boton from './Boton';
import useCapaModal from './useCapaModal';

// Diálogo modal genérico (formularios, detalles). Comparte el comportamiento de useCapaModal.
// `bloqueado` impide cerrarlo mientras hay una operación en curso.
// `refFocoInicial` permite que el primer campo reciba el foco al abrir.
const Dialogo = ({ titulo, descripcion, bloqueado = false, lateral = false, refFocoInicial, onCerrar, className, children }) => {
  const refCapa = useRef(null);
  const idTitulo = useId();
  const idDescripcion = useId();

  const cerrar = () => {
    if (!bloqueado) onCerrar();
  };
  useCapaModal({ refCapa, refFocoInicial, onCerrar: cerrar });

  return createPortal(
    <div className={cn('pansys-ui fixed inset-0 z-50 flex', lateral ? 'items-stretch justify-end' : 'items-end justify-center p-2 sm:items-center sm:p-5')}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={cerrar} aria-hidden="true" data-testid="fondo-dialogo" />
      <div
        ref={refCapa}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        aria-describedby={descripcion ? idDescripcion : undefined}
        tabIndex={-1}
        className={cn('relative flex w-full max-w-lg flex-col border border-border bg-card shadow-xl outline-none', lateral ? 'h-[100dvh] max-h-[100dvh] sm:max-w-xl' : 'max-h-[92dvh] rounded-2xl', className)}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border/70 bg-background/50 px-5 py-5 sm:px-6">
          <div className="min-w-0">
            <h2 id={idTitulo} className="text-base font-semibold">{titulo}</h2>
            {descripcion && <p id={idDescripcion} className="mt-0.5 text-sm text-muted-foreground">{descripcion}</p>}
          </div>
          <Boton variante="fantasma" tamano="icono" onClick={cerrar} disabled={bloqueado} aria-label="Cerrar">
            <X className="size-4" aria-hidden="true" />
          </Boton>
        </div>
        <div className="min-h-0 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
      </div>
    </div>,
    document.body
  );
};

export default Dialogo;
