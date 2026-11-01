import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider } from '../context/AuthContext';
import api from '../services/api';
import RestablecerContrasena from './RestablecerContrasena';

// Jest 27 (CRA 5) no resuelve 'react-router/dom': se sustituyen useNavigate y Link
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  Link: ({ to, children, ...props }) => require('react').createElement('a', { href: to, ...props }, children)
}));

// Sin red: la API se sustituye por funciones simuladas. AuthProvider y logout() son los reales.
jest.mock('../services/api', () => ({
  __esModule: true,
  default: { post: jest.fn() }
}));

const TOKEN = 'Q'.repeat(20) + '-_' + 'z'.repeat(21); // 43 caracteres base64url
const URL_VALIDAR = '/api/auth/restablecimiento/validar';
const URL_CONFIRMAR = '/api/auth/restablecimiento/confirmar';
// Mensajes reales del backend (restablecimiento.service.js)
const MENSAJE_400 = 'El enlace no es válido o ha caducado. Solicite uno nuevo.';
const MENSAJE_200 = 'Contraseña restablecida. Inicie sesión con la contraseña nueva.';
const activo = { status: 200, data: { estado: 'activo' } };
const procesando = { status: 202, data: { estado: 'procesando' } };
const errorHttp = (status, data = {}) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data, headers: {} } });

const abrir = (hash = `#token=${TOKEN}`, props = {}) => {
  window.history.replaceState(null, '', `/restablecer${hash}`);
  return render(<AuthProvider><RestablecerContrasena intervaloConsultaMs={5} {...props} /></AuthProvider>);
};
const nueva = () => screen.getByLabelText('Contraseña nueva');
const repetir = () => screen.getByLabelText('Repite la contraseña');
const guardar = () => userEvent.click(screen.getByRole('button', { name: 'Guardar contraseña' }));
const llamadas = (url) => api.post.mock.calls.filter(([u]) => u === url);

let espiasConsola;
beforeEach(() => {
  espiasConsola = ['log', 'info', 'warn', 'error', 'debug'].map(m => jest.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => {
  // El token nunca se escribe en la consola
  const escrito = espiasConsola.flatMap(e => e.mock.calls).map(args => args.map(String).join(' ')).join('\n');
  expect(escrito).not.toContain(TOKEN);
  espiasConsola.forEach(e => e.mockRestore());
  jest.clearAllMocks();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

test('lee el token del fragmento, lo borra de la barra de direcciones y valida el enlace con el contrato real', async () => {
  api.post.mockResolvedValueOnce(activo);
  abrir();
  expect(window.location.hash).toBe('');
  expect(window.location.pathname).toBe('/restablecer');
  expect(await screen.findByLabelText('Contraseña nueva')).toHaveFocus();
  expect(api.post).toHaveBeenCalledWith(URL_VALIDAR, { token: TOKEN });
  expect(document.body.textContent).not.toContain(TOKEN);
});

test.each([
  ['sin fragmento', ''],
  ['sin token', '#otra=1'],
  ['token con formato no válido', '#token=corto']
])('%s -> enlace no válido, sin ninguna petición y con el enlace para pedir otro', (_, hash) => {
  abrir(hash);
  expect(screen.getByRole('alert')).toHaveTextContent('El enlace no es válido o ha caducado. Solicita uno nuevo.');
  expect(screen.getByRole('link', { name: 'Solicitar un enlace nuevo' })).toHaveAttribute('href', '/recuperar');
  expect(api.post).not.toHaveBeenCalled();
  expect(window.location.hash).toBe('');
});

test('400 al validar (caducado, usado, inválido o agotado: el backend no los distingue) -> enlace no válido', async () => {
  api.post.mockRejectedValueOnce(errorHttp(400, { error: MENSAJE_400 }));
  abrir();
  expect(await screen.findByRole('alert')).toHaveTextContent('El enlace no es válido o ha caducado. Solicita uno nuevo.');
  expect(screen.queryByLabelText('Contraseña nueva')).toBeNull();
});

test('429 al validar -> demasiados intentos, sin formulario', async () => {
  api.post.mockRejectedValueOnce(errorHttp(429, { error: 'Demasiados intentos.' }));
  abrir();
  expect(await screen.findByRole('alert')).toHaveTextContent('Hubo demasiados intentos desde este equipo.');
  expect(screen.queryByLabelText('Contraseña nueva')).toBeNull();
});

test('sin conexión al validar -> aviso y botón para reintentar, que vuelve a validar', async () => {
  api.post.mockRejectedValueOnce(Object.assign(new Error('Network Error'), { request: {} })).mockResolvedValueOnce(activo);
  abrir();
  userEvent.click(await screen.findByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByLabelText('Contraseña nueva')).toBeInTheDocument();
  expect(llamadas(URL_VALIDAR)).toHaveLength(2);
});

test('«procesando» (202) -> espera y vuelve a consultar hasta que el enlace está activo', async () => {
  api.post.mockResolvedValueOnce(procesando).mockResolvedValueOnce(procesando).mockResolvedValueOnce(activo);
  abrir();
  expect(await screen.findByText(/Estamos terminando de preparar el enlace/)).toBeInTheDocument();
  expect(await screen.findByLabelText('Contraseña nueva')).toBeInTheDocument();
  expect(llamadas(URL_VALIDAR)).toHaveLength(3);
});

test('«procesando» más allá del máximo de consultas -> enlace no válido y no se consulta más', async () => {
  api.post.mockResolvedValue(procesando);
  abrir(undefined, { maximoConsultas: 3 });
  expect(await screen.findByRole('alert')).toHaveTextContent('El enlace no es válido o ha caducado.');
  expect(llamadas(URL_VALIDAR)).toHaveLength(3);
});

test.each([
  ['débil', 'corta', 'corta', 'Debe tener al menos 8 caracteres', 'nueva'],
  ['sin número', 'solamenteletras', 'solamenteletras', 'Debe incluir al menos una letra y un número', 'nueva'],
  ['que no coincide', 'NuevaClave123', 'NuevaClave124', 'Las contraseñas no coinciden', 'confirmacion']
])('contraseña %s -> error en el campo y ninguna confirmación', async (_, a, b, mensaje, campo) => {
  api.post.mockResolvedValueOnce(activo);
  abrir();
  userEvent.type(await screen.findByLabelText('Contraseña nueva'), a);
  userEvent.type(repetir(), b);
  guardar();
  expect(screen.getByText(mensaje)).toBeInTheDocument();
  expect((campo === 'nueva' ? nueva() : repetir())).toHaveAttribute('aria-invalid', 'true');
  expect(llamadas(URL_CONFIRMAR)).toHaveLength(0);
});

test('éxito -> contrato real, la sesión local se borra y se vuelve al Login con el aviso del backend', async () => {
  localStorage.setItem('token', 'jwt-de-una-sesion-anterior');
  localStorage.setItem('usuario', JSON.stringify({ id: 9, email: 'x@pansys.test', rol_id: 2 }));
  api.post.mockResolvedValueOnce(activo).mockResolvedValueOnce({ status: 200, data: { mensaje: MENSAJE_200 } });
  abrir();
  userEvent.type(await screen.findByLabelText('Contraseña nueva'), 'NuevaClave123');
  userEvent.type(repetir(), 'NuevaClave123');
  guardar();
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true, state: { aviso: MENSAJE_200 } }));
  expect(api.post).toHaveBeenLastCalledWith(URL_CONFIRMAR, { token: TOKEN, contrasena_nueva: 'NuevaClave123' });
  expect(localStorage.getItem('token')).toBeNull();
  expect(localStorage.getItem('usuario')).toBeNull();
  // El estado de la navegación solo lleva el aviso: ni el token ni la contraseña
  expect(JSON.stringify(mockNavigate.mock.calls)).not.toMatch(new RegExp(`${TOKEN}|NuevaClave123`));
});

test('400 al confirmar -> mensaje del backend y los campos se vacían (no se navega)', async () => {
  api.post.mockResolvedValueOnce(activo).mockRejectedValueOnce(errorHttp(400, { error: MENSAJE_400 }));
  abrir();
  userEvent.type(await screen.findByLabelText('Contraseña nueva'), 'NuevaClave123');
  userEvent.type(repetir(), 'NuevaClave123');
  guardar();
  expect(await screen.findByRole('alert')).toHaveTextContent(MENSAJE_400);
  expect(nueva()).toHaveValue('');
  expect(repetir()).toHaveValue('');
  expect(mockNavigate).not.toHaveBeenCalled();
});

test('409 PROCESANDO al confirmar -> pide esperar, sin navegar', async () => {
  api.post.mockResolvedValueOnce(activo).mockRejectedValueOnce(errorHttp(409, { error: 'El enlace aún se está procesando.', codigo: 'PROCESANDO' }));
  abrir();
  userEvent.type(await screen.findByLabelText('Contraseña nueva'), 'NuevaClave123');
  userEvent.type(repetir(), 'NuevaClave123');
  guardar();
  expect(await screen.findByRole('alert')).toHaveTextContent('El enlace aún se está procesando. Espera unos segundos');
  expect(mockNavigate).not.toHaveBeenCalled();
});

test('429 al confirmar -> demasiados intentos y desaparece el formulario', async () => {
  api.post.mockResolvedValueOnce(activo).mockRejectedValueOnce(errorHttp(429, {}));
  abrir();
  userEvent.type(await screen.findByLabelText('Contraseña nueva'), 'NuevaClave123');
  userEvent.type(repetir(), 'NuevaClave123');
  guardar();
  expect(await screen.findByRole('alert')).toHaveTextContent('Hubo demasiados intentos desde este equipo.');
  expect(screen.queryByLabelText('Contraseña nueva')).toBeNull();
});

test('no envía dos confirmaciones si se pulsa dos veces mientras espera', async () => {
  let resolver;
  api.post.mockResolvedValueOnce(activo).mockReturnValueOnce(new Promise((r) => { resolver = r; }));
  abrir();
  userEvent.type(await screen.findByLabelText('Contraseña nueva'), 'NuevaClave123');
  userEvent.type(repetir(), 'NuevaClave123');
  guardar();
  userEvent.click(screen.getByRole('button', { name: /Guardando/ }));
  expect(llamadas(URL_CONFIRMAR)).toHaveLength(1);
  resolver({ status: 200, data: { mensaje: MENSAJE_200 } });
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(1));
});

test('mostrar u ocultar la contraseña no cambia lo que se envía', async () => {
  api.post.mockResolvedValueOnce(activo);
  abrir();
  userEvent.type(await screen.findByLabelText('Contraseña nueva'), 'NuevaClave123');
  expect(nueva()).toHaveAttribute('type', 'password');
  userEvent.click(screen.getByRole('button', { name: 'Mostrar contraseña nueva' }));
  expect(nueva()).toHaveAttribute('type', 'text');
  expect(nueva()).toHaveValue('NuevaClave123');
});
