import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import api from '../services/api';
import { AuthProvider } from '../context/AuthContext';
import Colaboracion from './Colaboracion';
import { validarSolicitud, validarOrigenes } from '../lib/red';
jest.mock('../services/api', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn() } }));
const panaderias = [{ id: 1, nombre: 'Trigal', localidad: 'Kennedy', es_propia: true, en_red: true }, { id: 2, nombre: 'Espiga', localidad: 'Kennedy', es_propia: false, en_red: true }];
const materias = [{ id: 7, nombre: 'Harina', unidad_medida: 'kg', cantidad_disponible: 10, estado: true, version_fila: 0 }, { id: 8, nombre: 'Azúcar', unidad_medida: 'kg', cantidad_disponible: 2, estado: true, version_fila: 0 }];
const detalle = (rol = 'proveedora', estado = 'pendiente') => ({ id: 10, rol, estado, solicitante: { id: 2, nombre: 'Espiga' }, proveedora: { id: 1, nombre: 'Trigal' }, creada_en: '2026-11-05T12:00:00Z', nota: 'Para hoy', lineas: [{ id: 20, linea: 1, nombre: 'Harina', cantidad: 3, unidad_medida: 'kg' }], eventos: [{ tipo: 'creada', lado: 'solicitante', fecha: '2026-11-05T12:00:00Z' }] });
let solicitudActual;
const cargar = async (rol = 2) => {
  localStorage.setItem('token', 'prueba'); localStorage.setItem('usuario', JSON.stringify({ id: 2, rol_id: rol, panaderia_id: 1 }));
  render(<AuthProvider><Colaboracion /></AuthProvider>);
  await screen.findByRole('heading', { name: 'Espiga' });
};
const abrirDetalle = async () => {
  userEvent.click(screen.getByRole('button', { name: 'Recibidas' }));
  userEvent.click(await screen.findByRole('button', { name: 'Ver solicitud 10' }));
  return screen.findByRole('dialog', { name: 'Solicitud #10' });
};
beforeEach(() => {
  solicitudActual = detalle(); document.body.style.overflow = '';
  api.get.mockImplementation(url => {
    if (url === '/api/red/panaderias') return Promise.resolve({ data: panaderias });
    if (url === '/api/red/resumen') return Promise.resolve({ data: { recibidas_pendientes: 1, enviadas_pendientes: 0, transferencias_30_dias: 2 } });
    if (url === '/api/inventario') return Promise.resolve({ data: materias });
    if (url === '/api/red/solicitudes/10') return Promise.resolve({ data: solicitudActual });
    if (url.includes('/disponibilidad')) return Promise.resolve({ data: { panaderia: panaderias[1], materias: [{ id: 99, nombre: 'Harina compartida', unidad_medida: 'kg', cantidad_disponible: 5, nivel: 'disponible' }] } });
    if (url.startsWith('/api/red/solicitudes?')) return Promise.resolve({ data: { total: 1, tamano_pagina: 20, solicitudes: [{ id: 10, estado: 'pendiente', lineas: 1, contraparte: { nombre: 'Espiga' }, creada_en: '2026-11-05T12:00:00Z' }] } });
    if (url.startsWith('/api/red/movimientos?')) return Promise.resolve({ data: { total: 1, tamano_pagina: 20, movimientos: [{ id: 30, tipo: 'entrada', materia_nombre: 'Harina', cantidad: 3, unidad_medida: 'kg', saldo_anterior: 0, saldo_posterior: 3, solicitud_id: 10, fecha: '2026-11-05T12:00:00Z' }] } });
    throw new Error(`URL no prevista: ${url}`);
  });
  api.post.mockResolvedValue({ data: {} });
});
afterEach(() => {
  localStorage.clear();
  for (const [url, body] of api.post.mock.calls) { expect(url).toMatch(/^\/api\/red\/solicitudes/); expect(body).not.toHaveProperty('panaderia_id'); }
});
test('directorio, disponibilidad, resumen y bandejas usan contratos reales', async () => {
  await cargar(); userEvent.click(screen.getByRole('button', { name: 'Ver disponibilidad de Espiga' }));
  expect(await screen.findByText('Harina compartida')).toBeInTheDocument();
  expect(api.get).toHaveBeenCalledWith('/api/red/panaderias/2/disponibilidad');
  userEvent.click(screen.getByRole('button', { name: 'Enviadas' }));
  await screen.findByRole('button', { name: 'Ver solicitud 10' });
  expect(api.get).toHaveBeenCalledWith('/api/red/solicitudes?bandeja=enviadas&estado=&pagina=1');
  userEvent.selectOptions(screen.getByLabelText('Estado de solicitud'), 'aceptada');
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/api/red/solicitudes?bandeja=enviadas&estado=aceptada&pagina=1'));
});
test('creación con varias líneas, coma decimal y sin doble envío', async () => {
  let resolver; api.post.mockReturnValue(new Promise(r => { resolver = r; }));
  await cargar(); userEvent.click(screen.getByRole('button', { name: 'Solicitar a Espiga' }));
  await screen.findByLabelText('Insumo de destino 1');
  userEvent.selectOptions(screen.getByLabelText('Insumo de destino 1'), '7'); userEvent.type(screen.getByLabelText('Cantidad 1'), '1,25');
  userEvent.click(screen.getByRole('button', { name: 'Añadir línea' }));
  userEvent.selectOptions(screen.getByLabelText('Insumo de destino 2'), '8'); userEvent.type(screen.getByLabelText('Cantidad 2'), '0.5');
  const b = screen.getByRole('button', { name: 'Enviar solicitud' }); userEvent.click(b); userEvent.click(b);
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
  expect(api.post).toHaveBeenCalledWith('/api/red/solicitudes', { proveedora_id: 2, nota: null, lineas: [{ materia_prima_destino_id: 7, cantidad: 1.25 }, { materia_prima_destino_id: 8, cantidad: 0.5 }] });
  await act(async () => resolver({ data: {} })); expect(await screen.findByText('Solicitud enviada correctamente.')).toBeInTheDocument();
});
test('formulario no envía líneas incompletas ni cantidades cero', async () => {
  await cargar(); userEvent.click(screen.getByRole('button', { name: 'Solicitar a Espiga' }));
  await screen.findByLabelText('Insumo de destino 1'); userEvent.click(screen.getByRole('button', { name: 'Enviar solicitud' }));
  expect(await screen.findByText(/Selecciona el insumo de destino/)).toBeInTheDocument(); expect(api.post).not.toHaveBeenCalled();
  userEvent.selectOptions(screen.getByLabelText('Insumo de destino 1'), '7'); userEvent.type(screen.getByLabelText('Cantidad 1'), '0');
  userEvent.click(screen.getByRole('button', { name: 'Enviar solicitud' })); expect(await screen.findByText(/debe ser mayor que cero/)).toBeInTheDocument(); expect(api.post).not.toHaveBeenCalled();
});
test.each([1, 2])('rol %s acepta únicamente como proveedora, seleccionando orígenes propios', async rol => {
  await cargar(rol); const modal = await abrirDetalle(); await within(modal).findByText('Historial de la solicitud');
  expect(within(modal).queryByRole('button', { name: 'Cancelar solicitud' })).not.toBeInTheDocument();
  userEvent.click(within(modal).getByRole('button', { name: 'Aceptar solicitud' }));
  userEvent.selectOptions(await screen.findByLabelText('Origen para Harina (línea 1)'), '7');
  const resumen = within(screen.getByRole('region', { name: 'Resumen de transferencia' }));
  expect(resumen.getByText('De Trigal a Espiga')).toBeInTheDocument();
  expect(resumen.getByText('Harina → Harina')).toBeInTheDocument();
  expect(resumen.getByText('3 kg')).toBeInTheDocument();
  userEvent.click(screen.getByRole('button', { name: 'Confirmar transferencia' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/api/red/solicitudes/10/aceptar', { lineas: [{ detalle_id: 20, materia_prima_origen_id: 7 }] }));
  expect(await screen.findByText(/El inventario se transfirió correctamente/)).toBeInTheDocument();
});
test.each([
  ['pendiente', 'Esperando respuesta', 'Transferencia por confirmar'],
  ['aceptada', 'Solicitud cerrada', 'Inventario transferido'],
  ['rechazada', 'Solicitud cerrada', 'Sin transferencia'],
  ['cancelada', 'Solicitud cerrada', 'Sin transferencia']
])('el seguimiento de %s refleja el resultado real sin inventar una transferencia', async (estado, paso, resultado) => {
  solicitudActual = detalle('proveedora', estado);
  await cargar(3); await abrirDetalle();
  const seguimiento = within(await screen.findByRole('list', { name: 'Seguimiento de la solicitud' }));
  expect(seguimiento.getByText(paso)).toBeInTheDocument(); expect(seguimiento.getByText(resultado)).toBeInTheDocument();
  if (estado !== 'aceptada') expect(seguimiento.queryByText('Inventario transferido')).not.toBeInTheDocument();
  expect(api.post).not.toHaveBeenCalled();
});
test('rechazo exige motivo y usa el endpoint real', async () => {
  await cargar(); await abrirDetalle(); userEvent.click(await screen.findByRole('button', { name: 'Rechazar solicitud' }));
  userEvent.click(screen.getByRole('button', { name: 'Confirmar rechazo' }));
  expect(await screen.findByText(/Escribe un motivo de rechazo/)).toBeInTheDocument(); expect(api.post).not.toHaveBeenCalled();
  userEvent.type(screen.getByLabelText('Motivo del rechazo'), ' Sin disponibilidad '); userEvent.click(screen.getByRole('button', { name: 'Confirmar rechazo' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/api/red/solicitudes/10/rechazar', { motivo: 'Sin disponibilidad' }));
});
test('solicitante solo puede cancelar y una solicitud cerrada no ofrece acciones', async () => {
  solicitudActual = detalle('solicitante'); await cargar(); await abrirDetalle();
  userEvent.click(await screen.findByRole('button', { name: 'Cancelar solicitud' }));
  expect(screen.queryByRole('button', { name: 'Aceptar solicitud' })).not.toBeInTheDocument();
  userEvent.click(screen.getByRole('button', { name: 'Confirmar cancelación' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledWith('/api/red/solicitudes/10/cancelar', {}));
  await screen.findByText('Solicitud cancelada.'); solicitudActual = detalle('solicitante', 'cancelada'); await abrirDetalle();
  await screen.findByText('Historial de la solicitud'); expect(screen.queryByRole('button', { name: 'Cancelar solicitud' })).not.toBeInTheDocument();
});
test('gerente puede leer detalle pero no ve ninguna escritura', async () => {
  await cargar(3); expect(screen.queryByRole('button', { name: 'Nueva solicitud' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Solicitar a Espiga' })).not.toBeInTheDocument();
  await abrirDetalle(); await screen.findByText('Historial de la solicitud');
  for (const name of ['Aceptar solicitud', 'Rechazar solicitud', 'Cancelar solicitud']) expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
});
test('error de aceptación se muestra y no se reintenta automáticamente', async () => {
  api.post.mockRejectedValue({ response: { status: 409, data: { error: 'La solicitud ya no está pendiente', codigo: 'YA_CERRADA' } } });
  await cargar(); await abrirDetalle(); userEvent.click(await screen.findByRole('button', { name: 'Aceptar solicitud' }));
  userEvent.selectOptions(await screen.findByLabelText('Origen para Harina (línea 1)'), '7'); userEvent.click(screen.getByRole('button', { name: 'Confirmar transferencia' }));
  expect(await screen.findByText(/La solicitud ya no está pendiente/)).toBeInTheDocument(); expect(api.post).toHaveBeenCalledTimes(1);
  userEvent.click(screen.getByRole('button', { name: 'Actualizar detalle' })); await screen.findByText('Historial de la solicitud'); expect(screen.queryByLabelText('Origen para Harina (línea 1)')).not.toBeInTheDocument();
});
test('movimientos filtra fechas, valida rango y abre la solicitud', async () => {
  await cargar(); userEvent.click(screen.getByRole('button', { name: 'Movimientos' })); await screen.findByText('Entrada');
  fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-11-05' } }); fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-11-01' } });
  userEvent.click(screen.getByRole('button', { name: 'Aplicar fechas' })); expect(screen.getByText(/fecha inicial no puede/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-11-06' } }); userEvent.click(screen.getByRole('button', { name: 'Aplicar fechas' }));
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/api/red/movimientos?desde=2026-11-05&hasta=2026-11-06&pagina=1'));
  userEvent.click(await screen.findByRole('button', { name: 'Ver solicitud 10' })); expect(await screen.findByRole('dialog', { name: 'Solicitud #10' })).toBeInTheDocument();
});
test('errores y carga de directorio ofrecen reintento', async () => {
  api.get.mockRejectedValue({ request: {} });
  await cargarError();
});
test('paginación pide la página siguiente y vuelve a la primera al cambiar el estado', async () => {
  const get = api.get.getMockImplementation();
  api.get.mockImplementation(async url => {
    const r = await get(url);
    return url.startsWith('/api/red/solicitudes?') ? { data: { ...r.data, total: 21 } } : r;
  });
  await cargar(); userEvent.click(screen.getByRole('button', { name: 'Recibidas' }));
  userEvent.click(await screen.findByRole('button', { name: 'Siguiente' }));
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/api/red/solicitudes?bandeja=recibidas&estado=&pagina=2'));
  userEvent.selectOptions(screen.getByLabelText('Estado de solicitud'), 'rechazada');
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/api/red/solicitudes?bandeja=recibidas&estado=rechazada&pagina=1'));
});
test('fuera de red conserva historial pero deshabilita nuevas solicitudes', async () => {
  const get = api.get.getMockImplementation();
  api.get.mockImplementation(url => url === '/api/red/panaderias' ? Promise.resolve({ data: [{ ...panaderias[0], en_red: false }, panaderias[1]] }) : get(url));
  await cargar(); expect(screen.getByRole('button', { name: 'Nueva solicitud' })).toBeDisabled();
  expect(screen.queryByRole('button', { name: 'Solicitar a Espiga' })).not.toBeInTheDocument();
  userEvent.click(screen.getByRole('button', { name: 'Recibidas' })); expect(await screen.findByRole('button', { name: 'Ver solicitud 10' })).toBeInTheDocument();
});
test('carga y fallo del detalle se mantienen dentro del diálogo, sin ofrecer acciones', async () => {
  const get = api.get.getMockImplementation(); let rechazar;
  api.get.mockImplementation(url => url === '/api/red/solicitudes/10' ? new Promise((_, reject) => { rechazar = reject; }) : get(url));
  await cargar(); const modal = await abrirDetalle(); expect(within(modal).getByRole('status')).toHaveTextContent('Cargando datos');
  await act(async () => rechazar({ response: { status: 404, data: { error: 'Solicitud no encontrada' } } }));
  expect(within(modal).getByRole('alert')).toHaveTextContent('Solicitud no encontrada'); expect(within(modal).getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  expect(within(modal).queryByRole('button', { name: 'Aceptar solicitud' })).not.toBeInTheDocument();
});
test('aceptar dos veces mientras espera solo emite una transferencia y bloquea el cierre', async () => {
  let resolver; api.post.mockReturnValue(new Promise(r => { resolver = r; }));
  await cargar(); const modal = await abrirDetalle(); userEvent.click(await within(modal).findByRole('button', { name: 'Aceptar solicitud' }));
  userEvent.selectOptions(await screen.findByLabelText('Origen para Harina (línea 1)'), '7');
  const confirmar = screen.getByRole('button', { name: 'Confirmar transferencia' }); userEvent.click(confirmar); userEvent.click(confirmar);
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1)); expect(within(modal).getByRole('button', { name: 'Cerrar' })).toBeDisabled();
  fireEvent.keyDown(document, { key: 'Escape' }); expect(modal).toBeInTheDocument();
  await act(async () => resolver({ data: {} })); await screen.findByText(/El inventario se transfirió correctamente/);
});
async function cargarError() {
  localStorage.setItem('token', 'prueba'); localStorage.setItem('usuario', JSON.stringify({ rol_id: 2, panaderia_id: 1 }));
  render(<AuthProvider><Colaboracion /></AuthProvider>);
  expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
  expect((await screen.findAllByText('No se pudo conectar con el servidor.')).length).toBe(2);
  const antes = api.get.mock.calls.length; userEvent.click(screen.getAllByRole('button', { name: 'Reintentar' })[0]); await waitFor(() => expect(api.get.mock.calls.length).toBe(antes + 1));
}
test('validadores comprueban destinos únicos, límites y suma por origen compartido', () => {
  expect(() => validarSolicitud(2, '', [{ destino: 7, cantidad: 1 }, { destino: 7, cantidad: 1 }], materias)).toThrow(/solo puede aparecer/);
  for (const cantidad of ['1.00001', '-1', '100000000']) expect(() => validarSolicitud(2, '', [{ destino: 7, cantidad }], materias)).toThrow();
  const s = detalle(); s.lineas.push({ ...s.lineas[0], id: 21, linea: 2 });
  expect(() => validarOrigenes(s, { 20: 8, 21: 8 }, materias)).toThrow(/suma de las líneas/);
  expect(validarOrigenes(s, { 20: 7, 21: 7 }, materias).lineas).toHaveLength(2);
});
