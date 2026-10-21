const authService = require('./auth.service');
const { responderError } = require('../../utils/errores');

class AuthController {

  async login(req, res) {
    try {
      const { email, contrasena } = req.body ?? {};

      if (!email || !contrasena || typeof email !== 'string' || typeof contrasena !== 'string') {
        return res.status(400).json({ error: 'Email y contraseña son requeridos' });
      }

      const resultado = await authService.login(email, contrasena);
      res.json(resultado);

    } catch (error) {
      // 401 "Credenciales inválidas"; cualquier error interno es un 500 sin detalles
      responderError(res, error);
    }
  }

  async registrar(req, res) {
    try {
      const { email, contrasena, rol_id, panaderia_id } = req.body;

      if (!email || !contrasena || !rol_id) {
        return res.status(400).json({ error: 'Todos los campos son requeridos' });
      }

      const resultado = await authService.registrar(email, contrasena, rol_id, panaderia_id);
      res.status(201).json(resultado);

    } catch (error) {
      res.status(400).json({ error: error.message });
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
