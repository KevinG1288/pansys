const authService = require('./auth.service');

class AuthController {

  async login(req, res) {
    try {
      const { email, contrasena } = req.body;

      if (!email || !contrasena) {
        return res.status(400).json({ error: 'Email y contraseña son requeridos' });
      }

      const resultado = await authService.login(email, contrasena);
      res.json(resultado);

    } catch (error) {
      res.status(401).json({ error: error.message });
    }
  }

  async registrar(req, res) {
    try {
      const { email, contrasena, rol_id } = req.body;

      if (!email || !contrasena || !rol_id) {
        return res.status(400).json({ error: 'Todos los campos son requeridos' });
      }

      const resultado = await authService.registrar(email, contrasena, rol_id);
      res.status(201).json(resultado);

    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  }
}

module.exports = new AuthController();