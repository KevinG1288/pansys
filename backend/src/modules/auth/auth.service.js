const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Usuario, Rol, Panaderia } = require('../../models/index');
const ROLES = require('../../config/roles');

class AuthService {

  async login(email, contrasena) {
    // Buscar usuario por email
    const usuario = await Usuario.findOne({
      where: { email, estado: true },
      include: [{ model: Rol }]
    });

    // Mismo mensaje para email o contraseña incorrectos (no revelar qué cuentas existen)
    if (!usuario) {
      throw new Error('Credenciales inválidas');
    }

    // Verificar contraseña
    const valido = await bcrypt.compare(contrasena, usuario.contrasena);
    if (!valido) {
      throw new Error('Credenciales inválidas');
    }

    const datos = {
      id: usuario.id,
      email: usuario.email,
      rol: usuario.Rol.nombre,
      rol_id: usuario.rol_id,
      panaderia_id: usuario.panaderia_id ?? null
    };

    // Generar token JWT
    const token = jwt.sign(datos, process.env.JWT_SECRET, { expiresIn: '8h' });

    return { token, usuario: datos };
  }

  async registrar(email, contrasena, rol_id, panaderia_id) {
    // Solo se admiten los tres roles del sistema
    const rolId = Number(rol_id);
    if (!Object.values(ROLES).includes(rolId)) {
      throw new Error('Rol inválido');
    }

    // El administrador general no pertenece a una panadería; los demás roles sí
    let panaderiaId = null;
    if (rolId === ROLES.ADMINISTRADOR) {
      if (panaderia_id) {
        throw new Error('El administrador general no se asigna a una panadería');
      }
    } else {
      panaderiaId = Number(panaderia_id);
      const panaderia = Number.isInteger(panaderiaId) && panaderiaId > 0
        ? await Panaderia.findByPk(panaderiaId)
        : null;
      if (!panaderia) {
        throw new Error('Debe indicar una panadería válida para este rol');
      }
    }

    // Verificar si ya existe
    const existe = await Usuario.findOne({ where: { email } });
    if (existe) {
      throw new Error('El email ya está registrado');
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
}

module.exports = new AuthService();
