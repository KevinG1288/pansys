import { act, fireEvent, render, screen } from '@testing-library/react';
import { AuthProvider, useAuth } from '../context/AuthContext';
import { esSesionInvalida } from '../lib/sesion';
import Login from '../pages/Login';
import api from './api';

// Cliente HTTP REAL (axios con sus interceptores) y AuthProvider REAL. Solo se sustituye el
// adaptador de red de axios por respuestas simuladas con los códigos que devuelve el backend.
jest.mock('react-router-dom', () => ({ useNavigate: () => jest.fn() }));

const USUARIO = { id: 2, email: 'panadero@pansys.com', rol: 'panadero', rol_id: 2, panaderia_id: 1 };
const adaptadorOriginal = api.defaults.adapter;

// Responde según la URL: { '/api/x': [status, datos] }; registra el token enviado
let enviados = [];
const simularRed = (respuestas, antesDeResponder) => {
  api.defaults.adapter = async (config) => {
    enviados.push({ url: config.url, token: config.headers.get('Authorization') });
    antesDeResponder?.(config);
    const [status, data] = respuestas[config.url] ?? [200, []];
    const response = { status, data, headers: {}, config, statusText: '' };
    if (status < 400) return response;
    const error = new Error(`HTTP ${status}`);
    Object.assign(error, { config, response, isAxiosError: true });
    throw error;
  };
};

// Simula la ruta privada de App.js: sin sesión se muestra el Login
const Aplicacion = () => {
  const { usuario } = useAuth();
  return usuario ? <p>Sesión de {usuario.email}</p> : <Login />;
};

const iniciar = (token = 'token-actual') => {
  localStorage.setItem('token', token);
  localStorage.setItem('usuario', JSON.stringify(USUARIO));
  render(<AuthProvider><Aplicacion /></AuthProvider>);
  expect(screen.getByText('Sesión de panadero@pansys.com')).toBeInTheDocument();
};

const pedir = (fn) => act(async () => { await fn().catch(() => {}); });

beforeEach(() => {
  enviados = [];
});

afterEach(() => {
  api.defaults.adapter = adaptadorOriginal;
  localStorage.clear();
});

describe('Interceptor de 401 con el cliente real', () => {
  test('un 401 de cuenta desactivada cierra la sesión, lleva al Login y explica el motivo', async () => {
    simularRed({ '/api/inventario?panaderia_id=1': [401, { error: 'La cuenta no está activa. Inicia sesión con una cuenta activa.' }] });
    iniciar();

    let errorRecibido;
    await act(async () => {
      await api.get('/api/inventario?panaderia_id=1').catch(e => { errorRecibido = e; });
    });

    expect(errorRecibido.response.status).toBe(401); // el error sigue llegando a quien llamó
    expect(enviados[0].token).toBe('Bearer token-actual');
    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('usuario')).toBeNull();
    expect(screen.getByRole('button', { name: /Iniciar sesión/ })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Tu sesión terminó');
    expect(screen.getByRole('status')).toHaveTextContent('La cuenta no está activa.');
  });

  test('un token caducado (401) también cierra la sesión', async () => {
    simularRed({ '/api/ventas?panaderia_id=1': [401, { error: 'La sesión expiró. Inicia sesión nuevamente.' }] });
    iniciar();

    await pedir(() => api.get('/api/ventas?panaderia_id=1'));

    expect(localStorage.getItem('token')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('La sesión expiró. Inicia sesión nuevamente.');
  });

  test('un 403 NO cierra la sesión', async () => {
    simularRed({ '/api/ventas': [403, { error: 'No tiene permisos para realizar esta acción' }] });
    iniciar();

    await pedir(() => api.post('/api/ventas', {}));

    expect(localStorage.getItem('token')).toBe('token-actual');
    expect(screen.getByText('Sesión de panadero@pansys.com')).toBeInTheDocument();
  });

  test.each([[400], [404], [409], [500]])('un %i NO cierra la sesión', async (status) => {
    simularRed({ '/api/x': [status, { error: 'otro error' }] });
    iniciar();

    await pedir(() => api.get('/api/x'));

    expect(localStorage.getItem('token')).toBe('token-actual');
  });

  test('un error de red (sin respuesta) NO cierra la sesión', async () => {
    api.defaults.adapter = async (config) => {
      throw Object.assign(new Error('Network Error'), { config, request: {} });
    };
    iniciar();

    await pedir(() => api.get('/api/inventario'));

    expect(localStorage.getItem('token')).toBe('token-actual');
  });

  test('varios 401 simultáneos cierran la sesión una sola vez', async () => {
    simularRed({
      '/api/a': [401, { error: 'Token inválido' }],
      '/api/b': [401, { error: 'Token inválido' }],
      '/api/c': [401, { error: 'Token inválido' }]
    });
    iniciar();
    const borrar = jest.spyOn(Storage.prototype, 'removeItem');

    await act(async () => {
      await Promise.allSettled([api.get('/api/a'), api.get('/api/b'), api.get('/api/c')]);
    });

    expect(borrar.mock.calls.filter(([clave]) => clave === 'token')).toHaveLength(1);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    borrar.mockRestore();
  });

  test('el 401 del propio login lo gestiona el Login (credenciales incorrectas), sin cierre forzado', async () => {
    simularRed({ '/api/auth/login': [401, { error: 'Credenciales inválidas' }] });
    iniciar();

    await pedir(() => api.post('/api/auth/login', { email: 'a@b.co', contrasena: 'x' }));

    expect(localStorage.getItem('token')).toBe('token-actual');
    expect(screen.getByText('Sesión de panadero@pansys.com')).toBeInTheDocument();
  });

  test('un 401 tardío de una sesión anterior no cierra la sesión nueva', async () => {
    // Mientras la petición está en curso se inicia otra sesión (token distinto)
    simularRed({ '/api/inventario': [401, { error: 'Token inválido' }] }, () => localStorage.setItem('token', 'token-nuevo'));
    iniciar('token-viejo');

    await pedir(() => api.get('/api/inventario'));

    expect(localStorage.getItem('token')).toBe('token-nuevo');
    expect(screen.getByText('Sesión de panadero@pansys.com')).toBeInTheDocument();
  });

  test('tras el cierre forzado se puede volver a entrar; un login fallido muestra su propio error', async () => {
    simularRed({ '/api/inventario': [401, { error: 'Token inválido' }] });
    iniciar();
    await pedir(() => api.get('/api/inventario'));
    expect(screen.getByRole('status')).toHaveTextContent('Token inválido');

    // Credenciales incorrectas: error normal del Login, sin bucles de cierre
    simularRed({ '/api/auth/login': [401, { error: 'Credenciales inválidas' }] });
    fireEvent.change(screen.getByLabelText('Correo electrónico'), { target: { value: USUARIO.email } });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'Equivocada1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Email o contraseña incorrectos.');
    expect(screen.queryByText('Tu sesión terminó')).not.toBeInTheDocument();

    // Credenciales correctas: sesión nueva con el token nuevo
    simularRed({ '/api/auth/login': [200, { token: 'token-2', usuario: USUARIO }] });
    fireEvent.change(screen.getByLabelText('Contraseña'), { target: { value: 'Clave1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
    expect(await screen.findByText('Sesión de panadero@pansys.com')).toBeInTheDocument();
    expect(localStorage.getItem('token')).toBe('token-2');
  });
});

describe('esSesionInvalida', () => {
  const error = (status, url, token) => ({
    response: { status },
    config: { url, headers: { Authorization: token ? `Bearer ${token}` : undefined } }
  });

  test('solo un 401 hecho con el token actual y fuera del login', () => {
    expect(esSesionInvalida(error(401, '/api/ventas', 't'), 't')).toBe(true);
    expect(esSesionInvalida(error(403, '/api/ventas', 't'), 't')).toBe(false);
    expect(esSesionInvalida(error(401, '/api/auth/login', 't'), 't')).toBe(false);
    expect(esSesionInvalida(error(401, 'http://localhost:3000/api/auth/login?x=1', 't'), 't')).toBe(false);
    expect(esSesionInvalida(error(401, '/api/auth/contrasena', 't'), 't')).toBe(true);
    expect(esSesionInvalida(error(401, '/api/ventas', 'viejo'), 'nuevo')).toBe(false);
    expect(esSesionInvalida(error(401, '/api/ventas', 't'), null)).toBe(false);
    expect(esSesionInvalida({ request: {} }, 't')).toBe(false);
    expect(esSesionInvalida(undefined, 't')).toBe(false);
  });
});

describe('actualizarUsuario', () => {
  const Mostrar = () => {
    const { usuario, actualizarUsuario } = useAuth();
    return (
      <>
        <p>{usuario?.email}</p>
        <button type="button" onClick={() => actualizarUsuario({ email: 'nuevo@pansys.com' })}>Cambiar</button>
      </>
    );
  };

  test('actualiza la sesión mostrada y la guardada, sin tocar el token', async () => {
    localStorage.setItem('token', 'token-actual');
    localStorage.setItem('usuario', JSON.stringify(USUARIO));
    render(<AuthProvider><Mostrar /></AuthProvider>);

    act(() => screen.getByRole('button', { name: 'Cambiar' }).click());

    expect(await screen.findByText('nuevo@pansys.com')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('usuario'))).toEqual({ ...USUARIO, email: 'nuevo@pansys.com' });
    expect(localStorage.getItem('token')).toBe('token-actual');
  });
});

describe('renovarToken (cambio de contraseña con version_sesion)', () => {
  // Botón que renueva el token como lo hace Mi cuenta tras PATCH /api/auth/contrasena
  const AplicacionConRenovacion = () => {
    const { usuario, renovarToken } = useAuth();
    return usuario
      ? (
        <>
          <p>Sesión de {usuario.email}</p>
          <button type="button" onClick={() => renovarToken('token-renovado')}>Renovar</button>
        </>
      )
      : <Login />;
  };

  const iniciarConRenovacion = () => {
    localStorage.setItem('token', 'token-anterior');
    localStorage.setItem('usuario', JSON.stringify(USUARIO));
    render(<AuthProvider><AplicacionConRenovacion /></AuthProvider>);
  };

  test('las peticiones siguientes envían el token nuevo y la sesión sigue abierta', async () => {
    simularRed({ '/api/inventario': [200, []] });
    iniciarConRenovacion();

    act(() => screen.getByRole('button', { name: 'Renovar' }).click());
    await pedir(() => api.get('/api/inventario'));

    expect(enviados[0].token).toBe('Bearer token-renovado');
    expect(localStorage.getItem('token')).toBe('token-renovado');
    expect(JSON.parse(localStorage.getItem('usuario'))).toEqual(USUARIO);
    expect(screen.getByText('Sesión de panadero@pansys.com')).toBeInTheDocument();
  });

  test('un 401 tardío de una petición hecha con el token anterior no cierra la sesión renovada', async () => {
    // La petición sale con el token anterior y, mientras está en curso, se renueva el token
    simularRed({ '/api/ventas': [401, { error: 'La sesión ya no es válida. Inicia sesión nuevamente.' }] },
      () => localStorage.setItem('token', 'token-renovado'));
    iniciarConRenovacion();

    await pedir(() => api.get('/api/ventas'));

    expect(enviados[0].token).toBe('Bearer token-anterior');
    expect(localStorage.getItem('token')).toBe('token-renovado');
    expect(screen.getByText('Sesión de panadero@pansys.com')).toBeInTheDocument();
  });

  test('en otro dispositivo (token revocado), el 401 cierra la sesión y explica el motivo', async () => {
    simularRed({ '/api/inventario': [401, { error: 'La sesión ya no es válida. Inicia sesión nuevamente.' }] });
    iniciarConRenovacion();

    await pedir(() => api.get('/api/inventario'));

    expect(localStorage.getItem('token')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('La sesión ya no es válida. Inicia sesión nuevamente.');
  });
});
