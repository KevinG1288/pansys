const authService = require('./auth.service');
const { responderError } = require('../../utils/errores');

class AuthController {

  async login(req, res) {
    try {
      const { email, contrasena } = req.body ?? {};

      if (!email || !contrasena || typeof email !== 'string' || typeof contrasena !== 'string') {
        return res.status(400).json({ error: 'Email y contraseña son requeridos' });
      }

      const resultado = await authService.login(email, contrasena, { ip: req.ip });
      res.json(resultado);

    } catch (error) {
      // 401 "Credenciales inválidas"; 429 con Retry-After si se agotaron los intentos (por IP o por
      // cuenta); cualquier error interno es un 500 sin detalles
      responderError(res, error);
    }
  }

  async registrar(req, res) {
    try {
      // La panadería no se lee del cuerpo: es siempre la del administrador autenticado
      const { email, contrasena, rol_id } = req.body ?? {};

      if (!email || !contrasena || !rol_id) {
        return res.status(400).json({ error: 'Todos los campos son requeridos' });
      }

      const resultado = await authService.registrar(req.usuario.id, email, contrasena, rol_id);
      res.status(201).json(resultado);

    } catch (error) {
      // 400 con el mensaje de la validación; cualquier error interno es un 500 sin detalles
      responderError(res, error);
    }
  }

  async cambiarContrasena(req, res) {
    try {
      const { contrasena_actual, contrasena_nueva } = req.body ?? {};
      const resultado = await authService.cambiarContrasena(req.usuario.id, contrasena_actual, contrasena_nueva);
      res.json(resultado);
    } catch (error) {
      responderError(res, error);
    }
  }
}

module.exports = new AuthController();
