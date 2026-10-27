const bcrypt = require('bcrypt');
const { sequelize, Usuario, Rol, Panaderia } = require('../../models/index');
const ROLES = require('../../config/roles');
const { ErrorNegocio } = require('../../utils/errores');
const { validarContrasenaNueva } = require('../../utils/contrasenas');
const { parsearEmail } = require('../../utils/email');
const { enTransaccion } = require('../../utils/transaccion');
const { firmarSesion } = require('../../utils/sesion');

class AuthService {

  async login(email, contrasena) {
    // Buscar usuario por email
    const usuario = await Usuario.findOne({
      where: { email, estado: true },
      include: [{ model: Rol }]
    });

    // Mismo mensaje para email o contraseña incorrectos (no revelar qué cuentas existen)
    if (!usuario) {
      throw new ErrorNegocio('Credenciales inválidas', 401);
    }

    // Verificar contraseña
    const valido = await bcrypt.compare(contrasena, usuario.contrasena);
    if (!valido) {
      throw new ErrorNegocio('Credenciales inválidas', 401);
    }

    // Mismo contrato de siempre: { token, usuario }. El token lleva además la versión de sesión.
    return firmarSesion(usuario, usuario.Rol.nombre);
  }

  async registrar(emailRecibido, contrasena, rol_id, panaderia_id) {
    // Misma política que el cambio de contraseña y la interfaz (lib/validacion.js)
    const email = parsearEmail(emailRecibido);
    validarContrasenaNueva(contrasena, 'La contraseña');

    // Solo se admiten los tres roles del sistema
    const rolId = Number(rol_id);
    if (!Object.values(ROLES).includes(rolId)) {
      throw new ErrorNegocio('Rol inválido', 400);
    }

    // El administrador general no pertenece a una panadería; los demás roles sí
    let panaderiaId = null;
    if (rolId === ROLES.ADMINISTRADOR) {
      if (panaderia_id) {
        throw new ErrorNegocio('El administrador general no se asigna a una panadería', 400);
      }
    } else {
      panaderiaId = Number(panaderia_id);
      const panaderia = Number.isInteger(panaderiaId) && panaderiaId > 0
        ? await Panaderia.findByPk(panaderiaId)
        : null;
      if (!panaderia) {
        throw new ErrorNegocio('Debe indicar una panadería válida para este rol', 400);
      }
    }

    // Verificar si ya existe
    const existe = await Usuario.findOne({ where: { email } });
    if (existe) {
      // 400 (no 409): contrato de siempre de /registrar
      throw new ErrorNegocio('El email ya está registrado', 400);
    }

    // Cifrar contraseña
    const hash = await bcrypt.hash(contrasena, 10);

    // Crear usuario
    const usuario = await Usuario.create({
      email,
      contrasena: hash,
      rol_id: rolId,
      panaderia_id: panaderiaId
    });

    return { mensaje: 'Usuario creado exitosamente', id: usuario.id };
  }

  // Cambio de la propia contraseña: primero se verifica la actual. La contraseña y la versión
  // de sesión cambian en la misma transacción, con la fila bloqueada: los tokens anteriores de
  // todos los dispositivos quedan invalidados y este dispositivo recibe un token nuevo.
  // El token se firma DESPUÉS del COMMIT: si la transacción falla no se firma ninguno, y si se
  // reintenta por un deadlock, solo se firma la versión del intento que quedó confirmado.
  async cambiarContrasena(usuarioId, actual, nueva) {
    if (typeof actual !== 'string' || actual.length === 0) {
      throw new ErrorNegocio('La contraseña actual es obligatoria', 400);
    }
    validarContrasenaNueva(nueva);
    if (actual === nueva) {
      throw new ErrorNegocio('La contraseña nueva debe ser distinta de la actual', 400);
    }

    // El hash se calcula antes de abrir la transacción para no alargar el bloqueo
    const hashNuevo = await bcrypt.hash(nueva, 10);

    // enTransaccion solo resuelve tras el COMMIT del intento que tuvo éxito; si falla, lanza
    const confirmado = await enTransaccion(sequelize, async (t) => {
      // FOR UPDATE: dos cambios simultáneos se ejecutan en orden; el segundo ve ya el hash nuevo
      const usuario = await Usuario.findOne({
        where: { id: usuarioId, estado: true },
        attributes: ['id', 'email', 'contrasena', 'rol_id', 'panaderia_id', 'version_sesion'],
        lock: t.LOCK.UPDATE,
        transaction: t
      });
      if (!usuario) throw new ErrorNegocio('Cuenta no encontrada', 404);

      const valida = await bcrypt.compare(actual, usuario.contrasena).catch(() => false);
      if (!valida) throw new ErrorNegocio('La contraseña actual no es correcta', 400);

      const version = usuario.version_sesion + 1;
      await usuario.update({ contrasena: hashNuevo, version_sesion: version }, { transaction: t });
      const rol = await Rol.findByPk(usuario.rol_id, { attributes: ['nombre'], transaction: t });

      // Solo los datos necesarios para firmar (sin el hash): el token aún NO se firma aquí
      return {
        cuenta: { id: usuario.id, email: usuario.email, rol_id: usuario.rol_id, panaderia_id: usuario.panaderia_id, version_sesion: version },
        nombreRol: rol?.nombre
      };
    });

    // Transacción confirmada: se firma el token con la versión que quedó guardada.
    // La respuesta solo lleva el mensaje y el token: ni el hash ni la versión.
    return {
      mensaje: 'Contraseña actualizada correctamente',
      token: firmarSesion(confirmado.cuenta, confirmado.nombreRol).token
    };
  }
}

module.exports = new AuthService();
