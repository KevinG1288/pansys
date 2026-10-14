const router = require('express').Router();
const usuariosController = require('./usuarios.controller');
const verificarToken = require('../../middlewares/auth.middleware');
const { permitirRoles } = require('../../middlewares/roles.middleware');
const { ADMINISTRADOR } = require('../../config/roles');

// Gestión de cuentas: solo administrador (el servicio lo confirma además en la base de datos)
const soloAdministrador = [verificarToken, permitirRoles(ADMINISTRADOR)];

router.get('/', ...soloAdministrador, usuariosController.listar);
router.patch('/:id', ...soloAdministrador, usuariosController.actualizar);
router.patch('/:id/estado', ...soloAdministrador, usuariosController.cambiarEstado);

module.exports = router;
