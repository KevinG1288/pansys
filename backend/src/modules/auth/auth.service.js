const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Usuario, Rol } = require('../../models/index');

class AuthService {

  async login(email, contrasena) {
    // Buscar usuario por email
    const usuario = await Usuario.findOne({
      where: { email, estado: true },
      include: [{ model: Rol }]
    });

    if (!usuario) {
      throw new Error('Usuario no encontrado');
    }

    // Verificar contraseña
    const valido = await bcrypt.compare(contrasena, usuario.contrasena);
    if (!valido) {
      throw new Error('Contraseña incorrecta');
    }

    // Generar token JWT
    const token = jwt.sign(
      {
        id: usuario.id,
        email: usuario.email,
        rol: usuario.Rol.nombre
      },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    return {
      token,
      usuario: {
        id: usuario.id,
        email: usuario.email,
        rol: usuario.Rol.nombre
      }
    };
  }

  async registrar(email, contrasena, rol_id) {
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
      rol_id
    });

    return { mensaje: 'Usuario creado exitosamente', id: usuario.id };
  }
}

module.exports = new AuthService();