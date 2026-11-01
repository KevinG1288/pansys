import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import api from '../../services/api';
import DialogoRestablecer from './DialogoRestablecer';

// Sin red: la API se sustituye por funciones simuladas
jest.mock('../../services/api', () => ({
  __esModule: true,
  default: { post: jest.fn() }
}));

const CUENTA = { id: 7, email: 'panadero@pansys.com', rol_id: 2, estado: true };
const CLAVE = 'ClaveAdmin123';
const URL = '/api/usuarios/7/restablecimiento';
// Mensajes reales del backend (restablecimiento.service.js, solicitarAsistido)
const MENSAJE_200 = 'Se envió un enlace de restablecimiento al correo de la cuenta. Es válido durante 30 minutos.';
const errorHttp = (status, data = {}, headers = {}) => Object.assign(new Error(`HTTP ${status}`), { response: { status, data, headers } });

const abrir = (props = {}) => {
  const onEnviado = jest.fn();
  const onCerrar = jest.fn();
  render(<DialogoRestablecer cuenta={CUENTA} onEnviado={onEnviado} onCerrar={onCerrar} {...props} />);
  return { onEnviado, onCerrar };
};
const campo = () => screen.getByLabelText('Tu contraseña');
const enviar = () => userEvent.click(screen.getByRole('button', { name: 'Enviar enlace' }));

let espiasConsola;
beforeEach(() => {
  espiasConsola = ['log', 'info', 'warn', 'error', 'debug'].map(m => jest.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => {
  // La contraseña nunca llega a la consola
  const escrito = espiasConsola.flatMap(e => e.mock.calls).map(args => args.map(String).join(' ')).join('\n');
  expect(escrito).not.toContain(CLAVE);
  espiasConsola.forEach(e => e.mockRestore());
  jest.clearAllMocks();
});

test('200 -> contrato real y onEnviado con el mensaje del backend; la contraseña se vacía', async () => {
  api.post.mockResolvedValueOnce({ status: 200, data: { mensaje: MENSAJE_200 } });
  const { onEnviado } = abrir();
  expect(screen.getByRole('dialog')).toHaveTextContent(CUENTA.email);
  expect(campo()).toHaveFocus();
  userEvent.type(campo(), CLAVE);
  enviar();
  await waitFor(() => expect(onEnviado).toHaveBeenCalledWith(MENSAJE_200));
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(api.post).toHaveBeenCalledWith(URL, { contrasena: CLAVE });
  expect(campo()).toHaveValue('');
});

test('sin contraseña -> error en el campo y ninguna petición', () => {
  abrir();
  enviar();
  expect(screen.getByText('Escribe tu contraseña')).toBeInTheDocument();
  expect(campo()).toHaveAttribute('aria-invalid', 'true');
  expect(api.post).not.toHaveBeenCalled();
});

test.each([
  [400, { error: 'Su contraseña no es correcta' }, {}, 'Su contraseña no es correcta'],
  [403, { error: 'No tiene permisos para realizar esta acción' }, {}, 'No tiene permisos para realizar esta acción'],
  [404, { error: 'Cuenta no encontrada' }, {}, 'La cuenta ya no existe o no pertenece a tu panadería. Actualiza la lista.'],
  [409, { error: 'Ya hay un envío en curso para esta cuenta. Espere unos segundos.' }, {}, 'Ya hay un envío en curso para esta cuenta. Espere unos segundos.'],
  [409, { error: 'La cuenta está desactivada' }, {}, 'La cuenta está desactivada'],
  [429, { error: 'Ha alcanzado el límite de solicitudes. Inténtelo de nuevo más tarde.' }, { 'retry-after': '300' },
    'Ha alcanzado el límite de solicitudes. Inténtelo de nuevo más tarde. Espera unos 5 minutos.'],
  [429, { error: 'Demasiados intentos fallidos. Inténtelo de nuevo más tarde.' }, {}, 'Demasiados intentos fallidos. Inténtelo de nuevo más tarde.'],
  [502, { error: 'No se pudo enviar el correo. Si la cuenta tenía un enlace anterior, sigue siendo válido.' }, {},
    'No se pudo enviar el correo. Si la cuenta tenía un enlace anterior, sigue siendo válido.'],
  [503, { error: 'La recuperación de contraseña no está disponible en este momento.' }, {}, 'La recuperación de contraseña no está disponible en este momento.'],
  [503, { error: 'No se pudo completar el envío. Inténtelo de nuevo en unos minutos.' }, {}, 'No se pudo completar el envío. Inténtelo de nuevo en unos minutos.']
])('%i -> aviso de error sin afirmar el envío; la contraseña se vacía y el diálogo sigue abierto', async (status, data, headers, esperado) => {
  api.post.mockRejectedValueOnce(errorHttp(status, data, headers));
  const { onEnviado, onCerrar } = abrir();
  userEvent.type(campo(), CLAVE);
  enviar();
  expect(await screen.findByRole('alert')).toHaveTextContent(esperado);
  expect(screen.getByRole('alert')).not.toHaveTextContent(/Se envió/);
  expect(onEnviado).not.toHaveBeenCalled();
  expect(onCerrar).not.toHaveBeenCalled();
  expect(campo()).toHaveValue('');
  expect(campo()).toHaveFocus();
});

test('respuesta sin mensaje de negocio (p. ej. 500) -> texto genérico, sin detalles técnicos', async () => {
  api.post.mockRejectedValueOnce(errorHttp(500, { error: 'Error interno del servidor' }));
  abrir();
  userEvent.type(campo(), CLAVE);
  enviar();
  const aviso = await screen.findByRole('alert');
  expect(aviso).not.toHaveTextContent(/SMTP|Sequelize|stack|ECONN|token/i);
});

test('sin conexión -> mensaje de conexión', async () => {
  api.post.mockRejectedValueOnce(Object.assign(new Error('Network Error'), { request: {} }));
  abrir();
  userEvent.type(campo(), CLAVE);
  enviar();
  expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo conectar con el servidor.');
});

test('no envía dos peticiones si se pulsa dos veces; mientras espera no se puede cerrar', async () => {
  let resolver;
  api.post.mockReturnValueOnce(new Promise((r) => { resolver = r; }));
  const { onEnviado, onCerrar } = abrir();
  userEvent.type(campo(), CLAVE);
  enviar();
  userEvent.click(screen.getByRole('button', { name: /Enviando/ }));
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();
  userEvent.click(screen.getByRole('button', { name: 'Cerrar' }));
  expect(onCerrar).not.toHaveBeenCalled();
  resolver({ status: 200, data: { mensaje: MENSAJE_200 } });
  await waitFor(() => expect(onEnviado).toHaveBeenCalledTimes(1));
});

test('Cancelar llama a onCerrar sin enviar nada', () => {
  const { onCerrar } = abrir();
  userEvent.type(campo(), CLAVE);
  userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  expect(onCerrar).toHaveBeenCalledTimes(1);
  expect(api.post).not.toHaveBeenCalled();
});
