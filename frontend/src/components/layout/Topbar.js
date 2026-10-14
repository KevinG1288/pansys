import { Menu } from 'lucide-react';

// Cabecera: botón de menú (solo pantallas estrechas), módulo actual y usuario autenticado
const Topbar = ({ titulo, usuario, onAbrirMenu }) => (
  <header className="pansys-ui sticky top-0 z-30 border-b border-border/70 bg-background/85 backdrop-blur-md">
    <div className="flex h-16 items-center gap-3 px-4 md:px-6 lg:px-8">
      <button
        type="button"
        onClick={onAbrirMenu}
        aria-label="Abrir menú"
        className="flex size-10 items-center justify-center rounded-lg border border-border bg-card text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
      >
        <Menu className="size-5" aria-hidden="true" />
      </button>

      <p className="font-serif text-lg font-semibold tracking-tight">{titulo}</p>

      <div className="ml-auto flex items-center gap-2.5">
        <span
          className="flex size-9 items-center justify-center rounded-full bg-accent text-sm font-semibold uppercase text-accent-foreground"
          aria-hidden="true"
        >
          {usuario?.email?.charAt(0) ?? '?'}
        </span>
        <span className="hidden text-right leading-tight md:block">
          <span className="block text-sm font-semibold">{usuario?.email}</span>
          <span className="block text-xs capitalize text-muted-foreground">{usuario?.rol}</span>
        </span>
      </div>
    </div>
  </header>
);

export default Topbar;
