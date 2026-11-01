const { Usuario, Rol, Panaderia, sequelize } = require('../../models/index');
const ROLES = require('../../config/roles');
const { ErrorNegocio } = require('../../utils/errores');
const { enTransaccion } = require('../../utils/transaccion');
const { parsearId } = require('../produccion/produccion.validaciones');
const { parsearEmail } = require('../../utils/email');
// Enlaces de restablecimiento (SQL 005): se invocan por el objeto para poder sustituirlos en pruebas
const restablecimientos = require('../auth/restablecimiento.repositorio');

const CAMPOS_EDITABLES = ['email', 'rol_id', 'panaderia_id'];

// Nunca se leen ni se devuelven contraseñas ni hashes
const ATRIBUTOS = ['id', 'email', 'rol_id', 'panaderia_id', 'estado', 'createdAt', 'updatedAt'];
const INCLUDES = [
  { model: Rol, attributes: ['nombre'] },
  { model: Panaderia, as: 'panaderiaAsignada', attributes: ['id', 'nombre'] }
];

const formatear = (usuario) => ({
  id: usuario.id,
  email: usuario.email,
  rol_id: usuario.rol_id,
  rol: usuario.Rol?.nombre ?? null,
  panaderia_id: usuario.panaderia_id ?? null,
  panaderia: usuario.panaderiaAsignada
    ? { id: usuario.panaderiaAsignada.id, nombre: usuario.panaderiaAsignada.nombre }
    : null,
  estado: Boolean(usuario.estado),
  createdAt: usuario.createdAt,
  updatedAt: usuario.updatedAt
});

const obtenerFormateado = async (id, transaction) =>
  formatear(await Usuario.findByPk(id, { attributes: ATRIBUTOS, include: INCLUDES, transaction }));

// El rol del token puede estar desactualizado: la gestión de cuentas exige que quien
// actúa sea, según la base de datos, un administrador activo de una panadería
const exigirAdministradorActivo = (actor) => {
  if (!actor || !actor.estado || actor.rol_id !== ROLES.ADMINISTRADOR || !actor.panaderia_id) {
    throw new ErrorNegocio('No tiene permisos para realizar esta acción', 403);
  }
};

// Bloquea (FOR UPDATE) a los administradores activos de la panadería y devuelve sus id. Dos
// operaciones que afecten a administradores de una panadería quedan así en serie y no pueden
// dejarla sin ninguno.
const bloquearAdministradoresActivos = async (t, panaderiaId) => {
  const filas = await Usuario.findAll({
    attributes: ['id'],
    where: { rol_id: ROLES.ADMINISTRADOR, estado: true, panaderia_id: panaderiaId },
    lock: t.LOCK.UPDATE,
    transaction: t
  });
  return filas.map(f => f.id);
};

const asegurarOtroAdministradorActivo = (idsAdministradores, objetivoId) => {
  if (!idsAdministradores.some(id => id !== objetivoId)) {
    throw new ErrorNegocio('Debe quedar al menos un administrador activo', 409);
  }
};

// Bloqueos siempre en el mismo orden: administradores activos de la panadería, actor, cuenta
// objetivo. La panadería del actor se lee primero sin bloqueo (para saber qué bloquear) y se
// vuelve a comprobar con el actor ya bloqueado: si cambió entretanto, no se escribe nada (409).
// Una cuenta de otra panadería no se encuentra (404), igual que una inexistente. La cuenta
// objetivo también se lee antes sin bloqueo: si no es de la panadería, el 404 se responde sin
// bloquear nada (ni una fila de otra panadería). Su pertenencia se vuelve a comprobar bloqueada.
const prepararOperacion = async (t, actorId, objetivoId) => {
  const previo = await Usuario.findByPk(actorId, {
    attributes: ['id', 'rol_id', 'panaderia_id', 'estado'], transaction: t
  });
  exigirAdministradorActivo(previo);
  const panaderiaId = previo.panaderia_id;

  const objetivoPrevio = objetivoId === actorId
    ? previo
    : await Usuario.findByPk(objetivoId, { attributes: ['id', 'panaderia_id'], transaction: t });
  if (!objetivoPrevio || objetivoPrevio.panaderia_id !== panaderiaId) throw new ErrorNegocio('Cuenta no encontrada', 404);

  const administradores = await bloquearAdministradoresActivos(t, panaderiaId);

  const actor = await Usuario.findByPk(actorId, {
    attributes: ['id', 'rol_id', 'panaderia_id', 'estado'], lock: t.LOCK.UPDATE, transaction: t
  });
  exigirAdministradorActivo(actor);
  if (actor.panaderia_id !== panaderiaId) {
    throw new ErrorNegocio('La cuenta cambió durante la operación. Inténtelo de nuevo.', 409);
  }

  const objetivo = await Usuario.findByPk(objetivoId, {
    attributes: ['id', 'email', 'rol_id', 'panaderia_id', 'estado'], lock: t.LOCK.UPDATE, transaction: t
  });
  if (!objetivo || objetivo.panaderia_id !== panaderiaId) throw new ErrorNegocio('Cuenta no encontrada', 404);

  return { administradores, objetivo, panaderiaId };
};

// panaderia_id en una edición: no se puede cambiar. Solo se admite el valor de la propia
// panadería (la interfaz lo envía), que no tiene efecto.
const esLaMismaPanaderia = (valor, panaderiaId) =>
  (typeof valor === 'number' || (typeof valor === 'string' && valor.trim() !== '')) && Number(valor) === panaderiaId;

const parsearRol = (valor) => {
  const rolId = typeof valor === 'number' || typeof valor === 'string' ? Number(valor) : NaN;
  if (!Object.values(ROLES).includes(rolId)) throw new ErrorNegocio('Rol inválido', 400);
  return rolId;
};

class UsuariosService {

  // Solo las cuentas de la panadería del administrador
  async listar(actorId) {
    const actor = await Usuario.findByPk(actorId, { attributes: ['id', 'rol_id', 'panaderia_id', 'estado'] });
    exigirAdministradorActivo(actor);

    const usuarios = await Usuario.findAll({
      attributes: ATRIBUTOS,
      include: INCLUDES,
      where: { panaderia_id: actor.panaderia_id },
      order: [['estado', 'DESC'], ['email', 'ASC']]
    });
    return usuarios.map(formatear);
  }

  async actualizar(actorId, idTexto, datos) {
    const id = parsearId(idTexto, 'id de cuenta');

    if (!datos || typeof datos !== 'object' || Array.isArray(datos)) {
      throw new ErrorNegocio('Datos inválidos', 400);
    }
    const noPermitidos = Object.keys(datos).filter(c => !CAMPOS_EDITABLES.includes(c));
    if (noPermitidos.length) {
      throw new ErrorNegocio(`Campos no editables: ${noPermitidos.join(', ')}`, 400);
    }
    if (!CAMPOS_EDITABLES.some(c => datos[c] !== undefined)) {
      throw new ErrorNegocio('No hay cambios para guardar', 400);
    }

    // Validación de formato antes de abrir la transacción
    const email = datos.email !== undefined ? parsearEmail(datos.email) : undefined;
    const rolPedido = datos.rol_id !== undefined ? parsearRol(datos.rol_id) : undefined;
    const panaderiaEnviada = datos.panaderia_id !== undefined;

    return enTransaccion(sequelize, async (t) => {
      const { administradores, objetivo, panaderiaId } = await prepararOperacion(t, actorId, id);

      // La panadería de una cuenta no se cambia desde la administración
      if (panaderiaEnviada && !esLaMismaPanaderia(datos.panaderia_id, panaderiaId)) {
        throw new ErrorNegocio('Campos no editables: panaderia_id', 400);
      }

      const rolFinal = rolPedido ?? objetivo.rol_id;

      // Nadie cambia su propio rol desde la administración
      if (id === actorId && rolFinal !== objetivo.rol_id) {
        throw new ErrorNegocio('No puede cambiar su propio rol', 403);
      }

      // Ninguna cuenta pasa a ser administradora desde la administración
      if (rolFinal === ROLES.ADMINISTRADOR && objetivo.rol_id !== ROLES.ADMINISTRADOR) {
        throw new ErrorNegocio('No tiene permisos para asignar el rol de administrador', 403);
      }

      // Degradar a un administrador activo exige que quede otro en su panadería
      if (objetivo.estado && objetivo.rol_id === ROLES.ADMINISTRADOR && rolFinal !== ROLES.ADMINISTRADOR) {
        asegurarOtroAdministradorActivo(administradores, id);
      }

      if (email !== undefined && email !== objetivo.email) {
        const existe = await Usuario.findOne({ attributes: ['id'], where: { email }, transaction: t });
        if (existe && existe.id !== id) throw new ErrorNegocio('El email ya está registrado', 409);
      }

      const emailCambia = email !== undefined && email !== objetivo.email;
      await objetivo.update({
        ...(email !== undefined && { email }),
        rol_id: rolFinal
      }, { transaction: t });

      // Cambio de correo: en la misma transacción (cuenta ya bloqueada), los enlaces pendientes
      // quedan invalidados y se registra el evento (sin las direcciones)
      if (emailCambia) {
        await restablecimientos.invalidarPendientes(t, { usuarioId: id, motivo: 'email_cambiado', actorId, panaderiaId });
        await restablecimientos.registrarEvento(t, { tipo: 'email_cambiado', usuarioId: id, panaderiaId, actorId });
      }

      return obtenerFormateado(id, t);
    });
  }

  async cambiarEstado(actorId, idTexto, datos) {
    const id = parsearId(idTexto, 'id de cuenta');
    const estado = datos?.estado;
    if (typeof estado !== 'boolean') {
      throw new ErrorNegocio('estado debe ser true o false', 400);
    }

    return enTransaccion(sequelize, async (t) => {
      const { administradores, objetivo, panaderiaId } = await prepararOperacion(t, actorId, id);

      if (id === actorId) {
        throw new ErrorNegocio('No puede cambiar el estado de su propia cuenta', 403);
      }

      if (!estado && objetivo.estado && objetivo.rol_id === ROLES.ADMINISTRADOR) {
        asegurarOtroAdministradorActivo(administradores, id);
      }

      if (Boolean(objetivo.estado) !== estado) {
        // Desactivar también sube la versión de sesión: los tokens anteriores no vuelven a
        // valer aunque la cuenta se reactive (habrá que iniciar sesión de nuevo)
        await objetivo.update({
          estado,
          ...(!estado && { version_sesion: sequelize.literal('version_sesion + 1') })
        }, { transaction: t });
        // Desactivar invalida también los enlaces de restablecimiento pendientes
        if (!estado) {
          await restablecimientos.invalidarPendientes(t, { usuarioId: id, motivo: 'cuenta_desactivada', actorId, panaderiaId });
        }
      }

      return obtenerFormateado(id, t);
    });
  }
}

module.exports = new UsuariosService();
module.exports.asegurarOtroAdministradorActivo = asegurarOtroAdministradorActivo;
