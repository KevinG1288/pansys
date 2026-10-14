import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider, useAuth } from '../context/AuthContext';
import api from '../services/api';
import Login from './Login';

// Jest 27 (CRA 5) no resuelve el subpath 'react-router/dom' de react-router 7: solo se sustituye useNavigate
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }));

// Sin red: la API se sustituye por funciones simuladas. AuthProvider y login() son los reales.
jest.mock('../services/api', () => ({
  __esModule: true,
  default: { post: jest.fn() }
}));

// Respuesta real de POST /api/auth/login
const RESPUESTA = {
  token: 'jwt-de-prueba',
  usuario: { id: 1, email: 'admin@pansys.com', rol: 'administrador', rol_id: 1, panaderia_id: null }
};

const diferida = () => {
  let resolver;
  const promesa = new Promise((r) => { resolver = r; });
  return { promesa, resolver };
};

// Muestra el usuario del contexto para comprobar que login() lo actualizó
const UsuarioActual = () => {
  const { usuario } = useAuth();
  return <p data-testid="usuario-actual">{usuario ? usuario.email : 'sin sesión'}</p>;
};

const renderizar = () => render(
  <AuthProvider>
    <Login />
    <UsuarioActual />
  </AuthProvider>
);

const correo = () => screen.getByLabelText('Correo electrónico');
const contrasena = () => screen.getByLabelText('Contraseña');
const entrar = () => userEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }));

afterEach(() => {
  localStorage.clear();
});

test('inicia sesión con el contrato real, guarda el token y el usuario, y navega al dashboard', async () => {
  api.post.mockResolvedValueOnce({ data: RESPUESTA });
  renderizar();

  expect(correo()).toHaveFocus();
  userEvent.type(correo(), '  admin@pansys.com ');
  userEvent.type(contrasena(), 'password');
  entrar();

  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/dashboard'));
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(api.post).toHaveBeenCalledWith('/api/auth/login', { email: 'admin@pansys.com', contrasena: 'password' });
  expect(localStorage.getItem('token')).toBe('jwt-de-prueba');
  expect(JSON.parse(localStorage.getItem('usuario'))).toEqual(RESPUESTA.usuario);
  expect(screen.getByTestId('usuario-actual')).toHaveTextContent('admin@pansys.com');
});

test('la contraseña nunca se guarda en el navegador', async () => {
  api.post.mockResolvedValueOnce({ data: RESPUESTA });
  renderizar();

  userEvent.type(correo(), 'admin@pansys.com');
  userEvent.type(contrasena(), 'password');
  entrar();

  await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
  const guardado = Object.keys(localStorage).map(k => localStorage.getItem(k)).join(' ');
  expect(guardado).not.toContain('password');
});

test('valida los campos antes de enviar', () => {
  renderizar();

  entrar();
  expect(correo()).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByText('Escribe tu correo electrónico')).toBeInTheDocument();
  expect(correo()).toHaveFocus();

  userEvent.type(correo(), 'no-es-un-correo');
  entrar();
  expect(screen.getByText('Escribe un correo válido')).toBeInTheDocument();

  userEvent.clear(correo());
  userEvent.type(correo(), 'admin@pansys.com');
  entrar();
  expect(contrasena()).toHaveAttribute('aria-invalid', 'true');
  expect(contrasena()).toHaveFocus();
  expect(api.post).not.toHaveBeenCalled();
});

test('credenciales inválidas (401): mensaje claro, sin sesión y la contraseña se borra', async () => {
  api.post.mockRejectedValueOnce({ response: { status: 401, data: { error: 'Credenciales inválidas' } } });
  renderizar();

  userEvent.type(correo(), 'admin@pansys.com');
  userEvent.type(contrasena(), 'incorrecta');
  entrar();

  expect(await screen.findByRole('alert')).toHaveTextContent('Email o contraseña incorrectos.');
  expect(contrasena()).toHaveValue('');
  expect(localStorage.getItem('token')).toBeNull();
  expect(mockNavigate).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Iniciar sesión' })).toBeEnabled();
});

test('sin conexión con el servidor muestra un mensaje distinto', async () => {
  api.post.mockRejectedValueOnce({ request: {} });
  renderizar();

  userEvent.type(correo(), 'admin@pansys.com');
  userEvent.type(contrasena(), 'password');
  entrar();

  expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo conectar con el servidor.');
});

test('no envía dos veces mientras inicia sesión', async () => {
  const { promesa, resolver } = diferida();
  api.post.mockReturnValueOnce(promesa);
  renderizar();

  userEvent.type(correo(), 'admin@pansys.com');
  userEvent.type(contrasena(), 'password');
  const boton = screen.getByRole('button', { name: 'Iniciar sesión' });
  userEvent.click(boton);
  fireEvent.submit(correo());

  expect(api.post).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Iniciando sesión…' })).toBeDisabled();

  resolver({ data: RESPUESTA });
  await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/dashboard'));
});

test('el botón de ver contraseña alterna el tipo del campo', () => {
  renderizar();

  expect(contrasena()).toHaveAttribute('type', 'password');
  userEvent.click(screen.getByRole('button', { name: 'Mostrar contraseña' }));
  expect(contrasena()).toHaveAttribute('type', 'text');
  userEvent.click(screen.getByRole('button', { name: 'Ocultar contraseña' }));
  expect(contrasena()).toHaveAttribute('type', 'password');
});
