const redConsultas = require('./red.consultas');
const redOperaciones = require('./red.operaciones');
const { responderErrorRed } = require('./red.errores');
const {
  parsearPanaderiaRed, parsearSolicitudId, parsearFiltrosBandeja, parsearFiltrosMovimientos,
  parsearCrearSolicitud, parsearRechazo, parsearAceptarSolicitud
} = require('./red.validaciones');

// Controladores de la red colaborativa: lectura (E1a), crear, rechazar y cancelar (E1b) y aceptar (E1c). La panadería
// propia es siempre req.panaderiaId (resolverPanaderia) y quien actúa es req.usuario.id (verificarToken);
// cualquier panaderia_id de la query o del cuerpo se ignora.
class RedController {

  async crear(req, res) {
    try {
      const datos = parsearCrearSolicitud(req.body, req.panaderiaId);
      res.status(201).json(await redOperaciones.crear({ panaderiaId: req.panaderiaId, actorId: req.usuario.id, ...datos }));
    } catch (error) {
      responderErrorRed(res, error);
    }
  }

  async aceptar(req, res) {
    try {
      const solicitudId = parsearSolicitudId(req.params.id);
      const { lineas } = parsearAceptarSolicitud(req.body);
      res.json(await redOperaciones.aceptar({ panaderiaId: req.panaderiaId, actorId: req.usuario.id, solicitudId, lineas }));
    } catch (error) {
      responderErrorRed(res, error);
    }
  }

  async rechazar(req, res) {
    try {
      const solicitudId = parsearSolicitudId(req.params.id);
      const { motivo } = parsearRechazo(req.body);
      res.json(await redOperaciones.rechazar({ panaderiaId: req.panaderiaId, actorId: req.usuario.id, solicitudId, motivo }));
    } catch (error) {
      responderErrorRed(res, error);
    }
  }

  async cancelar(req, res) {
    try {
      const solicitudId = parsearSolicitudId(req.params.id);
      res.json(await redOperaciones.cancelar({ panaderiaId: req.panaderiaId, actorId: req.usuario.id, solicitudId }));
    } catch (error) {
      responderErrorRed(res, error);
    }
  }

  async directorio(req, res) {
    try {
      res.json(await redConsultas.directorio(req.panaderiaId));
    } catch (error) {
      responderErrorRed(res, error);
    }
  }

  async disponibilidad(req, res) {
    try {
      res.json(await redConsultas.disponibilidad(req.panaderiaId, parsearPanaderiaRed(req.params.id)));
    } catch (error) {
      responderErrorRed(res, error);
    }
  }

  async resumen(req, res) {
    try {
      res.json(await redConsultas.resumen(req.panaderiaId));
    } catch (error) {
      responderErrorRed(res, error);
    }
  }

  async bandeja(req, res) {
    try {
      res.json(await redConsultas.bandeja(req.panaderiaId, parsearFiltrosBandeja(req.query)));
    } catch (error) {
      responderErrorRed(res, error);
    }
  }

  async detalle(req, res) {
    try {
      res.json(await redConsultas.detalle(req.panaderiaId, parsearSolicitudId(req.params.id)));
    } catch (error) {
      responderErrorRed(res, error);
    }
  }

  async movimientos(req, res) {
    try {
      res.json(await redConsultas.movimientos(req.panaderiaId, parsearFiltrosMovimientos(req.query)));
    } catch (error) {
      responderErrorRed(res, error);
    }
  }
}

module.exports = new RedController();
