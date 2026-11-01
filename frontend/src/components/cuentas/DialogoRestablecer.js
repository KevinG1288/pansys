import { useRef, useState } from 'react';
import { KeyRound } from 'lucide-react';
import api from '../../services/api';
import { mensajeError } from '../../lib/errores';
import Aviso from '../ui/Aviso';
import Boton from '../ui/Boton';
import Campo from '../ui/Campo';
import Dialogo from '../ui/Dialogo';

// Enlace de restablecimiento para otra cuenta activa de la panadería (POST /api/usuarios/:id/restablecimiento,
// cuerpo { contrasena }: la contraseña de quien actúa, que el backend vuelve a comprobar).
// Solo un 200 significa que el correo se envió; cualquier otra respuesta se informa como no enviada.
// La contraseña solo vive en este diálogo: se vacía tras cada respuesta y desaparece al cerrarlo.

const minutosDe = (error) => {
  const segundos = Number(error?.response?.headers?.['retry-after']);
  return Number.isFinite(segundos) && segundos > 0 ? Math.ceil(segundos / 60) : null;
};

// Mensajes según la respuesta real del backend (restablecimiento.service.js, solicitarAsistido).
// Sus mensajes de negocio ya son legibles; un error interno (500) nunca muestra detalles.
const mensajeRestablecimiento = (error) => {
  const estado = error?.response?.status;
  switch (estado) {
    case 400: return mensajeError(error, 'Revisa tu contraseña.');
    case 403: return mensajeError(error, 'No tienes permiso para restablecer la contraseña de esta cuenta.');
    case 404: return 'La cuenta ya no existe o no pertenece a tu panadería. Actualiza la lista.';
    case 409: return mensajeError(error, 'No se puede enviar el enlace a esta cuenta ahora mismo.');
    case 429: {
      const minutos = minutosDe(error);
      const base = mensajeError(error, 'Se alcanzó el límite de solicitudes.');
      return minutos ? `${base} Espera unos ${minutos} minutos.` : base;
    }
    case 502: return mensajeError(error, 'No se pudo enviar el correo. Si la cuenta tenía un enlace anterior, sigue siendo válido.');
    case 503: return mensajeError(error, 'El envío de correos no está disponible en este momento. Inténtalo más tarde.');
    default: return mensajeError(error, 'No se pudo enviar el enlace. Inténtalo de nuevo.');
  }
};

const DialogoRestablecer = ({ cuenta, onEnviado, onCerrar }) => {
  const [contrasena, setContrasena] = useState('');
  const [errorCampo, setErrorCampo] = useState(null);
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const enviandoRef = useRef(false);
  const refContrasena = useRef(null);

  const enviar = async (evento) => {
    evento.preventDefault();
    if (enviandoRef.current) return;
    setError(null);
    if (!contrasena) {
      setErrorCampo('Escribe tu contraseña');
      refContrasena.current?.focus();
      return;
    }
    setErrorCampo(null);

    enviandoRef.current = true;
    setEnviando(true);
    const enviada = contrasena;
    setContrasena('');
    try {
      const res = await api.post(`/api/usuarios/${cuenta.id}/restablecimiento`, { contrasena: enviada });
      onEnviado(typeof res?.data?.mensaje === 'string' && res.data.mensaje.trim()
        ? res.data.mensaje
        : 'Se envió un enlace de restablecimiento al correo de la cuenta.');
    } catch (err) {
      setError(mensajeRestablecimiento(err));
      refContrasena.current?.focus();
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  };

  return (
    <Dialogo
      titulo="Enviar enlace para restablecer la contraseña"
      descripcion={cuenta.email}
      bloqueado={enviando}
      refFocoInicial={refContrasena}
      onCerrar={onCerrar}
    >
      <form onSubmit={enviar} noValidate className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          La cuenta recibirá un correo con un enlace válido durante 30 minutos y de un solo uso. Al usarlo, se cerrarán
          todas sus sesiones abiertas. Si tenía un enlace anterior, dejará de valer.
        </p>
        {error && <Aviso tipo="error">{error}</Aviso>}
        <Campo
          ref={refContrasena}
          etiqueta="Tu contraseña"
          type="password"
          autoComplete="current-password"
          value={contrasena}
          onChange={(e) => setContrasena(e.target.value)}
          error={errorCampo}
          ayuda="Por seguridad, confirma que eres tú."
        />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Boton variante="contorno" onClick={onCerrar} disabled={enviando}>Cancelar</Boton>
          <Boton type="submit" cargando={enviando}>
            {!enviando && <KeyRound className="size-4" aria-hidden="true" />}
            {enviando ? 'Enviando…' : 'Enviar enlace'}
          </Boton>
        </div>
      </form>
    </Dialogo>
  );
};

export default DialogoRestablecer;
