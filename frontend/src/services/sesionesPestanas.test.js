import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider, useAuth } from '../context/AuthContext';
import { identidadToken, CODIGO_SESION_CAMBIADA, MENSAJE_SESION_CAMBIADA } from '../lib/sesion';
import { mensajeError } from '../lib/errores';
import Colaboracion from '../pages/Colaboracion';
import api from './api';

// Sesiones en VARIAS PESTAÑAS del mismo navegador (localStorage común). Cliente HTTP real (axios con
// sus interceptores) y AuthProvider real; solo se sustituye el adaptador de red por un backend
// simulado que, como el real, decide la panadería propia por el token recibido (nunca por el cliente).
// La "otra pestaña" escribe en localStorage y el navegador avisa a esta con el evento storage.

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (datos, firma = 'firma') => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(datos)}.${firma}`;

const TRIGAL = { id: 1, email: 'admin.trigal@pansys.test', rol: 'administrador', rol_id: 1, panaderia_id: 1 };
const ESPIGA = { id: 2, email: 'admin.espiga@pansys.test', rol: 'administrador', rol_id: 1, panaderia_id: 2 };
const TOKEN = { trigal: jwt(TRIGAL), espiga: jwt(ESPIGA), espigaRenovado: jwt({ ...ESPIGA, version_sesion: 1 }, 'otra-firma') };
const PANADERIAS = [{ id: 1, nombre: 'Panadería El Trigal', localidad: 'Kennedy' }, { id: 2, nombre: 'Panadería La Espiga', localidad: 'Kennedy' }];
const MATERIAS = {
  1: [{ id: 5, nombre: 'Harina de trigo', unidad_medida: 'kg', cantidad_disponible: 44, estado: true, version_fila: 0 }],
  2: [{ id: 1, nombre: 'Harina de trigo', unidad_medida: 'kg', cantidad_disponible: 40, estado: true, version_fila: 0 }]
};

const adaptadorOriginal = api.defaults.adapter;
let enviadas = [];
const backendSimulado = () => {
  api.defaults.adapter = async (config) => {
    const autorizacion = config.headers.get('Authorization');
    const token = autorizacion ? autorizacion.replace(/^Bearer /, '') : null;
    enviadas.push({ metodo: config.method, url: config.url, token });
    const responder = (status, data) => {
      const response = { status, data, headers: {}, config, statusText: '' };
      if (status < 400) return response;
      throw Object.assign(new Error(`HTTP ${status}`), { config, response, isAxiosError: true });
    };
    if (config.url === '/api/auth/login') return responder(401, { error: 'Credenciales inválidas' });
    const propia = identidadToken(token)?.panaderia_id;
    if (!propia) return responder(401, { error: 'Token inválido' });
    if (config.url === '/api/red/panaderias') return responder(200, PANADERIAS.map(p => ({ ...p, en_red: true, es_propia: p.id === propia })));
    if (config.url === '/api/red/resumen') return responder(200, { recibidas_pendientes: 0, enviadas_pendientes: 0, transferencias_30_dias: 0 });
    if (config.url === '/api/inventario') return responder(200, MATERIAS[propia]);
    if (config.method === 'post') return responder(201, {});
    return responder(200, []);
  };
};

const guardarSesion = (usuario, token) => {
  localStorage.setItem('usuario', JSON.stringify(usuario));
  localStorage.setItem('token', token);
};
// La otra pestaña cambia la sesión guardada y el navegador avisa a esta (evento storage)
const avisarDesdeOtraPestana = (clave, valor) => act(() => {
  window.dispatchEvent(new StorageEvent('storage', { key: clave, newValue: valor, storageArea: localStorage }));
});
const otraPestanaInicia = async (usuario, token) => {
  guardarSesion(usuario, token);
  await avisarDesdeOtraPestana('usuario', JSON.stringify(usuario));
  await avisarDesdeOtraPestana('token', token);
};
const otraPestanaCierra = async () => {
  localStorage.clear();
  await avisarDesdeOtraPestana(null, null);
};

// Simula la ruta privada (App.js): con sesión, la Red colaborativa; sin sesión, el aviso del Login
const Aplicacion = () => {
  const { usuario, avisoSesion, avisoCambioSesion, logout } = useAuth();
  if (!usuario) return <p>Sin sesión. {avisoSesion}</p>;
  return (
    <>
      <p>Cuenta: {usuario.email}</p>
      {avisoCambioSesion && <p role="note">{avisoCambioSesion}</p>}
      <button type="button" onClick={logout}>Cerrar sesión</button>
      <Colaboracion />
    </>
  );
};
const abrir = async (usuario, token) => {
  guardarSesion(usuario, token);
  const vista = render(<AuthProvider><Aplicacion /></AuthProvider>);
  await screen.findByRole('heading', { name: 'Panadería La Espiga' });
  return vista;
};
const propiaMostrada = () => {
  const etiquetas = screen.getAllByText('Tu establecimiento');
  expect(etiquetas).toHaveLength(1);
  return etiquetas[0];
};
const esPropia = (nombre) => within(tarjetaDe(nombre)).queryByText('Tu establecimiento') !== null;
const tarjetaDe = (nombre) => {
  let nodo = screen.getByRole('heading', { name: nombre });
  while (nodo && !within(nodo).queryByText(/Tu panadería|Panadería participante/)) nodo = nodo.parentElement;
  return nodo;
};

beforeEach(() => {
  enviadas = [];
  backendSimulado();
  document.body.style.overflow = '';
});

afterEach(() => {
  api.defaults.adapter = adaptadorOriginal;
  localStorage.clear();
});

describe('Red colaborativa: cada cuenta reconoce su panadería', () => {
  test('La Espiga ve La Espiga como propia y solo puede solicitar a El Trigal', async () => {
    await abrir(ESPIGA, TOKEN.espiga);
    propiaMostrada();
    expect(esPropia('Panadería La Espiga')).toBe(true);
    expect(esPropia('Panadería El Trigal')).toBe(false);
    expect(screen.getByRole('button', { name: 'Solicitar a Panadería El Trigal' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Solicitar a Panadería La Espiga' })).not.toBeInTheDocument();
    expect(enviadas.every(e => e.token === TOKEN.espiga)).toBe(true);
  });

  test('El Trigal ve El Trigal como propia y solo puede solicitar a La Espiga', async () => {
    await abrir(TRIGAL, TOKEN.trigal);
    propiaMostrada();
    expect(esPropia('Panadería El Trigal')).toBe(true);
    expect(screen.getByRole('button', { name: 'Solicitar a Panadería La Espiga' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Solicitar a Panadería El Trigal' })).not.toBeInTheDocument();
    expect(enviadas.every(e => e.token === TOKEN.trigal)).toBe(true);
  });
});

describe('Cambio de cuenta en otra pestaña', () => {
  test('la pestaña adopta la cuenta nueva, descarta el formulario abierto y lo avisa', async () => {
    await abrir(ESPIGA, TOKEN.espiga);
    userEvent.click(screen.getByRole('button', { name: 'Solicitar a Panadería El Trigal' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    await otraPestanaInicia(TRIGAL, TOKEN.trigal);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); // formulario de la cuenta anterior descartado
    expect(screen.getByText(`Cuenta: ${TRIGAL.email}`)).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('La sesión cambió en otra pestaña');
    await waitFor(() => expect(esPropia('Panadería El Trigal')).toBe(true));
    expect(esPropia('Panadería La Espiga')).toBe(false);
    expect(screen.getByRole('button', { name: 'Solicitar a Panadería La Espiga' })).toBeInTheDocument();
    expect(enviadas.filter(e => e.metodo === 'post')).toHaveLength(0);
  });

  test('formulario abierto: si la cuenta cambió antes de que llegue el aviso, la escritura NO sale', async () => {
    await abrir(ESPIGA, TOKEN.espiga);
    userEvent.click(screen.getByRole('button', { name: 'Solicitar a Panadería El Trigal' }));
    userEvent.selectOptions(await screen.findByLabelText('Insumo de destino 1'), '1');
    userEvent.type(screen.getByLabelText('Cantidad 1'), '2');

    guardarSesion(TRIGAL, TOKEN.trigal); // la otra pestaña ya guardó la sesión; el evento aún no llegó
    userEvent.click(screen.getByRole('button', { name: 'Enviar solicitud' }));

    // La petición se bloquea antes de salir y la pestaña se sincroniza con la cuenta guardada
    expect(await screen.findByText(`Cuenta: ${TRIGAL.email}`)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(enviadas.filter(e => e.metodo === 'post')).toHaveLength(0);
    expect(enviadas.some(e => e.token === TOKEN.trigal && e.url === '/api/red/panaderias')).toBe(true);
  });

  test('una petición directa con la sesión cambiada se rechaza con un mensaje claro y no llega al servidor', async () => {
    await abrir(ESPIGA, TOKEN.espiga);
    const antes = enviadas.length;
    guardarSesion(TRIGAL, TOKEN.trigal);

    let error;
    await act(async () => { await api.post('/api/red/solicitudes', {}).catch(e => { error = e; }); });

    expect(error.codigo).toBe(CODIGO_SESION_CAMBIADA);
    expect(mensajeError(error)).toBe(MENSAJE_SESION_CAMBIADA);
    expect(enviadas.slice(antes).some(e => e.metodo === 'post')).toBe(false);
  });

  test('si el usuario guardado aún no corresponde al token nuevo, la pestaña espera y sigue bloqueando', async () => {
    await abrir(ESPIGA, TOKEN.espiga);
    localStorage.setItem('token', TOKEN.trigal); // la otra pestaña escribió el token pero no el usuario
    await avisarDesdeOtraPestana('token', TOKEN.trigal);

    expect(screen.getByText(`Cuenta: ${ESPIGA.email}`)).toBeInTheDocument();
    let error;
    await act(async () => { await api.get('/api/inventario').catch(e => { error = e; }); });
    expect(error.codigo).toBe(CODIGO_SESION_CAMBIADA);
    expect(enviadas.some(e => e.token === TOKEN.trigal)).toBe(false);

    localStorage.setItem('usuario', JSON.stringify(TRIGAL));
    await avisarDesdeOtraPestana('usuario', JSON.stringify(TRIGAL));
    expect(screen.getByText(`Cuenta: ${TRIGAL.email}`)).toBeInTheDocument();
  });

  test('token renovado de la MISMA cuenta en otra pestaña: no interrumpe y usa el token nuevo', async () => {
    await abrir(ESPIGA, TOKEN.espiga);
    userEvent.click(screen.getByRole('button', { name: 'Solicitar a Panadería El Trigal' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    localStorage.setItem('token', TOKEN.espigaRenovado);
    await act(async () => { await api.get('/api/inventario'); });
    await avisarDesdeOtraPestana('token', TOKEN.espigaRenovado);

    expect(enviadas[enviadas.length - 1].token).toBe(TOKEN.espigaRenovado);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  test('otras claves del almacenamiento no alteran la sesión', async () => {
    await abrir(ESPIGA, TOKEN.espiga);
    userEvent.click(screen.getByRole('button', { name: 'Solicitar a Panadería El Trigal' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    localStorage.setItem('preferencia', 'x');
    await avisarDesdeOtraPestana('preferencia', 'x');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('Cierre de sesión en otra pestaña', () => {
  test('la pestaña cierra su sesión y lo explica', async () => {
    await abrir(ESPIGA, TOKEN.espiga);
    await otraPestanaCierra();
    expect(screen.getByText(/Sin sesión\. Se cerró la sesión en otra pestaña\./)).toBeInTheDocument();
  });

  test('sin haber recibido el aviso, la siguiente petición no sale y la pestaña cierra la sesión', async () => {
    await abrir(ESPIGA, TOKEN.espiga);
    const antes = enviadas.length;
    localStorage.clear();
    let error;
    await act(async () => { await api.get('/api/inventario').catch(e => { error = e; }); });
    expect(error.codigo).toBe(CODIGO_SESION_CAMBIADA);
    expect(enviadas.length).toBe(antes);
    expect(screen.getByText(/Sin sesión/)).toBeInTheDocument();
  });

  test('cerrar sesión en una pestaña desfasada no cierra la sesión de la otra cuenta', async () => {
    await abrir(ESPIGA, TOKEN.espiga);
    guardarSesion(TRIGAL, TOKEN.trigal); // la otra pestaña ya entró como El Trigal
    userEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    expect(screen.getByText(/Sin sesión/)).toBeInTheDocument();
    expect(localStorage.getItem('token')).toBe(TOKEN.trigal);
    expect(JSON.parse(localStorage.getItem('usuario'))).toEqual(TRIGAL);
  });

  test('cerrar sesión con la sesión propia sí la borra', async () => {
    await abrir(ESPIGA, TOKEN.espiga);
    userEvent.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('usuario')).toBeNull();
  });
});

describe('Recarga de la página y pestañas sin sesión', () => {
  test('al recargar, la pestaña toma la sesión guardada (la última iniciada)', async () => {
    const primera = await abrir(ESPIGA, TOKEN.espiga);
    guardarSesion(TRIGAL, TOKEN.trigal);
    primera.unmount();
    enviadas = [];

    render(<AuthProvider><Aplicacion /></AuthProvider>); // recarga
    await screen.findByRole('heading', { name: 'Panadería La Espiga' });
    expect(screen.getByText(`Cuenta: ${TRIGAL.email}`)).toBeInTheDocument();
    await waitFor(() => expect(esPropia('Panadería El Trigal')).toBe(true));
    expect(enviadas.every(e => e.token === TOKEN.trigal)).toBe(true);
  });

  test('al recargar con token y usuario de cuentas distintas, se pide iniciar sesión', () => {
    guardarSesion(ESPIGA, TOKEN.trigal);
    render(<AuthProvider><Aplicacion /></AuthProvider>);
    expect(screen.getByText(/Sin sesión/)).toBeInTheDocument();
  });

  test('una pestaña sin sesión no envía el token que guardó otra pestaña', async () => {
    render(<AuthProvider><Aplicacion /></AuthProvider>);
    guardarSesion(TRIGAL, TOKEN.trigal); // sin evento todavía
    await act(async () => { await api.post('/api/auth/login', {}).catch(() => {}); });
    expect(enviadas[0]).toEqual({ metodo: 'post', url: '/api/auth/login', token: null });
  });

  test('una pestaña sin sesión adopta la sesión iniciada en otra pestaña', async () => {
    render(<AuthProvider><Aplicacion /></AuthProvider>);
    await otraPestanaInicia(TRIGAL, TOKEN.trigal);
    expect(await screen.findByText(`Cuenta: ${TRIGAL.email}`)).toBeInTheDocument();
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });
});

describe('identidadToken', () => {
  test('lee id y panadería de un JWT y rechaza lo que no lo es', () => {
    expect(identidadToken(TOKEN.espiga)).toEqual({ id: 2, panaderia_id: 2 });
    expect(identidadToken('token-de-prueba')).toBeNull();
    expect(identidadToken(null)).toBeNull();
    expect(identidadToken(`${b64({})}.${b64({ id: '2' })}.x`)).toBeNull();
  });
});
