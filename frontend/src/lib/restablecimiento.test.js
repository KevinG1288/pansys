import { leerTokenDelFragmento, limpiarFragmento } from './restablecimiento';

const TOKEN = 'A'.repeat(21) + '_-' + 'b'.repeat(20); // 43 caracteres base64url

test('lee un token con el formato del backend desde el fragmento', () => {
  expect(TOKEN).toHaveLength(43);
  expect(leerTokenDelFragmento(`#token=${TOKEN}`)).toBe(TOKEN);
  expect(leerTokenDelFragmento(`token=${TOKEN}`)).toBe(TOKEN);
});

test.each([
  ['vacío', ''],
  ['solo #', '#'],
  ['sin token', '#otra=1'],
  ['corto', `#token=${TOKEN.slice(1)}`],
  ['largo', `#token=${TOKEN}x`],
  ['caracteres no válidos', `#token=${TOKEN.slice(1)}+`],
  ['no es texto', undefined]
])('fragmento %s -> null', (_, hash) => {
  expect(leerTokenDelFragmento(hash)).toBeNull();
});

test('limpiarFragmento quita el fragmento sin añadir entradas al historial y conserva ruta y consulta', () => {
  window.history.pushState({ marca: 1 }, '', `/restablecer?x=1#token=${TOKEN}`);
  const entradas = window.history.length;
  limpiarFragmento();
  expect(window.location.hash).toBe('');
  expect(window.location.pathname).toBe('/restablecer');
  expect(window.location.search).toBe('?x=1');
  expect(window.history.length).toBe(entradas);
  expect(window.history.state).toEqual({ marca: 1 });
});

test('limpiarFragmento no hace nada si no hay fragmento', () => {
  const ventana = { location: { hash: '', pathname: '/x', search: '' }, history: { state: null, replaceState: jest.fn() } };
  limpiarFragmento(ventana);
  expect(ventana.history.replaceState).not.toHaveBeenCalled();
});
