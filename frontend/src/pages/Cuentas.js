import { useCallback, useEffect, useRef, useState } from 'react';
import { Pencil, Power, RefreshCw, UserPlus, Users } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { mensajeError } from '../lib/errores';
import { ROLES } from '../lib/permisos';
import { validarContrasena, validarEmail } from '../lib/validacion';
import Aviso from '../components/ui/Aviso';
import Boton from '../components/ui/Boton';
import Campo from '../components/ui/Campo';
import DialogoConfirmacion from '../components/ui/DialogoConfirmacion';
import EstadoVacio from '../components/ui/EstadoVacio';
import { PageHeader, Panel } from '../components/ui/Panel';
import Selector from '../components/ui/Selector';
import StatusBadge from '../components/ui/StatusBadge';
import { Tabla, TablaCelda, TablaColumna, TablaCuerpo, TablaEncabezado, TablaFila } from '../components/ui/Tabla';
import DialogoEditarCuenta from '../components/cuentas/DialogoEditarCuenta';
import { nombreRol, OPCIONES_ROL } from '../components/cuentas/roles';

// La política de contraseñas vive en lib/validacion.js (se reexporta por compatibilidad)
export { validarContrasena };

const VACIO = { email: '', contrasena: '', confirmacion: '', rol_id: String(ROLES.PANADERO), panaderia_id: '' };

const esAdministradorActivo = (c) => c.estado && c.rol_id === ROLES.ADMINISTRADOR;

// Gestión de cuentas (solo administrador): listar, crear, editar y desactivar/reactivar.
// Endpoints: GET/PATCH /api/usuarios, GET /api/panaderias y POST /api/auth/registrar.
const Cuentas = () => {
  const { usuario, actualizarUsuario } = useAuth();
  const esAdministrador = usuario?.rol_id === ROLES.ADMINISTRADOR;

  const [cuentas, setCuentas] = useState([]);
  const [panaderias, setPanaderias] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [errorCuentas, setErrorCuentas] = useState(null);
  const [errorPanaderias, setErrorPanaderias] = useState(null);

  const [valores, setValores] = useState(VACIO);
  const [errores, setErrores] = useState({});
  const [errorGeneral, setErrorGeneral] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [confirmarAdmin, setConfirmarAdmin] = useState(null);
  const guardandoRef = useRef(false);

  const [editando, setEditando] = useState(null);
  const [desactivando, setDesactivando] = useState(null);
  const [errorEstado, setErrorEstado] = useState(null);
  const [cambiandoEstado, setCambiandoEstado] = useState(null);
  const cambiandoEstadoRef = useRef(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    const [resCuentas, resPanaderias] = await Promise.allSettled([api.get('/api/usuarios'), api.get('/api/panaderias')]);
    if (resCuentas.status === 'fulfilled') {
      setCuentas(Array.isArray(resCuentas.value.data) ? resCuentas.value.data : []);
      setErrorCuentas(null);
    } else {
      setErrorCuentas(mensajeError(resCuentas.reason, 'No se pudieron cargar las cuentas.'));
    }
    if (resPanaderias.status === 'fulfilled') {
      setPanaderias(Array.isArray(resPanaderias.value.data) ? resPanaderias.value.data : []);
      setErrorPanaderias(null);
    } else {
      setErrorPanaderias(mensajeError(resPanaderias.reason, 'No se pudieron cargar las panaderías.'));
    }
    setCargando(false);
  }, []);

  useEffect(() => {
    if (esAdministrador) cargar();
  }, [esAdministrador, cargar]);

  if (!esAdministrador) {
    return (
      <div className="pansys-ui flex-1 px-4 py-6 md:px-6 lg:px-8 lg:py-8">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
          <PageHeader titulo="Cuentas" />
          <Aviso tipo="error" titulo="Acceso restringido">Solo los administradores pueden gestionar cuentas.</Aviso>
        </div>
      </div>
    );
  }

  const administradoresActivos = cuentas.filter(esAdministradorActivo).length;
  const esUltimoAdministrador = (c) => esAdministradorActivo(c) && administradoresActivos <= 1;
  const nombrePanaderia = (c) =>
    c.panaderia?.nombre ?? panaderias.find(p => p.id === c.panaderia_id)?.nombre ?? '—';

  const reemplazar = (actualizada) =>
    setCuentas(lista => lista.map(c => (c.id === actualizada.id ? actualizada : c)));

  // ---------- Crear ----------
  const rolId = Number(valores.rol_id);
  const requierePanaderia = rolId !== ROLES.ADMINISTRADOR;
  const cambiar = (campo) => (e) => setValores(v => ({ ...v, [campo]: e.target.value }));

  const leerFormulario = () => {
    const nuevos = {};
    const email = validarEmail(valores.email);
    if (email.error) nuevos.email = email.error;
    const errorContrasena = validarContrasena(valores.contrasena);
    if (errorContrasena) nuevos.contrasena = errorContrasena;
    if (!nuevos.contrasena && valores.confirmacion !== valores.contrasena) nuevos.confirmacion = 'Las contraseñas no coinciden';
    const panaderiaId = Number(valores.panaderia_id);
    if (requierePanaderia && !panaderias.some(p => p.id === panaderiaId)) nuevos.panaderia_id = 'Selecciona la panadería';
    setErrores(nuevos);
    if (Object.keys(nuevos).length > 0) return null;
    // El administrador general no se asigna a una panadería (regla del backend)
    return {
      email: email.valor,
      contrasena: valores.contrasena,
      rol_id: rolId,
      ...(requierePanaderia ? { panaderia_id: panaderiaId } : {})
    };
  };

  const crearCuenta = async (cuerpo) => {
    if (guardandoRef.current) return;
    guardandoRef.current = true;
    setGuardando(true);
    setErrorGeneral(null);
    try {
      const res = await api.post('/api/auth/registrar', cuerpo);
      setAviso(`Cuenta creada para «${cuerpo.email}» (id ${res.data.id}).`);
      setValores(VACIO);
      setErrores({});
      setConfirmarAdmin(null);
      cargar();
    } catch (error) {
      setErrorGeneral(mensajeError(error, 'No se pudo crear la cuenta.'));
      setConfirmarAdmin(null);
    } finally {
      guardandoRef.current = false;
      setGuardando(false);
    }
  };

  const enviar = (evento) => {
    evento.preventDefault();
    setAviso(null);
    const cuerpo = leerFormulario();
    if (!cuerpo) return;
    // Crear un administrador da acceso total: se confirma antes
    if (cuerpo.rol_id === ROLES.ADMINISTRADOR) setConfirmarAdmin(cuerpo);
    else crearCuenta(cuerpo);
  };

  // ---------- Desactivar / reactivar ----------
  const cambiarEstado = async (cuenta, estado) => {
    if (cambiandoEstadoRef.current) return;
    cambiandoEstadoRef.current = true;
    setCambiandoEstado(cuenta.id);
    setErrorEstado(null);
    setAviso(null);
    try {
      const res = await api.patch(`/api/usuarios/${cuenta.id}/estado`, { estado });
      reemplazar(res.data);
      setDesactivando(null);
      setAviso(estado ? `Cuenta «${cuenta.email}» reactivada.` : `Cuenta «${cuenta.email}» desactivada.`);
    } catch (error) {
      setErrorEstado(mensajeError(error, 'No se pudo cambiar el estado de la cuenta.'));
    } finally {
      cambiandoEstadoRef.current = false;
      setCambiandoEstado(null);
    }
  };

  const ayudaRol = OPCIONES_ROL.find(o => o.valor === rolId)?.ayuda;

  return (
    <div className="pansys-ui flex-1 px-4 py-6 md:px-6 lg:px-8 lg:py-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          antetitulo="Administración"
          titulo="Cuentas"
          descripcion="Crea, edita y desactiva las cuentas de quienes usan Pansys en cada panadería."
          acciones={(
            <Boton variante="contorno" onClick={cargar} disabled={cargando}>
              <RefreshCw className="size-4" aria-hidden="true" />
              Actualizar
            </Boton>
          )}
        />

        {aviso && <Aviso tipo="exito" onCerrar={() => setAviso(null)}>{aviso}</Aviso>}
        {errorEstado && !desactivando && <Aviso tipo="error" onCerrar={() => setErrorEstado(null)}>{errorEstado}</Aviso>}

        <Panel
          titulo="Cuentas registradas"
          descripcion="Una cuenta desactivada no puede iniciar sesión y sus sesiones abiertas dejan de funcionar. Su historial se conserva."
        >
          {errorCuentas ? (
            <div className="px-5 pb-5"><Aviso tipo="error">{errorCuentas}</Aviso></div>
          ) : cargando && cuentas.length === 0 ? (
            <p role="status" className="px-5 pb-5 text-sm text-muted-foreground">Cargando cuentas…</p>
          ) : cuentas.length === 0 ? (
            <EstadoVacio icono={Users} titulo="No hay cuentas registradas" />
          ) : (
            <Tabla aria-label="Cuentas registradas">
              <TablaEncabezado>
                <tr>
                  <TablaColumna>Correo</TablaColumna>
                  <TablaColumna>Rol</TablaColumna>
                  <TablaColumna>Panadería</TablaColumna>
                  <TablaColumna>Estado</TablaColumna>
                  <TablaColumna className="text-right">Acciones</TablaColumna>
                </tr>
              </TablaEncabezado>
              <TablaCuerpo>
                {cuentas.map(c => {
                  const esPropia = c.id === usuario.id;
                  const ultimo = esUltimoAdministrador(c);
                  return (
                    <TablaFila key={c.id}>
                      <TablaCelda className="font-medium">
                        {c.email}
                        {esPropia && <span className="ml-2 text-xs text-muted-foreground">(tu cuenta)</span>}
                      </TablaCelda>
                      <TablaCelda>{c.rol ? c.rol.charAt(0).toUpperCase() + c.rol.slice(1) : nombreRol(c.rol_id)}</TablaCelda>
                      <TablaCelda>{c.rol_id === ROLES.ADMINISTRADOR ? 'Todas' : nombrePanaderia(c)}</TablaCelda>
                      <TablaCelda>
                        <StatusBadge tono={c.estado ? 'exito' : 'neutro'}>{c.estado ? 'Activa' : 'Desactivada'}</StatusBadge>
                      </TablaCelda>
                      <TablaCelda>
                        <div className="flex justify-end gap-2">
                          <Boton variante="contorno" tamano="sm" onClick={() => setEditando(c)} aria-label={`Editar ${c.email}`}>
                            <Pencil className="size-3.5" aria-hidden="true" />
                            Editar
                          </Boton>
                          {!esPropia && (c.estado ? (
                            <Boton
                              variante="contorno"
                              tamano="sm"
                              disabled={ultimo || cambiandoEstado !== null}
                              title={ultimo ? 'Debe quedar al menos un administrador activo' : undefined}
                              onClick={() => { setErrorEstado(null); setDesactivando(c); }}
                              aria-label={`Desactivar ${c.email}`}
                            >
                              <Power className="size-3.5" aria-hidden="true" />
                              Desactivar
                            </Boton>
                          ) : (
                            <Boton
                              variante="contorno"
                              tamano="sm"
                              cargando={cambiandoEstado === c.id}
                              disabled={cambiandoEstado !== null}
                              onClick={() => cambiarEstado(c, true)}
                              aria-label={`Reactivar ${c.email}`}
                            >
                              <Power className="size-3.5" aria-hidden="true" />
                              Reactivar
                            </Boton>
                          ))}
                        </div>
                      </TablaCelda>
                    </TablaFila>
                  );
                })}
              </TablaCuerpo>
            </Tabla>
          )}
        </Panel>

        <Panel titulo="Nueva cuenta" descripcion="La contraseña se guarda cifrada en el servidor; nunca se muestra ni se almacena en el navegador.">
          <form onSubmit={enviar} noValidate className="flex flex-col gap-4 px-5 pb-5">
            {errorGeneral && <Aviso tipo="error">{errorGeneral}</Aviso>}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Campo
                etiqueta="Correo electrónico"
                type="email"
                autoComplete="off"
                value={valores.email}
                onChange={cambiar('email')}
                error={errores.email}
                maxLength={255}
              />
              <Selector etiqueta="Rol" value={valores.rol_id} onChange={cambiar('rol_id')} ayuda={ayudaRol}>
                {OPCIONES_ROL.map(o => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}
              </Selector>
              <Campo
                etiqueta="Contraseña"
                type="password"
                autoComplete="new-password"
                value={valores.contrasena}
                onChange={cambiar('contrasena')}
                error={errores.contrasena}
                ayuda="Mínimo 8 caracteres, con al menos una letra y un número"
              />
              <Campo
                etiqueta="Confirmar contraseña"
                type="password"
                autoComplete="new-password"
                value={valores.confirmacion}
                onChange={cambiar('confirmacion')}
                error={errores.confirmacion}
              />
              {requierePanaderia && (
                <Selector
                  etiqueta="Panadería"
                  value={valores.panaderia_id}
                  onChange={cambiar('panaderia_id')}
                  error={errores.panaderia_id ?? errorPanaderias}
                >
                  <option value="">Selecciona una panadería</option>
                  {panaderias.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                </Selector>
              )}
            </div>
            <div className="flex justify-end">
              <Boton type="submit" cargando={guardando && !confirmarAdmin}>
                <UserPlus className="size-4" aria-hidden="true" />
                Crear cuenta
              </Boton>
            </div>
          </form>
        </Panel>
      </div>

      {confirmarAdmin && (
        <DialogoConfirmacion
          titulo="¿Crear una cuenta de administrador?"
          descripcion={`«${confirmarAdmin.email}» tendrá acceso total a las dos panaderías y podrá gestionar todas las cuentas.`}
          textoConfirmar="Crear administrador"
          confirmando={guardando}
          onConfirmar={() => crearCuenta(confirmarAdmin)}
          onCancelar={() => setConfirmarAdmin(null)}
        />
      )}

      {desactivando && (
        <DialogoConfirmacion
          titulo="¿Desactivar esta cuenta?"
          descripcion={`«${desactivando.email}» no podrá iniciar sesión y sus sesiones abiertas dejarán de funcionar. Podrás reactivarla después.`}
          textoConfirmar="Desactivar cuenta"
          confirmando={cambiandoEstado === desactivando.id}
          error={errorEstado}
          onConfirmar={() => cambiarEstado(desactivando, false)}
          onCancelar={() => { setDesactivando(null); setErrorEstado(null); }}
        />
      )}

      {editando && (
        <DialogoEditarCuenta
          cuenta={editando}
          panaderias={panaderias}
          esPropia={editando.id === usuario.id}
          esUltimoAdministrador={esUltimoAdministrador(editando)}
          onGuardada={(actualizada) => {
            reemplazar(actualizada);
            // Si es la propia cuenta, la cabecera y Mi cuenta muestran el email nuevo
            if (actualizada.id === usuario.id) actualizarUsuario({ email: actualizada.email });
            setEditando(null);
            setAviso(`Cuenta «${actualizada.email}» actualizada.`);
          }}
          onCerrar={() => setEditando(null)}
        />
      )}
    </div>
  );
};

export default Cuentas;
