import { cn } from '../../lib/utils';

// Encabezado de página (adaptado del diseño de v0)
export const PageHeader = ({ antetitulo, titulo, descripcion, acciones }) => (
  <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
    <div>
      {antetitulo && <p className="text-xs font-medium uppercase tracking-[0.16em] text-primary">{antetitulo}</p>}
      <h1 className="mt-1 font-serif text-3xl font-semibold tracking-tight md:text-4xl">{titulo}</h1>
      {descripcion && <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{descripcion}</p>}
    </div>
    {acciones && <div className="flex flex-wrap items-center gap-2">{acciones}</div>}
  </div>
);

// Tarjeta contenedora con título opcional (adaptada del diseño de v0)
export const Panel = ({ titulo, descripcion, accion, children, className }) => (
  <section className={cn('flex flex-col rounded-2xl border border-border/80 bg-card shadow-panel', className)}>
    {titulo && (
      <div className="flex items-start justify-between gap-4 px-5 pb-4 pt-5">
        <div>
          <h2 className="text-base font-semibold">{titulo}</h2>
          {descripcion && <p className="mt-0.5 text-sm text-muted-foreground">{descripcion}</p>}
        </div>
        {accion}
      </div>
    )}
    <div className="flex-1">{children}</div>
  </section>
);
