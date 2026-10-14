import { Wheat } from 'lucide-react';
import { cn } from '../../lib/utils';

const Logo = ({ className }) => (
  <div className={cn('flex items-center gap-2.5', className)}>
    <span className="flex size-9 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground shadow-sm">
      <Wheat className="size-5" aria-hidden="true" />
    </span>
    <span className="flex flex-col leading-none">
      <span className="font-serif text-xl font-semibold tracking-tight">Pansys</span>
      <span className="mt-1 text-[11px] uppercase tracking-[0.18em] opacity-60">Panadería</span>
    </span>
  </div>
);

export default Logo;
