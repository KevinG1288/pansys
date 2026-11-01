import { render, screen, waitFor } from '@testing-library/react';
import App from './App';
import api from './services/api';

// Enrutado REAL de App.js. Jest 27 (react-scripts 5) no resuelve react-router-dom 7, que carga la
// subruta "react-router/dom" mediante el campo "exports"; react-router exporta los mismos
// componentes y hooks que usa la aplicación (BrowserRouter, Routes, Route, Navigate, Link,
// useLocation, useNavigate), así que las rutas se prueban con el enrutador real.
// react-router 7 usa TextEncoder al cargarse y el jsdom de Jest 27 no lo define: se toma del módulo
// nativo util, solo en esta prueba y justo antes de cargar el enrutador.
jest.mock('react-router-dom', () => {
  const { TextEncoder, TextDecoder } = require('util');
  if (typeof global.TextEncoder === 'undefined') global.TextEncoder = TextEncoder;
  if (typeof global.TextDecoder === 'undefined') global.TextDecoder = TextDecoder;
  return jest.requireActual('react-router');
});

// Sin red: las rutas probadas solo usan api.post (/restablecer valida el enlace al montarse).
jest.mock('./services/api', () => ({
  __esModule: true,
  default: { post: jest.fn() }
}));

const TOKEN = 'Q'.repeat(20) + '-_' + 'z'.repeat(21); // 43 caracteres base64url
const URL_VALIDAR = '/api/auth/restablecimiento/validar';

const abrir = (ruta) => {
  window.history.pushState({}, '', ruta);
  return render(<App />);
};

beforeEach(() => {
  localStorage.clear();
  api.post.mockReset();
});

test('/login es pública y muestra el inicio de sesión', () => {
  abrir('/login');
  expect(window.location.pathname).toBe('/login');
  expect(screen.getByRole('heading', { name: 'Iniciar sesión' })).toBeInTheDocument();
});

test('/dashboard sin sesión redirige a /login', async () => {
  abrir('/dashboard');
  await waitFor(() => expect(window.location.pathname).toBe('/login'));
  expect(screen.getByRole('heading', { name: 'Iniciar sesión' })).toBeInTheDocument();
});

test('una ruta desconocida redirige a /login', async () => {
  abrir('/ruta-que-no-existe');
  await waitFor(() => expect(window.location.pathname).toBe('/login'));
  expect(screen.getByRole('heading', { name: 'Iniciar sesión' })).toBeInTheDocument();
});

test('/recuperar es pública: no redirige y muestra el formulario', () => {
  abrir('/recuperar');
  expect(window.location.pathname).toBe('/recuperar');
  expect(screen.getByText('Recuperar contraseña')).toBeInTheDocument();
  expect(api.post).not.toHaveBeenCalled(); // solo se pide al enviar
});

test('/restablecer#token= es pública: lee el token antes de cualquier redirección, lo valida y lo quita de la URL', async () => {
  api.post.mockResolvedValue({ status: 200, data: { estado: 'activo' } }); // respuesta real del backend
  abrir(`/restablecer#token=${TOKEN}`);
  expect(window.location.pathname).toBe('/restablecer');
  expect(await screen.findByLabelText('Contraseña nueva')).toBeInTheDocument();
  expect(api.post).toHaveBeenCalledWith(URL_VALIDAR, { token: TOKEN });
  expect(window.location.hash).toBe('');
});
