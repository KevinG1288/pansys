const { Usuario, Rol, Panaderia, sequelize } = require('../../models/index');
const ROLES = require('../../config/roles');
const { ErrorNegocio } = require('../../utils/errores');
const { enTransaccion } = require('../../utils/transaccion');
const { parsearId } = require('../produccion/produccion.validaciones');
const { parsearEmail } = require('../../utils/email');

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
// actúa sea, según la base de datos, un administrador activo
const exigirAdministradorActivo = (actor) => {
  if (!actor || !actor.estado || actor.rol_id !== ROLES.ADMINISTRADOR) {
    throw new ErrorNegocio('No tiene permisos para realizar esta acción', 403);
  }
};

// Bloquea (FOR UPDATE) a los administradores activos y devuelve sus id. Dos operaciones
// que afecten a administradores quedan así en serie y no pueden dejar el sistema sin ninguno.
const bloquearAdministradoresActivos = async (t) => {
  const filas = await Usuario.findAll({
    attributes: ['id'],
    where: { rol_id: ROLES.ADMINISTRADOR, estado: true },
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

// Bloqueos siempre en el mismo orden: administradores activos, actor, cuenta objetivo
const prepararOperacion = async (t, actorId, objetivoId) => {
  const administradores = await bloquearAdministradoresActivos(t);

  const actor = await Usuario.findByPk(actorId, {
    attributes: ['id', 'rol_id', 'estado'], lock: t.LOCK.UPDATE, transaction: t
  });
  exigirAdministradorActivo(actor);

  const objetivo = await Usuario.findByPk(objetivoId, {
    attributes: ['id', 'email', 'rol_id', 'panaderia_id', 'estado'], lock: t.LOCK.UPDATE, transaction: t
  });
  if (!objetivo) throw new ErrorNegocio('Cuenta no encontrada', 404);

  return { administradores, objetivo };
};

const parsearRol = (valor) => {
  const rolId = typeof valor === 'number' || typeof valor === 'string' ? Number(valor) : NaN;
  if (!Object.values(ROLES).includes(rolId)) throw new ErrorNegocio('Rol inválido', 400);
  return rolId;
};

class UsuariosService {

  async listar(actorId) {
    const actor = await Usuario.findByPk(actorId, { attributes: ['id', 'rol_id', 'estado'] });
    exigirAdministradorActivo(actor);

    const usuarios = await Usuario.findAll({
      attributes: ATRIBUTOS,
      include: INCLUDES,
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
    const panaderiaPedida = panaderiaEnviada && datos.panaderia_id !== null && datos.panaderia_id !== ''
      ? parsearId(datos.panaderia_id, 'panaderia_id')
      : null;

    return enTransaccion(sequelize, async (t) => {
      const { administradores, objetivo } = await prepararOperacion(t, actorId, id);

      const rolFinal = rolPedido ?? objetivo.rol_id;

      // Nadie cambia su propio rol desde la administración
      if (id === actorId && rolFinal !== objetivo.rol_id) {
        throw new ErrorNegocio('No puede cambiar su propio rol', 403);
      }

      // El administrador general no pertenece a una panadería; los demás roles sí
      let panaderiaFinal;
      if (rolFinal === ROLES.ADMINISTRADOR) {
        if (panaderiaPedida !== null) {
          throw new ErrorNegocio('El administrador general no se asigna a una panadería', 400);
        }
        panaderiaFinal = null;
      } else {
        panaderiaFinal = panaderiaEnviada ? panaderiaPedida : objetivo.panaderia_id;
        if (panaderiaFinal === null) {
          throw new ErrorNegocio('Debe indicar una panadería válida para este rol', 400);
        }
        if (panaderiaFinal !== objetivo.panaderia_id || panaderiaEnviada) {
          const panaderia = await Panaderia.findByPk(panaderiaFinal, { attributes: ['id'], transaction: t });
          if (!panaderia) throw new ErrorNegocio('Panadería no encontrada', 404);
        }
      }

      // Degradar a un administrador activo exige que quede otro
      if (objetivo.estado && objetivo.rol_id === ROLES.ADMINISTRADOR && rolFinal !== ROLES.ADMINISTRADOR) {
        asegurarOtroAdministradorActivo(administradores, id);
      }

      if (email !== undefined && email !== objetivo.email) {
        const existe = await Usuario.findOne({ attributes: ['id'], where: { email }, transaction: t });
        if (existe && existe.id !== id) throw new ErrorNegocio('El email ya está registrado', 409);
      }

      await objetivo.update({
        ...(email !== undefined && { email }),
        rol_id: rolFinal,
        panaderia_id: panaderiaFinal
      }, { transaction: t });

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
      const { administradores, objetivo } = await prepararOperacion(t, actorId, id);

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
      }

      return obtenerFormateado(id, t);
    });
  }
}

module.exports = new UsuariosService();
module.exports.asegurarOtroAdministradorActivo = asegurarOtroAdministradorActivo;
