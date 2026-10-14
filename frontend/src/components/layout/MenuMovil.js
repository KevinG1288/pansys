import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import Sidebar from './Sidebar';
import useCapaModal from '../ui/useCapaModal';

// Ancho desde el que se muestra el menú fijo de escritorio (breakpoint lg de Tailwind)
const ANCHO_ESCRITORIO = 1024;

// Menú lateral para pantallas estrechas. Se dibuja solo mientras está abierto; el contenido
// de fondo recibe `inert` desde Dashboard.js para que el foco no salga del menú.
const MenuMovil = ({ activo, rolId, onSeleccionar, onLogout, onCerrar }) => {
  const panelRef = useRef(null);
  const cerrarRef = useRef(onCerrar);

  // Siempre la última función de cierre, sin volver a ejecutar el efecto del redimensionado
  useEffect(() => {
    cerrarRef.current = onCerrar;
  });

  // Foco, desplazamiento del fondo, Escape y Tab: comportamiento común de las capas modales
  useCapaModal({ refCapa: panelRef, onCerrar });

  // Propio del menú: al pasar a pantalla ancha deja de tener sentido (y liberaría el scroll)
  useEffect(() => {
    const alRedimensionar = () => {
      if (window.innerWidth >= ANCHO_ESCRITORIO) cerrarRef.current();
    };
    window.addEventListener('resize', alRedimensionar);
    return () => window.removeEventListener('resize', alRedimensionar);
  }, []);

  return (
    <div className="fixed inset-0 z-40 lg:hidden">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onCerrar}
        aria-hidden="true"
        data-testid="fondo-menu"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Menú de navegación"
        tabIndex={-1}
        className="pansys-ui absolute inset-y-0 left-0 w-72 max-w-[85vw] animate-entrar-izquierda shadow-xl outline-none motion-reduce:animate-none"
      >
        <button
          type="button"
          onClick={onCerrar}
          aria-label="Cerrar menú"
          className="absolute right-3 top-3 z-10 flex size-9 items-center justify-center rounded-lg text-sidebar-foreground/80 hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <X className="size-5" aria-hidden="true" />
        </button>
        <Sidebar
          activo={activo}
          rolId={rolId}
          onSeleccionar={(id) => {
            onSeleccionar(id);
            onCerrar();
          }}
          onLogout={() => {
            onCerrar();
            onLogout();
          }}
        />
      </div>
    </div>
  );
};

export default MenuMovil;
