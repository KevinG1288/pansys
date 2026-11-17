import { createContext, Fragment, useCallback, useEffect, useRef, useState, useContext } from 'react';
import {
  alInvalidarSesion, alDetectarCambioDeSesion, fijarTokenPestana, identidadToken, leerTokenGuardado,
  mismaCuenta, tokenDePestana
} from '../lib/sesion';

const AuthContext = createContext();

const leerUsuarioGuardado = () => {
  try {
    return JSON.parse(localStorage.getItem('usuario')) || null;
  } catch {
    return null;
  }
};

// El usuario guardado corresponde al token: mismo id (si el token es un JWT legible)
const coherentes = (token, usuario) => {
  if (!token || !usuario) return false;
  const identidad = identidadToken(token);
  return !identidad || identidad.id === usuario.id;
};

// Sesión con la que arranca la pestaña (también tras recargar la página): la guardada. Si el token
// declara OTRA cuenta que el usuario guardado (sesión a medio guardar), se pide iniciar sesión.
const sesionInicial = () => {
  const token = leerTokenGuardado(), usuario = leerUsuarioGuardado();
  if (token && usuario && !coherentes(token, usuario)) {
    fijarTokenPestana(null);
    return null;
  }
  fijarTokenPestana(token);
  return usuario;
};

export const AuthProvider = ({ children }) => {
  const [usuario, setUsuario] = useState(sesionInicial);
  // Motivo del último cierre de sesión forzado (lo muestra el Login)
  const [avisoSesion, setAvisoSesion] = useState(null);
  // Aviso tras cambiar de cuenta desde otra pestaña (lo muestra el Dashboard)
  const [avisoCambioSesion, setAvisoCambioSesion] = useState(null);
  // Cambia con cada cambio de cuenta: vuelve a montar toda la interfaz (sin datos, formularios ni
  // diálogos de la cuenta anterior) y la deja en su pantalla inicial
  const [generacion, setGeneracion] = useState(0);
  const usuarioRef = useRef(usuario);
  usuarioRef.current = usuario;

  const login = (token, usuario) => {
    localStorage.setItem('usuario', JSON.stringify(usuario));
    localStorage.setItem('token', token);
    fijarTokenPestana(token);
    setAvisoSesion(null);
    setAvisoCambioSesion(null);
    setUsuario(usuario);
  };

  // Cierra la sesión de esta pestaña. Solo borra la sesión guardada si es la de esta pestaña (o un
  // token renovado de la misma cuenta): nunca la de otra cuenta abierta en otra pestaña.
  const logout = useCallback(() => {
    const propio = tokenDePestana(), guardado = leerTokenGuardado();
    if (propio === undefined || guardado === propio || (propio && mismaCuenta(guardado, propio))) {
      localStorage.removeItem('token');
      localStorage.removeItem('usuario');
    }
    fijarTokenPestana(null);
    setAvisoCambioSesion(null);
    setUsuario(null);
  }, []);

  // Sustituye el token de la sesión actual por uno nuevo (tras cambiar la contraseña, el backend
  // invalida los anteriores y entrega otro a este dispositivo). No cambia el usuario mostrado.
  const renovarToken = useCallback((token) => {
    localStorage.setItem('token', token);
    fijarTokenPestana(token);
  }, []);

  // Actualiza los datos mostrados de la sesión (p. ej. el email propio editado en Cuentas)
  const actualizarUsuario = useCallback((cambios) => {
    setUsuario(actual => {
      if (!actual) return actual;
      const nuevo = { ...actual, ...cambios };
      localStorage.setItem('usuario', JSON.stringify(nuevo));
      return nuevo;
    });
  }, []);

  // Ajusta esta pestaña a la sesión guardada por otra pestaña (evento storage) o cuando el cliente
  // HTTP detecta que ya no coinciden. Lee el estado guardado en el momento (no el del evento).
  const sincronizar = useCallback(() => {
    const token = leerTokenGuardado(), guardado = leerUsuarioGuardado();
    const propio = tokenDePestana(), actual = usuarioRef.current;

    if (!token) { // sesión cerrada en otra pestaña
      if (propio || actual) {
        fijarTokenPestana(null);
        setAvisoCambioSesion(null);
        setUsuario(null);
        setAvisoSesion('Se cerró la sesión en otra pestaña.');
      }
      return;
    }
    if (propio && (token === propio || mismaCuenta(token, propio))) { // misma cuenta
      fijarTokenPestana(token);
      if (guardado && actual && guardado.id === actual.id && coherentes(token, guardado)) setUsuario(guardado);
      return;
    }
    // Otra cuenta. Si el usuario guardado aún no corresponde al token (la otra pestaña está a mitad
    // de guardar la sesión), se espera al siguiente evento; mientras, las peticiones siguen bloqueadas.
    if (!coherentes(token, guardado)) return;
    fijarTokenPestana(token);
    setAvisoSesion(null);
    setUsuario(guardado);
    if (actual) {
      setAvisoCambioSesion(`La sesión cambió en otra pestaña. Ahora trabajas como ${guardado.email ?? 'otra cuenta'}; se descartó la pantalla anterior.`);
      setGeneracion(g => g + 1);
    }
  }, []);

  useEffect(() => {
    const alCambiarAlmacenamiento = (evento) => {
      if (evento.storageArea && evento.storageArea !== localStorage) return;
      if (evento.key === null || evento.key === 'token' || evento.key === 'usuario') sincronizar();
    };
    window.addEventListener('storage', alCambiarAlmacenamiento);
    const anular = alDetectarCambioDeSesion(sincronizar);
    return () => {
      window.removeEventListener('storage', alCambiarAlmacenamiento);
      anular();
    };
  }, [sincronizar]);

  // El backend respondió 401: se borra la sesión y la ruta privada redirige al Login
  useEffect(() => alInvalidarSesion((mensaje) => {
    logout();
    setAvisoSesion(mensaje);
  }), [logout]);

  const cerrarAvisoCambioSesion = useCallback(() => setAvisoCambioSesion(null), []);

  return (
    <AuthContext.Provider value={{
      usuario, login, logout, actualizarUsuario, renovarToken, avisoSesion, avisoCambioSesion, cerrarAvisoCambioSesion
    }}>
      <Fragment key={generacion}>{children}</Fragment>
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
