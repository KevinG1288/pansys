const router = require('express').Router();
const { Panaderia } = require('../../models/index');
const verificarToken = require('../../middlewares/auth.middleware');
const { permitirRoles } = require('../../middlewares/roles.middleware');
const { ADMINISTRADOR } = require('../../config/roles');
const { responderError } = require('../../utils/errores');

// GET /api/panaderias: lista mínima para los selectores del administrador
router.get('/', verificarToken, permitirRoles(ADMINISTRADOR), async (req, res) => {
  try {
    const panaderias = await Panaderia.findAll({ attributes: ['id', 'nombre'], order: [['id', 'ASC']] });
    res.json(panaderias);
  } catch (error) {
    responderError(res, error);
  }
});

module.exports = router;
