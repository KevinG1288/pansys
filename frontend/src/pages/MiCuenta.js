import { useRef, useState } from 'react';
import { KeyRound } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { mensajeError } from '../lib/errores';
import { validarContrasena } from '../lib/validacion';
import Aviso from '../components/ui/Aviso';
import Boton from '../components/ui/Boton';
import Campo from '../components/ui/Campo';
import { PageHeader, Panel } from '../components/ui/Panel';

const VACIO = { actual: '', nueva: '', confirmacion: '' };

// Datos de la sesión y cambio de la propia contraseña (PATCH /api/auth/contrasena, todos los roles)
const MiCuenta = () => {
  const { usuario } = useAuth();
  const [valores, setValores] = useState(VACIO);
  const [errores, setErrores] = useState({});
  const [errorGeneral, setErrorGeneral] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const guardandoRef = useRef(false);

  const cambiar = (campo) => (e) => setValores(v => ({ ...v, [campo]: e.target.value }));

  const leerFormulario = () => {
    const nuevos = {};
    if (!valores.actual) nuevos.actual = 'Este campo es obligatorio';
    const errorNueva = validarContrasena(valores.nueva);
    if (errorNueva) nuevos.nueva = errorNueva;
    else if (valores.actual && valores.nueva === valores.actual) nuevos.nueva = 'Debe ser distinta de la actual';
    if (!nuevos.nueva && valores.confirmacion !== valores.nueva) nuevos.confirmacion = 'Las contraseñas no coinciden';
    setErrores(nuevos);
    return Object.keys(nuevos).length === 0;
  };

  const enviar = async (evento) => {
    evento.preventDefault();
    if (guardandoRef.current) return;
    setAviso(null);
    setErrorGeneral(null);
    if (!leerFormulario()) return;

    guardandoRef.current = true;
    setGuardando(true);
    try {
      await api.patch('/api/auth/contrasena', { contrasena_actual: valores.actual, contrasena_nueva: valores.nueva });
      setValores(VACIO);
      setErrores({});
      setAviso('Contraseña actualizada. Úsala la próxima vez que inicies sesión.');
    } catch (error) {
      setErrorGeneral(mensajeError(error, 'No se pudo cambiar la contraseña.'));
    } finally {
      guardandoRef.current = false;
      setGuardando(false);
    }
  };

  return (
    <div className="pansys-ui flex-1 px-4 py-6 md:px-6 lg:px-8 lg:py-8">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <PageHeader antetitulo="Cuenta" titulo="Mi cuenta" descripcion="Consulta tu sesión y cambia tu contraseña." />

        <Panel titulo="Sesión actual">
          <dl className="grid grid-cols-1 gap-4 px-5 pb-5 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Correo electrónico</dt>
              <dd className="mt-0.5 break-all font-medium">{usuario?.email}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Rol</dt>
              <dd className="mt-0.5 font-medium capitalize">{usuario?.rol}</dd>
            </div>
          </dl>
        </Panel>

        {aviso && <Aviso tipo="exito" onCerrar={() => setAviso(null)}>{aviso}</Aviso>}

        <Panel titulo="Cambiar contraseña" descripcion="Por seguridad, primero confirma tu contraseña actual.">
          <form onSubmit={enviar} noValidate className="flex flex-col gap-4 px-5 pb-5">
            {errorGeneral && <Aviso tipo="error">{errorGeneral}</Aviso>}
            <Campo
              etiqueta="Contraseña actual"
              type="password"
              autoComplete="current-password"
              value={valores.actual}
              onChange={cambiar('actual')}
              error={errores.actual}
            />
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Campo
                etiqueta="Contraseña nueva"
                type="password"
                autoComplete="new-password"
                value={valores.nueva}
                onChange={cambiar('nueva')}
                error={errores.nueva}
                ayuda="Mínimo 8 caracteres, con al menos una letra y un número"
              />
              <Campo
                etiqueta="Confirmar contraseña nueva"
                type="password"
                autoComplete="new-password"
                value={valores.confirmacion}
                onChange={cambiar('confirmacion')}
                error={errores.confirmacion}
              />
            </div>
            <div className="flex justify-end">
              <Boton type="submit" cargando={guardando}>
                <KeyRound className="size-4" aria-hidden="true" />
                Cambiar contraseña
              </Boton>
            </div>
          </form>
        </Panel>
      </div>
    </div>
  );
};

export default MiCuenta;
