import { useRef, useState } from 'react';
import api from '../../services/api';
import { mensajeError } from '../../lib/errores';
import { ROLES } from '../../lib/permisos';
import { validarEmail } from '../../lib/validacion';
import Aviso from '../ui/Aviso';
import Boton from '../ui/Boton';
import Campo from '../ui/Campo';
import Dialogo from '../ui/Dialogo';
import Selector from '../ui/Selector';
import { OPCIONES_ROL } from './roles';

// Edición de email, rol y panadería de una cuenta (PATCH /api/usuarios/:id).
// La interfaz bloquea el cambio del propio rol y la degradación del último administrador
// activo; el backend aplica las mismas reglas aunque la interfaz se salte.
const DialogoEditarCuenta = ({ cuenta, panaderias, esPropia, esUltimoAdministrador, onGuardada, onCerrar }) => {
  const [valores, setValores] = useState({
    email: cuenta.email,
    rol_id: String(cuenta.rol_id),
    panaderia_id: cuenta.panaderia_id ? String(cuenta.panaderia_id) : ''
  });
  const [errores, setErrores] = useState({});
  const [errorGeneral, setErrorGeneral] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const guardandoRef = useRef(false);
  const refEmail = useRef(null);

  const rolBloqueado = esPropia || esUltimoAdministrador;
  const rolId = Number(valores.rol_id);
  const requierePanaderia = rolId !== ROLES.ADMINISTRADOR;
  const promueveAdministrador = rolId === ROLES.ADMINISTRADOR && cuenta.rol_id !== ROLES.ADMINISTRADOR;
  const cambiar = (campo) => (e) => setValores(v => ({ ...v, [campo]: e.target.value }));

  const leerFormulario = () => {
    const nuevos = {};
    const email = validarEmail(valores.email);
    if (email.error) nuevos.email = email.error;
    const panaderiaId = Number(valores.panaderia_id);
    if (requierePanaderia && !panaderias.some(p => p.id === panaderiaId)) {
      nuevos.panaderia_id = 'Selecciona la panadería';
    }
    setErrores(nuevos);
    if (Object.keys(nuevos).length > 0) return null;
    return { email: email.valor, rol_id: rolId, panaderia_id: requierePanaderia ? panaderiaId : null };
  };

  const guardar = async (evento) => {
    evento.preventDefault();
    if (guardandoRef.current) return;
    setErrorGeneral(null);
    const cuerpo = leerFormulario();
    if (!cuerpo) return;
    if (rolBloqueado && cuerpo.rol_id !== cuenta.rol_id) return;
    if (cuerpo.email === cuenta.email && cuerpo.rol_id === cuenta.rol_id
      && cuerpo.panaderia_id === (cuenta.panaderia_id ?? null)) {
      setErrorGeneral('No hay cambios para guardar.');
      return;
    }

    guardandoRef.current = true;
    setGuardando(true);
    try {
      const res = await api.patch(`/api/usuarios/${cuenta.id}`, cuerpo);
      onGuardada(res.data);
    } catch (error) {
      setErrorGeneral(mensajeError(error, 'No se pudo guardar la cuenta.'));
    } finally {
      guardandoRef.current = false;
      setGuardando(false);
    }
  };

  let ayudaRol = OPCIONES_ROL.find(o => o.valor === rolId)?.ayuda;
  if (esPropia) ayudaRol = 'No puedes cambiar el rol de tu propia cuenta.';
  else if (esUltimoAdministrador) ayudaRol = 'Es el único administrador activo: no se puede cambiar su rol.';

  return (
    <Dialogo
      titulo="Editar cuenta"
      descripcion={cuenta.email}
      bloqueado={guardando}
      refFocoInicial={refEmail}
      onCerrar={onCerrar}
    >
      <form onSubmit={guardar} noValidate className="flex flex-col gap-4">
        {errorGeneral && <Aviso tipo="error">{errorGeneral}</Aviso>}
        <Campo
          ref={refEmail}
          etiqueta="Correo electrónico"
          type="email"
          autoComplete="off"
          value={valores.email}
          onChange={cambiar('email')}
          error={errores.email}
          maxLength={255}
        />
        <Selector etiqueta="Rol" value={valores.rol_id} onChange={cambiar('rol_id')} disabled={rolBloqueado} ayuda={ayudaRol}>
          {OPCIONES_ROL.map(o => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}
        </Selector>
        {requierePanaderia && (
          <Selector etiqueta="Panadería" value={valores.panaderia_id} onChange={cambiar('panaderia_id')} error={errores.panaderia_id}>
            <option value="">Selecciona una panadería</option>
            {panaderias.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
          </Selector>
        )}
        {promueveAdministrador && (
          <Aviso tipo="info" titulo="Acceso total">
            Como administrador tendrá acceso a las dos panaderías y podrá gestionar todas las cuentas.
          </Aviso>
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Boton variante="contorno" onClick={onCerrar} disabled={guardando}>Cancelar</Boton>
          <Boton type="submit" cargando={guardando}>Guardar cambios</Boton>
        </div>
      </form>
    </Dialogo>
  );
};

export default DialogoEditarCuenta;
