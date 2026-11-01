import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import api from '../services/api';
import RecuperarContrasena from './RecuperarContrasena';

// Jest 27 (CRA 5) no resuelve 'react-router/dom': Link se sustituye por un <a> con su destino
jest.mock('react-router-dom', () => ({
  Link: ({ to, children, ...props }) => require('react').createElement('a', { href: to, ...props }, children)
}));

// Sin red: la API se sustituye por funciones simuladas
jest.mock('../services/api', () => ({
  __esModule: true,
  default: { post: jest.fn() }
}));

// Respuesta real del backend (202, restablecimiento.service.js: MENSAJE_SOLICITUD)
const MENSAJE_202 = 'Si la dirección corresponde a una cuenta activa, recibirá un correo con un enlace para restablecer la contraseña.';
const errorHttp = (status, data = {}, headers = {}) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data, headers } });

const correo = () => screen.getByLabelText('Correo electrónico');
const enviar = () => userEvent.click(screen.getByRole('button', { name: 'Enviar enlace' }));

afterEach(() => {
  jest.clearAllMocks();
});

test('envía el contrato real y muestra el mensaje neutro del backend, sin afirmar que se envió un correo', async () => {
  api.post.mockResolvedValueOnce({ status: 202, data: { mensaje: MENSAJE_202 } });
  render(<RecuperarContrasena />);

  expect(correo()).toHaveFocus();
  userEvent.type(correo(), '  persona@panaderia.com ');
  enviar();

  expect(await screen.findByText(MENSAJE_202)).toBeInTheDocument();
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(api.post).toHaveBeenCalledWith('/api/auth/restablecimiento/solicitar', { email: 'persona@panaderia.com' });
  expect(screen.queryByText(/se envió|hemos enviado|correo enviado/i)).toBeNull();
  expect(screen.queryByLabelText('Correo electrónico')).toBeNull(); // el formulario se sustituye por la respuesta
  expect(screen.getByRole('link', { name: 'Volver a iniciar sesión' })).toHaveAttribute('href', '/login');
});

test('sin mensaje en la respuesta usa un texto igualmente neutro', async () => {
  api.post.mockResolvedValueOnce({ status: 202, data: {} });
  render(<RecuperarContrasena />);
  userEvent.type(correo(), 'persona@panaderia.com');
  enviar();
  expect(await screen.findByText(/Si la dirección corresponde a una cuenta activa/)).toBeInTheDocument();
});

test.each([
  ['vacío', ''],
  ['sin @', 'persona'],
  ['sin dominio', 'persona@']
])('correo %s -> error en el campo y ninguna petición', (_, valor) => {
  render(<RecuperarContrasena />);
  if (valor) userEvent.type(correo(), valor);
  enviar();
  expect(api.post).not.toHaveBeenCalled();
  expect(correo()).toHaveAttribute('aria-invalid', 'true');
});

test('429 -> mensaje de límite con la espera en minutos si se puede leer Retry-After', async () => {
  api.post.mockRejectedValueOnce(errorHttp(429, { error: 'Demasiadas solicitudes.' }, { 'retry-after': '600' }));
  render(<RecuperarContrasena />);
  userEvent.type(correo(), 'persona@panaderia.com');
  enviar();
  expect(await screen.findByRole('alert')).toHaveTextContent('Has hecho demasiadas solicitudes. Inténtalo de nuevo en unos 10 minutos.');
});

test('429 sin Retry-After legible (otro origen sin cabecera expuesta) -> «más tarde»', async () => {
  api.post.mockRejectedValueOnce(errorHttp(429, {}));
  render(<RecuperarContrasena />);
  userEvent.type(correo(), 'persona@panaderia.com');
  enviar();
  expect(await screen.findByRole('alert')).toHaveTextContent('Has hecho demasiadas solicitudes. Inténtalo de nuevo más tarde.');
});

test('503 (correo desactivado) -> servicio no disponible, sin detalles técnicos', async () => {
  api.post.mockRejectedValueOnce(errorHttp(503, { error: 'La recuperación de contraseña no está disponible en este momento.' }));
  render(<RecuperarContrasena />);
  userEvent.type(correo(), 'persona@panaderia.com');
  enviar();
  const aviso = await screen.findByRole('alert');
  expect(aviso).toHaveTextContent('La recuperación de contraseña no está disponible en este momento.');
  expect(aviso).not.toHaveTextContent(/SMTP|Mailpit|PANSYS_/);
  expect(correo()).toBeInTheDocument(); // se puede volver a intentar
});

test('sin conexión -> mensaje de conexión', async () => {
  api.post.mockRejectedValueOnce(Object.assign(new Error('Network Error'), { request: {} }));
  render(<RecuperarContrasena />);
  userEvent.type(correo(), 'persona@panaderia.com');
  enviar();
  expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo conectar con el servidor.');
});

test('no envía dos solicitudes si se pulsa dos veces mientras espera', async () => {
  let resolver;
  api.post.mockReturnValueOnce(new Promise((r) => { resolver = r; }));
  render(<RecuperarContrasena />);
  userEvent.type(correo(), 'persona@panaderia.com');
  enviar();
  userEvent.click(screen.getByRole('button', { name: /Enviando/ }));
  expect(api.post).toHaveBeenCalledTimes(1);
  resolver({ status: 202, data: { mensaje: MENSAJE_202 } });
  await waitFor(() => expect(screen.getByText(MENSAJE_202)).toBeInTheDocument());
});
