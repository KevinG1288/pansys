import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider } from '../context/AuthContext';
import api from '../services/api';
import Cuentas, { validarContrasena } from './Cuentas';

// Sin red: la API se sustituye por funciones simuladas. La autenticación (AuthProvider) es la real.
jest.mock('../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), patch: jest.fn() }
}));

const ADMIN = { id: 1, email: 'admin@pansys.com', rol: 'administrador', rol_id: 1, panaderia_id: null };
const PANADERO = { id: 2, email: 'panadero@pansys.com', rol: 'panadero', rol_id: 2, panaderia_id: 1 };
const GERENTE = { id: 4, email: 'gerente@pansys.com', rol: 'gerente', rol_id: 3, panaderia_id: 1 };

const PANADERIAS = [{ id: 1, nombre: 'Panadería Uno' }, { id: 2, nombre: 'Panadería Dos' }];

// Mismo formato que GET /api/usuarios (sin contraseñas)
const cuenta = (id, email, rol_id, panaderia_id, estado = true) => ({
  id,
  email,
  rol_id,
  rol: { 1: 'administrador', 2: 'panadero', 3: 'gerente' }[rol_id],
  panaderia_id,
  panaderia: PANADERIAS.find(p => p.id === panaderia_id) ?? null,
  estado,
  createdAt: '2026-10-01T15:00:00.000Z',
  updatedAt: '2026-10-01T15:00:00.000Z'
});

const CUENTAS = [
  cuenta(1, 'admin@pansys.com', 1, null),
  cuenta(2, 'panadero1@pansys.com', 2, 1),
  cuenta(4, 'gerente1@pansys.com', 3, 1),
  cuenta(5, 'antiguo@pansys.com', 2, 2, false)
];

const simularGet = ({ cuentas = CUENTAS, panaderias = PANADERIAS, falloCuentas, falloPanaderias } = {}) => {
  api.get.mockImplementation((url) => {
    if (url === '/api/usuarios') return falloCuentas ? Promise.reject(falloCuentas) : Promise.resolve({ data: cuentas });
    if (url === '/api/panaderias') return falloPanaderias ? Promise.reject(falloPanaderias) : Promise.resolve({ data: panaderias });
    return Promise.reject(new Error(`URL inesperada ${url}`));
  });
};

const renderizar = async (usuario = ADMIN, { esperarTabla = usuario.rol_id === 1 } = {}) => {
  localStorage.setItem('token', 'token-de-prueba');
  localStorage.setItem('usuario', JSON.stringify(usuario));
  render(<AuthProvider><Cuentas /></AuthProvider>);
  if (esperarTabla) await screen.findByRole('table', { name: 'Cuentas registradas' });
};

const fila = (email) => screen.getByRole('row', { name: new RegExp(email.replace(/\./g, '\\.')) });

const llenar = ({ email, contrasena, confirmacion = contrasena, rol, panaderia }) => {
  userEvent.type(screen.getByLabelText('Correo electrónico'), email);
  userEvent.type(screen.getByLabelText('Contraseña'), contrasena);
  userEvent.type(screen.getByLabelText('Confirmar contraseña'), confirmacion);
  if (rol) userEvent.selectOptions(screen.getByLabelText('Rol'), rol);
  if (panaderia) userEvent.selectOptions(screen.getByLabelText('Panadería'), panaderia);
};

const crear = () => userEvent.click(screen.getByRole('button', { name: 'Crear cuenta' }));

beforeEach(() => {
  simularGet();
});

afterEach(() => {
  localStorage.clear();
});

describe('Listado', () => {
  test('lista las cuentas desde GET /api/usuarios con rol, panadería y estado', async () => {
    await renderizar();

    expect(api.get).toHaveBeenCalledWith('/api/usuarios');
    expect(api.get).toHaveBeenCalledWith('/api/panaderias');
    expect(within(fila('panadero1@pansys.com')).getByText('Panadero')).toBeInTheDocument();
    expect(within(fila('panadero1@pansys.com')).getByText('Panadería Uno')).toBeInTheDocument();
    expect(within(fila('panadero1@pansys.com')).getByText('Activa')).toBeInTheDocument();
    expect(within(fila('admin@pansys.com')).getByText('Todas')).toBeInTheDocument();
    expect(within(fila('antiguo@pansys.com')).getByText('Desactivada')).toBeInTheDocument();
    expect(screen.queryByText(/pendientes de aprobación/)).not.toBeInTheDocument();
  });

  test('la propia cuenta se marca y no puede desactivarse', async () => {
    await renderizar();

    expect(within(fila('admin@pansys.com')).getByText('(tu cuenta)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Desactivar admin@pansys.com' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Desactivar panadero1@pansys.com' })).toBeEnabled();
  });

  test('muestra el error si no se pueden cargar las cuentas', async () => {
    simularGet({ falloCuentas: { response: { status: 403, data: { error: 'No tiene permisos para realizar esta acción' } } } });
    await renderizar(ADMIN, { esperarTabla: false });

    expect(await screen.findByText('No tiene permisos para realizar esta acción')).toBeInTheDocument();
  });
});

describe('Crear cuenta', () => {
  test('crea una cuenta de panadero eligiendo la panadería de GET /api/panaderias', async () => {
    api.post.mockResolvedValueOnce({ data: { mensaje: 'Usuario creado exitosamente', id: 7 } });
    await renderizar();

    expect(screen.getByRole('option', { name: 'Panadería Dos' })).toBeInTheDocument();
    llenar({ email: ' nuevo@pansys.com ', contrasena: 'Panaderia2026', rol: '2', panaderia: '2' });
    crear();

    expect(await screen.findByText('Cuenta creada para «nuevo@pansys.com» (id 7).')).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/api/auth/registrar', {
      email: 'nuevo@pansys.com', contrasena: 'Panaderia2026', rol_id: 2, panaderia_id: 2
    });
    expect(screen.getByLabelText('Correo electrónico')).toHaveValue('');
    expect(screen.getByLabelText('Contraseña')).toHaveValue('');
    // El listado se recarga para mostrar la cuenta nueva
    await waitFor(() => expect(api.get.mock.calls.filter(([url]) => url === '/api/usuarios')).toHaveLength(2));
  });

  test('una cuenta de administrador no lleva panadería y exige confirmación', async () => {
    api.post.mockResolvedValueOnce({ data: { mensaje: 'Usuario creado exitosamente', id: 8 } });
    await renderizar();

    userEvent.selectOptions(screen.getByLabelText('Rol'), '1');
    expect(screen.queryByLabelText('Panadería')).not.toBeInTheDocument();
    llenar({ email: 'otro.admin@pansys.com', contrasena: 'Segura2026' });
    crear();

    const dialogo = screen.getByRole('alertdialog', { name: '¿Crear una cuenta de administrador?' });
    expect(api.post).not.toHaveBeenCalled();
    userEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));
    expect(api.post).not.toHaveBeenCalled();

    crear();
    userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Crear administrador' }));

    expect(await screen.findByText('Cuenta creada para «otro.admin@pansys.com» (id 8).')).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/api/auth/registrar', {
      email: 'otro.admin@pansys.com', contrasena: 'Segura2026', rol_id: 1
    });
  });

  test('valida email, contraseña, confirmación y panadería antes de enviar', async () => {
    await renderizar();

    llenar({ email: 'correo-invalido', contrasena: 'corta', confirmacion: 'otra' });
    crear();

    expect(screen.getByLabelText('Correo electrónico')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Debe tener al menos 8 caracteres')).toBeInTheDocument();
    expect(screen.getByLabelText('Panadería')).toHaveAttribute('aria-invalid', 'true');
    expect(api.post).not.toHaveBeenCalled();

    userEvent.clear(screen.getByLabelText('Contraseña'));
    userEvent.type(screen.getByLabelText('Contraseña'), 'Valida2026');
    crear();
    expect(screen.getByText('Las contraseñas no coinciden')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  test('si no se cargan las panaderías, el selector lo indica y no se envía', async () => {
    simularGet({ falloPanaderias: { request: {} } });
    await renderizar();

    expect(screen.getByText('No se pudo conectar con el servidor.')).toBeInTheDocument();
    llenar({ email: 'nuevo@pansys.com', contrasena: 'Panaderia2026' });
    crear();
    expect(screen.getByText('Selecciona la panadería')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  test('muestra el error del backend (por ejemplo, email repetido)', async () => {
    api.post.mockRejectedValueOnce({ response: { status: 400, data: { error: 'El email ya está registrado' } } });
    await renderizar();

    llenar({ email: 'admin@pansys.com', contrasena: 'Panaderia2026', panaderia: '1' });
    crear();

    expect(await screen.findByRole('alert')).toHaveTextContent('El email ya está registrado');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Crear cuenta' })).toBeEnabled());
    expect(screen.getByLabelText('Correo electrónico')).toHaveValue('admin@pansys.com');
  });
});

describe('Editar cuenta', () => {
  const abrirEdicion = (email) => {
    userEvent.click(screen.getByRole('button', { name: `Editar ${email}` }));
    return screen.getByRole('dialog', { name: 'Editar cuenta' });
  };

  test('cambia rol y panadería con PATCH /api/usuarios/:id y actualiza la fila', async () => {
    api.patch.mockResolvedValueOnce({ data: cuenta(2, 'panadero1@pansys.com', 3, 2) });
    await renderizar();

    const dialogo = abrirEdicion('panadero1@pansys.com');
    expect(within(dialogo).getByLabelText('Correo electrónico')).toHaveValue('panadero1@pansys.com');
    userEvent.selectOptions(within(dialogo).getByLabelText('Rol'), '3');
    userEvent.selectOptions(within(dialogo).getByLabelText('Panadería'), '2');
    userEvent.click(within(dialogo).getByRole('button', { name: 'Guardar cambios' }));

    expect(await screen.findByText('Cuenta «panadero1@pansys.com» actualizada.')).toBeInTheDocument();
    expect(api.patch).toHaveBeenCalledWith('/api/usuarios/2', { email: 'panadero1@pansys.com', rol_id: 3, panaderia_id: 2 });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(within(fila('panadero1@pansys.com')).getByText('Gerente')).toBeInTheDocument();
    expect(within(fila('panadero1@pansys.com')).getByText('Panadería Dos')).toBeInTheDocument();
  });

  test('promover a administrador envía panaderia_id null y avisa del acceso total', async () => {
    api.patch.mockResolvedValueOnce({ data: cuenta(4, 'gerente1@pansys.com', 1, null) });
    await renderizar();

    const dialogo = abrirEdicion('gerente1@pansys.com');
    userEvent.selectOptions(within(dialogo).getByLabelText('Rol'), '1');
    expect(within(dialogo).queryByLabelText('Panadería')).not.toBeInTheDocument();
    expect(within(dialogo).getByText('Acceso total')).toBeInTheDocument();
    userEvent.click(within(dialogo).getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/api/usuarios/4', {
      email: 'gerente1@pansys.com', rol_id: 1, panaderia_id: null
    }));
  });

  test('en la propia cuenta el rol está bloqueado (solo se edita el email)', async () => {
    await renderizar();

    const dialogo = abrirEdicion('admin@pansys.com');
    expect(within(dialogo).getByLabelText('Rol')).toBeDisabled();
    expect(within(dialogo).getByText('No puedes cambiar el rol de tu propia cuenta.')).toBeInTheDocument();
  });

  test('al cambiar el email propio se actualiza la sesión mostrada (no el token)', async () => {
    api.patch.mockResolvedValueOnce({ data: cuenta(1, 'admin.nuevo@pansys.com', 1, null) });
    await renderizar();

    const dialogo = abrirEdicion('admin@pansys.com');
    userEvent.clear(within(dialogo).getByLabelText('Correo electrónico'));
    userEvent.type(within(dialogo).getByLabelText('Correo electrónico'), 'admin.nuevo@pansys.com');
    userEvent.click(within(dialogo).getByRole('button', { name: 'Guardar cambios' }));

    expect(await screen.findByText('Cuenta «admin.nuevo@pansys.com» actualizada.')).toBeInTheDocument();
    expect(api.patch).toHaveBeenCalledWith('/api/usuarios/1', { email: 'admin.nuevo@pansys.com', rol_id: 1, panaderia_id: null });
    expect(JSON.parse(localStorage.getItem('usuario'))).toEqual({ ...ADMIN, email: 'admin.nuevo@pansys.com' });
    expect(localStorage.getItem('token')).toBe('token-de-prueba');
    expect(within(fila('admin.nuevo@pansys.com')).getByText('(tu cuenta)')).toBeInTheDocument();
  });

  test('editar el email de otra cuenta no cambia la sesión', async () => {
    api.patch.mockResolvedValueOnce({ data: cuenta(2, 'otro.email@pansys.com', 2, 1) });
    await renderizar();

    const dialogo = abrirEdicion('panadero1@pansys.com');
    userEvent.clear(within(dialogo).getByLabelText('Correo electrónico'));
    userEvent.type(within(dialogo).getByLabelText('Correo electrónico'), 'otro.email@pansys.com');
    userEvent.click(within(dialogo).getByRole('button', { name: 'Guardar cambios' }));

    expect(await screen.findByText('Cuenta «otro.email@pansys.com» actualizada.')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem('usuario'))).toEqual(ADMIN);
  });

  test('valida el email y no envía si no hay cambios', async () => {
    await renderizar();

    const dialogo = abrirEdicion('panadero1@pansys.com');
    userEvent.click(within(dialogo).getByRole('button', { name: 'Guardar cambios' }));
    expect(within(dialogo).getByText('No hay cambios para guardar.')).toBeInTheDocument();

    userEvent.clear(within(dialogo).getByLabelText('Correo electrónico'));
    userEvent.type(within(dialogo).getByLabelText('Correo electrónico'), 'sin-arroba');
    userEvent.click(within(dialogo).getByRole('button', { name: 'Guardar cambios' }));
    expect(within(dialogo).getByLabelText('Correo electrónico')).toHaveAttribute('aria-invalid', 'true');
    expect(api.patch).not.toHaveBeenCalled();
  });

  test('muestra en el diálogo el error del backend y lo mantiene abierto', async () => {
    api.patch.mockRejectedValueOnce({ response: { status: 409, data: { error: 'El email ya está registrado' } } });
    await renderizar();

    const dialogo = abrirEdicion('panadero1@pansys.com');
    userEvent.clear(within(dialogo).getByLabelText('Correo electrónico'));
    userEvent.type(within(dialogo).getByLabelText('Correo electrónico'), 'gerente1@pansys.com');
    userEvent.click(within(dialogo).getByRole('button', { name: 'Guardar cambios' }));

    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('El email ya está registrado');
    expect(screen.getByRole('dialog', { name: 'Editar cuenta' })).toBeInTheDocument();
  });
});

describe('Desactivar y reactivar', () => {
  test('desactivar pide confirmación y usa PATCH /api/usuarios/:id/estado', async () => {
    api.patch.mockResolvedValueOnce({ data: cuenta(2, 'panadero1@pansys.com', 2, 1, false) });
    await renderizar();

    userEvent.click(screen.getByRole('button', { name: 'Desactivar panadero1@pansys.com' }));
    let dialogo = screen.getByRole('alertdialog', { name: '¿Desactivar esta cuenta?' });
    userEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));
    expect(api.patch).not.toHaveBeenCalled();

    userEvent.click(screen.getByRole('button', { name: 'Desactivar panadero1@pansys.com' }));
    dialogo = screen.getByRole('alertdialog', { name: '¿Desactivar esta cuenta?' });
    userEvent.click(within(dialogo).getByRole('button', { name: 'Desactivar cuenta' }));

    expect(await screen.findByText('Cuenta «panadero1@pansys.com» desactivada.')).toBeInTheDocument();
    expect(api.patch).toHaveBeenCalledWith('/api/usuarios/2/estado', { estado: false });
    expect(within(fila('panadero1@pansys.com')).getByText('Desactivada')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reactivar panadero1@pansys.com' })).toBeInTheDocument();
  });

  test('reactivar una cuenta desactivada', async () => {
    api.patch.mockResolvedValueOnce({ data: cuenta(5, 'antiguo@pansys.com', 2, 2, true) });
    await renderizar();

    userEvent.click(screen.getByRole('button', { name: 'Reactivar antiguo@pansys.com' }));

    expect(await screen.findByText('Cuenta «antiguo@pansys.com» reactivada.')).toBeInTheDocument();
    expect(api.patch).toHaveBeenCalledWith('/api/usuarios/5/estado', { estado: true });
    expect(within(fila('antiguo@pansys.com')).getByText('Activa')).toBeInTheDocument();
  });

  test('si el backend rechaza la desactivación, el error se ve en la confirmación', async () => {
    api.patch.mockRejectedValueOnce({ response: { status: 409, data: { error: 'Debe quedar al menos un administrador activo' } } });
    await renderizar();

    userEvent.click(screen.getByRole('button', { name: 'Desactivar gerente1@pansys.com' }));
    const dialogo = screen.getByRole('alertdialog');
    userEvent.click(within(dialogo).getByRole('button', { name: 'Desactivar cuenta' }));

    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('Debe quedar al menos un administrador activo');
    expect(within(fila('gerente1@pansys.com')).getByText('Activa')).toBeInTheDocument();
  });

  test('el único administrador activo no se puede desactivar ni degradar desde la interfaz', async () => {
    // Sesión de un administrador que aún no aparece en el listado (p. ej. datos desactualizados)
    await renderizar({ ...ADMIN, id: 99, email: 'otro@pansys.com' });

    expect(screen.getByRole('button', { name: 'Desactivar admin@pansys.com' })).toBeDisabled();
    userEvent.click(screen.getByRole('button', { name: 'Editar admin@pansys.com' }));
    const dialogo = screen.getByRole('dialog', { name: 'Editar cuenta' });
    expect(within(dialogo).getByLabelText('Rol')).toBeDisabled();
    expect(within(dialogo).getByText('Es el único administrador activo: no se puede cambiar su rol.')).toBeInTheDocument();
  });
});

test('política de contraseñas (la misma del backend)', () => {
  expect(validarContrasena('')).toBe('Este campo es obligatorio');
  expect(validarContrasena('abc123')).toBe('Debe tener al menos 8 caracteres');
  expect(validarContrasena('solamenteletras')).toBe('Debe incluir al menos una letra y un número');
  expect(validarContrasena('12345678')).toBe('Debe incluir al menos una letra y un número');
  expect(validarContrasena('ñandú2026')).toBeNull();
  expect(validarContrasena('Ωμέγα2026')).toBeNull(); // cualquier letra Unicode, como \p{L} del backend
  expect(validarContrasena('a1'.repeat(36))).toBeNull(); // 72 bytes
  expect(validarContrasena('a1'.repeat(36) + 'x')).toBe('Es demasiado larga (máximo 72 bytes)');
});

test.each([['panadero', PANADERO], ['gerente', GERENTE]])('un %s no puede gestionar cuentas', async (_, usuario) => {
  await renderizar(usuario);

  expect(screen.getByRole('alert')).toHaveTextContent('Solo los administradores pueden gestionar cuentas.');
  expect(screen.queryByRole('button', { name: 'Crear cuenta' })).not.toBeInTheDocument();
  expect(api.get).not.toHaveBeenCalled();
  expect(api.post).not.toHaveBeenCalled();
});
