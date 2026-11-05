// Mensaje para listas sin datos o búsquedas sin resultados
const EstadoVacio = ({ icono: Icono, titulo, descripcion, children }) => (
  <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
    {Icono && <span className="mb-1 flex size-14 items-center justify-center rounded-2xl border border-border bg-background"><Icono className="size-6 text-muted-foreground" aria-hidden="true" /></span>}
    <p className="font-medium">{titulo}</p>
    {descripcion && <p className="max-w-sm text-sm text-muted-foreground">{descripcion}</p>}
    {children && <div className="mt-2">{children}</div>}
  </div>
);

export default EstadoVacio;
