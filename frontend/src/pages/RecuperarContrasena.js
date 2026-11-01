import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail } from 'lucide-react';
import api from '../services/api';
import { mensajeError } from '../lib/errores';
import { validarEmail } from '../lib/validacion';
import Aviso from '../components/ui/Aviso';
import Boton from '../components/ui/Boton';
import Campo from '../components/ui/Campo';
import PantallaPublica from '../components/layout/PantallaPublica';

// Respuesta neutra del backend (202): la misma exista o no la cuenta. Nunca se afirma que se envió
// un correo; se muestra el mensaje del propio backend.
const MENSAJE_RESPALDO = 'Si la dirección corresponde a una cuenta activa, recibirás un correo con un enlace para restablecer la contraseña.';

const minutosDe = (error) => {
  const segundos = Number(error?.response?.headers?.['retry-after']);
  return Number.isFinite(segundos) && segundos > 0 ? Math.ceil(segundos / 60) : null;
};

// Mensajes sin detalles técnicos. 429 y 503 no dependen de la cuenta (límite por IP y servicio
// desactivado), así que no revelan si existe.
const mensajeSolicitud = (error) => {
  const estado = error?.response?.status;
  if (estado === 429) {
    const minutos = minutosDe(error);
    return `Has hecho demasiadas solicitudes. Inténtalo de nuevo${minutos ? ` en unos ${minutos} minutos` : ' más tarde'}.`;
  }
  if (estado === 503) return 'La recuperación de contraseña no está disponible en este momento. Inténtalo más tarde o pide ayuda al administrador de tu panadería.';
  if (estado === 400) return mensajeError(error, 'Revisa el correo electrónico.');
  return mensajeError(error, 'No se pudo enviar la solicitud. Inténtalo de nuevo.');
};

const RecuperarContrasena = () => {
  const [email, setEmail] = useState('');
  const [errorCampo, setErrorCampo] = useState(null);
  const [error, setError] = useState('');
  const [respuesta, setRespuesta] = useState('');
  const [enviando, setEnviando] = useState(false);
  const enviandoRef = useRef(false);
  const refEmail = useRef(null);

  useEffect(() => {
    refEmail.current?.focus();
  }, []);

  const enviar = async (e) => {
    e.preventDefault();
    if (enviandoRef.current) return;
    const { valor, error: errorEmail } = validarEmail(email);
    setErrorCampo(errorEmail ?? null);
    setError('');
    if (errorEmail) {
      refEmail.current?.focus();
      return;
    }

    enviandoRef.current = true;
    setEnviando(true);
    try {
      const res = await api.post('/api/auth/restablecimiento/solicitar', { email: valor });
      setRespuesta(typeof res?.data?.mensaje === 'string' && res.data.mensaje.trim() ? res.data.mensaje : MENSAJE_RESPALDO);
    } catch (err) {
      setError(mensajeSolicitud(err));
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  };

  return (
    <PantallaPublica
      titulo="Recuperar contraseña"
      descripcion="Escribe el correo de tu cuenta y te enviaremos un enlace para elegir una contraseña nueva."
      pie={<Link to="/login" className="font-medium text-primary hover:underline">Volver a iniciar sesión</Link>}
    >
      {respuesta ? (
        <div className="flex flex-col gap-4">
          <Aviso tipo="info" titulo="Solicitud recibida">{respuesta}</Aviso>
          <p className="text-sm text-muted-foreground">
            El enlace es válido durante 30 minutos y solo se puede usar una vez. Si no lo recibes, revisa la carpeta de spam o pide ayuda al administrador de tu panadería.
          </p>
        </div>
      ) : (
        <form onSubmit={enviar} noValidate className="flex flex-col gap-4">
          {error && <Aviso tipo="error">{error}</Aviso>}
          <Campo
            ref={refEmail}
            etiqueta="Correo electrónico"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={errorCampo}
            placeholder="nombre@panaderia.com"
          />
          <Boton type="submit" cargando={enviando} className="mt-2 w-full">
            {!enviando && <Mail className="size-4" aria-hidden="true" />}
            {enviando ? 'Enviando…' : 'Enviar enlace'}
          </Boton>
        </form>
      )}
    </PantallaPublica>
  );
};

export default RecuperarContrasena;
