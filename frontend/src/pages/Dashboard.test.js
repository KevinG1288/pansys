import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider } from '../context/AuthContext';
import api from '../services/api';
import Dashboard from './Dashboard';

// Jest 27 (CRA 5) no resuelve el subpath 'react-router/dom' de react-router 7,
// así que solo se sustituye useNavigate. La autenticación (AuthProvider y logout) es la real.
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }));

// Sin red: la API se sustituye por funciones simuladas
jest.mock('../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() }
}));

const ADMIN = { id: 1, email: 'admin@pansys.com', rol: 'administrador', rol_id: 1, panaderia_id: null };
const PANADERO = { id: 2, email: 'panadero@pansys.com', rol: 'panadero', rol_id: 2, panaderia_id: 1 };
const MODULOS = ['Dashboard', 'Inventario', 'Ventas', 'Producción', 'Recetas', 'Red colaborativa'];
const AVISO_PENDIENTE = 'Este módulo todavía no está disponible en la interfaz.';
const URLS_PORTADA = [
  '/api/inventario?panaderia_id=1',
  '/api/ventas?panaderia_id=1',
  '/api/ventas/productos?panaderia_id=1',
  '/api/produccion/ordenes?panaderia_id=1'
];

const INSUMOS = [
  { id: 1, nombre: 'Harina', unidad_medida: 'kg', cantidad_disponible: 10, stock_minimo: 2, precio_unitario: 3000 },
  { id: 2, nombre: 'Azúcar', unidad_medida: 'kg', cantidad_disponible: 1, stock_minimo: 2, precio_unitario: 4000 },
  { id: 3, nombre: 'Levadura', unidad_medida: 'g', cantidad_disponible: 0, stock_minimo: 100, precio_unitario: 50 }
];

const fijarAncho = (ancho) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: ancho });
};

// Renderiza con la sesión real guardada y espera a que la portada termine de cargar
const renderizarDashboard = async (usuario = ADMIN) => {
  localStorage.setItem('token', 'token-de-prueba');
  localStorage.setItem('usuario', JSON.stringify(usuario));
  render(
    <AuthProvider>
      <Dashboard />
    </AuthProvider>
  );
  await screen.findByRole('list', { name: 'Insumos con alerta' });
};

const menuEscritorio = () => screen.getByRole('navigation', { name: 'Módulos principales' });

const abrirMenuMovil = () => {
  userEvent.click(screen.getByRole('button', { name: 'Abrir menú' }));
  return screen.getByRole('dialog', { name: 'Menú de navegación' });
};

beforeEach(() => {
  // Inventario con 3 insumos (2 con alerta); los demás listados vacíos
  api.get.mockImplementation((url) =>
    Promise.resolve({ data: url.startsWith('/api/inventario') ? INSUMOS : [] })
  );
  fijarAncho(800);
  document.body.style.overflow = '';
});

afterEach(() => {
  localStorage.clear();
});

describe('Estructura y navegación', () => {
  test('el menú del administrador muestra «Mi panadería», los seis módulos, Cuentas y Cerrar sesión', async () => {
    await renderizarDashboard();

    expect(screen.getByText('Mi panadería')).toBeInTheDocument();
    [...MODULOS, 'Cuentas'].forEach(nombre => {
      expect(within(menuEscritorio()).getByRole('button', { name: nombre })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: 'Cerrar sesión' })).toBeInTheDocument();
  });

  test('un panadero no ve la gestión de cuentas', async () => {
    await renderizarDashboard(PANADERO);

    MODULOS.forEach(nombre => {
      expect(within(menuEscritorio()).getByRole('button', { name: nombre })).toBeInTheDocument();
    });
    expect(within(menuEscritorio()).queryByRole('button', { name: 'Cuentas' })).not.toBeInTheDocument();
  });

  test('cualquier rol abre «Mi cuenta» con el cambio de contraseña', async () => {
    await renderizarDashboard(PANADERO);
    const llamadasPrevias = api.get.mock.calls.length;

    userEvent.click(within(menuEscritorio()).getByRole('button', { name: 'Mi cuenta' }));

    expect(screen.getByRole('heading', { level: 1, name: 'Mi cuenta' })).toBeInTheDocument();
    expect(screen.getByLabelText('Contraseña actual')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(llamadasPrevias);
  });

  test('la portada carga sus datos una vez desde los endpoints reales', async () => {
    await renderizarDashboard();

    expect(api.get).toHaveBeenCalledTimes(URLS_PORTADA.length);
    URLS_PORTADA.forEach(url => expect(api.get).toHaveBeenCalledWith(url));
    expect(screen.queryByText(AVISO_PENDIENTE)).not.toBeInTheDocument();
  });

  test('la cabecera muestra el email y el rol del usuario autenticado', async () => {
    await renderizarDashboard();

    const cabecera = screen.getByRole('banner');
    expect(within(cabecera).getByText('admin@pansys.com')).toBeInTheDocument();
    expect(within(cabecera).getByText('administrador')).toBeInTheDocument();
  });

  test('aria-current marca el módulo activo', async () => {
    await renderizarDashboard();
    const menu = menuEscritorio();

    expect(within(menu).getByRole('button', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
    userEvent.click(within(menu).getByRole('button', { name: 'Recetas' }));
    expect(within(menu).getByRole('button', { name: 'Recetas' })).toHaveAttribute('aria-current', 'page');
    expect(within(menu).getByRole('button', { name: 'Dashboard' })).not.toHaveAttribute('aria-current');
    await screen.findByText('No hay productos');
  });

  test('Red colaborativa muestra el aviso sin llamar a la API (no tiene backend)', async () => {
    await renderizarDashboard();
    const llamadasPrevias = api.get.mock.calls.length;

    userEvent.click(within(menuEscritorio()).getByRole('button', { name: 'Red colaborativa' }));

    expect(screen.getByRole('heading', { level: 1, name: 'Red colaborativa' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(AVISO_PENDIENTE);
    expect(api.get).toHaveBeenCalledTimes(llamadasPrevias);
  });

  test('Producción y Recetas abren sus pantallas y consultan sus endpoints reales', async () => {
    await renderizarDashboard();

    userEvent.click(within(menuEscritorio()).getByRole('button', { name: 'Producción' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Producción' })).toBeInTheDocument();
    expect(await screen.findByText('Aún no hay órdenes de producción')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/api/produccion/recetas?panaderia_id=1');

    userEvent.click(within(menuEscritorio()).getByRole('button', { name: 'Recetas' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Recetas' })).toBeInTheDocument();
    expect(await screen.findByText('No hay productos')).toBeInTheDocument();
    // 4 de la portada + 2 de Producción + 2 de Recetas
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(8));
  });

  test('los accesos de la portada navegan al módulo correspondiente', async () => {
    await renderizarDashboard();

    userEvent.click(screen.getByRole('button', { name: 'Ver inventario' }));

    expect(screen.getByRole('heading', { level: 1, name: 'Inventario de insumos' })).toBeInTheDocument();
    expect(within(menuEscritorio()).getByRole('button', { name: 'Inventario' })).toHaveAttribute('aria-current', 'page');
    await screen.findByRole('row', { name: /Harina/ });
  });
});

describe('Cierre de sesión (AuthContext real)', () => {
  test('Cerrar sesión ejecuta logout(), vacía la sesión y navega a /login', async () => {
    await renderizarDashboard();

    userEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));

    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('usuario')).toBeNull();
    expect(mockNavigate).toHaveBeenCalledWith('/login');
    // El estado de AuthContext también se vació: la cabecera ya no muestra al usuario
    expect(within(screen.getByRole('banner')).queryByText('admin@pansys.com')).not.toBeInTheDocument();
  });

  test('Cerrar sesión desde el menú móvil cierra el menú y cierra la sesión', async () => {
    await renderizarDashboard();
    const menu = abrirMenuMovil();

    userEvent.click(within(menu).getByRole('button', { name: 'Cerrar sesión' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('');
    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('usuario')).toBeNull();
    expect(mockNavigate).toHaveBeenCalledWith('/login');
  });
});

describe('Menú móvil', () => {
  test('al abrirse bloquea el desplazamiento, recibe el foco y deja inerte el fondo', async () => {
    await renderizarDashboard();
    const menu = abrirMenuMovil();

    expect(menu).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');
    expect(screen.getByTestId('contenido-principal')).toHaveAttribute('inert');
  });

  test('Escape lo cierra, restaura el desplazamiento anterior y devuelve el foco', async () => {
    await renderizarDashboard();
    document.body.style.overflow = 'auto';
    const botonMenu = screen.getByRole('button', { name: 'Abrir menú' });
    abrirMenuMovil();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('auto');
    expect(botonMenu).toHaveFocus();
    expect(screen.getByTestId('contenido-principal')).not.toHaveAttribute('inert');
  });

  test('un clic en el fondo lo cierra', async () => {
    await renderizarDashboard();
    abrirMenuMovil();

    userEvent.click(screen.getByTestId('fondo-menu'));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('');
  });

  test('un clic dentro del panel no lo cierra', async () => {
    await renderizarDashboard();
    const menu = abrirMenuMovil();

    userEvent.click(within(menu).getByText('Mi panadería'));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  test('elegir un módulo lo cierra y cambia de módulo', async () => {
    await renderizarDashboard();
    const menu = abrirMenuMovil();

    userEvent.click(within(menu).getByRole('button', { name: 'Recetas' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Recetas' })).toBeInTheDocument();
    expect(within(menuEscritorio()).getByRole('button', { name: 'Recetas' })).toHaveAttribute('aria-current', 'page');
    await screen.findByText('No hay productos');
  });

  test('pasar a pantalla ancha lo cierra y libera el desplazamiento', async () => {
    await renderizarDashboard();
    abrirMenuMovil();

    fijarAncho(1280);
    fireEvent(window, new Event('resize'));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('');
  });
});
