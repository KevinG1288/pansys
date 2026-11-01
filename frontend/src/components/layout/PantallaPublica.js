import Logo from './Logo';

// Marco de las pantallas públicas sin sesión (recuperación de contraseña): el mismo fondo, tarjeta
// y logotipo que la columna del formulario del Login, en una sola columna adaptable.
const PantallaPublica = ({ titulo, descripcion, children, pie }) => (
  <div className="pansys-ui flex min-h-screen items-center justify-center bg-background px-4 py-10">
    <div className="w-full max-w-sm">
      <div className="mb-8 flex justify-center text-foreground">
        <Logo />
      </div>
      <main className="rounded-2xl border border-border/80 bg-card p-7 shadow-panel">
        <h1 className="font-serif text-2xl font-semibold tracking-tight">{titulo}</h1>
        {descripcion && <p className="mt-1 text-sm text-muted-foreground">{descripcion}</p>}
        <div className="mt-6">{children}</div>
      </main>
      {pie && <div className="mt-6 text-center text-xs text-muted-foreground">{pie}</div>}
    </div>
  </div>
);

export default PantallaPublica;
