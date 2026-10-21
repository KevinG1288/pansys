import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider } from '../context/AuthContext';
import api from '../services/api';
import Inventario from './Inventario';

// Sin red: la API se sustituye por funciones simuladas. La autenticación (AuthProvider) es la real.
jest.mock('../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() }
}));

const URL_LISTADO = '/api/inventario?panaderia_id=1';
const PANADERO = { id: 2, email: 'panadero@pansys.com', rol: 'panadero', rol_id: 2, panaderia_id: 1 };
const GERENTE = { id: 4, email: 'gerente@pansys.com', rol: 'gerente', rol_id: 3, panaderia_id: 1 };

// Forma real de GET /api/inventario
const insumo = (datos) => ({ unidad_medida: 'kg', panaderia_id: 1, estado: true, createdAt: '2026-10-13T15:00:00.000Z', updatedAt: '2026-10-13T15:00:00.000Z', ...datos });
const INSUMOS = [
  insumo({ id: 7, nombre: 'Harina de trigo', cantidad_disponible: 10, stock_minimo: 2, precio_unitario: 3000 }),
  insumo({ id: 8, nombre: 'Azúcar', cantidad_disponible: 2, stock_minimo: 2, precio_unitario: 4000 }), // igual al mínimo: stock bajo
  insumo({ id: 9, nombre: 'Levadura', unidad_medida: 'g', cantidad_disponible: 0, stock_minimo: 100, precio_unitario: 50 }) // sin existencias
];

// Promesa controlable para simular una petición pendiente
const diferida = () => {
  let resolver;
  const promesa = new Promise((r) => { resolver = r; });
  return { promesa, resolver };
};

const renderizar = async (usuario = PANADERO) => {
  localStorage.setItem('token', 'token-de-prueba');
  localStorage.setItem('usuario', JSON.stringify(usuario));
  render(
    <AuthProvider>
      <Inventario />
    </AuthProvider>
  );
  await screen.findByRole('cell', { name: /Harina de trigo/ });
};

const fila = (nombre) => screen.getByRole('row', { name: new RegExp(nombre) });
const indicador = (etiqueta) =>
  within(screen.getByRole('region', { name: 'Resumen de inventario' }))
    .getAllByRole('article')
    .find(tarjeta => within(tarjeta).queryByText(etiqueta));
const campo = (etiqueta) => screen.getByLabelText(etiqueta);

const escribir = (etiqueta, texto) => {
  userEvent.clear(campo(etiqueta));
  userEvent.type(campo(etiqueta), texto);
};

const llenarFormulario = ({ nombre, unidad, cantidad, minimo, precio }) => {
  escribir('Nombre', nombre);
  escribir('Unidad de medida', unidad);
  escribir('Cantidad disponible', cantidad);
  escribir('Stock mínimo', minimo);
  escribir('Precio unitario (COP)', precio);
};

beforeEach(() => {
  api.get.mockResolvedValue({ data: INSUMOS });
  document.body.style.overflow = '';
});

afterEach(() => {
  localStorage.clear();
});

describe('Listado e indicadores', () => {
  test('carga el inventario una vez con la URL real y muestra los datos con formato', async () => {
    await renderizar();

    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get).toHaveBeenCalledWith(URL_LISTADO);
    expect(within(fila('Harina de trigo')).getByText(/\$\s?3\.000/)).toBeInTheDocument();
    expect(within(fila('Levadura')).getByText('Sin existencias')).toBeInTheDocument();
  });

  test('los indicadores se calculan con los datos reales', async () => {
    await renderizar();

    expect(within(indicador('Insumos registrados')).getByText('3')).toBeInTheDocument();
    // 10 × 3.000 + 2 × 4.000 + 0 × 50
    expect(within(indicador('Valor del inventario')).getByText(/\$\s?38\.000/)).toBeInTheDocument();
    expect(within(indicador('Con stock bajo')).getByText('1')).toBeInTheDocument();
    expect(within(indicador('Sin existencias')).getByText('1')).toBeInTheDocument();
  });

  test('estado: igual al mínimo es «Stock bajo», 0 es «Sin existencias» y el resto «Disponible»', async () => {
    await renderizar();

    expect(within(fila('Harina de trigo')).getByText('Disponible')).toBeInTheDocument();
    expect(within(fila('Azúcar')).getByText('Stock bajo')).toBeInTheDocument();
    expect(within(fila('Levadura')).getByText('Sin existencias')).toBeInTheDocument();
  });

  test('mientras carga muestra un estado de carga', async () => {
    const { promesa, resolver } = diferida();
    api.get.mockReturnValueOnce(promesa);
    localStorage.setItem('usuario', JSON.stringify(PANADERO));
    render(<AuthProvider><Inventario /></AuthProvider>);

    expect(screen.getByRole('status')).toHaveTextContent('Cargando inventario…');
    resolver({ data: INSUMOS });
    expect(await screen.findByRole('cell', { name: /Harina de trigo/ })).toBeInTheDocument();
  });

  test('sin insumos muestra el estado vacío', async () => {
    api.get.mockResolvedValueOnce({ data: [] });
    localStorage.setItem('usuario', JSON.stringify(PANADERO));
    render(<AuthProvider><Inventario /></AuthProvider>);

    expect(await screen.findByText('Aún no hay insumos registrados')).toBeInTheDocument();
  });

  test('si la carga falla muestra el error del backend y permite reintentar', async () => {
    api.get
      .mockRejectedValueOnce({ response: { status: 401, data: { error: 'Sesión desactualizada, inicie sesión nuevamente' } } })
      .mockResolvedValueOnce({ data: INSUMOS });
    localStorage.setItem('usuario', JSON.stringify(PANADERO));
    render(<AuthProvider><Inventario /></AuthProvider>);

    expect(await screen.findByRole('alert')).toHaveTextContent('Sesión desactualizada, inicie sesión nuevamente');
    userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByRole('cell', { name: /Harina de trigo/ })).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(2);
  });
});

describe('Filtros y búsqueda', () => {
  test('los filtros muestran sus contadores y filtran por estado', async () => {
    await renderizar();
    const filtros = screen.getByRole('group', { name: 'Filtrar por estado' });

    expect(within(filtros).getByRole('button', { name: /Todos\s*3/ })).toHaveAttribute('aria-pressed', 'true');
    userEvent.click(within(filtros).getByRole('button', { name: /Stock bajo\s*1/ }));

    expect(screen.getByRole('cell', { name: /Azúcar/ })).toBeInTheDocument();
    expect(screen.queryByRole('cell', { name: /Harina de trigo/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('cell', { name: /Levadura/ })).not.toBeInTheDocument();
  });

  // El buscador se escribe con fireEvent.change (síncrono): userEvent.type v13 dejaba trabajo
  // pendiente que React 19 señalaba en la prueba siguiente
  test('busca por nombre sin distinguir tildes ni mayúsculas, y por unidad', async () => {
    await renderizar();
    const buscador = screen.getByRole('searchbox', { name: /Buscar insumo/ });

    fireEvent.change(buscador, { target: { value: 'AZUCAR' } });
    expect(screen.getByRole('cell', { name: /Azúcar/ })).toBeInTheDocument();
    expect(screen.queryByRole('cell', { name: /Harina de trigo/ })).not.toBeInTheDocument();

    fireEvent.change(buscador, { target: { value: 'g' } });
    // "g" coincide con la unidad de Levadura y con "trigo"
    expect(screen.getByRole('cell', { name: /Levadura/ })).toBeInTheDocument();
  });

  test('sin coincidencias muestra «No encontramos insumos»', async () => {
    await renderizar();
    fireEvent.change(screen.getByRole('searchbox', { name: /Buscar insumo/ }), { target: { value: 'chocolate' } });

    expect(screen.getByText('No encontramos insumos')).toBeInTheDocument();
  });
});

describe('Crear insumo', () => {
  test('envía el contrato real del POST con textos recortados y números JSON, y recarga la lista', async () => {
    api.post.mockResolvedValueOnce({ data: { id: 10 } });
    await renderizar();

    userEvent.click(screen.getByRole('button', { name: 'Nuevo insumo' }));
    llenarFormulario({ nombre: '  Sal marina  ', unidad: ' kg ', cantidad: '12,5', minimo: '2', precio: '1500' });
    userEvent.click(screen.getByRole('button', { name: 'Guardar insumo' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith('/api/inventario', {
      nombre: 'Sal marina',
      unidad_medida: 'kg',
      cantidad_disponible: 12.5,
      stock_minimo: 2,
      precio_unitario: 1500,
      panaderia_id: 1
    });
    expect(await screen.findByText('«Sal marina» se agregó al inventario.')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: 'Guardar insumo' })).not.toBeInTheDocument();
  });

  test('la validación impide enviar valores vacíos, negativos o con demasiados decimales', async () => {
    await renderizar();

    userEvent.click(screen.getByRole('button', { name: 'Nuevo insumo' }));
    llenarFormulario({ nombre: '   ', unidad: 'kg', cantidad: '-3', minimo: '1.23456', precio: '10.99999' });
    userEvent.click(screen.getByRole('button', { name: 'Guardar insumo' }));

    expect(api.post).not.toHaveBeenCalled();
    expect(campo('Nombre')).toHaveAttribute('aria-invalid', 'true');
    expect(campo('Nombre')).toHaveFocus();
    expect(campo('Cantidad disponible')).toHaveAttribute('aria-invalid', 'true');
    expect(campo('Stock mínimo')).toHaveAttribute('aria-invalid', 'true');
    expect(campo('Precio unitario (COP)')).toHaveAttribute('aria-invalid', 'true');
    expect(campo('Unidad de medida')).not.toHaveAttribute('aria-invalid');
  });

  test('un doble clic mientras se guarda solo envía una petición', async () => {
    const { promesa, resolver } = diferida();
    api.post.mockReturnValueOnce(promesa);
    await renderizar();

    userEvent.click(screen.getByRole('button', { name: 'Nuevo insumo' }));
    llenarFormulario({ nombre: 'Sal', unidad: 'kg', cantidad: '1', minimo: '0', precio: '100' });
    const guardar = screen.getByRole('button', { name: 'Guardar insumo' });
    userEvent.click(guardar);
    // Segundo envío directo (el evento submit sube hasta el formulario): lo frena la protección interna
    fireEvent.submit(campo('Nombre'));

    expect(api.post).toHaveBeenCalledTimes(1);
    expect(guardar).toBeDisabled();
    expect(guardar).toHaveAttribute('aria-busy', 'true');

    resolver({ data: {} });
    expect(await screen.findByText('«Sal» se agregó al inventario.')).toBeInTheDocument();
  });

  test('si el backend rechaza el alta muestra su mensaje y conserva lo escrito', async () => {
    api.post.mockRejectedValueOnce({ response: { status: 400, data: { error: 'Error de prueba del servidor' } } });
    await renderizar();

    userEvent.click(screen.getByRole('button', { name: 'Nuevo insumo' }));
    llenarFormulario({ nombre: 'Sal', unidad: 'kg', cantidad: '1', minimo: '0', precio: '100' });
    userEvent.click(screen.getByRole('button', { name: 'Guardar insumo' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Error de prueba del servidor');
    expect(campo('Nombre')).toHaveValue('Sal');
    expect(screen.getByRole('button', { name: 'Guardar insumo' })).toBeEnabled();
    expect(api.get).toHaveBeenCalledTimes(1);
  });
});

describe('Editar insumo', () => {
  test('rellena el formulario y envía el contrato real del PUT a /api/inventario/:id', async () => {
    api.put.mockResolvedValueOnce({ data: {} });
    await renderizar();

    userEvent.click(screen.getByRole('button', { name: 'Editar Harina de trigo' }));
    expect(screen.getByRole('heading', { name: 'Editar «Harina de trigo»' })).toBeInTheDocument();
    expect(campo('Nombre')).toHaveValue('Harina de trigo');
    expect(campo('Cantidad disponible')).toHaveValue('10');
    expect(campo('Precio unitario (COP)')).toHaveValue('3000');

    escribir('Cantidad disponible', '12,5');
    userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(api.put).toHaveBeenCalledWith('/api/inventario/7', {
      nombre: 'Harina de trigo',
      unidad_medida: 'kg',
      cantidad_disponible: 12.5,
      stock_minimo: 2,
      precio_unitario: 3000,
      panaderia_id: 1
    });
    expect(api.post).not.toHaveBeenCalled();
    expect(await screen.findByText('«Harina de trigo» se actualizó correctamente.')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  test('Cancelar cierra el formulario sin enviar nada', async () => {
    await renderizar();

    userEvent.click(screen.getByRole('button', { name: 'Editar Azúcar' }));
    userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(screen.queryByRole('heading', { name: 'Editar «Azúcar»' })).not.toBeInTheDocument();
    expect(api.put).not.toHaveBeenCalled();
  });
});

describe('Precisión DECIMAL(12,4) de cantidades y precio', () => {
  test('acepta 4 decimales también en el precio y valores en el máximo de la columna', async () => {
    api.post.mockResolvedValueOnce({ data: { id: 11 } });
    await renderizar();

    userEvent.click(screen.getByRole('button', { name: 'Nuevo insumo' }));
    llenarFormulario({ nombre: 'Vainilla', unidad: 'ml', cantidad: '99999999,9999', minimo: '0,0001', precio: '12,3456' });
    userEvent.click(screen.getByRole('button', { name: 'Guardar insumo' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledWith('/api/inventario', {
      nombre: 'Vainilla',
      unidad_medida: 'ml',
      cantidad_disponible: 99999999.9999,
      stock_minimo: 0.0001,
      precio_unitario: 12.3456,
      panaderia_id: 1
    });
  });

  test('rechaza valores por encima de 99.999.999,9999 o con más de 4 decimales, como el backend', async () => {
    await renderizar();

    userEvent.click(screen.getByRole('button', { name: 'Nuevo insumo' }));
    llenarFormulario({ nombre: 'Vainilla', unidad: 'ml', cantidad: '100000000', minimo: '0', precio: '100000000' });
    userEvent.click(screen.getByRole('button', { name: 'Guardar insumo' }));

    expect(api.post).not.toHaveBeenCalled();
    expect(campo('Cantidad disponible')).toHaveAttribute('aria-invalid', 'true');
    expect(campo('Precio unitario (COP)')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getAllByText('No puede superar 99.999.999,9999')).toHaveLength(2);

    escribir('Cantidad disponible', '1');
    escribir('Precio unitario (COP)', '0,00001');
    userEvent.click(screen.getByRole('button', { name: 'Guardar insumo' }));
    expect(api.post).not.toHaveBeenCalled();
    expect(campo('Precio unitario (COP)')).toHaveAttribute('aria-invalid', 'true');
  });

  test('editar un insumo con precio de 4 decimales no lo redondea', async () => {
    api.get.mockResolvedValue({ data: [...INSUMOS,
      insumo({ id: 12, nombre: 'Esencia', unidad_medida: 'ml', cantidad_disponible: 0.0001, stock_minimo: 0, precio_unitario: 0.0125 })] });
    api.put.mockResolvedValueOnce({ data: {} });
    await renderizar();

    userEvent.click(screen.getByRole('button', { name: 'Editar Esencia' }));
    expect(campo('Cantidad disponible')).toHaveValue('0.0001');
    expect(campo('Precio unitario (COP)')).toHaveValue('0.0125');
    userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));
    expect(api.put).toHaveBeenCalledWith('/api/inventario/12', expect.objectContaining({
      cantidad_disponible: 0.0001,
      precio_unitario: 0.0125
    }));
  });

  test('la tabla muestra el precio unitario con sus decimales', async () => {
    api.get.mockResolvedValue({ data: [...INSUMOS,
      insumo({ id: 12, nombre: 'Esencia', unidad_medida: 'ml', cantidad_disponible: 5, stock_minimo: 0, precio_unitario: 0.0125 })] });
    await renderizar();

    expect(within(fila('Esencia')).getByText(/0,0125/)).toBeInTheDocument();
    expect(within(fila('Harina de trigo')).getByText(/3\.000/)).toBeInTheDocument();
  });
});

describe('Eliminar insumo', () => {
  test('pide confirmación con el diálogo; Cancelar y Escape no eliminan', async () => {
    await renderizar();

    userEvent.click(screen.getByRole('button', { name: 'Eliminar Azúcar' }));
    expect(screen.getByRole('alertdialog', { name: '¿Eliminar «Azúcar»?' })).toBeInTheDocument();
    userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();

    userEvent.click(screen.getByRole('button', { name: 'Eliminar Azúcar' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Eliminar Azúcar' })).toHaveFocus();

    expect(api.delete).not.toHaveBeenCalled();
  });

  test('Confirmar llama a DELETE /api/inventario/:id, cierra el diálogo y recarga la lista', async () => {
    api.delete.mockResolvedValueOnce({ data: { mensaje: 'Materia prima eliminada correctamente' } });
    await renderizar();

    userEvent.click(screen.getByRole('button', { name: 'Eliminar Azúcar' }));
    userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Eliminar' }));

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/api/inventario/8'));
    expect(api.delete).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('«Azúcar» se eliminó del inventario.')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(document.body.style.overflow).toBe('');
  });

  test('si el backend rechaza la eliminación el error se muestra dentro del diálogo', async () => {
    api.delete.mockRejectedValueOnce({ response: { status: 400, data: { error: 'Materia prima no encontrada' } } });
    await renderizar();

    userEvent.click(screen.getByRole('button', { name: 'Eliminar Azúcar' }));
    const dialogo = screen.getByRole('alertdialog');
    userEvent.click(within(dialogo).getByRole('button', { name: 'Eliminar' }));

    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('Materia prima no encontrada');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(1);
  });
});

describe('Permisos del gerente (solo lectura)', () => {
  test('ve los datos y los filtros, pero los controles de escritura están deshabilitados y explicados', async () => {
    await renderizar(GERENTE);

    const explicacion = screen.getByRole('status');
    expect(explicacion).toHaveTextContent('Modo consulta: tu rol permite ver el inventario, pero no crear, editar ni eliminar insumos.');
    expect(explicacion).toHaveAttribute('id', 'aviso-modo-consulta-inventario');
    ['Nuevo insumo', 'Editar Harina de trigo', 'Eliminar Harina de trigo'].forEach(nombre => {
      const boton = screen.getByRole('button', { name: nombre });
      expect(boton).toBeDisabled();
      expect(boton).toHaveAttribute('aria-describedby', 'aviso-modo-consulta-inventario');
      expect(boton).toHaveAccessibleDescription(/Modo consulta/);
    });

    userEvent.click(screen.getByRole('button', { name: /Sin existencias\s*1/ }));
    expect(screen.getByRole('cell', { name: /Levadura/ })).toBeInTheDocument();

    expect(api.post).not.toHaveBeenCalled();
    expect(api.put).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
  });

  test('el panadero tiene los controles habilitados y no ve el aviso de solo lectura', async () => {
    await renderizar(PANADERO);

    expect(screen.queryByText(/Modo consulta/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nuevo insumo' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Editar Harina de trigo' })).toBeEnabled();
  });
});
