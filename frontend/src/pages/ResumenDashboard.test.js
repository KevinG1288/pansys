import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import api from '../services/api';
import ResumenDashboard from './ResumenDashboard';

// Sin red: la API se sustituye por funciones simuladas
jest.mock('../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn() }
}));

// Ninguna petición envía panaderia_id: el backend usa siempre la panadería de la cuenta autenticada
afterEach(() => {
  for (const llamadas of Object.values(api).map(f => f?.mock?.calls ?? [])) {
    for (const [url, cuerpo] of llamadas) {
      expect(String(url)).not.toMatch(/panaderia_id/);
      if (cuerpo && typeof cuerpo === 'object') expect(cuerpo).not.toHaveProperty('panaderia_id');
    }
  }
});

const AHORA = new Date().toISOString();
const HACE_DOS_DIAS = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

// Formas reales de las respuestas de los endpoints de lectura
const INSUMOS = [
  { id: 1, nombre: 'Harina', unidad_medida: 'kg', cantidad_disponible: 10, stock_minimo: 2, precio_unitario: 3000 },
  { id: 2, nombre: 'Azúcar', unidad_medida: 'kg', cantidad_disponible: 1, stock_minimo: 2, precio_unitario: 4000 },
  { id: 3, nombre: 'Levadura', unidad_medida: 'g', cantidad_disponible: 0, stock_minimo: 100, precio_unitario: 50 }
];
const PRODUCTOS = [
  { id: 1, nombre: 'Pan', precio_venta: 500, cantidad_disponible: 3 },
  { id: 2, nombre: 'Torta', precio_venta: 2000, cantidad_disponible: 0 }
];
const VENTAS = [
  {
    id: 10, total: 3500, estado: 'completada', createdAt: AHORA,
    DetalleVenta: [
      { id: 1, producto_id: 1, cantidad: 3, subtotal: 1500, Producto: { id: 1, nombre: 'Pan' } },
      { id: 2, producto_id: 2, cantidad: 1, subtotal: 2000, Producto: { id: 2, nombre: 'Torta' } }
    ]
  },
  { id: 9, total: 1000, estado: 'completada', createdAt: HACE_DOS_DIAS, DetalleVenta: [{ id: 3, producto_id: 1, cantidad: 2, subtotal: 1000, Producto: { id: 1, nombre: 'Pan' } }] }
];
const ORDENES = [
  { id: 5, estado: 'en_proceso', cantidad_planificada: 40, producto_id: 1, createdAt: AHORA, Producto: { id: 1, nombre: 'Pan' } },
  { id: 4, estado: 'finalizada', cantidad_planificada: 20, cantidad_producida: 20, producto_id: 1, fecha_finalizacion: AHORA, createdAt: AHORA, Producto: { id: 1, nombre: 'Pan' } }
];

const RESPUESTAS = {
  '/api/inventario': INSUMOS,
  '/api/ventas': VENTAS,
  '/api/ventas/productos': PRODUCTOS,
  '/api/produccion/ordenes': ORDENES
};

const simularGet = (fallos = {}) => {
  api.get.mockImplementation((url) => {
    if (fallos[url]) return Promise.reject({ response: { status: 500, data: { error: fallos[url] } } });
    if (RESPUESTAS[url]) return Promise.resolve({ data: RESPUESTAS[url] });
    return Promise.reject(new Error(`URL inesperada: ${url}`));
  });
};

const indicador = (etiqueta) =>
  within(screen.getByRole('region', { name: 'Indicadores del día' }))
    .getAllByRole('article')
    .find(tarjeta => within(tarjeta).queryByText(etiqueta));

beforeEach(() => {
  simularGet();
});

test('los accesos rápidos abren los módulos existentes sin enviar operaciones', async () => {
  const ir = jest.fn();
  render(<ResumenDashboard onIrA={ir} />);
  await screen.findByRole('list', { name: 'Insumos con alerta' });
  const accesos = within(screen.getByRole('region', { name: 'Accesos rápidos' }));
  for (const [nombre, id] of [['Ir a ventas', 'ventas'], ['Ir a inventario', 'inventario'], ['Ir a producción', 'produccion'], ['Ir a red colaborativa', 'colaboracion']]) {
    userEvent.click(accesos.getByRole('button', { name: nombre }));
    expect(ir).toHaveBeenLastCalledWith(id);
  }
  expect(api.get).toHaveBeenCalledTimes(4);
});

test('muestra los indicadores del día calculados con los datos reales', async () => {
  render(<ResumenDashboard onIrA={jest.fn()} />);
  await screen.findByRole('list', { name: 'Insumos con alerta' });

  expect(within(indicador('Ventas de hoy')).getByText(/\$\s?3\.500/)).toBeInTheDocument();
  expect(within(indicador('Ventas de hoy')).getByText(/1 transacciones/)).toBeInTheDocument();
  expect(within(indicador('Productos con stock')).getByText('1 de 2')).toBeInTheDocument();
  expect(within(indicador('Órdenes en proceso')).getByText('1')).toBeInTheDocument();
  expect(within(indicador('Órdenes en proceso')).getByText('1 finalizadas hoy')).toBeInTheDocument();
  expect(within(indicador('Alertas de inventario')).getByText('2')).toBeInTheDocument();
  expect(within(indicador('Alertas de inventario')).getByText('1 sin existencias · 1 con stock bajo')).toBeInTheDocument();
});

test('lista alertas, órdenes en proceso, más vendidos de hoy y últimas ventas', async () => {
  render(<ResumenDashboard onIrA={jest.fn()} />);

  const alertas = await screen.findByRole('list', { name: 'Insumos con alerta' });
  expect(within(alertas).getByText('Levadura')).toBeInTheDocument();
  expect(within(alertas).getByText('Azúcar')).toBeInTheDocument();
  expect(within(alertas).queryByText('Harina')).not.toBeInTheDocument();

  expect(within(screen.getByRole('list', { name: 'Órdenes en proceso' })).getByText('Pan')).toBeInTheDocument();

  // Solo cuentan las ventas de hoy: Torta $2.000 y Pan $1.500 (la venta de hace dos días no suma)
  const masVendidos = within(screen.getByRole('list', { name: 'Más vendidos hoy' })).getAllByRole('listitem');
  expect(masVendidos[0]).toHaveTextContent(/Torta.*\$\s?2\.000/);
  expect(masVendidos[1]).toHaveTextContent(/Pan.*3 und.*\$\s?1\.500/);

  const ultimas = screen.getByRole('table', { name: 'Últimas ventas' });
  expect(within(ultimas).getByRole('row', { name: /#10/ })).toBeInTheDocument();
  expect(within(ultimas).getByRole('row', { name: /#9/ })).toBeInTheDocument();
});

test('si una fuente falla, lo indica y el resto del resumen sigue visible; Reintentar vuelve a cargar', async () => {
  simularGet({ '/api/ventas': 'Error de prueba en ventas' });
  render(<ResumenDashboard onIrA={jest.fn()} />);

  expect(await screen.findByRole('alert')).toHaveTextContent('Error de prueba en ventas');
  expect(within(indicador('Ventas de hoy')).getByText('—')).toBeInTheDocument();
  expect(within(indicador('Alertas de inventario')).getByText('2')).toBeInTheDocument();

  simularGet();
  userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  expect(await within(indicador('Ventas de hoy')).findByText(/\$\s?3\.500/)).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('los accesos llevan a Inventario, Producción y Ventas', async () => {
  const onIrA = jest.fn();
  render(<ResumenDashboard onIrA={onIrA} />);
  await screen.findByRole('list', { name: 'Insumos con alerta' });

  userEvent.click(screen.getByRole('button', { name: 'Ver inventario' }));
  userEvent.click(screen.getByRole('button', { name: 'Ver producción' }));
  userEvent.click(screen.getByRole('button', { name: 'Ver ventas' }));

  expect(onIrA.mock.calls.map(([m]) => m)).toEqual(['inventario', 'produccion', 'ventas']);
});

test('sin datos muestra estados vacíos en lugar de cifras inventadas', async () => {
  api.get.mockImplementation(() => Promise.resolve({ data: [] }));
  render(<ResumenDashboard onIrA={jest.fn()} />);

  expect(await screen.findByText('Todo en orden')).toBeInTheDocument();
  expect(screen.getByText('Sin órdenes en proceso')).toBeInTheDocument();
  expect(screen.getByText('Aún no hay ventas hoy')).toBeInTheDocument();
  expect(screen.getByText('Aún no hay ventas registradas')).toBeInTheDocument();
  expect(within(indicador('Ventas de hoy')).getByText(/\$\s?0/)).toBeInTheDocument();
});
