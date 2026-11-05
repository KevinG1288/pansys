import { cn } from '../../lib/utils';

// Encabezado de página (adaptado del diseño de v0)
export const PageHeader = ({ antetitulo, titulo, descripcion, acciones }) => (
  <div className="pansys-page-header flex flex-col gap-4 border-b border-border/80 pb-6 md:flex-row md:items-center md:justify-between">
    <div className="min-w-0">
      {antetitulo && antetitulo !== 'Módulo' && <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">{antetitulo}</p>}
      <h1 className="font-serif text-3xl font-semibold leading-tight tracking-tight md:text-[34px]">{titulo}</h1>
      {descripcion && <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{descripcion}</p>}
    </div>
    {acciones && <div className="flex shrink-0 flex-wrap items-center gap-2">{acciones}</div>}
  </div>
);

// Tarjeta contenedora con título opcional (adaptada del diseño de v0)
export const Panel = ({ titulo, descripcion, accion, children, className }) => (
  <section className={cn('pansys-panel flex min-w-0 flex-col rounded-2xl border border-border/80 bg-card shadow-panel', className)}>
    {titulo && (
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-4 pt-5">
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
