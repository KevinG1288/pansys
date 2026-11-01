// Pruebas unitarias de la gestión de cuentas por panadería (usuarios.service): la regla "debe quedar
// al menos un administrador activo" aplicada a la panadería del administrador, el orden de bloqueos
// con la nueva comprobación de la panadería de quien actúa, y el aislamiento entre panaderías
// (una cuenta de otra panadería no se encuentra, no se promueve a nadie a administrador y la
// panadería de una cuenta no se cambia).
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
  const restablecimientos = require('../src/modules/auth/restablecimiento.repositorio');
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
    findOne: Usuario.findOne, panaderiaFindByPk: Panaderia.findByPk,
    invalidarPendientes: restablecimientos.invalidarPendientes, registrarEvento: restablecimientos.registrarEvento
  };

  // Escenario: cuentas en memoria (por defecto, todas de la panadería 20) y la lista de
  // administradores activos que devuelve el bloqueo. alLeer[id] se ejecuta tras la primera
  // lectura sin bloqueo de esa cuenta (simula un cambio concurrente antes de los bloqueos).
  let eventos;
  let cuentas;
  let administradoresBloqueados;
  let alLeer;
  const leidas = new Set();
  // Enlaces de restablecimiento (SQL 005): llamadas anotadas aparte, con si fueron dentro de la
  // transacción y antes del COMMIT (sin alterar la secuencia de eventos de las demás pruebas)
  let recuperacion;
  const preparar = ({
    admins, actor = { id: 10, rol_id: 1, estado: true, panaderia_id: 20 },
    objetivo = { id: 11, rol_id: 1, estado: true, panaderia_id: 20 }, otras = [], tras = {}
  }) => {
    eventos = [];
    recuperacion = [];
    administradoresBloqueados = admins;
    alLeer = tras;
    leidas.clear();
    cuentas = {};
    for (const c of [actor, objetivo, ...otras]) cuentas[c.id] = { email: `cuenta${c.id}@pansys.test`, ...c };
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
  const formateable = (cuenta) => ({
    ...cuenta,
    Rol: { nombre: cuenta.rol_id === 1 ? 'administrador' : 'panadero' },
    panaderiaAsignada: cuenta.panaderia_id ? { id: cuenta.panaderia_id, nombre: `Panadería ${cuenta.panaderia_id}` } : null
  });
  Usuario.findAll = async (opciones) => {
    const where = opciones?.where ?? {};
    const esBloqueoAdmins = opciones?.lock === 'UPDATE' && where.rol_id === 1 && where.estado === true && 'panaderia_id' in where;
    const esListado = !opciones?.lock && Object.keys(where).join() === 'panaderia_id';
    if (esBloqueoAdmins) {
      eventos.push(`bloqueo-administradores:${where.panaderia_id}`);
      return administradoresBloqueados.map(id => ({ id }));
    }
    if (esListado) {
      eventos.push(`listado:${where.panaderia_id}`);
      return Object.values(cuentas).filter(c => c.panaderia_id === where.panaderia_id).map(formateable);
    }
    lecturasNoPrevistas++;
    eventos.push('lectura-no-prevista');
    return [];
  };
  Usuario.findByPk = async (id, opciones) => {
    const cuenta = cuentas[id];
    eventos.push(`${opciones?.lock ? 'bloqueo' : 'lectura'}-cuenta-${id}`);
    if (!cuenta) return null;
    const copia = {
      ...formateable(cuenta),
      update: async (cambios, op) => {
        eventos.push(`escritura-${id}${op?.transaction ? '' : ':FUERA DE LA TRANSACCION'}`);
        Object.assign(cuenta, cambios);
      }
    };
    if (!opciones?.lock && alLeer[id] && !leidas.has(id)) { leidas.add(id); alLeer[id](cuenta); }
    return copia;
  };
  Usuario.findOne = async () => null;
  const dentroDeLaTransaccion = (t) => Boolean(t) && eventos.includes('inicio') && !eventos.includes('commit');
  restablecimientos.invalidarPendientes = async (t, datos) => {
    recuperacion.push({ op: 'invalidar', enTransaccion: dentroDeLaTransaccion(t), ...datos });
    return 0;
  };
  restablecimientos.registrarEvento = async (t, datos) => {
    recuperacion.push({ op: 'evento', enTransaccion: dentroDeLaTransaccion(t), ...datos });
  };
  // La gestión de cuentas ya no consulta panaderías: cualquier consulta se cuenta como fallo
  let consultasPanaderia = 0;
  Panaderia.findByPk = async (id) => { consultasPanaderia++; return { id }; };
  const escrituras = () => eventos.filter(e => e.startsWith('escritura'));

  try {
    console.log('\n== actualizar: degradar a un administrador activo de la panadería');
    preparar({ admins: [11] });
    const solo = await resultado(usuariosService.actualizar(10, '11', { rol_id: 2, panaderia_id: 20 }));
    igual('degradar al único administrador activo de la panadería -> 409', [solo.ok, solo.e?.status, solo.e?.message], [false, 409, 'Debe quedar al menos un administrador activo']);
    igual('409: sin escritura y con la transacción deshecha', [escrituras(), eventos.at(-1)], [[], 'rollback']);
    igual('orden: lecturas de quien actúa y del objetivo, bloqueo de los administradores de SU panadería, actor y objetivo',
      eventos.slice(0, 6), ['inicio', 'lectura-cuenta-10', 'lectura-cuenta-11', 'bloqueo-administradores:20', 'bloqueo-cuenta-10', 'bloqueo-cuenta-11']);

    preparar({ admins: [10, 11] });
    const conOtro = await resultado(usuariosService.actualizar(10, '11', { rol_id: 2, panaderia_id: 20 }));
    igual('D3: con otro administrador activo en la panadería -> degradación aplicada dentro de la transacción',
      [conOtro.ok, eventos.includes('escritura-11'), eventos.at(-1), cuentas[11].rol_id, cuentas[11].panaderia_id], [true, true, 'commit', 2, 20]);

    preparar({ admins: [10], objetivo: { id: 11, rol_id: 2, estado: true, panaderia_id: 20 } });
    const noAdmin = await resultado(usuariosService.actualizar(10, '11', { rol_id: 3 }));
    igual('cambiar el rol de una cuenta que no es administradora no aplica la regla', [noAdmin.ok, cuentas[11].rol_id], [true, 3]);

    preparar({ admins: [10], objetivo: { id: 11, rol_id: 1, estado: false, panaderia_id: 20 } });
    const inactivo = await resultado(usuariosService.actualizar(10, '11', { rol_id: 2 }));
    igual('degradar a un administrador desactivado no aplica la regla', [inactivo.ok, cuentas[11].rol_id], [true, 2]);

    // Lo que encuentra la operación perdedora de dos degradaciones simultáneas: su autor ya no es
    // administrador activo. Se rechaza antes de la regla y sin escribir.
    preparar({ admins: [11], actor: { id: 10, rol_id: 2, estado: true, panaderia_id: 20 } });
    const degradado = await resultado(usuariosService.actualizar(10, '11', { rol_id: 2 }));
    igual('actor que ya no es administrador -> 403 sin bloqueos ni escritura',
      [degradado.e?.status, escrituras(), eventos.some(e => e.startsWith('bloqueo'))], [403, [], false]);

    console.log('\n== actualizar: aislamiento por panadería y escalada de privilegios');
    for (const [descripcion, objetivo] of [
      ['de otra panadería', { id: 11, rol_id: 2, estado: true, panaderia_id: 21 }],
      ['administradora de otra panadería', { id: 11, rol_id: 1, estado: true, panaderia_id: 21 }],
      ['sin panadería (administrador global anterior)', { id: 11, rol_id: 1, estado: true, panaderia_id: null }]
    ]) {
      preparar({ admins: [10], objetivo });
      const ajena = await resultado(usuariosService.actualizar(10, '11', { email: 'nuevo@pansys.test' }));
      igual(`editar una cuenta ${descripcion} -> 404 «Cuenta no encontrada» sin escritura`,
        [ajena.e?.status, ajena.e?.message, escrituras(), eventos.at(-1)], [404, 'Cuenta no encontrada', [], 'rollback']);
      igual(`editar una cuenta ${descripcion}: 404 sin ningún bloqueo (solo las dos lecturas previas)`,
        eventos, ['inicio', 'lectura-cuenta-10', 'lectura-cuenta-11', 'rollback']);
    }
    preparar({ admins: [10], objetivo: { id: 11, rol_id: 2, estado: true, panaderia_id: 20 } });
    const promover = await resultado(usuariosService.actualizar(10, '11', { rol_id: 1 }));
    igual('promover a administrador -> 403 sin escritura',
      [promover.e?.status, promover.e?.message, escrituras(), cuentas[11].rol_id], [403, 'No tiene permisos para asignar el rol de administrador', [], 2]);
    for (const valor of [21, null, '', 'abc', '21']) {
      preparar({ admins: [10], objetivo: { id: 11, rol_id: 2, estado: true, panaderia_id: 20 } });
      const mover = await resultado(usuariosService.actualizar(10, '11', { rol_id: 3, panaderia_id: valor }));
      igual(`panaderia_id ${JSON.stringify(valor)} distinto del propio -> 400 sin escritura`,
        [mover.e?.status, mover.e?.message, escrituras(), cuentas[11].panaderia_id], [400, 'Campos no editables: panaderia_id', [], 20]);
    }
    for (const valor of [20, '20']) {
      preparar({ admins: [10], objetivo: { id: 11, rol_id: 2, estado: true, panaderia_id: 20 } });
      const igualPropia = await resultado(usuariosService.actualizar(10, '11', { rol_id: 3, panaderia_id: valor }));
      igual(`panaderia_id ${JSON.stringify(valor)} igual al propio (lo envía la interfaz) -> sin efecto y cambio aplicado`,
        [igualPropia.ok, cuentas[11].rol_id, cuentas[11].panaderia_id], [true, 3, 20]);
    }
    preparar({ admins: [10, 11] });
    const editarAdmin = await resultado(usuariosService.actualizar(10, '11', { email: 'admin.b@pansys.test' }));
    igual('editar el correo de otro administrador de la panadería no le quita la panadería',
      [editarAdmin.ok, cuentas[11].email, cuentas[11].rol_id, cuentas[11].panaderia_id], [true, 'admin.b@pansys.test', 1, 20]);

    console.log('\n== enlaces de restablecimiento: invalidación en la misma transacción');
    igual('cambio de correo -> invalida los enlaces pendientes y registra el evento, dentro de la transacción y sin direcciones',
      recuperacion, [
        { op: 'invalidar', enTransaccion: true, usuarioId: 11, motivo: 'email_cambiado', actorId: 10, panaderiaId: 20 },
        { op: 'evento', enTransaccion: true, tipo: 'email_cambiado', usuarioId: 11, panaderiaId: 20, actorId: 10 }
      ]);
    preparar({ admins: [10, 11] });
    const mismoCorreo = await resultado(usuariosService.actualizar(10, '11', { email: 'cuenta11@pansys.test', rol_id: 1 }));
    igual('el mismo correo -> sin invalidación ni evento', [mismoCorreo.ok, recuperacion], [true, []]);
    preparar({ admins: [10], objetivo: { id: 11, rol_id: 2, estado: true, panaderia_id: 20 } });
    await resultado(usuariosService.actualizar(10, '11', { rol_id: 3 }));
    igual('solo cambio de rol -> sin invalidación ni evento', recuperacion, []);
    preparar({ admins: [10], objetivo: { id: 11, rol_id: 2, estado: true, panaderia_id: 21 } });
    await resultado(usuariosService.actualizar(10, '11', { email: 'nuevo@pansys.test' }));
    igual('cambio de correo de una cuenta de otra panadería (404) -> sin invalidación ni evento', recuperacion, []);
    preparar({ admins: [10], objetivo: { id: 11, rol_id: 2, estado: true, panaderia_id: 20 } });
    restablecimientos.invalidarPendientes = async () => { throw new Error('Fallo simulado al invalidar'); };
    const falloInvalidar = await resultado(usuariosService.actualizar(10, '11', { email: 'otro@pansys.test' }));
    igual('si falla la invalidación, el cambio de correo se deshace (rollback)', [falloInvalidar.ok, eventos.at(-1)], [false, 'rollback']);
    restablecimientos.invalidarPendientes = async (t, datos) => {
      recuperacion.push({ op: 'invalidar', enTransaccion: dentroDeLaTransaccion(t), ...datos });
      return 0;
    };

    console.log('\n== quien actúa: panadería asignada y comprobación tras los bloqueos');
    preparar({ admins: [11], actor: { id: 10, rol_id: 1, estado: true, panaderia_id: null } });
    const sinPanaderia = await resultado(usuariosService.actualizar(10, '11', { rol_id: 2 }));
    igual('administrador sin panadería -> 403 sin bloqueos ni escritura',
      [sinPanaderia.e?.status, escrituras(), eventos.some(e => e.startsWith('bloqueo'))], [403, [], false]);
    preparar({ admins: [10, 11], tras: { 10: (cuenta) => { cuenta.panaderia_id = 21; } } });
    const cambiada = await resultado(usuariosService.actualizar(10, '11', { rol_id: 2 }));
    igual('la panadería de quien actúa cambia entre la lectura y el bloqueo -> 409 sin escritura',
      [cambiada.e?.status, cambiada.e?.message, escrituras(), eventos.at(-1)],
      [409, 'La cuenta cambió durante la operación. Inténtelo de nuevo.', [], 'rollback']);
    igual('el bloqueo se tomó sobre la panadería leída y el objetivo no llegó a bloquearse',
      [eventos.includes('bloqueo-administradores:20'), eventos.includes('bloqueo-cuenta-11')], [true, false]);
    preparar({ admins: [10, 11], tras: { 10: (cuenta) => { cuenta.estado = false; } } });
    const desactivada = await resultado(usuariosService.cambiarEstado(10, '11', { estado: false }));
    igual('quien actúa se desactiva entre la lectura y el bloqueo -> 403 sin escritura',
      [desactivada.e?.status, escrituras()], [403, []]);

    console.log('\n== cambiarEstado: desactivar a un administrador activo de la panadería');
    preparar({ admins: [11] });
    const desactivarSolo = await resultado(usuariosService.cambiarEstado(10, '11', { estado: false }));
    igual('desactivar al único administrador activo de la panadería -> 409 sin escritura',
      [desactivarSolo.e?.status, escrituras(), eventos.at(-1)], [409, [], 'rollback']);

    preparar({ admins: [10, 11] });
    const desactivarConOtro = await resultado(usuariosService.cambiarEstado(10, '11', { estado: false }));
    igual('D3: con otro administrador activo -> desactivación aplicada y versión de sesión incrementada',
      [desactivarConOtro.ok, cuentas[11].estado, typeof cuentas[11].version_sesion === 'object'], [true, false, true]);
    igual('desactivar -> invalida los enlaces pendientes en la misma transacción',
      recuperacion, [{ op: 'invalidar', enTransaccion: true, usuarioId: 11, motivo: 'cuenta_desactivada', actorId: 10, panaderiaId: 20 }]);

    preparar({ admins: [11] });
    const reactivar = await resultado(usuariosService.cambiarEstado(10, '11', { estado: true }));
    igual('activar nunca aplica la regla', reactivar.ok, true);
    igual('activar no invalida enlaces', recuperacion, []);
    preparar({ admins: [10, 11], objetivo: { id: 11, rol_id: 1, estado: false, panaderia_id: 20 } });
    await resultado(usuariosService.cambiarEstado(10, '11', { estado: false }));
    igual('desactivar una cuenta ya desactivada (sin cambio) no invalida enlaces', recuperacion, []);

    preparar({ admins: [10], objetivo: { id: 11, rol_id: 2, estado: true, panaderia_id: 21 } });
    const desactivarAjena = await resultado(usuariosService.cambiarEstado(10, '11', { estado: false }));
    igual('desactivar una cuenta de otra panadería -> 404 sin escritura', [desactivarAjena.e?.status, escrituras(), cuentas[11].estado], [404, [], true]);
    igual('desactivar una cuenta de otra panadería: 404 sin ningún bloqueo', eventos.some(e => e.startsWith('bloqueo')), false);

    preparar({ admins: [10], objetivo: { id: 10, rol_id: 1, estado: true, panaderia_id: 20 } });
    const propia = await resultado(usuariosService.cambiarEstado(10, '10', { estado: false }));
    igual('desactivarse a sí mismo -> 403 sin escritura', [propia.e?.status, escrituras()], [403, []]);
    igual('sobre la propia cuenta no se repite la lectura previa (una sola lectura antes de los bloqueos)',
      eventos.slice(0, 5), ['inicio', 'lectura-cuenta-10', 'bloqueo-administradores:20', 'bloqueo-cuenta-10', 'bloqueo-cuenta-10']);

    // ---------- M2: la cuenta objetivo se comprueba antes de bloquear y otra vez bloqueada ----------
    console.log('\n== cuenta objetivo: lectura previa sin bloqueo y nueva comprobación bloqueada');
    for (const [nombre, operar] of [
      ['actualizar', (id) => usuariosService.actualizar(10, id, { rol_id: 3 })],
      ['cambiarEstado', (id) => usuariosService.cambiarEstado(10, id, { estado: false })]
    ]) {
      preparar({ admins: [10], objetivo: { id: 11, rol_id: 2, estado: true, panaderia_id: 20 } });
      const inexistente = await resultado(operar('99'));
      igual(`${nombre}: cuenta inexistente -> 404 «Cuenta no encontrada» sin bloqueos ni escritura`,
        [inexistente.e?.status, inexistente.e?.message, eventos], [404, 'Cuenta no encontrada', ['inicio', 'lectura-cuenta-10', 'lectura-cuenta-99', 'rollback']]);

      preparar({ admins: [10, 12], objetivo: { id: 11, rol_id: 1, estado: true, panaderia_id: 21 } });
      const ajena = await resultado(operar('11'));
      igual(`${nombre}: administradora de otra panadería -> 404 sin bloquear a los administradores ni la fila ajena`,
        [ajena.e?.status, eventos.some(e => e.startsWith('bloqueo')), escrituras(), cuentas[11]], [404, false, [], { email: 'cuenta11@pansys.test', id: 11, rol_id: 1, estado: true, panaderia_id: 21 }]);

      // La cuenta deja la panadería entre la lectura previa y el bloqueo: decide la lectura bloqueada
      preparar({ admins: [10], objetivo: { id: 11, rol_id: 2, estado: true, panaderia_id: 20 }, tras: { 11: (cuenta) => { cuenta.panaderia_id = 21; } } });
      const movida = await resultado(operar('11'));
      igual(`${nombre}: la cuenta cambia de panadería entre las lecturas -> 404 tras bloquearla, sin escritura`,
        [movida.e?.status, movida.e?.message, escrituras(), eventos.at(-1)], [404, 'Cuenta no encontrada', [], 'rollback']);
      igual(`${nombre}: en ese caso se mantuvo el orden de bloqueo completo antes de rechazar`,
        eventos.slice(0, 7), ['inicio', 'lectura-cuenta-10', 'lectura-cuenta-11', 'bloqueo-administradores:20', 'bloqueo-cuenta-10', 'bloqueo-cuenta-11', 'rollback']);

      preparar({ admins: [10], objetivo: { id: 11, rol_id: 2, estado: true, panaderia_id: 20 } });
      const valida = await resultado(operar('11'));
      igual(`${nombre}: cuenta de la panadería -> aplicada con el orden de siempre (lecturas, bloqueos, escritura, commit)`,
        [valida.ok, eventos], [true, ['inicio', 'lectura-cuenta-10', 'lectura-cuenta-11', 'bloqueo-administradores:20', 'bloqueo-cuenta-10',
          'bloqueo-cuenta-11', 'escritura-11', 'lectura-cuenta-11', 'commit']]);
    }

    console.log('\n== listar: solo las cuentas de la panadería');
    preparar({
      admins: [10], objetivo: { id: 11, rol_id: 2, estado: true, panaderia_id: 20 },
      otras: [{ id: 12, rol_id: 1, estado: true, panaderia_id: 21 }, { id: 13, rol_id: 3, estado: true, panaderia_id: 21 }]
    });
    const lista = await resultado(usuariosService.listar(10));
    igual('listar devuelve solo las cuentas de la panadería de quien actúa',
      [lista.ok, lista.r?.map(c => c.id).sort(), eventos.filter(e => e.startsWith('listado'))], [true, [10, 11], ['listado:20']]);
    preparar({ admins: [], actor: { id: 10, rol_id: 1, estado: true, panaderia_id: null } });
    const listaSin = await resultado(usuariosService.listar(10));
    igual('listar sin panadería asignada -> 403 sin listar nada', [listaSin.e?.status, eventos.filter(e => e.startsWith('listado'))], [403, []]);

    igual('en ningún escenario hubo lecturas de Usuario.findAll distintas del bloqueo y del listado por panadería', lecturasNoPrevistas, 0);
    igual('la gestión de cuentas ya no consulta panaderías', consultasPanaderia, 0);
  } finally {
    sequelize.transaction = originales.transaction;
    Usuario.findAll = originales.findAll;
    Usuario.findByPk = originales.findByPk;
    Usuario.findOne = originales.findOne;
    Panaderia.findByPk = originales.panaderiaFindByPk;
    restablecimientos.invalidarPendientes = originales.invalidarPendientes;
    restablecimientos.registrarEvento = originales.registrarEvento;
  }
};

main()
  .catch(error => { resultados.push(false); console.log('FALLA ejecución abortada ->', error.message); })
  .finally(() => {
    const fallidas = resultados.filter(ok => !ok).length;
    console.log(`\n${resultados.length - fallidas}/${resultados.length} pruebas correctas`);
    process.exit(fallidas ? 1 : 0);
  });
