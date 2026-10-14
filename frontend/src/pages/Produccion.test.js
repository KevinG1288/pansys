import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider } from '../context/AuthContext';
import api from '../services/api';
import Produccion from './Produccion';

// Sin red: la API se sustituye por funciones simuladas. La autenticación (AuthProvider) es la real.
jest.mock('../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() }
}));

const URL_ORDENES = '/api/produccion/ordenes?panaderia_id=1';
const URL_RECETAS = '/api/produccion/recetas?panaderia_id=1';
const URL_DETALLE_5 = '/api/produccion/ordenes/5?panaderia_id=1';
const PANADERO = { id: 2, email: 'panadero@pansys.com', rol: 'panadero', rol_id: 2, panaderia_id: 1 };
const GERENTE = { id: 4, email: 'gerente@pansys.com', rol: 'gerente', rol_id: 3, panaderia_id: 1 };

const AHORA = new Date().toISOString();
const HACE_DOS_DIAS = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();

// Formas reales de GET /recetas, GET /ordenes, GET /ordenes/:id y GET /calcular
const RECETAS = [
  { producto_id: 1, producto: 'Pan', panaderia_id: 1, insumos: [{ materia_prima_id: 7, nombre: 'Harina', unidad_medida: 'kg', activo: true, cantidad_por_unidad: 0.125 }] },
  { producto_id: 2, producto: 'Torta', panaderia_id: 1, insumos: [] }
];
const orden = (datos) => ({
  panaderia_id: 1, producto_id: 1, empleado_id: 2, fecha: '2026-10-13', cantidad_planificada: 40, cantidad_producida: null,
  estado: 'en_proceso', costo_insumos: 15000, observaciones: null, motivo_cancelacion: null, insumos_devueltos: false,
  fecha_finalizacion: null, cerrado_por: null, createdAt: AHORA, updatedAt: AHORA,
  Producto: { id: 1, nombre: 'Pan' }, empleado: { id: 2, email: 'panadero@pansys.com' }, ...datos
});
const ORDENES = [
  orden({ id: 5 }),
  orden({ id: 4, estado: 'finalizada', cantidad_producida: 38, fecha_finalizacion: AHORA, cerrado_por: 2 }),
  orden({ id: 3, estado: 'cancelada', fecha_finalizacion: HACE_DOS_DIAS, motivo_cancelacion: 'Masa dañada', insumos_devueltos: true })
];
const DETALLE_5 = {
  ...ORDENES[0],
  cerradoPor: null,
  insumos: [{
    id: 11, orden_id: 5, materia_prima_id: 7, cantidad_por_unidad: 0.125, unidad_medida: 'kg', precio_unitario: 3000,
    cantidad_usada: 5, cantidad_consumida: 0, cantidad_devuelta: 0, cantidad_mermada: 0, costo: 15000, MateriaPrima: { id: 7, nombre: 'Harina' }
  }]
};
const CALCULO = {
  producto_id: 1, producto: 'Pan', panaderia_id: 1, cantidad: 40, alcanza: true, costo_total_estimado: 15000,
  insumos: [{ materia_prima_id: 7, nombre: 'Harina', unidad_medida: 'kg', cantidad_por_unidad: 0.125, necesario: 5, disponible: 10, faltante: 0, precio_unitario: 3000, costo_estimado: 15000 }]
};

const simularGet = () => {
  api.get.mockImplementation((url) => {
    if (url === URL_ORDENES) return Promise.resolve({ data: ORDENES });
    if (url === URL_RECETAS) return Promise.resolve({ data: RECETAS });
    if (url === URL_DETALLE_5) return Promise.resolve({ data: DETALLE_5 });
    if (url.startsWith('/api/produccion/calcular?')) return Promise.resolve({ data: CALCULO });
    return Promise.reject(new Error(`URL inesperada: ${url}`));
  });
};

const llamadasA = (url) => api.get.mock.calls.filter(([u]) => u === url).length;

const renderizar = async (usuario = PANADERO) => {
  localStorage.setItem('token', 'token-de-prueba');
  localStorage.setItem('usuario', JSON.stringify(usuario));
  render(<AuthProvider><Produccion /></AuthProvider>);
  await screen.findByRole('row', { name: /#5/ });
};

const indicador = (etiqueta) =>
  within(screen.getByRole('region', { name: 'Resumen de producción' }))
    .getAllByRole('article')
    .find(tarjeta => within(tarjeta).queryByText(etiqueta));

const escribir = (etiqueta, texto) => {
  userEvent.clear(screen.getByLabelText(etiqueta));
  userEvent.type(screen.getByLabelText(etiqueta), texto);
};

const abrirFormulario = () => userEvent.click(screen.getByRole('button', { name: 'Nueva orden' }));

beforeEach(() => {
  simularGet();
  document.body.style.overflow = '';
});

afterEach(() => {
  localStorage.clear();
});

describe('Listado e indicadores', () => {
  test('carga órdenes y recetas con las URL reales y calcula los indicadores de hoy', async () => {
    await renderizar();

    expect(api.get).toHaveBeenCalledWith(URL_ORDENES);
    expect(api.get).toHaveBeenCalledWith(URL_RECETAS);
    expect(within(indicador('Órdenes en proceso')).getByText('1')).toBeInTheDocument();
    expect(within(indicador('Finalizadas hoy')).getByText('1')).toBeInTheDocument();
    expect(within(indicador('Unidades producidas hoy')).getByText('38')).toBeInTheDocument();
    expect(within(indicador('Canceladas hoy')).getByText('0')).toBeInTheDocument();
  });

  test('filtra por estado y solo las órdenes en proceso tienen Finalizar y Cancelar', async () => {
    await renderizar();

    expect(screen.getByRole('button', { name: 'Finalizar la orden #5' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Finalizar la orden #4' })).not.toBeInTheDocument();

    userEvent.click(screen.getByRole('button', { name: /Finalizadas\s*1/ }));
    expect(screen.getByRole('row', { name: /#4/ })).toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /#5/ })).not.toBeInTheDocument();
  });

  test('el detalle muestra la trazabilidad de los insumos', async () => {
    await renderizar();

    userEvent.click(screen.getByRole('button', { name: 'Ver detalle de la orden #5' }));
    const dialogo = screen.getByRole('dialog', { name: 'Orden #5' });
    const tabla = await within(dialogo).findByRole('table', { name: 'Insumos de la orden' });

    expect(api.get).toHaveBeenCalledWith(URL_DETALLE_5);
    expect(within(tabla).getByRole('row', { name: /Harina/ })).toHaveTextContent(/0,125 kg/);
  });
});

describe('Nueva orden', () => {
  test('calcula con GET /calcular y crea la orden con el contrato real del POST', async () => {
    api.post.mockResolvedValueOnce({
      data: {
        orden: { ...ORDENES[0], id: 6 },
        alertas_stock_bajo: [{ materia_prima_id: 7, nombre: 'Harina', unidad_medida: 'kg', disponible: 1, stock_minimo: 2 }]
      }
    });
    await renderizar();
    abrirFormulario();

    expect(screen.getByRole('option', { name: 'Torta (sin receta)' })).toBeDisabled();
    userEvent.selectOptions(screen.getByLabelText('Producto'), '1');
    userEvent.type(screen.getByLabelText('Cantidad a producir'), '40');
    userEvent.click(screen.getByRole('button', { name: 'Calcular insumos' }));

    expect(await screen.findByText('Hay insumos suficientes')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/api/produccion/calcular?producto_id=1&cantidad=40&panaderia_id=1');
    expect(screen.getByRole('table', { name: 'Insumos necesarios' })).toHaveTextContent(/Harina/);

    userEvent.click(screen.getByRole('button', { name: 'Crear orden' }));

    expect(await screen.findByText(/Orden #6 creada: 40 × Pan/)).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post).toHaveBeenCalledWith('/api/produccion/ordenes', { producto_id: 1, cantidad_planificada: 40, panaderia_id: 1 });
    expect(screen.getByText(/Quedaron en su stock mínimo o por debajo: Harina \(1 kg\)/)).toBeInTheDocument();
    await waitFor(() => expect(llamadasA(URL_ORDENES)).toBe(2));
  });

  test('valida el producto y la cantidad antes de enviar', async () => {
    await renderizar();
    abrirFormulario();

    userEvent.type(screen.getByLabelText('Cantidad a producir'), '0');
    userEvent.click(screen.getByRole('button', { name: 'Crear orden' }));
    expect(screen.getByLabelText('Producto')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Cantidad a producir')).toHaveAttribute('aria-invalid', 'true');
    expect(api.post).not.toHaveBeenCalled();
  });

  test('un 409 muestra el mensaje del backend y la tabla de faltantes', async () => {
    api.post.mockRejectedValueOnce({
      response: {
        status: 409,
        data: {
          error: 'Materia prima insuficiente para la orden',
          faltantes: [{ materia_prima_id: 7, nombre: 'Harina', unidad_medida: 'kg', cantidad_por_unidad: 0.125, necesario: 5, disponible: 1, faltante: 4, precio_unitario: 3000, costo_estimado: 15000 }]
        }
      }
    });
    await renderizar();
    abrirFormulario();

    userEvent.selectOptions(screen.getByLabelText('Producto'), '1');
    userEvent.type(screen.getByLabelText('Cantidad a producir'), '40');
    userEvent.click(screen.getByRole('button', { name: 'Crear orden' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Materia prima insuficiente para la orden');
    expect(screen.getByRole('table', { name: 'Insumos faltantes' })).toHaveTextContent(/4 kg/);
    expect(screen.getByRole('button', { name: 'Crear orden' })).toBeEnabled();
  });
});

describe('Finalizar', () => {
  test('envía la cantidad producida al PATCH real y recarga las órdenes', async () => {
    api.patch.mockResolvedValueOnce({ data: { ...ORDENES[0], estado: 'finalizada', cantidad_producida: 38 } });
    await renderizar();

    userEvent.click(screen.getByRole('button', { name: 'Finalizar la orden #5' }));
    const dialogo = screen.getByRole('dialog', { name: 'Finalizar la orden #5' });
    expect(within(dialogo).getByLabelText('Cantidad producida')).toHaveValue('40');
    expect(within(dialogo).getByLabelText('Cantidad producida')).toHaveFocus();

    escribir('Cantidad producida', '38');
    userEvent.click(within(dialogo).getByRole('button', { name: 'Finalizar orden' }));

    expect(await screen.findByText(/Orden #5 finalizada: 38 unidades/)).toBeInTheDocument();
    expect(api.patch).toHaveBeenCalledWith('/api/produccion/ordenes/5/finalizar?panaderia_id=1', { cantidad_producida: 38 });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(llamadasA(URL_ORDENES)).toBe(2));
  });

  test('no permite producir más de lo planificado y muestra los errores del backend', async () => {
    api.patch.mockRejectedValueOnce({ response: { status: 409, data: { error: 'La orden ya está finalizada', estado: 'finalizada' } } });
    await renderizar();

    userEvent.click(screen.getByRole('button', { name: 'Finalizar la orden #5' }));
    escribir('Cantidad producida', '41');
    userEvent.click(screen.getByRole('button', { name: 'Finalizar orden' }));
    expect(screen.getByLabelText('Cantidad producida')).toHaveAttribute('aria-invalid', 'true');
    expect(api.patch).not.toHaveBeenCalled();

    escribir('Cantidad producida', '40');
    userEvent.click(screen.getByRole('button', { name: 'Finalizar orden' }));
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent('La orden ya está finalizada');
  });
});

describe('Cancelar', () => {
  const abrirCancelar = async () => {
    userEvent.click(screen.getByRole('button', { name: 'Cancelar la orden #5' }));
    const dialogo = screen.getByRole('dialog', { name: 'Cancelar la orden #5' });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith(URL_DETALLE_5));
    return dialogo;
  };

  test('devolver todos: { motivo, devolver_insumos: true }', async () => {
    api.patch.mockResolvedValueOnce({ data: {} });
    await renderizar();
    const dialogo = await abrirCancelar();

    userEvent.type(within(dialogo).getByLabelText('Motivo de la cancelación'), '  Masa dañada ');
    userEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar orden' }));

    expect(await screen.findByText(/Orden #5 cancelada. Los insumos indicados volvieron/)).toBeInTheDocument();
    expect(api.patch).toHaveBeenCalledWith('/api/produccion/ordenes/5/cancelar?panaderia_id=1', { motivo: 'Masa dañada', devolver_insumos: true });
  });

  test('no devolver: { motivo, devolver_insumos: false } y el motivo es obligatorio', async () => {
    api.patch.mockResolvedValueOnce({ data: {} });
    await renderizar();
    const dialogo = await abrirCancelar();

    userEvent.click(within(dialogo).getByRole('radio', { name: /No devolver insumos/ }));
    userEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar orden' }));
    expect(within(dialogo).getByLabelText('Motivo de la cancelación')).toHaveAttribute('aria-invalid', 'true');
    expect(api.patch).not.toHaveBeenCalled();

    userEvent.type(within(dialogo).getByLabelText('Motivo de la cancelación'), 'Pedido anulado');
    userEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar orden' }));

    expect(await screen.findByText(/se registraron como merma/)).toBeInTheDocument();
    expect(api.patch).toHaveBeenCalledWith('/api/produccion/ordenes/5/cancelar?panaderia_id=1', { motivo: 'Pedido anulado', devolver_insumos: false });
  });

  test('devolución parcial: envía el detalle por insumo y no permite devolver más de lo descontado', async () => {
    api.patch.mockResolvedValueOnce({ data: {} });
    await renderizar();
    const dialogo = await abrirCancelar();

    userEvent.type(within(dialogo).getByLabelText('Motivo de la cancelación'), 'Se quemó una parte');
    userEvent.click(within(dialogo).getByRole('radio', { name: /Devolver solo una parte/ }));
    const campo = await within(dialogo).findByLabelText('Devolver de Harina (kg)');
    expect(campo).toHaveValue('5');

    userEvent.clear(campo);
    userEvent.type(campo, '6');
    userEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar orden' }));
    expect(campo).toHaveAttribute('aria-invalid', 'true');
    expect(api.patch).not.toHaveBeenCalled();

    userEvent.clear(campo);
    userEvent.type(campo, '2,5');
    userEvent.click(within(dialogo).getByRole('button', { name: 'Cancelar orden' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    expect(api.patch).toHaveBeenCalledWith('/api/produccion/ordenes/5/cancelar?panaderia_id=1', {
      motivo: 'Se quemó una parte',
      devolver_insumos: true,
      insumos: [{ materia_prima_id: 7, cantidad_devuelta: 2.5 }]
    });
    expect(await screen.findByText(/Orden #5 cancelada/)).toBeInTheDocument();
  });

  test('Escape cierra el diálogo sin cancelar la orden', async () => {
    await renderizar();
    await abrirCancelar();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();
  });
});

describe('Permisos del gerente (solo lectura)', () => {
  test('ve órdenes y detalle, pero no puede crear, finalizar ni cancelar', async () => {
    await renderizar(GERENTE);

    expect(screen.getByRole('status')).toHaveTextContent('Modo consulta: tu rol permite ver la producción');
    ['Nueva orden', 'Finalizar la orden #5', 'Cancelar la orden #5'].forEach(nombre => {
      const boton = screen.getByRole('button', { name: nombre });
      expect(boton).toBeDisabled();
      expect(boton).toHaveAttribute('aria-describedby', 'aviso-modo-consulta-produccion');
    });
    expect(screen.getByRole('button', { name: 'Ver detalle de la orden #5' })).toBeEnabled();
    expect(api.post).not.toHaveBeenCalled();
    expect(api.patch).not.toHaveBeenCalled();
  });
});
