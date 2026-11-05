import { Check, Clock3, PackageCheck, Send, X } from 'lucide-react';
import { cn } from '../../lib/utils';

// Se representa el estado real; rechazo y cancelación nunca se muestran como transferencia.
const SeguimientoSolicitud = ({ estado }) => {
  const pendiente = estado === 'pendiente', aceptada = estado === 'aceptada';
  const pasos = [
    { texto: 'Solicitud enviada', icono: Send, hecho: true },
    { texto: pendiente ? 'Esperando respuesta' : 'Solicitud cerrada', icono: pendiente ? Clock3 : Check, hecho: !pendiente, actual: pendiente },
    { texto: aceptada ? 'Inventario transferido' : pendiente ? 'Transferencia por confirmar' : 'Sin transferencia', icono: aceptada ? PackageCheck : pendiente ? PackageCheck : X, hecho: aceptada }
  ];
  return <ol aria-label="Seguimiento de la solicitud" className="grid gap-2 rounded-xl border border-border bg-background p-3 sm:grid-cols-3">
    {pasos.map((p, i) => <li key={i} aria-current={p.actual ? 'step' : undefined} className="flex items-center gap-2.5 px-1 py-2">
      <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-full', p.hecho ? 'bg-success/10 text-success' : p.actual ? 'bg-warning/15 text-warning-foreground' : 'bg-muted text-muted-foreground')}><p.icono className="size-4" aria-hidden="true" /></span>
      <span className={cn('text-xs leading-relaxed', p.hecho || p.actual ? 'font-medium text-foreground' : 'text-muted-foreground')}>{p.texto}</span>
    </li>)}
  </ol>;
};
export default SeguimientoSolicitud;
