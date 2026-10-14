import { useCallback, useEffect, useMemo, useState } from 'react';
import { Boxes, PackageX, Plus, RotateCw, TriangleAlert, Wallet } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { mensajeError } from '../lib/errores';
import { formatCOP } from '../lib/formato';
import { puedeEscribir } from '../lib/permisos';
import Aviso from '../components/ui/Aviso';
import Boton from '../components/ui/Boton';
import DialogoConfirmacion from '../components/ui/DialogoConfirmacion';
import { PageHeader } from '../components/ui/Panel';
import StatCard from '../components/ui/StatCard';
import FormularioInsumo from '../components/inventario/FormularioInsumo';
import TablaInsumos, { estadoInsumo } from '../components/inventario/TablaInsumos';

// Panadería con la que trabaja la interfaz (para panadero y gerente el backend usa la del token)
const PANADERIA_ID = 1;
const ID_AVISO_CONSULTA = 'aviso-modo-consulta-inventario';

const Inventario = () => {
  const { usuario } = useAuth();
  const escribe = puedeEscribir(usuario);

  const [insumos, setInsumos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [errorCarga, setErrorCarga] = useState(null);
  const [formulario, setFormulario] = useState(null); // null | { insumo: null } (alta) | { insumo } (edición)
  const [aviso, setAviso] = useState(null);
  const [porEliminar, setPorEliminar] = useState(null);
  const [eliminando, setEliminando] = useState(false);
  const [errorEliminar, setErrorEliminar] = useState(null);

  const cargarInventario = useCallback(async () => {
    setErrorCarga(null);
    try {
      const res = await api.get(`/api/inventario?panaderia_id=${PANADERIA_ID}`);
      setInsumos(res.data);
    } catch (error) {
      setErrorCarga(mensajeError(error, 'No se pudo cargar el inventario.'));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargarInventario();
  }, [cargarInventario]);

  const resumen = useMemo(() => ({
    registrados: insumos.length,
    valor: insumos.reduce((total, i) => total + (Number(i.cantidad_disponible) || 0) * (Number(i.precio_unitario) || 0), 0),
    bajo: insumos.filter(i => estadoInsumo(i) === 'bajo').length,
    agotados: insumos.filter(i => estadoInsumo(i) === 'agotado').length
  }), [insumos]);

  const abrirAlta = () => {
    setAviso(null);
    setFormulario({ insumo: null });
  };

  const abrirEdicion = (insumo) => {
    setAviso(null);
    setFormulario({ insumo });
  };

  // Recibe los datos ya validados y convertidos por FormularioInsumo; los errores los muestra el formulario
  const guardarInsumo = async (datos) => {
    const cuerpo = { ...datos, panaderia_id: PANADERIA_ID };
    const editando = Boolean(formulario.insumo);
    if (editando) {
      await api.put(`/api/inventario/${formulario.insumo.id}`, cuerpo);
    } else {
      await api.post('/api/inventario', cuerpo);
    }
    setFormulario(null);
    setAviso({ tipo: 'exito', texto: editando ? `«${datos.nombre}» se actualizó correctamente.` : `«${datos.nombre}» se agregó al inventario.` });
    await cargarInventario();
  };

  const pedirEliminacion = (insumo) => {
    setAviso(null);
    setErrorEliminar(null);
    setPorEliminar(insumo);
  };

  const confirmarEliminacion = async () => {
    setEliminando(true);
    setErrorEliminar(null);
    try {
      await api.delete(`/api/inventario/${porEliminar.id}`);
      setAviso({ tipo: 'exito', texto: `«${porEliminar.nombre}» se eliminó del inventario.` });
      setPorEliminar(null);
      await cargarInventario();
    } catch (error) {
      setErrorEliminar(mensajeError(error, 'No se pudo eliminar el insumo.'));
    } finally {
      setEliminando(false);
    }
  };

  const reintentar = () => {
    setCargando(true);
    cargarInventario();
  };

  const sinDatos = cargando || errorCarga;
  const descritoPor = escribe ? undefined : ID_AVISO_CONSULTA;

  return (
    <div className="pansys-ui flex-1 px-4 py-6 md:px-6 lg:px-8 lg:py-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          antetitulo="Módulo"
          titulo="Inventario de insumos"
          descripcion="Controla las existencias, los mínimos de reposición y el valor de cada materia prima."
          acciones={
            <Boton onClick={abrirAlta} disabled={!escribe || Boolean(formulario)} aria-describedby={descritoPor}>
              <Plus className="size-4" aria-hidden="true" />
              Nuevo insumo
            </Boton>
          }
        />

        {!escribe && (
          <Aviso tipo="info" id={ID_AVISO_CONSULTA}>
            Modo consulta: tu rol permite ver el inventario, pero no crear, editar ni eliminar insumos.
          </Aviso>
        )}

        {aviso && (
          <Aviso tipo={aviso.tipo} onCerrar={() => setAviso(null)}>
            {aviso.texto}
          </Aviso>
        )}

        {formulario && (
          <FormularioInsumo
            key={formulario.insumo?.id ?? 'nuevo'}
            insumo={formulario.insumo}
            onGuardar={guardarInsumo}
            onCancelar={() => setFormulario(null)}
          />
        )}

        <section aria-label="Resumen de inventario" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard etiqueta="Insumos registrados" valor={sinDatos ? '—' : String(resumen.registrados)} icono={Boxes} />
          <StatCard
            tono="primario"
            etiqueta="Valor del inventario"
            valor={sinDatos ? '—' : formatCOP(resumen.valor)}
            icono={Wallet}
            nota="Cantidad × precio unitario"
          />
          <StatCard etiqueta="Con stock bajo" valor={sinDatos ? '—' : String(resumen.bajo)} icono={TriangleAlert} nota="En el mínimo o por debajo" />
          <StatCard tono="alerta" etiqueta="Sin existencias" valor={sinDatos ? '—' : String(resumen.agotados)} icono={PackageX} />
        </section>

        {errorCarga ? (
          <Aviso tipo="error" titulo="No se pudo cargar el inventario">
            <p>{errorCarga}</p>
            <Boton variante="contorno" tamano="sm" className="mt-3" onClick={reintentar}>
              <RotateCw className="size-4" aria-hidden="true" />
              Reintentar
            </Boton>
          </Aviso>
        ) : cargando ? (
          <p role="status" className="rounded-2xl border border-border/80 bg-card px-5 py-10 text-center text-sm text-muted-foreground">
            Cargando inventario…
          </p>
        ) : (
          <TablaInsumos
            insumos={insumos}
            puedeEditar={escribe}
            descritoPor={descritoPor}
            onEditar={abrirEdicion}
            onEliminar={pedirEliminacion}
          />
        )}
      </div>

      {porEliminar && (
        <DialogoConfirmacion
          titulo={`¿Eliminar «${porEliminar.nombre}»?`}
          descripcion="El insumo dejará de aparecer en el inventario."
          textoConfirmar="Eliminar"
          confirmando={eliminando}
          error={errorEliminar}
          onConfirmar={confirmarEliminacion}
          onCancelar={() => setPorEliminar(null)}
        />
      )}
    </div>
  );
};

export default Inventario;
