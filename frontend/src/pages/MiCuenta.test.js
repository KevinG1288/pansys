import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider } from '../context/AuthContext';
import api from '../services/api';
import MiCuenta from './MiCuenta';

// Sin red: la API se sustituye por funciones simuladas. La autenticación (AuthProvider) es la real.
jest.mock('../services/api', () => ({
  __esModule: true,
  default: { patch: jest.fn() }
}));

const PANADERO = { id: 2, email: 'panadero@pansys.com', rol: 'panadero', rol_id: 2, panaderia_id: 1 };
const GERENTE = { id: 4, email: 'gerente@pansys.com', rol: 'gerente', rol_id: 3, panaderia_id: 1 };

const renderizar = (usuario = PANADERO) => {
  localStorage.setItem('token', 'token-de-prueba');
  localStorage.setItem('usuario', JSON.stringify(usuario));
  render(<AuthProvider><MiCuenta /></AuthProvider>);
};

const llenar = ({ actual, nueva, confirmacion = nueva }) => {
  if (actual) userEvent.type(screen.getByLabelText('Contraseña actual'), actual);
  if (nueva) userEvent.type(screen.getByLabelText('Contraseña nueva'), nueva);
  if (confirmacion) userEvent.type(screen.getByLabelText('Confirmar contraseña nueva'), confirmacion);
};

const enviar = () => userEvent.click(screen.getByRole('button', { name: 'Cambiar contraseña' }));

afterEach(() => {
  localStorage.clear();
});

test.each([['panadero', PANADERO], ['gerente', GERENTE]])('un %s cambia su contraseña con PATCH /api/auth/contrasena', async (_, usuario) => {
  api.patch.mockResolvedValueOnce({ data: { mensaje: 'Contraseña actualizada correctamente', token: 'token-nuevo' } });
  renderizar(usuario);

  expect(screen.getByText(usuario.email)).toBeInTheDocument();
  llenar({ actual: 'Anterior2025', nueva: 'Nueva2026' });
  enviar();

  expect(await screen.findByText('Contraseña actualizada. Las sesiones abiertas en otros dispositivos se cerraron.')).toBeInTheDocument();
  expect(api.patch).toHaveBeenCalledWith('/api/auth/contrasena', { contrasena_actual: 'Anterior2025', contrasena_nueva: 'Nueva2026' });
  // Este dispositivo sigue conectado con el token nuevo; el usuario mostrado no cambia
  expect(localStorage.getItem('token')).toBe('token-nuevo');
  expect(JSON.parse(localStorage.getItem('usuario'))).toEqual(usuario);
  expect(screen.getByLabelText('Contraseña actual')).toHaveValue('');
  expect(screen.getByLabelText('Contraseña nueva')).toHaveValue('');
});

test('si la respuesta no trae token (backend anterior), conserva la sesión sin romperse', async () => {
  api.patch.mockResolvedValueOnce({ data: { mensaje: 'Contraseña actualizada correctamente' } });
  renderizar();

  llenar({ actual: 'Anterior2025', nueva: 'Nueva2026' });
  enviar();

  expect(await screen.findByText('Contraseña actualizada. Úsala la próxima vez que inicies sesión.')).toBeInTheDocument();
  expect(localStorage.getItem('token')).toBe('token-de-prueba');
});

test('un 401 por sesión revocada muestra el mensaje del backend', async () => {
  api.patch.mockRejectedValueOnce({ response: { status: 401, data: { error: 'La sesión ya no es válida. Inicia sesión nuevamente.' } } });
  renderizar();

  llenar({ actual: 'Anterior2025', nueva: 'Nueva2026' });
  enviar();

  expect(await screen.findByRole('alert')).toHaveTextContent('La sesión ya no es válida.');
});

test('valida antes de enviar: actual obligatoria, política, igual a la actual y confirmación', () => {
  renderizar();

  llenar({ nueva: 'corta' });
  enviar();
  expect(screen.getByLabelText('Contraseña actual')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByText('Debe tener al menos 8 caracteres')).toBeInTheDocument();

  userEvent.type(screen.getByLabelText('Contraseña actual'), 'Igual2026');
  userEvent.clear(screen.getByLabelText('Contraseña nueva'));
  userEvent.type(screen.getByLabelText('Contraseña nueva'), 'Igual2026');
  enviar();
  expect(screen.getByText('Debe ser distinta de la actual')).toBeInTheDocument();

  userEvent.clear(screen.getByLabelText('Contraseña nueva'));
  userEvent.type(screen.getByLabelText('Contraseña nueva'), 'Distinta2026');
  enviar();
  expect(screen.getByText('Las contraseñas no coinciden')).toBeInTheDocument();
  expect(api.patch).not.toHaveBeenCalled();
});

test('muestra el error del backend si la contraseña actual no es correcta', async () => {
  api.patch.mockRejectedValueOnce({ response: { status: 400, data: { error: 'La contraseña actual no es correcta' } } });
  renderizar();

  llenar({ actual: 'Equivocada1', nueva: 'Nueva2026' });
  enviar();

  expect(await screen.findByRole('alert')).toHaveTextContent('La contraseña actual no es correcta');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Cambiar contraseña' })).toBeEnabled());
  expect(screen.getByLabelText('Contraseña nueva')).toHaveValue('Nueva2026');
});

test('una cuenta desactivada recibe el aviso del backend', async () => {
  api.patch.mockRejectedValueOnce({ response: { status: 401, data: { error: 'La cuenta no está activa. Inicia sesión con una cuenta activa.' } } });
  renderizar();

  llenar({ actual: 'Anterior2025', nueva: 'Nueva2026' });
  enviar();

  expect(await screen.findByRole('alert')).toHaveTextContent('La cuenta no está activa.');
});
