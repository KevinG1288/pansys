import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, KeyRound } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { mensajeError } from '../lib/errores';
import { validarContrasena } from '../lib/validacion';
import { leerTokenDelFragmento, limpiarFragmento } from '../lib/restablecimiento';
import { cn } from '../lib/utils';
import Aviso from '../components/ui/Aviso';
import Boton from '../components/ui/Boton';
import { estiloControl } from '../components/ui/Campo';
import PantallaPublica from '../components/layout/PantallaPublica';

// Contratos reales del backend (restablecimiento.service.js):
//  POST /api/auth/restablecimiento/validar   { token }                    -> 200 activo | 202 procesando | 400 | 429
//  POST /api/auth/restablecimiento/confirmar { token, contrasena_nueva }  -> 200 | 400 | 409 PROCESANDO | 429
// El backend responde igual (400) a un enlace caducado, usado, inválido o agotado: no se distinguen.
// La confirmación no inicia sesión: revoca las sesiones anteriores y se vuelve al Login.

// Mientras el enlace está "procesando" (el correo se está enviando) se vuelve a consultar
const INTERVALO_CONSULTA_MS = 2000;
const MAXIMO_CONSULTAS = 35;

const MENSAJE_INVALIDO = 'El enlace no es válido o ha caducado. Solicita uno nuevo.';
const MENSAJE_BLOQUEADO = 'Hubo demasiados intentos desde este equipo. Espera unos minutos y vuelve a intentarlo.';

// Campo de contraseña con botón para mostrarla, como en el Login
const CampoContrasena = ({ id, etiqueta, valor, onCambiar, error, autoComplete, refCampo }) => {
  const [ver, setVer] = useState(false);
  const idError = error ? `${id}-error` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">{etiqueta}</label>
      <div className="relative">
        <input
          ref={refCampo}
          id={id}
          type={ver ? 'text' : 'password'}
          autoComplete={autoComplete}
          value={valor}
          onChange={(e) => onCambiar(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={idError}
          className={cn(estiloControl, 'pr-11')}
        />
        <button
          type="button"
          onClick={() => setVer(v => !v)}
          aria-label={ver ? `Ocultar ${etiqueta.toLowerCase()}` : `Mostrar ${etiqueta.toLowerCase()}`}
          aria-pressed={ver}
          className="absolute right-1 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {ver ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
        </button>
      </div>
      {error && <p id={idError} className="text-xs font-medium text-destructive">{error}</p>}
    </div>
  );
};

const RestablecerContrasena = ({ intervaloConsultaMs = INTERVALO_CONSULTA_MS, maximoConsultas = MAXIMO_CONSULTAS }) => {
  // El token se lee una sola vez del fragmento (también con React.StrictMode, que repite el
  // inicializador antes de que el efecto borre el fragmento) y solo vive en memoria
  const [token] = useState(() => leerTokenDelFragmento(window.location.hash));
  // estado: validando | procesando | formulario | invalido | bloqueado | conexion
  const [estado, setEstado] = useState(token ? 'validando' : 'invalido');
  const [nueva, setNueva] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [errores, setErrores] = useState({});
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const guardandoRef = useRef(false);
  const refNueva = useRef(null);
  const montado = useRef(true);
  const { logout } = useAuth();
  const navigate = useNavigate();

  // El fragmento con el token se borra de la barra de direcciones en cuanto se monta la página
  useEffect(() => {
    limpiarFragmento();
  }, []);

  useEffect(() => {
    montado.current = true;
    return () => { montado.current = false; };
  }, []);

  // `cancelada` indica si esta comprobación ya no debe actualizar la página (desmontaje, o el
  // remontaje de React.StrictMode en desarrollo): cada ejecución tiene la suya y no se solapan
  const validarEnlace = useCallback(async (cancelada = () => !montado.current) => {
    if (!token) return;
    setEstado('validando');
    for (let consulta = 1; consulta <= maximoConsultas; consulta++) {
      let res;
      try {
        res = await api.post('/api/auth/restablecimiento/validar', { token });
      } catch (err) {
        if (cancelada()) return;
        const codigo = err?.response?.status;
        setEstado(codigo === 429 ? 'bloqueado' : codigo === 400 ? 'invalido' : 'conexion');
        return;
      }
      if (cancelada()) return;
      if (res?.status === 200 && res.data?.estado === 'activo') {
        setEstado('formulario');
        return;
      }
      if (res?.status === 202 && res.data?.estado === 'procesando') {
        setEstado('procesando');
        await new Promise(resolver => setTimeout(resolver, intervaloConsultaMs));
        if (cancelada()) return;
        continue;
      }
      setEstado('invalido');
      return;
    }
    // La reserva venció sin activarse: el enlace no llegó a ser válido
    if (!cancelada()) setEstado('invalido');
  }, [token, intervaloConsultaMs, maximoConsultas]);

  useEffect(() => {
    let cancelada = false;
    validarEnlace(() => cancelada);
    return () => { cancelada = true; };
  }, [validarEnlace]);

  useEffect(() => {
    if (estado === 'formulario') refNueva.current?.focus();
  }, [estado]);

  const guardar = async (e) => {
    e.preventDefault();
    if (guardandoRef.current) return;
    const nuevos = {};
    const errorNueva = validarContrasena(nueva);
    if (errorNueva) nuevos.nueva = errorNueva;
    if (!confirmacion) nuevos.confirmacion = 'Este campo es obligatorio';
    else if (!errorNueva && confirmacion !== nueva) nuevos.confirmacion = 'Las contraseñas no coinciden';
    setErrores(nuevos);
    setError('');
    if (Object.keys(nuevos).length) return;

    guardandoRef.current = true;
    setGuardando(true);
    try {
      const res = await api.post('/api/auth/restablecimiento/confirmar', { token, contrasena_nueva: nueva });
      // Las sesiones anteriores quedaron revocadas en el backend: la de este navegador, si la había,
      // se borra ya (sin esperar a que un 401 la cierre) y se vuelve al Login
      logout();
      navigate('/login', {
        replace: true,
        state: { aviso: typeof res?.data?.mensaje === 'string' ? res.data.mensaje : 'Contraseña restablecida. Inicia sesión con la contraseña nueva.' }
      });
    } catch (err) {
      const codigo = err?.response?.status;
      if (codigo === 429) setEstado('bloqueado');
      else if (codigo === 409) setError('El enlace aún se está procesando. Espera unos segundos y vuelve a intentarlo.');
      else setError(mensajeError(err, 'No se pudo restablecer la contraseña. Inténtalo de nuevo.'));
      setNueva('');
      setConfirmacion('');
      guardandoRef.current = false;
      setGuardando(false);
    }
  };

  const enlaceSolicitar = <Link to="/recuperar" className="font-medium text-primary hover:underline">Solicitar un enlace nuevo</Link>;
  const pie = <Link to="/login" className="font-medium text-primary hover:underline">Volver a iniciar sesión</Link>;

  return (
    <PantallaPublica titulo="Nueva contraseña" descripcion="Elige la contraseña con la que iniciarás sesión." pie={pie}>
      {estado === 'validando' && <Aviso tipo="info">Comprobando el enlace…</Aviso>}
      {estado === 'procesando' && <Aviso tipo="info">Estamos terminando de preparar el enlace. Espera unos segundos…</Aviso>}
      {estado === 'invalido' && (
        <div className="flex flex-col gap-4">
          <Aviso tipo="error" titulo="Enlace no válido">{MENSAJE_INVALIDO}</Aviso>
          <p className="text-sm">{enlaceSolicitar}</p>
        </div>
      )}
      {estado === 'bloqueado' && <Aviso tipo="error" titulo="Demasiados intentos">{MENSAJE_BLOQUEADO}</Aviso>}
      {estado === 'conexion' && (
        <div className="flex flex-col gap-4">
          <Aviso tipo="error">No se pudo comprobar el enlace. Revisa la conexión e inténtalo de nuevo.</Aviso>
          <Boton variante="contorno" onClick={() => validarEnlace()}>Reintentar</Boton>
        </div>
      )}
      {estado === 'formulario' && (
        <form onSubmit={guardar} noValidate className="flex flex-col gap-4">
          {error && <Aviso tipo="error">{error}</Aviso>}
          <CampoContrasena
            id="restablecer-nueva"
            etiqueta="Contraseña nueva"
            valor={nueva}
            onCambiar={setNueva}
            error={errores.nueva}
            autoComplete="new-password"
            refCampo={refNueva}
          />
          <p className="-mt-2 text-xs text-muted-foreground">Al menos 8 caracteres, con una letra y un número.</p>
          <CampoContrasena
            id="restablecer-confirmacion"
            etiqueta="Repite la contraseña"
            valor={confirmacion}
            onCambiar={setConfirmacion}
            error={errores.confirmacion}
            autoComplete="new-password"
          />
          <Boton type="submit" cargando={guardando} className="mt-2 w-full">
            {!guardando && <KeyRound className="size-4" aria-hidden="true" />}
            {guardando ? 'Guardando…' : 'Guardar contraseña'}
          </Boton>
        </form>
      )}
    </PantallaPublica>
  );
};

export default RestablecerContrasena;
