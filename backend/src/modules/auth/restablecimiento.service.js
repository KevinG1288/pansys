const crypto = require('crypto');
const { ErrorNegocio } = require('../../utils/errores');
const { parsearEmail } = require('../../utils/email');
const { validarContrasenaNueva } = require('../../utils/contrasenas');
const { crearLimitador } = require('../../utils/limitador');
const { parsearId } = require('../produccion/produccion.validaciones');
const ROLES = require('../../config/roles');

// Restablecimiento de contraseña (R-b). Flujo de un enlace:
//   1. Reserva: transacción corta con la cuenta bloqueada. Recupera las reservas vencidas,
//      comprueba los límites e inserta la fila 'enviando' (solo el SHA-256 del token) y su evento.
//   2. Envío SMTP: SIN transacción ni bloqueos abiertos.
//   3. Activación: transacción condicional por id (ver repositorio.activar). Si el SMTP falla,
//      la reserva pasa a 'envio_fallido' y el enlace anterior queda intacto.
// El token solo existe en memoria entre la reserva y el envío: nunca se guarda, se registra ni se
// devuelve. Los enlaces se construyen solo con PANSYS_URL_PUBLICA (tokens.construirEnlace), nunca
// con el encabezado Host ni req.protocol.

const MINUTO = 60 * 1000;
const VIGENCIA_ENLACE_MS = 30 * MINUTO;
const RESERVA_MS = MINUTO; // plazo de una reserva 'enviando' (el SMTP tiene un tope de 20 s)
const MARGEN_CONSULTA_MS = 5 * 1000;
const MAX_FALLOS_ENLACE = 5;
const INTENTOS_ACTIVACION = 3;
const LIMITE_ADMINISTRADOR = { maximo: 5, ventanaMs: 15 * MINUTO }; // reservas por administrador (en la base)
const LIMITE_CUENTA = { maximo: 3, ventanaMs: 60 * MINUTO }; // envíos aceptados por cuenta (en la base)

const MENSAJE_SOLICITUD = 'Si la dirección corresponde a una cuenta activa, recibirá un correo con un enlace para restablecer la contraseña.';
const MENSAJE_ENLACE_NO_VALIDO = 'El enlace no es válido o ha caducado. Solicite uno nuevo.';
const MENSAJE_NO_DISPONIBLE = 'La recuperación de contraseña no está disponible en este momento.';

// Limitadores en memoria (locales al proceso: se reinician con el servidor)
const crearLimitadores = (reloj = Date.now) => ({
  // Por IP: solicitudes públicas (las únicas que responden 429 en la solicitud pública)
  solicitudIp: crearLimitador({ maximo: 5, ventanaMs: 15 * MINUTO, reloj }),
  // Por correo (clave: SHA-256 del correo normalizado): al alcanzarlo se responde 202 y no se envía
  correo: crearLimitador({ maximo: 3, ventanaMs: 60 * MINUTO, reloj }),
  // Por IP: fallos de token (validar y confirmar)
  falloTokenIp: crearLimitador({ maximo: 5, ventanaMs: 15 * MINUTO, reloj }),
  // Por IP: consultas de la página mientras un enlace está 'enviando'
  consultaIp: crearLimitador({ maximo: 60, ventanaMs: MINUTO, reloj }),
  // Por administrador: reconfirmaciones de su contraseña fallidas
  reconfirmacion: crearLimitador({ maximo: 5, ventanaMs: 15 * MINUTO, reloj })
});

const errorLimite = (mensaje, retryAfterS) => {
  const error = new ErrorNegocio(mensaje, 429);
  error.retryAfterS = Math.max(1, Math.ceil(retryAfterS));
  return error;
};

// Ventana deslizante sobre marcas guardadas en la base: segundos hasta que vence la más antigua
// de las que bloquean
const esperaLimite = (marcas, { maximo, ventanaMs }, ahora) =>
  (marcas[marcas.length - maximo] + ventanaMs - ahora) / 1000;

// Un enlace 'enviando' dentro de su reserva (más un margen para la página): aún no se puede usar,
// pero no cuenta como fallo. Pasado ese plazo, deja de ser válido.
const enEnvio = (enlace, ahora) => enlace?.estado === 'enviando'
  && new Date(enlace.createdAt).getTime() + RESERVA_MS + MARGEN_CONSULTA_MS > ahora;

const claveIp = (ip) => `ip:${typeof ip === 'string' && ip ? ip.slice(0, 100) : 'desconocida'}`;
const claveCorreo = (email) => `correo:${crypto.createHash('sha256').update(email.toLowerCase(), 'utf8').digest('hex')}`;

// Registro de errores sin datos sensibles: solo el nombre y el código del error
const registroSeguro = (contexto, error) => {
  console.error(`Error interno (${contexto}): ${error?.name ?? 'Error'}${error?.code ? ` ${error.code}` : ''}`);
};

const crearServicio = ({
  repo, correo, tokens, bcrypt, reloj = Date.now, programar = setImmediate,
  limitadores = crearLimitadores(reloj), env = process.env, registrar = registroSeguro
}) => {
  // Configuración global (no depende de la cuenta): sin SMTP o sin URL pública válida -> 503
  const exigirDisponible = () => {
    let urlValida = true;
    try {
      tokens.leerUrlPublica(env);
    } catch {
      urlValida = false;
    }
    if (!urlValida || !correo.configurado()) throw new ErrorNegocio(MENSAJE_NO_DISPONIBLE, 503);
  };

  const exigirIpSinBloqueo = (ip) => {
    const estado = limitadores.falloTokenIp.consultar(claveIp(ip));
    if (!estado.permitido) throw errorLimite('Demasiados intentos. Inténtelo de nuevo más tarde.', estado.retryAfterS);
  };
  const falloToken = (ip) => {
    limitadores.falloTokenIp.registrar(claveIp(ip));
    return new ErrorNegocio(MENSAJE_ENLACE_NO_VALIDO, 400);
  };

  // ---------- 1. Reserva ----------
  // Devuelve { id, usuarioId, destino, enlace } o, en la solicitud propia, null si no procede
  // (sin revelar el motivo). En la asistida, los rechazos son ErrorNegocio.
  const reservar = async ({ objetivoId, actorId = null }) => {
    const asistida = actorId !== null;
    const token = tokens.generarToken();
    const tokenHash = tokens.hashToken(token);
    const enlace = tokens.construirEnlace(token, env); // antes de escribir: una URL inválida no deja filas
    const ahora = reloj();

    const reserva = await repo.transaccion(async (t) => {
      const cuentas = await repo.bloquearCuentas(t, asistida ? [actorId, objetivoId] : [objetivoId]);
      const objetivo = cuentas.find(c => c.id === objetivoId);
      if (asistida) {
        const actor = cuentas.find(c => c.id === actorId);
        if (!actor || !actor.estado || actor.rol_id !== ROLES.ADMINISTRADOR || !actor.panaderia_id) {
          throw new ErrorNegocio('No tiene permisos para realizar esta acción', 403);
        }
        // Una cuenta de otra panadería no se encuentra, igual que una inexistente
        if (!objetivo || objetivo.panaderia_id !== actor.panaderia_id) throw new ErrorNegocio('Cuenta no encontrada', 404);
        if (!objetivo.estado) throw new ErrorNegocio('La cuenta está desactivada', 409);
      } else if (!objetivo || !objetivo.estado) {
        return null;
      }
      const panaderiaId = objetivo.panaderia_id ?? null;

      await repo.recuperarVencidas(t, { usuarioId: objetivoId, panaderiaId, ahora, reservaMs: RESERVA_MS });
      if (await repo.contarEnCurso(t, objetivoId)) {
        if (asistida) throw new ErrorNegocio('Ya hay un envío en curso para esta cuenta. Espere unos segundos.', 409);
        return null;
      }
      if (asistida) {
        const reservas = await repo.reservasDeActorDesde(t, actorId, ahora - LIMITE_ADMINISTRADOR.ventanaMs);
        if (reservas.length >= LIMITE_ADMINISTRADOR.maximo) {
          throw errorLimite('Ha alcanzado el límite de solicitudes. Inténtelo de nuevo más tarde.', esperaLimite(reservas, LIMITE_ADMINISTRADOR, ahora));
        }
      }
      const activaciones = await repo.activacionesDesde(t, objetivoId, ahora - LIMITE_CUENTA.ventanaMs);
      if (activaciones.length >= LIMITE_CUENTA.maximo) {
        if (asistida) {
          throw errorLimite('Esta cuenta ya recibió el máximo de enlaces por hora. Inténtelo de nuevo más tarde.', esperaLimite(activaciones, LIMITE_CUENTA, ahora));
        }
        return null;
      }

      const id = await repo.insertarReserva(t, {
        usuarioId: objetivoId, origen: asistida ? 'administrador' : 'propio', solicitadoPor: actorId, tokenHash, expiraEn: ahora + VIGENCIA_ENLACE_MS
      });
      await repo.registrarEvento(t, {
        tipo: asistida ? 'restablecimiento_solicitado' : 'restablecimiento_propio_solicitado',
        usuarioId: objetivoId, panaderiaId, actorId, restablecimientoId: id
      });
      return { id, usuarioId: objetivoId, destino: objetivo.email };
    });
    return reserva && { ...reserva, enlace };
  };

  // ---------- 2 y 3. Envío y activación ----------
  // Devuelve 'activo', 'envio_fallido' o 'activacion_fallida'. El SMTP se llama exactamente una vez.
  const enviarYActivar = async (reserva) => {
    try {
      await correo.enviarEnlaceRestablecimiento({ para: reserva.destino, enlace: reserva.enlace });
    } catch (error) {
      await repo.marcarFallido({ id: reserva.id, usuarioId: reserva.usuarioId, motivo: correo.clasificarError(error), ahora: reloj() })
        .catch(e => registrar('marcar envío fallido', e));
      return 'envio_fallido';
    }
    // Reintentos sobre el MISMO id (sin token ni envío nuevos) mientras dure la reserva
    for (let intento = 1; intento <= INTENTOS_ACTIVACION; intento++) {
      try {
        if (await repo.activar({ id: reserva.id, usuarioId: reserva.usuarioId, ahora: reloj(), reservaMs: RESERVA_MS })) return 'activo';
        break; // ya no está 'enviando' o la reserva venció: no se activa
      } catch (error) {
        // COMMIT ambiguo o fallo: se lee el estado por id
        registrar('activar enlace', error);
        const estado = await repo.leerEstado(reserva.id).catch(() => null);
        if (estado === 'activo') return 'activo';
        if (estado !== 'enviando') break;
      }
    }
    await repo.marcarFallido({ id: reserva.id, usuarioId: reserva.usuarioId, motivo: 'activacion_fallida', ahora: reloj() })
      .catch(e => registrar('marcar activación fallida', e));
    return 'activacion_fallida';
  };

  // Trabajo de la solicitud pública, después de responder. Nunca lanza.
  const procesarSolicitudPropia = async (email) => {
    try {
      if (!limitadores.correo.intentar(claveCorreo(email)).permitido) return;
      const cuenta = await repo.buscarCuentaActivaPorEmail(email);
      if (!cuenta) return;
      const reserva = await reservar({ objetivoId: cuenta.id });
      if (reserva) await enviarYActivar(reserva);
    } catch (error) {
      registrar('solicitud propia', error);
    }
  };

  return {
    // POST /api/auth/restablecimiento/solicitar (público). Siempre 202 con el mismo cuerpo si el
    // formato es válido, exista o no la cuenta; el trabajo se hace DESPUÉS de responder, así el
    // tiempo de respuesta no depende de la búsqueda. 400 solo por formato; 429 solo por IP; 503
    // si la configuración global no está lista.
    async solicitarPropio({ email: emailRecibido, ip }) {
      const email = parsearEmail(emailRecibido);
      exigirDisponible();
      const estado = limitadores.solicitudIp.intentar(claveIp(ip));
      if (!estado.permitido) throw errorLimite('Demasiadas solicitudes. Inténtelo de nuevo más tarde.', estado.retryAfterS);
      // La tarea devuelve la promesa del trabajo (setImmediate la ignora; las pruebas la esperan)
      programar(() => procesarSolicitudPropia(email));
      return { status: 202, cuerpo: { mensaje: MENSAJE_SOLICITUD } };
    },

    // POST /api/usuarios/:id/restablecimiento (administrador, para otra cuenta activa de su
    // panadería, tras volver a escribir su contraseña)
    async solicitarAsistido({ actorId, idTexto, contrasena }) {
      const objetivoId = parsearId(idTexto, 'id de cuenta');
      if (objetivoId === actorId) throw new ErrorNegocio('No puede solicitar un enlace para su propia cuenta. Use «Mi cuenta» para cambiar su contraseña.', 403);
      if (typeof contrasena !== 'string' || contrasena.length === 0) throw new ErrorNegocio('Su contraseña es obligatoria', 400);
      exigirDisponible();

      const clave = `admin:${actorId}`;
      const estadoC = limitadores.reconfirmacion.consultar(clave);
      if (!estadoC.permitido) throw errorLimite('Demasiados intentos fallidos. Inténtelo de nuevo más tarde.', estadoC.retryAfterS);

      const actor = await repo.buscarCredencialesActor(actorId);
      if (!actor || !actor.estado || actor.rol_id !== ROLES.ADMINISTRADOR || !actor.panaderia_id) {
        throw new ErrorNegocio('No tiene permisos para realizar esta acción', 403);
      }
      // bcrypt fuera de cualquier transacción
      const valida = await bcrypt.compare(contrasena, actor.contrasena).catch(() => false);
      if (!valida) {
        limitadores.reconfirmacion.registrar(clave);
        await repo.registrarEventoSuelto({ tipo: 'reconfirmacion_fallida', usuarioId: actorId, panaderiaId: actor.panaderia_id, actorId })
          .catch(e => registrar('evento de reconfirmación', e));
        throw new ErrorNegocio('Su contraseña no es correcta', 400);
      }

      const reserva = await reservar({ objetivoId, actorId });
      const resultado = await enviarYActivar(reserva);
      if (resultado === 'activo') {
        return { status: 200, cuerpo: { mensaje: 'Se envió un enlace de restablecimiento al correo de la cuenta. Es válido durante 30 minutos.' } };
      }
      if (resultado === 'envio_fallido') {
        throw new ErrorNegocio('No se pudo enviar el correo. Si la cuenta tenía un enlace anterior, sigue siendo válido.', 502);
      }
      throw new ErrorNegocio('No se pudo completar el envío. Inténtelo de nuevo en unos minutos.', 503);
    },

    // POST /api/auth/restablecimiento/validar (público): estado del enlace para la página.
    // 200 activo; 202 'procesando' mientras está 'enviando' (no cuenta como fallo); 400 genérico.
    async validar({ token, ip }) {
      exigirIpSinBloqueo(ip);
      const consulta = limitadores.consultaIp.intentar(claveIp(ip));
      if (!consulta.permitido) throw errorLimite('Demasiadas consultas. Inténtelo de nuevo más tarde.', consulta.retryAfterS);
      if (!tokens.esFormatoToken(token)) throw falloToken(ip);

      const enlace = await repo.buscarPorHash(tokens.hashToken(token));
      const ahora = reloj();
      if (enEnvio(enlace, ahora)) return { status: 202, cuerpo: { estado: 'procesando' } };
      if (!enlace || enlace.estado !== 'activo' || new Date(enlace.expira_en).getTime() <= ahora || enlace.intentos_fallidos >= MAX_FALLOS_ENLACE) {
        throw falloToken(ip);
      }
      return { status: 200, cuerpo: { estado: 'activo' } };
    },

    // POST /api/auth/restablecimiento/confirmar (público): consume el enlace y cambia la contraseña.
    // No inicia sesión: la persona entra después con la contraseña nueva.
    async confirmar({ token, contrasena, ip }) {
      exigirIpSinBloqueo(ip);
      if (!tokens.esFormatoToken(token)) throw falloToken(ip);

      const enlace = await repo.buscarPorHash(tokens.hashToken(token));
      const ahora = reloj();
      if (enEnvio(enlace, ahora)) {
        throw new ErrorNegocio('El enlace aún se está procesando. Espere unos segundos.', 409, { codigo: 'PROCESANDO' });
      }
      if (!enlace || enlace.estado !== 'activo' || new Date(enlace.expira_en).getTime() <= ahora || enlace.intentos_fallidos >= MAX_FALLOS_ENLACE) {
        throw falloToken(ip);
      }

      // Contraseña que no cumple la política: cuenta como fallo del enlace (al 5.º queda invalidado)
      try {
        validarContrasenaNueva(contrasena);
      } catch (error) {
        await repo.sumarFallo({ id: enlace.id, usuarioId: enlace.usuario_id, maximo: MAX_FALLOS_ENLACE, ahora });
        throw error;
      }

      // bcrypt fuera de cualquier transacción
      const hashNuevo = await bcrypt.hash(contrasena, 10);
      const resultado = await repo.consumir({ id: enlace.id, usuarioId: enlace.usuario_id, hashNuevo, ahora: reloj(), maximoFallos: MAX_FALLOS_ENLACE });
      if (!resultado.ok) throw falloToken(ip);
      return { status: 200, cuerpo: { mensaje: 'Contraseña restablecida. Inicie sesión con la contraseña nueva.' } };
    }
  };
};

module.exports = {
  crearServicio, crearLimitadores, registroSeguro, claveCorreo,
  VIGENCIA_ENLACE_MS, RESERVA_MS, MAX_FALLOS_ENLACE, LIMITE_ADMINISTRADOR, LIMITE_CUENTA,
  MENSAJE_SOLICITUD, MENSAJE_ENLACE_NO_VALIDO, MENSAJE_NO_DISPONIBLE
};
