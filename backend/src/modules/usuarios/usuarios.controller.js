const usuariosService = require('./usuarios.service');
const { responderError } = require('../../utils/errores');

class UsuariosController {

  async listar(req, res) {
    try {
      res.json(await usuariosService.listar(req.usuario.id));
    } catch (error) {
      responderError(res, error);
    }
  }

  async actualizar(req, res) {
    try {
      // 400 datos inválidos, 403 sin permiso o cambio del propio rol, 404 inexistente,
      // 409 email repetido o último administrador activo
      res.json(await usuariosService.actualizar(req.usuario.id, req.params.id, req.body));
    } catch (error) {
      responderError(res, error);
    }
  }

  async cambiarEstado(req, res) {
    try {
      res.json(await usuariosService.cambiarEstado(req.usuario.id, req.params.id, req.body));
    } catch (error) {
      responderError(res, error);
    }
  }
}

module.exports = new UsuariosController();
