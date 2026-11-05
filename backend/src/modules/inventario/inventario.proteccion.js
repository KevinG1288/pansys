const { QueryTypes } = require('sequelize');
const { sequelize } = require('../../models/index');
const { ErrorNegocio } = require('../../utils/errores');

// Ejecutar DESPUÉS del FOR UPDATE de la materia, en READ COMMITTED. No tomar bloqueos
// de solicitudes ni parejas: E1b conserva FOR SHARE del destino hasta commit/rollback.
const exigirSinPendientes = async (id, panaderiaId, transaction) => {
  const filas = await sequelize.query(`SELECT d.id FROM solicitudes_red_detalle d
    JOIN solicitudes_red s ON s.id = d.solicitud_id
    WHERE d.materia_prima_destino_id = :id AND d.panaderia_solicitante_id = :propia
      AND s.estado = 'pendiente' LIMIT 1`, {
    replacements: { id, propia: panaderiaId }, type: QueryTypes.SELECT, transaction
  });
  if (filas.length) throw new ErrorNegocio('La materia prima forma parte de una solicitud pendiente de la red', 409, { codigo: 'MATERIA_EN_SOLICITUD_PENDIENTE' });
};
module.exports = { exigirSinPendientes };
