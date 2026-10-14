import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider } from '../context/AuthContext';
import api from '../services/api';
import Ventas from './Ventas';

// Sin red: la API se sustituye por funciones simuladas. La autenticación (AuthProvider) es la real.
jest.mock('../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() }
}));

const URL_VENTAS = '/api/ventas?panaderia_id=1';
const URL_PRODUCTOS = '/api/ventas/productos?panaderia_id=1';
const PANADERO = { id: 2, email: 'panadero@pansys.com', rol: 'panadero', rol_id: 2, panaderia_id: 1 };
const GERENTE = { id: 4, email: 'gerente@pansys.com', rol: 'gerente', rol_id: 3, panaderia_id: 1 };

// Forma real de GET /api/ventas/productos
const producto = (datos) => ({ precio_compra: 0, panaderia_id: 1, estado: true, ...datos });
const PRODUCTOS = [
  producto({ id: 1, nombre: 'Pan', precio_venta: 500, cantidad_disponible: 3 }),
  producto({ id: 2, nombre: 'Torta', precio_venta: 2000, cantidad_disponible: 1 }),
  producto({ id: 3, nombre: 'Galleta', precio_venta: 300, cantidad_disponible: 0 })
];

// Forma real de GET /api/ventas (detalle incluido como "DetalleVenta")
const HACE_DOS_DIAS = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
const VENTAS = [
  {
    id: 10, fecha: '2026-10-13', total: 3500, empleado_id: 2, panaderia_id: 1, estado: 'completada',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    DetalleVenta: [
      { id: 1, venta_id: 10, producto_id: 1, cantidad: 3, precio_unitario: 500, subtotal: 1500, Producto: PRODUCTOS[0] },
      { id: 2, venta_id: 10, producto_id: 2, cantidad: 1, precio_unitario: 2000, subtotal: 2000, Producto: PRODUCTOS[1] }
    ]
  },
  {
    id: 9, fecha: '2026-10-11', total: 1000, empleado_id: 2, panaderia_id: 1, estado: 'completada',
    createdAt: HACE_DOS_DIAS, updatedAt: HACE_DOS_DIAS,
    DetalleVenta: [{ id: 3, venta_id: 9, producto_id: 1, cantidad: 2, precio_unitario: 500, subtotal: 1000, Producto: PRODUCTOS[0] }]
  }
];

const diferida = () => {
  let resolver;
  const promesa = new Promise((r) => { resolver = r; });
  return { promesa, resolver };
};

// Respuestas por URL; `datos` permite cambiar ventas o productos en una prueba
const simularGet = ({ ventas = VENTAS, productos = PRODUCTOS } = {}) => {
  api.get.mockImplementation((url) => {
    if (url === URL_VENTAS) return Promise.resolve({ data: ventas });
    if (url === URL_PRODUCTOS) return Promise.resolve({ data: productos });
    return Promise.reject(new Error(`URL inesperada: ${url}`));
  });
};

const llamadasA = (url) => api.get.mock.calls.filter(([u]) => u === url).length;

const renderizar = async (usuario = PANADERO) => {
  localStorage.setItem('token', 'token-de-prueba');
  localStorage.setItem('usuario', JSON.stringify(usuario));
  render(
    <AuthProvider>
      <Ventas />
    </AuthProvider>
  );
  await screen.findByText('Historial de ventas');
};

const indicador = (etiqueta) =>
  within(screen.getByRole('region', { name: 'Resumen de ventas' }))
    .getAllByRole('article')
    .find(tarjeta => within(tarjeta).queryByText(etiqueta));

const carrito = () => screen.getByRole('region', { name: 'Carrito' });
const abrirPuntoVenta = () => userEvent.click(screen.getByRole('button', { name: 'Nueva venta' }));
const anadir = (nombre) => userEvent.click(screen.getByRole('button', { name: `Añadir ${nombre}` }));

beforeEach(() => {
  simularGet();
});

afterEach(() => {
  localStorage.clear();
});

describe('Carga e indicadores', () => {
  test('carga ventas y productos con las URL reales', async () => {
    await renderizar();

    expect(api.get).toHaveBeenCalledWith(URL_VENTAS);
    expect(api.get).toHaveBeenCalledWith(URL_PRODUCTOS);
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  test('los indicadores solo cuentan las ventas de hoy (hora de Bogotá)', async () => {
    await renderizar();

    expect(within(indicador('Ventas de hoy')).getByText(/\$\s?3\.500/)).toBeInTheDocument();
    expect(within(indicador('Transacciones de hoy')).getByText('1')).toBeInTheDocument();
    expect(within(indicador('Ticket promedio de hoy')).getByText(/\$\s?3\.500/)).toBeInTheDocument();
    expect(within(indicador('Productos con stock')).getByText('2 de 3')).toBeInTheDocument();
  });

  test('si las ventas fallan se muestra el error y los productos siguen disponibles', async () => {
    api.get.mockImplementation((url) =>
      url === URL_VENTAS
        ? Promise.reject({ response: { status: 500, data: { error: 'Error de prueba en ventas' } } })
        : Promise.resolve({ data: PRODUCTOS })
    );
    localStorage.setItem('usuario', JSON.stringify(PANADERO));
    render(<AuthProvider><Ventas /></AuthProvider>);

    expect(await screen.findByRole('alert')).toHaveTextContent('Error de prueba en ventas');
    expect(within(indicador('Productos con stock')).getByText('2 de 3')).toBeInTheDocument();
    abrirPuntoVenta();
    expect(screen.getByRole('button', { name: 'Añadir Pan' })).toBeEnabled();
  });
});

describe('Historial', () => {
  test('muestra las ventas reales y su detalle al desplegarlo', async () => {
    await renderizar();

    const filaVenta = screen.getByRole('row', { name: /#10/ });
    expect(within(filaVenta).getByText(/\$\s?3\.500/)).toBeInTheDocument();
    expect(within(filaVenta).getByText('Completada')).toBeInTheDocument();

    const boton = screen.getByRole('button', { name: 'Ver detalle de la venta #10' });
    expect(boton).toHaveAttribute('aria-expanded', 'false');
    userEvent.click(boton);
    expect(boton).toHaveAttribute('aria-expanded', 'true');

    const detalle = screen.getByRole('list', { name: 'Productos de la venta #10' });
    expect(within(detalle).getByText(/Pan × 3/)).toBeInTheDocument();
    expect(within(detalle).getByText(/Torta × 1/)).toBeInTheDocument();
  });

  test('sin ventas muestra el estado vacío', async () => {
    simularGet({ ventas: [] });
    await renderizar();

    expect(screen.getByText('Aún no hay ventas registradas')).toBeInTheDocument();
  });
});

describe('Punto de venta y carrito', () => {
  test('añade, suma y resta unidades sin superar el stock, y calcula el total', async () => {
    await renderizar();
    abrirPuntoVenta();

    anadir('Pan');
    anadir('Pan');
    expect(within(carrito()).getByLabelText('Cantidad de Pan')).toHaveTextContent('2');
    expect(within(carrito()).getByLabelText('Total de la venta')).toHaveTextContent(/\$\s?1\.000/);

    userEvent.click(screen.getByRole('button', { name: 'Añadir una unidad de Pan' }));
    expect(within(carrito()).getByLabelText('Cantidad de Pan')).toHaveTextContent('3');
    expect(screen.getByRole('button', { name: 'Añadir una unidad de Pan' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Añadir Pan' })).toBeDisabled();
    expect(within(carrito()).getByText('Máximo disponible: 3')).toBeInTheDocument();

    userEvent.click(screen.getByRole('button', { name: 'Quitar una unidad de Pan' }));
    expect(within(carrito()).getByLabelText('Cantidad de Pan')).toHaveTextContent('2');

    userEvent.click(screen.getByRole('button', { name: 'Quitar Pan del carrito' }));
    expect(within(carrito()).getByText('Selecciona productos para agregarlos.')).toBeInTheDocument();
  });

  test('un producto sin stock no se puede añadir', async () => {
    await renderizar();
    abrirPuntoVenta();

    expect(screen.getByRole('button', { name: 'Añadir Galleta' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Registrar venta' })).toBeDisabled();
  });

  test('registra la venta con el contrato real del POST y recarga ventas y productos', async () => {
    api.post.mockResolvedValueOnce({ data: { id: 11, total: 3000 } });
    await renderizar();
    abrirPuntoVenta();

    anadir('Pan');
    anadir('Pan');
    anadir('Torta');
    userEvent.click(screen.getByRole('button', { name: 'Registrar venta' }));

    expect(await screen.findByText(/Venta #11 registrada por \$\s?3\.000\./)).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/api/ventas', {
      empleado_id: 1,
      panaderia_id: 1,
      productos: [
        { producto_id: 1, cantidad: 2 },
        { producto_id: 2, cantidad: 1 }
      ]
    });
    await waitFor(() => expect(llamadasA(URL_VENTAS)).toBe(2));
    expect(llamadasA(URL_PRODUCTOS)).toBe(2);
    expect(within(carrito()).getByText('Selecciona productos para agregarlos.')).toBeInTheDocument();
  });

  test('no envía dos veces la misma venta mientras se registra', async () => {
    const { promesa, resolver } = diferida();
    api.post.mockReturnValueOnce(promesa);
    await renderizar();
    abrirPuntoVenta();

    anadir('Pan');
    const registrar = screen.getByRole('button', { name: 'Registrar venta' });
    userEvent.click(registrar);
    userEvent.click(registrar);

    expect(api.post).toHaveBeenCalledTimes(1);
    expect(registrar).toBeDisabled();
    expect(registrar).toHaveAttribute('aria-busy', 'true');

    resolver({ data: { id: 12, total: 500 } });
    expect(await screen.findByText(/Venta #12 registrada/)).toBeInTheDocument();
  });

  test('un 409 muestra el mensaje exacto del backend, conserva el carrito y recarga el stock', async () => {
    const mensaje = 'Stock insuficiente: Pan (disponible 0, solicitado 1)';
    api.post.mockRejectedValueOnce({ response: { status: 409, data: { error: mensaje } } });
    await renderizar();
    abrirPuntoVenta();

    anadir('Pan');
    // Tras el 409 el backend informa el stock real
    simularGet({ productos: [{ ...PRODUCTOS[0], cantidad_disponible: 0 }, PRODUCTOS[1], PRODUCTOS[2]] });
    userEvent.click(screen.getByRole('button', { name: 'Registrar venta' }));

    expect(await within(carrito()).findByRole('alert')).toHaveTextContent(mensaje);
    expect(within(carrito()).getByLabelText('Cantidad de Pan')).toHaveTextContent('1');
    expect(await within(carrito()).findByText('Solo quedan 0 disponibles: reduce la cantidad.')).toBeInTheDocument();
    expect(llamadasA(URL_PRODUCTOS)).toBe(2);
    expect(llamadasA(URL_VENTAS)).toBe(1);
  });
});

describe('Alta de producto', () => {
  test('envía el contrato real con texto recortado y números JSON, y recarga los productos', async () => {
    api.post.mockResolvedValueOnce({ data: { id: 4 } });
    await renderizar();

    userEvent.click(screen.getByRole('button', { name: 'Nuevo producto' }));
    userEvent.type(screen.getByLabelText('Nombre'), '  Pan de queso ');
    userEvent.type(screen.getByLabelText('Precio de compra (COP)'), '800');
    userEvent.type(screen.getByLabelText('Precio de venta (COP)'), '1500,5');
    userEvent.type(screen.getByLabelText('Cantidad disponible'), '10');
    userEvent.click(screen.getByRole('button', { name: 'Guardar producto' }));

    expect(await screen.findByText('Producto «Pan de queso» creado.')).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/api/ventas/productos', {
      nombre: 'Pan de queso',
      precio_compra: 800,
      precio_venta: 1500.5,
      cantidad_disponible: 10,
      panaderia_id: 1
    });
    await waitFor(() => expect(llamadasA(URL_PRODUCTOS)).toBe(2));
    expect(screen.queryByRole('button', { name: 'Guardar producto' })).not.toBeInTheDocument();
  });

  test('la cantidad debe ser un entero y los campos son obligatorios', async () => {
    await renderizar();

    userEvent.click(screen.getByRole('button', { name: 'Nuevo producto' }));
    userEvent.type(screen.getByLabelText('Cantidad disponible'), '1.5');
    userEvent.click(screen.getByRole('button', { name: 'Guardar producto' }));

    expect(api.post).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Nombre')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Precio de venta (COP)')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Cantidad disponible')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('Debe ser un número entero mayor o igual a 0')).toBeInTheDocument();
  });
});

describe('Permisos del gerente (solo lectura)', () => {
  test('ve indicadores e historial, pero no puede registrar ventas ni crear productos', async () => {
    await renderizar(GERENTE);

    const explicacion = screen.getByRole('status');
    expect(explicacion).toHaveTextContent('Modo consulta: tu rol permite ver las ventas, pero no registrar ventas ni crear productos.');
    ['Nueva venta', 'Nuevo producto'].forEach(nombre => {
      const boton = screen.getByRole('button', { name: nombre });
      expect(boton).toBeDisabled();
      expect(boton).toHaveAttribute('aria-describedby', 'aviso-modo-consulta-ventas');
    });
    expect(screen.getByRole('row', { name: /#10/ })).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });
});
