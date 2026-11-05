import { cn } from '../../lib/utils';

// Tarjeta de indicador (adaptada del diseño de v0, sin variaciones porcentuales:
// el backend no ofrece datos para compararlas)
const StatCard = ({ etiqueta, valor, icono: Icono, nota, tono = 'normal' }) => (
  <article
    className={cn(
      'pansys-stat relative flex flex-col gap-3 overflow-hidden rounded-2xl border bg-card p-5 text-foreground shadow-panel',
      tono === 'primario' ? 'border-primary/30' : tono === 'alerta' ? 'border-warning/30' : 'border-border/80'
    )}
  >
    {tono === 'primario' && <span className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-primary" aria-hidden="true" />}
    <div className="flex items-start justify-between gap-3">
      <p className="text-sm font-semibold text-foreground">
        {etiqueta}
      </p>
      <span
        className={cn(
          'flex size-9 items-center justify-center rounded-xl',
          tono === 'primario' && 'bg-accent text-primary',
          tono === 'normal' && 'bg-accent text-accent-foreground',
          tono === 'alerta' && 'bg-warning/15 text-warning-foreground'
        )}
      >
        <Icono className="size-[18px]" aria-hidden="true" />
      </span>
    </div>
    <p className={cn('font-sans text-3xl font-semibold tracking-tight tabular-nums leading-none', tono === 'primario' && 'text-primary')}>{valor}</p>
    {nota && (
      <p className="mt-auto text-xs leading-relaxed text-muted-foreground">{nota}</p>
    )}
  </article>
);

export default StatCard;
