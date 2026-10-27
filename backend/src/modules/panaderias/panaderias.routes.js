const router = require('express').Router();
const { Panaderia } = require('../../models/index');
const verificarToken = require('../../middlewares/auth.middleware');
const { permitirRoles, resolverPanaderia } = require('../../middlewares/roles.middleware');
const { ADMINISTRADOR } = require('../../config/roles');
const { responderError } = require('../../utils/errores');

// GET /api/panaderias: lista mínima para los formularios del administrador. Solo contiene la
// panadería de su cuenta (cada administrador gestiona únicamente la suya).
router.get('/', verificarToken, permitirRoles(ADMINISTRADOR), resolverPanaderia(), async (req, res) => {
  try {
    const panaderias = await Panaderia.findAll({
      attributes: ['id', 'nombre'], where: { id: req.panaderiaId }, order: [['id', 'ASC']]
    });
    res.json(panaderias);
  } catch (error) {
    responderError(res, error);
  }
});

module.exports = router;
