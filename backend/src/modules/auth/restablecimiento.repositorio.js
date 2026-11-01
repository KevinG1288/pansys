const { Op } = require('sequelize');
const { sequelize, Usuario, RestablecimientoContrasena, EventoSeguridad } = require('../../models/index');
const { enTransaccion } = require('../../utils/transaccion');

// Acceso a datos del restablecimiento de contraseña (SQL 005). Cada operación que escribe abre su
// propia transacción corta; ninguna envía correo ni calcula bcrypt dentro de ella.
// Orden de bloqueos, siempre el mismo: 1) las cuentas implicadas, en una sola sentencia y en orden
// ascendente de id; 2) la fila del enlace por su id (nunca rangos de enlaces con FOR UPDATE);
// 3) la inserción de eventos. Como toda operación sobre los enlaces de una cuenta bloquea antes la
// cuenta, esas operaciones quedan en serie.
// Nunca se lee ni se devuelve el token_hash salvo para buscar por él; los eventos no llevan IP,
// contraseñas, tokens ni hashes.

const PENDIENTES = ['activo', 'enviando'];
const ATRIBUTOS_CUENTA = ['id', 'email', 'rol_id', 'panaderia_id', 'estado', 'version_sesion'];
const ATRIBUTOS_ENLACE = ['id', 'usuario_id', 'estado', 'expira_en', 'intentos_fallidos', 'createdAt'];

const fecha = (ms) => new Date(ms);

const repositorio = {
  // Transacción corta; reintenta los interbloqueos (enTransaccion)
  transaccion: (fn) => enTransaccion(sequelize, fn),

  bloquearCuentas: (t, ids) => Usuario.findAll({
    attributes: ATRIBUTOS_CUENTA,
    where: { id: [...new Set(ids)].sort((a, b) => a - b) },
    order: [['id', 'ASC']],
    lock: t.LOCK.UPDATE,
    transaction: t
  }),

  // Sin transacción: solo localiza la cuenta de una solicitud pública
  buscarCuentaActivaPorEmail: (email) => Usuario.findOne({ attributes: ['id'], where: { email, estado: true } }),

  // Sin transacción: el hash se compara con bcrypt FUERA de cualquier transacción
  buscarCredencialesActor: (id) => Usuario.findByPk(id, { attributes: ['id', 'contrasena', 'rol_id', 'panaderia_id', 'estado'] }),

  registrarEvento: (t, { tipo, usuarioId, panaderiaId = null, actorId = null, restablecimientoId = null, detalle = null }) =>
    EventoSeguridad.create({
      tipo, usuario_id: usuarioId, panaderia_id: panaderiaId, actor_id: actorId, restablecimiento_id: restablecimientoId, detalle
    }, { transaction: t }),

  // Evento fuera de transacción (p. ej. una reconfirmación fallida, que no escribe nada más)
  registrarEventoSuelto: (datos) => repositorio.registrarEvento(null, datos),

  // Reservas 'enviando' de la cuenta cuyo plazo venció: pasan a envio_fallido/proceso_interrumpido
  // sin activarse ni tocar los demás enlaces. La cuenta ya está bloqueada por quien llama.
  async recuperarVencidas(t, { usuarioId, panaderiaId, ahora, reservaMs }) {
    const vencidas = await RestablecimientoContrasena.findAll({
      attributes: ['id'],
      where: { usuario_id: usuarioId, estado: 'enviando', createdAt: { [Op.lte]: fecha(ahora - reservaMs) } },
      transaction: t
    });
    let recuperadas = 0;
    for (const { id } of vencidas) {
      const [n] = await RestablecimientoContrasena.update(
        { estado: 'envio_fallido', motivo: 'proceso_interrumpido', fallido_en: fecha(ahora) },
        { where: { id, estado: 'enviando' }, transaction: t }
      );
      if (n === 1) {
        recuperadas++;
        await repositorio.registrarEvento(t, { tipo: 'restablecimiento_fallido', usuarioId, panaderiaId, restablecimientoId: id, detalle: 'proceso_interrumpido' });
      }
    }
    return recuperadas;
  },

  contarEnCurso: (t, usuarioId) => RestablecimientoContrasena.count({ where: { usuario_id: usuarioId, estado: 'enviando' }, transaction: t }),

  // Marcas de tiempo (ms), en orden ascendente, de los enlaces de la cuenta activados DESPUÉS de
  // `desde` (estrictamente: a los 60 min exactos una activación deja de contar, como en el
  // limitador en memoria)
  async activacionesDesde(t, usuarioId, desde) {
    const filas = await RestablecimientoContrasena.findAll({
      attributes: ['enviado_en'],
      where: { usuario_id: usuarioId, enviado_en: { [Op.gt]: fecha(desde) } },
      order: [['enviado_en', 'ASC']],
      transaction: t
    });
    return filas.map(f => new Date(f.enviado_en).getTime());
  },

  // Marcas de tiempo (ms), en orden ascendente, de las reservas que pidió el administrador DESPUÉS
  // de `desde` (estrictamente, igual que activacionesDesde)
  async reservasDeActorDesde(t, actorId, desde) {
    const filas = await RestablecimientoContrasena.findAll({
      attributes: ['createdAt'],
      where: { solicitado_por: actorId, createdAt: { [Op.gt]: fecha(desde) } },
      order: [['createdAt', 'ASC']],
      transaction: t
    });
    return filas.map(f => new Date(f.createdAt).getTime());
  },

  async insertarReserva(t, { usuarioId, origen, solicitadoPor, tokenHash, expiraEn }) {
    const fila = await RestablecimientoContrasena.create({
      usuario_id: usuarioId, origen, solicitado_por: solicitadoPor, token_hash: tokenHash, estado: 'enviando', expira_en: fecha(expiraEn)
    }, { transaction: t });
    return fila.id;
  },

  // Invalida los enlaces pendientes ('activo' y 'enviando') de una cuenta YA BLOQUEADA por quien
  // llama, dentro de su transacción, y registra un evento por cada enlace invalidado. Devuelve
  // cuántos invalidó. Lo usan el consumo, la activación, el cambio de correo, la desactivación y
  // el cambio de contraseña desde Mi cuenta.
  async invalidarPendientes(t, { usuarioId, motivo, actorId = null, panaderiaId = null, ahora = Date.now(), excluirId = null, estados = PENDIENTES }) {
    const filas = await RestablecimientoContrasena.findAll({
      attributes: ['id'],
      where: { usuario_id: usuarioId, estado: estados, ...(excluirId !== null && { id: { [Op.ne]: excluirId } }) },
      transaction: t
    });
    let invalidados = 0;
    for (const { id } of filas) {
      const [n] = await RestablecimientoContrasena.update(
        { estado: 'invalidado', motivo, invalidado_en: fecha(ahora) },
        { where: { id, estado: estados }, transaction: t }
      );
      if (n === 1) {
        invalidados++;
        await repositorio.registrarEvento(t, { tipo: 'restablecimiento_invalidado', usuarioId, panaderiaId, actorId, restablecimientoId: id, detalle: motivo });
      }
    }
    return invalidados;
  },

  // Activa una reserva tras la aceptación del SMTP. Solo si la fila sigue 'enviando' y dentro de
  // su plazo de reserva: invalida en el mismo COMMIT el enlace activo anterior y registra el
  // evento. Devuelve false sin cambiar nada en cualquier otro caso (repetir una activación ya
  // hecha no invalida nada).
  activar({ id, usuarioId, ahora, reservaMs }) {
    return repositorio.transaccion(async (t) => {
      const [cuenta] = await repositorio.bloquearCuentas(t, [usuarioId]);
      const enlace = await RestablecimientoContrasena.findByPk(id, { attributes: ATRIBUTOS_ENLACE, lock: t.LOCK.UPDATE, transaction: t });
      if (!cuenta || !enlace || enlace.usuario_id !== usuarioId || enlace.estado !== 'enviando'
        || new Date(enlace.createdAt).getTime() + reservaMs <= ahora) {
        return false;
      }
      // Primero el anterior (UNIQUE de un solo 'activo' por cuenta) y en la misma transacción: nunca
      // se confirma el anterior invalidado sin el nuevo activo
      await repositorio.invalidarPendientes(t, {
        usuarioId, motivo: 'nuevo_enlace', panaderiaId: cuenta.panaderia_id, ahora, excluirId: id, estados: ['activo']
      });
      const [n] = await RestablecimientoContrasena.update(
        { estado: 'activo', enviado_en: fecha(ahora) },
        { where: { id, estado: 'enviando' }, transaction: t }
      );
      if (n !== 1) throw new Error('La activación no cambió exactamente una fila');
      await repositorio.registrarEvento(t, { tipo: 'restablecimiento_activado', usuarioId, panaderiaId: cuenta.panaderia_id, restablecimientoId: id });
      return true;
    });
  },

  // Estado actual de un enlace por id (fuera de transacción): resuelve un COMMIT ambiguo
  async leerEstado(id) {
    const fila = await RestablecimientoContrasena.findByPk(id, { attributes: ['estado'] });
    return fila?.estado ?? null;
  },

  // Marca condicional de envío fallido: solo si sigue 'enviando'. El enlace anterior no se toca.
  marcarFallido({ id, usuarioId, motivo, ahora }) {
    return repositorio.transaccion(async (t) => {
      const [cuenta] = await repositorio.bloquearCuentas(t, [usuarioId]);
      const [n] = await RestablecimientoContrasena.update(
        { estado: 'envio_fallido', motivo, fallido_en: fecha(ahora) },
        { where: { id, usuario_id: usuarioId, estado: 'enviando' }, transaction: t }
      );
      if (n === 1) {
        await repositorio.registrarEvento(t, { tipo: 'restablecimiento_fallido', usuarioId, panaderiaId: cuenta?.panaderia_id ?? null, restablecimientoId: id, detalle: motivo });
      }
      return n === 1;
    });
  },

  // Sin transacción: solo identifica el enlace. Toda decisión se vuelve a comprobar bloqueada.
  buscarPorHash: (tokenHash) => RestablecimientoContrasena.findOne({ attributes: ATRIBUTOS_ENLACE, where: { token_hash: tokenHash } }),

  // Un intento fallido con un enlace activo (p. ej. una contraseña nueva que no cumple la política).
  // Al llegar a `maximo`, el enlace queda invalidado por 'intentos'. Devuelve los intentos acumulados.
  sumarFallo({ id, usuarioId, maximo, ahora }) {
    return repositorio.transaccion(async (t) => {
      const [cuenta] = await repositorio.bloquearCuentas(t, [usuarioId]);
      const enlace = await RestablecimientoContrasena.findByPk(id, { attributes: ATRIBUTOS_ENLACE, lock: t.LOCK.UPDATE, transaction: t });
      if (!enlace || enlace.usuario_id !== usuarioId || enlace.estado !== 'activo') return null;
      const intentos = Math.min(enlace.intentos_fallidos + 1, maximo);
      const agotado = intentos >= maximo;
      await RestablecimientoContrasena.update(
        { intentos_fallidos: intentos, ...(agotado && { estado: 'invalidado', motivo: 'intentos', invalidado_en: fecha(ahora) }) },
        { where: { id, estado: 'activo' }, transaction: t }
      );
      if (agotado) {
        await repositorio.registrarEvento(t, { tipo: 'restablecimiento_invalidado', usuarioId, panaderiaId: cuenta?.panaderia_id ?? null, restablecimientoId: id, detalle: 'intentos' });
      }
      return intentos;
    });
  },

  // Consumo: con la cuenta y el enlace bloqueados, comprueba que el enlace es 'activo', no ha
  // caducado y tiene menos de `maximoFallos`; cambia la contraseña, sube version_sesion (revoca los
  // JWT anteriores), marca 'usado', invalida los demás pendientes y registra el evento. Todo en un
  // COMMIT. Con la cuenta desactivada, solo invalida sus enlaces.
  consumir({ id, usuarioId, hashNuevo, ahora, maximoFallos }) {
    return repositorio.transaccion(async (t) => {
      const [cuenta] = await repositorio.bloquearCuentas(t, [usuarioId]);
      const enlace = await RestablecimientoContrasena.findByPk(id, { attributes: ATRIBUTOS_ENLACE, lock: t.LOCK.UPDATE, transaction: t });
      if (!cuenta || !enlace || enlace.usuario_id !== usuarioId || enlace.estado !== 'activo'
        || new Date(enlace.expira_en).getTime() <= ahora || enlace.intentos_fallidos >= maximoFallos) {
        return { ok: false };
      }
      if (!cuenta.estado) {
        await repositorio.invalidarPendientes(t, { usuarioId, motivo: 'cuenta_desactivada', panaderiaId: cuenta.panaderia_id, ahora });
        return { ok: false };
      }
      await Usuario.update(
        { contrasena: hashNuevo, version_sesion: sequelize.literal('version_sesion + 1') },
        { where: { id: usuarioId }, transaction: t }
      );
      const [n] = await RestablecimientoContrasena.update(
        { estado: 'usado', usado_en: fecha(ahora) },
        { where: { id, estado: 'activo' }, transaction: t }
      );
      if (n !== 1) throw new Error('El consumo no cambió exactamente un enlace');
      await repositorio.invalidarPendientes(t, { usuarioId, motivo: 'contrasena_cambiada', panaderiaId: cuenta.panaderia_id, ahora, excluirId: id });
      await repositorio.registrarEvento(t, { tipo: 'restablecimiento_usado', usuarioId, panaderiaId: cuenta.panaderia_id, restablecimientoId: id });
      return { ok: true };
    });
  }
};

module.exports = repositorio;
module.exports.PENDIENTES = PENDIENTES;
