import { cn } from '../../lib/utils';

// Colores de components/pansys/status-badge.tsx del diseño de v0
const TONOS = {
  exito: { insignia: 'bg-success/10 text-success ring-success/20', punto: 'bg-success' },
  alerta: { insignia: 'bg-warning/15 text-[#874e00] ring-warning/30', punto: 'bg-warning' },
  peligro: { insignia: 'bg-destructive/10 text-destructive ring-destructive/20', punto: 'bg-destructive' },
  neutro: { insignia: 'bg-muted text-muted-foreground ring-border', punto: 'bg-muted-foreground/60' },
  info: { insignia: 'bg-accent text-accent-foreground ring-primary/20', punto: 'bg-primary' }
};

const StatusBadge = ({ tono = 'neutro', className, children }) => (
  <span
    className={cn(
      'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
      TONOS[tono].insignia,
      className
    )}
  >
    <span className={cn('size-1.5 rounded-full', TONOS[tono].punto)} aria-hidden="true" />
    {children}
  </span>
);

export default StatusBadge;
