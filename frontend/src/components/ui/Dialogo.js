import { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import Boton from './Boton';
import useCapaModal from './useCapaModal';

// Diálogo modal genérico (formularios, detalles). Comparte el comportamiento de useCapaModal.
// `bloqueado` impide cerrarlo mientras hay una operación en curso.
// `refFocoInicial` permite que el primer campo reciba el foco al abrir.
const Dialogo = ({ titulo, descripcion, bloqueado = false, refFocoInicial, onCerrar, className, children }) => {
  const refCapa = useRef(null);
  const idTitulo = useId();
  const idDescripcion = useId();

  const cerrar = () => {
    if (!bloqueado) onCerrar();
  };
  useCapaModal({ refCapa, refFocoInicial, onCerrar: cerrar });

  return createPortal(
    <div className="pansys-ui fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={cerrar} aria-hidden="true" data-testid="fondo-dialogo" />
      <div
        ref={refCapa}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        aria-describedby={descripcion ? idDescripcion : undefined}
        tabIndex={-1}
        className={cn('relative flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl border border-border bg-card shadow-xl outline-none', className)}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border/70 px-6 py-4">
          <div className="min-w-0">
            <h2 id={idTitulo} className="text-base font-semibold">{titulo}</h2>
            {descripcion && <p id={idDescripcion} className="mt-0.5 text-sm text-muted-foreground">{descripcion}</p>}
          </div>
          <Boton variante="fantasma" tamano="icono" onClick={cerrar} disabled={bloqueado} aria-label="Cerrar">
            <X className="size-4" aria-hidden="true" />
          </Boton>
        </div>
        <div className="overflow-y-auto px-6 py-4">{children}</div>
      </div>
    </div>,
    document.body
  );
};

export default Dialogo;
