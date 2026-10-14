import { createContext, useCallback, useEffect, useState, useContext } from 'react';
import { alInvalidarSesion } from '../lib/sesion';

const AuthContext = createContext();

const leerUsuarioGuardado = () => {
  try {
    return JSON.parse(localStorage.getItem('usuario')) || null;
  } catch {
    return null;
  }
};

export const AuthProvider = ({ children }) => {
  const [usuario, setUsuario] = useState(leerUsuarioGuardado);
  // Motivo del último cierre de sesión forzado (lo muestra el Login)
  const [avisoSesion, setAvisoSesion] = useState(null);

  const login = (token, usuario) => {
    localStorage.setItem('token', token);
    localStorage.setItem('usuario', JSON.stringify(usuario));
    setAvisoSesion(null);
    setUsuario(usuario);
  };

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('usuario');
    setUsuario(null);
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

  // El backend respondió 401: se borra la sesión y la ruta privada redirige al Login
  useEffect(() => alInvalidarSesion((mensaje) => {
    logout();
    setAvisoSesion(mensaje);
  }), [logout]);

  return (
    <AuthContext.Provider value={{ usuario, login, logout, actualizarUsuario, avisoSesion }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
