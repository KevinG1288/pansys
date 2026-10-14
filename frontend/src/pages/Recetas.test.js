import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider } from '../context/AuthContext';
import api from '../services/api';
import Recetas from './Recetas';

// Sin red: la API se sustituye por funciones simuladas. La autenticación (AuthProvider) es la real.
jest.mock('../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() }
}));

const URL_RECETAS = '/api/produccion/recetas?panaderia_id=1';
const URL_MATERIAS = '/api/inventario?panaderia_id=1';
const PANADERO = { id: 2, email: 'panadero@pansys.com', rol: 'panadero', rol_id: 2, panaderia_id: 1 };
const GERENTE = { id: 4, email: 'gerente@pansys.com', rol: 'gerente', rol_id: 3, panaderia_id: 1 };

// Forma real de GET /api/produccion/recetas
const RECETAS = [
  { producto_id: 1, producto: 'Pan', panaderia_id: 1, insumos: [{ materia_prima_id: 7, nombre: 'Harina', unidad_medida: 'kg', activo: true, cantidad_por_unidad: 0.125 }] },
  { producto_id: 2, producto: 'Torta', panaderia_id: 1, insumos: [] }
];
// Forma real de GET /api/inventario (solo materias activas)
const materia = (datos) => ({ cantidad_disponible: 10, stock_minimo: 1, panaderia_id: 1, estado: true, ...datos });
const MATERIAS = [
  materia({ id: 7, nombre: 'Harina', unidad_medida: 'kg', precio_unitario: 3000 }),
  materia({ id: 8, nombre: 'Azúcar', unidad_medida: 'kg', precio_unitario: 4000 })
];

const simularGet = ({ recetas = RECETAS } = {}) => {
  api.get.mockImplementation((url) => {
    if (url === URL_RECETAS) return Promise.resolve({ data: recetas });
    if (url === URL_MATERIAS) return Promise.resolve({ data: MATERIAS });
    return Promise.reject(new Error(`URL inesperada: ${url}`));
  });
};

const llamadasA = (url) => api.get.mock.calls.filter(([u]) => u === url).length;

const renderizar = async (usuario = PANADERO) => {
  localStorage.setItem('token', 'token-de-prueba');
  localStorage.setItem('usuario', JSON.stringify(usuario));
  render(<AuthProvider><Recetas /></AuthProvider>);
  await screen.findByRole('row', { name: /Pan/ });
};

beforeEach(() => {
  simularGet();
  document.body.style.overflow = '';
});

afterEach(() => {
  localStorage.clear();
});

describe('Listado', () => {
  test('carga recetas y materias primas con las URL reales y muestra el costo estimado por unidad', async () => {
    await renderizar();

    expect(api.get).toHaveBeenCalledWith(URL_RECETAS);
    expect(api.get).toHaveBeenCalledWith(URL_MATERIAS);
    const pan = screen.getByRole('row', { name: /^Pan/ });
    expect(pan).toHaveTextContent('Harina: 0,125 kg');
    expect(within(pan).getByText(/\$\s?375/)).toBeInTheDocument(); // 0,125 × 3.000
    expect(within(pan).getByText('Lista para producir')).toBeInTheDocument();
    expect(within(screen.getByRole('row', { name: /^Torta/ })).getAllByText('Sin receta')).toHaveLength(2);
  });

  test('marca las recetas que usan insumos inactivos', async () => {
    simularGet({ recetas: [{ ...RECETAS[0], insumos: [{ ...RECETAS[0].insumos[0], activo: false }] }] });
    await renderizar();

    expect(screen.getByText('Usa insumos inactivos')).toBeInTheDocument();
  });
});

describe('Crear y editar', () => {
  test('crea una receta con POST /recetas/:producto_id y el contrato { insumos }', async () => {
    api.post.mockResolvedValueOnce({ data: {} });
    await renderizar();

    userEvent.click(screen.getByRole('button', { name: 'Crear receta de Torta' }));
    userEvent.selectOptions(screen.getByLabelText('Materia prima 1'), '8');
    userEvent.type(screen.getByLabelText('Cantidad por unidad 1'), '0,5');
    userEvent.click(screen.getByRole('button', { name: 'Agregar insumo' }));
    userEvent.selectOptions(screen.getByLabelText('Materia prima 2'), '7');
    userEvent.type(screen.getByLabelText('Cantidad por unidad 2'), '1');
    userEvent.click(screen.getByRole('button', { name: 'Crear receta' }));

    expect(await screen.findByText('Receta de «Torta» creada.')).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/api/produccion/recetas/2?panaderia_id=1', {
      insumos: [
        { materia_prima_id: 8, cantidad_por_unidad: 0.5 },
        { materia_prima_id: 7, cantidad_por_unidad: 1 }
      ]
    });
    expect(api.put).not.toHaveBeenCalled();
    await waitFor(() => expect(llamadasA(URL_RECETAS)).toBe(2));
  });

  test('edita una receta existente con PUT y los valores precargados', async () => {
    api.put.mockResolvedValueOnce({ data: {} });
    await renderizar();

    userEvent.click(screen.getByRole('button', { name: 'Editar receta de Pan' }));
    expect(screen.getByLabelText('Materia prima 1')).toHaveValue('7');
    expect(screen.getByLabelText('Cantidad por unidad 1')).toHaveValue('0.125');

    userEvent.clear(screen.getByLabelText('Cantidad por unidad 1'));
    userEvent.type(screen.getByLabelText('Cantidad por unidad 1'), '0.2');
    userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(await screen.findByText('Receta de «Pan» actualizada.')).toBeInTheDocument();
    expect(api.put).toHaveBeenCalledWith('/api/produccion/recetas/1?panaderia_id=1', {
      insumos: [{ materia_prima_id: 7, cantidad_por_unidad: 0.2 }]
    });
    expect(api.post).not.toHaveBeenCalled();
  });

  test('valida materias repetidas, cantidades no positivas y campos vacíos', async () => {
    await renderizar();

    userEvent.click(screen.getByRole('button', { name: 'Editar receta de Pan' }));
    userEvent.click(screen.getByRole('button', { name: 'Agregar insumo' }));
    userEvent.selectOptions(screen.getByLabelText('Materia prima 2'), '7');
    userEvent.type(screen.getByLabelText('Cantidad por unidad 2'), '0');
    userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(screen.getByText('Esta materia prima ya está en la receta')).toBeInTheDocument();
    expect(screen.getByText('Debe ser mayor que 0')).toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
  });

  test('muestra el error del backend con las materias primas que no encontró', async () => {
    api.put.mockRejectedValueOnce({
      response: { status: 404, data: { error: 'Materias primas no encontradas en la panadería del producto', materias_primas: [7] } }
    });
    await renderizar();

    userEvent.click(screen.getByRole('button', { name: 'Editar receta de Pan' }));
    userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Materias primas no encontradas en la panadería del producto (materias primas: 7)'
    );
  });
});

describe('Eliminar', () => {
  test('confirma con el diálogo y llama a DELETE /recetas/:producto_id', async () => {
    api.delete.mockResolvedValueOnce({ data: { mensaje: 'Receta eliminada correctamente' } });
    await renderizar();

    userEvent.click(screen.getByRole('button', { name: 'Eliminar receta de Pan' }));
    const dialogo = screen.getByRole('alertdialog', { name: '¿Eliminar la receta de «Pan»?' });
    userEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar' }));
    expect(api.delete).not.toHaveBeenCalled();

    userEvent.click(screen.getByRole('button', { name: 'Eliminar receta de Pan' }));
    userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Eliminar' }));

    expect(await screen.findByText(/Receta de «Pan» eliminada/)).toBeInTheDocument();
    expect(api.delete).toHaveBeenCalledWith('/api/produccion/recetas/1?panaderia_id=1');
    await waitFor(() => expect(llamadasA(URL_RECETAS)).toBe(2));
  });
});

describe('Permisos del gerente (solo lectura)', () => {
  test('ve las recetas, pero no puede crearlas, editarlas ni eliminarlas', async () => {
    await renderizar(GERENTE);

    expect(screen.getByRole('status')).toHaveTextContent('Modo consulta: tu rol permite ver las recetas');
    ['Editar receta de Pan', 'Eliminar receta de Pan', 'Crear receta de Torta'].forEach(nombre => {
      const boton = screen.getByRole('button', { name: nombre });
      expect(boton).toBeDisabled();
      expect(boton).toHaveAttribute('aria-describedby', 'aviso-modo-consulta-recetas');
    });
    expect(api.post).not.toHaveBeenCalled();
    expect(api.put).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
  });
});
