import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpenText, ChefHat, Eye, EyeOff, LogIn, Package, ShoppingBasket } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { mensajeError } from '../lib/errores';
import { cn } from '../lib/utils';
import Aviso from '../components/ui/Aviso';
import Boton from '../components/ui/Boton';
import Campo, { estiloControl } from '../components/ui/Campo';
import Logo from '../components/layout/Logo';

const PATRON_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const MODULOS = [
  { icono: Package, texto: 'Inventario de insumos con alertas de stock' },
  { icono: ShoppingBasket, texto: 'Punto de venta e historial' },
  { icono: ChefHat, texto: 'Órdenes de producción con trazabilidad' },
  { icono: BookOpenText, texto: 'Recetas y costo por unidad' }
];

// Mensaje claro para cada caso, sin revelar si el email existe (el backend responde igual a ambos)
const mensajeLogin = (error) => {
  const estado = error?.response?.status;
  if (estado === 401) return 'Email o contraseña incorrectos.';
  if (estado === 400) return mensajeError(error, 'Revisa el email y la contraseña.');
  return mensajeError(error, 'No se pudo iniciar sesión. Inténtalo de nuevo.');
};

const Login = () => {
  const [email, setEmail] = useState('');
  const [contrasena, setContrasena] = useState('');
  const [verContrasena, setVerContrasena] = useState(false);
  const [errores, setErrores] = useState({});
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);
  const enviandoRef = useRef(false);
  const refEmail = useRef(null);
  const refContrasena = useRef(null);
  const { login, avisoSesion } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    refEmail.current?.focus();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (enviandoRef.current) return;

    const correo = email.trim();
    const nuevos = {};
    if (!correo) nuevos.email = 'Escribe tu correo electrónico';
    else if (!PATRON_EMAIL.test(correo)) nuevos.email = 'Escribe un correo válido';
    if (!contrasena) nuevos.contrasena = 'Escribe tu contraseña';
    setErrores(nuevos);
    setError('');
    if (nuevos.email) {
      refEmail.current?.focus();
      return;
    }
    if (nuevos.contrasena) {
      refContrasena.current?.focus();
      return;
    }

    enviandoRef.current = true;
    setCargando(true);
    try {
      // Mismo contrato de siempre: el token y los datos públicos del usuario quedan en AuthContext;
      // la contraseña nunca se guarda en el navegador
      const res = await api.post('/api/auth/login', { email: correo, contrasena });
      login(res.data.token, res.data.usuario);
      navigate('/dashboard');
    } catch (err) {
      setError(mensajeLogin(err));
      setContrasena('');
      enviandoRef.current = false;
      setCargando(false);
    }
  };

  const idErrorContrasena = errores.contrasena ? 'login-contrasena-error' : undefined;

  return (
    <div className="pansys-ui grid min-h-screen bg-background lg:grid-cols-[1.1fr_1fr]">
      <aside className="hidden flex-col justify-between bg-sidebar p-10 text-sidebar-foreground lg:flex">
        <Logo />
        <div className="max-w-md">
          <h2 className="font-serif text-4xl font-semibold leading-tight tracking-tight text-sidebar-accent-foreground">
            Gestión para panaderías de barrio
          </h2>
          <p className="mt-3 text-sm opacity-75">
            Inventario, ventas y producción de la panadería en un solo lugar.
          </p>
          <ul className="mt-8 flex flex-col gap-3">
            {MODULOS.map(({ icono: Icono, texto }) => (
              <li key={texto} className="flex items-center gap-3 text-sm">
                <span className="flex size-8 items-center justify-center rounded-lg bg-sidebar-accent text-sidebar-primary">
                  <Icono className="size-4" aria-hidden="true" />
                </span>
                {texto}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-xs opacity-50">Localidad de Kennedy · Bogotá</p>
      </aside>

      <main className="flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex justify-center text-foreground lg:hidden">
            <Logo />
          </div>
          <div className="rounded-2xl border border-border/80 bg-card p-7 shadow-panel">
            <h1 className="font-serif text-2xl font-semibold tracking-tight">Iniciar sesión</h1>
            <p className="mt-1 text-sm text-muted-foreground">Usa la cuenta que te asignó el administrador.</p>

            <form onSubmit={handleSubmit} noValidate className="mt-6 flex flex-col gap-4">
              {avisoSesion && !error && <Aviso tipo="info" titulo="Tu sesión terminó">{avisoSesion}</Aviso>}
              {error && <Aviso tipo="error">{error}</Aviso>}
              <Campo
                ref={refEmail}
                etiqueta="Correo electrónico"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                error={errores.email}
                placeholder="nombre@panaderia.com"
              />
              <div className="flex flex-col gap-1.5">
                <label htmlFor="login-contrasena" className="text-sm font-medium">Contraseña</label>
                <div className="relative">
                  <input
                    ref={refContrasena}
                    id="login-contrasena"
                    type={verContrasena ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={contrasena}
                    onChange={(e) => setContrasena(e.target.value)}
                    aria-invalid={errores.contrasena ? true : undefined}
                    aria-describedby={idErrorContrasena}
                    className={cn(estiloControl, 'pr-11')}
                  />
                  <button
                    type="button"
                    onClick={() => setVerContrasena(v => !v)}
                    aria-label={verContrasena ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    aria-pressed={verContrasena}
                    className="absolute right-1 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {verContrasena ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
                  </button>
                </div>
                {errores.contrasena && (
                  <p id={idErrorContrasena} className="text-xs font-medium text-destructive">{errores.contrasena}</p>
                )}
              </div>
              <Boton type="submit" cargando={cargando} className="mt-2 w-full">
                {!cargando && <LogIn className="size-4" aria-hidden="true" />}
                {cargando ? 'Iniciando sesión…' : 'Iniciar sesión'}
              </Boton>
            </form>
          </div>
          <p className="mt-6 text-center text-xs text-muted-foreground">
            ¿No tienes cuenta? Pídela al administrador de tu panadería.
          </p>
        </div>
      </main>
    </div>
  );
};

export default Login;
