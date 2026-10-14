import { useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { TriangleAlert } from 'lucide-react';
import Boton from './Boton';
import useCapaModal from './useCapaModal';

// Diálogo de confirmación para acciones destructivas (sustituye a window.confirm).
// Se dibuja solo mientras está abierto; el foco inicial va a Cancelar, la opción segura.
const DialogoConfirmacion = ({
  titulo,
  descripcion,
  textoConfirmar = 'Confirmar',
  textoCancelar = 'Cancelar',
  confirmando = false,
  error,
  onConfirmar,
  onCancelar
}) => {
  const refCapa = useRef(null);
  const refCancelar = useRef(null);
  const idTitulo = useId();
  const idDescripcion = useId();

  // Mientras se confirma, Escape y el fondo no cancelan una operación ya enviada
  const cancelar = () => {
    if (!confirmando) onCancelar();
  };
  useCapaModal({ refCapa, refFocoInicial: refCancelar, onCerrar: cancelar });

  return createPortal(
    <div className="pansys-ui fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={cancelar} aria-hidden="true" data-testid="fondo-dialogo" />
      <div
        ref={refCapa}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        aria-describedby={idDescripcion}
        tabIndex={-1}
        className="relative w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl outline-none"
      >
        <div className="flex gap-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <TriangleAlert className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={idTitulo} className="text-base font-semibold">{titulo}</h2>
            <p id={idDescripcion} className="mt-1 text-sm text-muted-foreground">{descripcion}</p>
            {error && <p role="alert" className="mt-3 text-sm font-medium text-destructive">{error}</p>}
          </div>
        </div>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Boton ref={refCancelar} variante="contorno" onClick={cancelar} disabled={confirmando}>
            {textoCancelar}
          </Boton>
          <Boton variante="peligro" onClick={onConfirmar} cargando={confirmando}>
            {textoConfirmar}
          </Boton>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default DialogoConfirmacion;
