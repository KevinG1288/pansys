// Pruebas unitarias de la regla "debe quedar al menos un administrador activo" (usuarios.service).
// Por la API, con otro administrador actuando, la regla nunca da 409: quien actúa ya es otro
// administrador activo. La suite de integración prueba la serialización real (FOR UPDATE) con dos
// administradoras temporales; aquí se prueba la propia regla y su posición en el servicio, sin
// depender de las cuentas que existan en ninguna base.
// No usan la base de datos ni el servidor: los modelos y la transacción se sustituyen por dobles en
// memoria. Se pueden ejecutar en cualquier momento.
//
// Uso (desde backend/):  node pruebas/usuarios.unitarias.js

// Seguridad: antes de cargar la configuración, la conexión apunta a un host que no existe (dominio
// .invalid, reservado) y toda conexión de red queda bloqueada. Si alguna consulta escapara a los
// dobles, fallaría al instante sin llegar nunca a pansys_db ni a pansys_test.
process.env.DB_HOST = 'base-inexistente.invalid';
process.env.DB_NAME = 'sin_base_pruebas_unitarias';
const net = require('net');
const tls = require('tls');
const redBloqueada = () => { throw new Error('Red bloqueada en las pruebas unitarias'); };
net.connect = net.createConnection = redBloqueada;
net.Socket.prototype.connect = redBloqueada;
tls.connect = redBloqueada;
require('dotenv').config({ quiet: true });

const resultados = [];
const igual = (descripcion, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  resultados.push(ok);
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${descripcion}${ok ? '' : ` -> obtenido ${JSON.stringify(real)}, esperado ${JSON.stringify(esperado)}`}`);
};
const resultado = (promesa) => promesa.then(r => ({ ok: true, r }), e => ({ ok: false, e }));
const codigoDe = (fn) => { try { fn(); return null; } catch (e) { return e.status ?? 'sin código'; } };

const main = async () => {
  const { sequelize, Usuario, Panaderia } = require('../src/models/index');
  const usuariosService = require('../src/modules/usuarios/usuarios.service');
  const { asegurarOtroAdministradorActivo } = usuariosService;

  // ---------- La regla, aislada ----------
  console.log('\n== asegurarOtroAdministradorActivo');
  igual('único administrador activo (el objetivo) -> 409', codigoDe(() => asegurarOtroAdministradorActivo([11], 11)), 409);
  igual('ningún administrador activo bloqueado -> 409', codigoDe(() => asegurarOtroAdministradorActivo([], 11)), 409);
  igual('con otro administrador activo -> permitido', codigoDe(() => asegurarOtroAdministradorActivo([10, 11], 11)), null);
  igual('el objetivo no figura y hay otro -> permitido', codigoDe(() => asegurarOtroAdministradorActivo([10], 11)), null);
  igual('id repetido del objetivo no cuenta como otro -> 409', codigoDe(() => asegurarOtroAdministradorActivo([11, 11], 11)), 409);

  // ---------- La regla dentro del servicio ----------
  const originales = {
    transaction: sequelize.transaction, findAll: Usuario.findAll, findByPk: Usuario.findByPk,
    findOne: Usuario.findOne, panaderiaFindByPk: Panaderia.findByPk
  };

  // Escenario: cuentas en memoria y lista de administradores activos que devuelve el bloqueo
  let eventos;
  let cuentas;
  let administradoresBloqueados;
  const preparar = ({ admins, actor = { id: 10, rol_id: 1, estado: true }, objetivo = { id: 11, rol_id: 1, estado: true, panaderia_id: null } }) => {
    eventos = [];
    administradoresBloqueados = admins;
    cuentas = {
      [actor.id]: { email: `cuenta${actor.id}@pansys.test`, panaderia_id: null, ...actor },
      [objetivo.id]: { email: `cuenta${objetivo.id}@pansys.test`, ...objetivo }
    };
  };

  sequelize.transaction = async (fn) => {
    eventos.push('inicio');
    try {
      const r = await fn({ LOCK: { UPDATE: 'UPDATE' } });
      eventos.push('commit');
      return r;
    } catch (error) {
      eventos.push('rollback');
      throw error;
    }
  };
  let lecturasNoPrevistas = 0;
  Usuario.findAll = async (opciones) => {
    const esBloqueoAdmins = opciones?.lock === 'UPDATE' && opciones?.where?.rol_id === 1 && opciones?.where?.estado === true;
    if (!esBloqueoAdmins) lecturasNoPrevistas++;
    eventos.push(esBloqueoAdmins ? 'bloqueo-administradores' : 'lectura-no-prevista');
    return administradoresBloqueados.map(id => ({ id }));
  };
  Usuario.findByPk = async (id, opciones) => {
    const cuenta = cuentas[id];
    if (opciones?.lock) eventos.push(`bloqueo-cuenta-${id}`);
    if (!cuenta) return null;
    return {
      ...cuenta,
      Rol: { nombre: cuenta.rol_id === 1 ? 'administrador' : 'panadero' },
      panaderiaAsignada: null,
      update: async (cambios, op) => {
        eventos.push(`escritura-${id}${op?.transaction ? '' : ':FUERA DE LA TRANSACCION'}`);
        Object.assign(cuenta, cambios);
      }
    };
  };
  Usuario.findOne = async () => null;
  Panaderia.findByPk = async (id) => ({ id });

  try {
    console.log('\n== actualizar: degradar a un administrador activo');
    preparar({ admins: [11] });
    const solo = await resultado(usuariosService.actualizar(10, '11', { rol_id: 2, panaderia_id: 20 }));
    igual('degradar al único administrador activo bloqueado -> 409', [solo.ok, solo.e?.status, solo.e?.message], [false, 409, 'Debe quedar al menos un administrador activo']);
    igual('409: sin escritura y con la transacción deshecha',
      [eventos.filter(e => e.startsWith('escritura')), eventos.at(-1)], [[], 'rollback']);
    igual('bloqueos en orden: administradores activos, actor y objetivo (dentro de la transacción)',
      eventos.slice(0, 4), ['inicio', 'bloqueo-administradores', 'bloqueo-cuenta-10', 'bloqueo-cuenta-11']);

    preparar({ admins: [10, 11] });
    const conOtro = await resultado(usuariosService.actualizar(10, '11', { rol_id: 2, panaderia_id: 20 }));
    igual('con otro administrador activo -> degradación aplicada dentro de la transacción',
      [conOtro.ok, eventos.includes('escritura-11'), eventos.at(-1), cuentas[11].rol_id], [true, true, 'commit', 2]);

    preparar({ admins: [10], objetivo: { id: 11, rol_id: 2, estado: true, panaderia_id: 20 } });
    const noAdmin = await resultado(usuariosService.actualizar(10, '11', { rol_id: 3 }));
    igual('cambiar el rol de una cuenta que no es administradora no aplica la regla', [noAdmin.ok, cuentas[11].rol_id], [true, 3]);

    preparar({ admins: [11], objetivo: { id: 11, rol_id: 1, estado: false, panaderia_id: null } });
    const inactivo = await resultado(usuariosService.actualizar(10, '11', { rol_id: 2, panaderia_id: 20 }));
    igual('degradar a un administrador desactivado no aplica la regla', [inactivo.ok, cuentas[11].rol_id], [true, 2]);

    // Lo que encuentra la operación perdedora de dos degradaciones simultáneas: su autor ya no es
    // administrador activo. Se rechaza antes de la regla y sin escribir.
    preparar({ admins: [11], actor: { id: 10, rol_id: 2, estado: true } });
    const degradado = await resultado(usuariosService.actualizar(10, '11', { rol_id: 2, panaderia_id: 20 }));
    igual('actor que ya no es administrador -> 403 sin escritura',
      [degradado.e?.status, eventos.filter(e => e.startsWith('escritura'))], [403, []]);

    console.log('\n== cambiarEstado: desactivar a un administrador activo');
    preparar({ admins: [11] });
    const desactivarSolo = await resultado(usuariosService.cambiarEstado(10, '11', { estado: false }));
    igual('desactivar al único administrador activo bloqueado -> 409 sin escritura',
      [desactivarSolo.e?.status, eventos.filter(e => e.startsWith('escritura')), eventos.at(-1)], [409, [], 'rollback']);

    preparar({ admins: [10, 11] });
    const desactivarConOtro = await resultado(usuariosService.cambiarEstado(10, '11', { estado: false }));
    igual('con otro administrador activo -> desactivación aplicada y versión de sesión incrementada',
      [desactivarConOtro.ok, cuentas[11].estado, typeof cuentas[11].version_sesion === 'object'], [true, false, true]);

    preparar({ admins: [11] });
    const reactivar = await resultado(usuariosService.cambiarEstado(10, '11', { estado: true }));
    igual('activar nunca aplica la regla', reactivar.ok, true);

    preparar({ admins: [10], actor: { id: 10, rol_id: 1, estado: true }, objetivo: { id: 10, rol_id: 1, estado: true } });
    const propia = await resultado(usuariosService.cambiarEstado(10, '10', { estado: false }));
    igual('desactivarse a sí mismo -> 403 sin escritura', [propia.e?.status, eventos.filter(e => e.startsWith('escritura'))], [403, []]);

    igual('en ningún escenario hubo lecturas de Usuario.findAll distintas del bloqueo de administradores activos', lecturasNoPrevistas, 0);
  } finally {
    sequelize.transaction = originales.transaction;
    Usuario.findAll = originales.findAll;
    Usuario.findByPk = originales.findByPk;
    Usuario.findOne = originales.findOne;
    Panaderia.findByPk = originales.panaderiaFindByPk;
  }
};

main()
  .catch(error => { resultados.push(false); console.log('FALLA ejecución abortada ->', error.message); })
  .finally(() => {
    const fallidas = resultados.filter(ok => !ok).length;
    console.log(`\n${resultados.length - fallidas}/${resultados.length} pruebas correctas`);
    process.exit(fallidas ? 1 : 0);
  });
