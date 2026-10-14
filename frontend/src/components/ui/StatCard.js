import { cn } from '../../lib/utils';

// Tarjeta de indicador (adaptada del diseño de v0, sin variaciones porcentuales:
// el backend no ofrece datos para compararlas)
const StatCard = ({ etiqueta, valor, icono: Icono, nota, tono = 'normal' }) => (
  <article
    className={cn(
      'relative flex flex-col gap-4 overflow-hidden rounded-2xl border p-5 shadow-panel',
      tono === 'primario' ? 'border-transparent bg-primary text-primary-foreground' : 'border-border/80 bg-card'
    )}
  >
    <div className="flex items-start justify-between gap-3">
      <p className={cn('text-sm font-medium', tono === 'primario' ? 'text-primary-foreground/85' : 'text-muted-foreground')}>
        {etiqueta}
      </p>
      <span
        className={cn(
          'flex size-9 items-center justify-center rounded-xl',
          tono === 'primario' && 'bg-white/15',
          tono === 'normal' && 'bg-accent text-accent-foreground',
          tono === 'alerta' && 'bg-destructive/10 text-destructive'
        )}
      >
        <Icono className="size-[18px]" aria-hidden="true" />
      </span>
    </div>
    <p className="font-serif text-3xl font-semibold tracking-tight tabular-nums">{valor}</p>
    {nota && (
      <p className={cn('text-xs', tono === 'primario' ? 'text-primary-foreground/80' : 'text-muted-foreground')}>{nota}</p>
    )}
  </article>
);

export default StatCard;
