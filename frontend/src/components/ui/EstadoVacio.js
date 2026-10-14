// Mensaje para listas sin datos o búsquedas sin resultados
const EstadoVacio = ({ icono: Icono, titulo, descripcion, children }) => (
  <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
    {Icono && <Icono className="size-8 text-muted-foreground" aria-hidden="true" />}
    <p className="font-medium">{titulo}</p>
    {descripcion && <p className="max-w-sm text-sm text-muted-foreground">{descripcion}</p>}
    {children && <div className="mt-2">{children}</div>}
  </div>
);

export default EstadoVacio;
