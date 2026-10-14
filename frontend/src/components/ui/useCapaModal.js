import { useEffect, useRef } from 'react';

const SELECTOR_ENFOCABLES = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(', ');

// Comportamiento común de las capas modales (menú móvil y diálogos):
// - mueve el foco a la capa (o a `refFocoInicial`) y al cerrar lo devuelve a donde estaba;
// - bloquea el desplazamiento del fondo y luego restaura su valor anterior;
// - Escape llama a `onCerrar`;
// - Tab y Mayús+Tab dan la vuelta dentro de la capa.
// Cada efecto deshace lo que hace, así que es seguro con React.StrictMode.
const useCapaModal = ({ refCapa, refFocoInicial, onCerrar }) => {
  const cerrarRef = useRef(onCerrar);

  // Siempre la última función de cierre, sin volver a ejecutar el efecto principal
  useEffect(() => {
    cerrarRef.current = onCerrar;
  });

  useEffect(() => {
    const capa = refCapa.current;
    const focoAnterior = document.activeElement;
    const overflowAnterior = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    (refFocoInicial?.current ?? capa)?.focus();

    const alPresionarTecla = (evento) => {
      if (evento.key === 'Escape') {
        cerrarRef.current?.();
        return;
      }
      if (evento.key !== 'Tab' || !capa) return;

      const enfocables = [...capa.querySelectorAll(SELECTOR_ENFOCABLES)];
      if (enfocables.length === 0) {
        evento.preventDefault();
        capa.focus();
        return;
      }
      const primero = enfocables[0];
      const ultimo = enfocables[enfocables.length - 1];
      const activo = document.activeElement;
      const fuera = activo === capa || !capa.contains(activo);

      if (evento.shiftKey && (activo === primero || fuera)) {
        evento.preventDefault();
        ultimo.focus();
      } else if (!evento.shiftKey && (activo === ultimo || fuera)) {
        evento.preventDefault();
        primero.focus();
      }
    };
    document.addEventListener('keydown', alPresionarTecla);

    return () => {
      document.removeEventListener('keydown', alPresionarTecla);
      document.body.style.overflow = overflowAnterior;
      if (focoAnterior instanceof HTMLElement && document.contains(focoAnterior)) {
        focoAnterior.focus();
      }
    };
  }, [refCapa, refFocoInicial]);
};

export default useCapaModal;
