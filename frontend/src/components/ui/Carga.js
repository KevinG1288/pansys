const Carga = ({ texto = 'Cargando datos…' }) => (
  <div role="status" className="p-5">
    <p className="mb-4 text-sm text-muted-foreground">{texto}</p>
    <div aria-hidden="true" className="grid gap-3 motion-safe:animate-pulse">
      <div className="h-3 w-1/3 rounded-full bg-muted" />
      <div className="h-10 rounded-xl bg-muted/70" /><div className="h-10 rounded-xl bg-muted/40" />
    </div>
  </div>
);
export default Carga;
