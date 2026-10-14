import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChefHat, CircleCheck, CircleX, PackageCheck, Plus } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { mensajeError } from '../lib/errores';
import { esHoyEnBogota, formatNumber } from '../lib/formato';
import { puedeEscribir } from '../lib/permisos';
import Aviso from '../components/ui/Aviso';
import Boton from '../components/ui/Boton';
import { PageHeader } from '../components/ui/Panel';
import StatCard from '../components/ui/StatCard';
import DialogoCancelar from '../components/produccion/DialogoCancelar';
import DialogoDetalleOrden from '../components/produccion/DialogoDetalleOrden';
import DialogoFinalizar from '../components/produccion/DialogoFinalizar';
import FormularioOrden from '../components/produccion/FormularioOrden';
import TablaOrdenes from '../components/produccion/TablaOrdenes';

// Panadería con la que trabaja la interfaz (para panadero y gerente el backend usa la del token;
// para el administrador acota las consultas a esta panadería)
const PANADERIA_ID = 1;
const ID_AVISO_CONSULTA = 'aviso-modo-consulta-produccion';

const Produccion = () => {
  const { usuario } = useAuth();
  const escribe = puedeEscribir(usuario);

  const [ordenes, setOrdenes] = useState([]);
  const [recetas, setRecetas] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [errorOrdenes, setErrorOrdenes] = useState(null);
  const [errorRecetas, setErrorRecetas] = useState(null);
  const [avisos, setAvisos] = useState([]);
  const [mostrarFormulario, setMostrarFormulario] = useState(false);
  const [porFinalizar, setPorFinalizar] = useState(null);
  const [porCancelar, setPorCancelar] = useState(null);
  const [detalleId, setDetalleId] = useState(null);

  const cargarOrdenes = useCallback(async () => {
    setErrorOrdenes(null);
    try {
      const res = await api.get(`/api/produccion/ordenes?panaderia_id=${PANADERIA_ID}`);
      setOrdenes(res.data);
    } catch (error) {
      setErrorOrdenes(mensajeError(error, 'No se pudieron cargar las órdenes.'));
    }
  }, []);

  const cargarRecetas = useCallback(async () => {
    setErrorRecetas(null);
    try {
      const res = await api.get(`/api/produccion/recetas?panaderia_id=${PANADERIA_ID}`);
      setRecetas(res.data);
    } catch (error) {
      setErrorRecetas(mensajeError(error, 'No se pudieron cargar los productos con receta.'));
    }
  }, []);

  useEffect(() => {
    Promise.allSettled([cargarOrdenes(), cargarRecetas()]).then(() => setCargando(false));
  }, [cargarOrdenes, cargarRecetas]);

  // Indicadores con los datos reales; "hoy" según la zona horaria de Bogotá
  const resumen = useMemo(() => {
    const cerradasHoy = (estado) =>
      ordenes.filter(o => o.estado === estado && o.fecha_finalizacion && esHoyEnBogota(o.fecha_finalizacion));
    const finalizadasHoy = cerradasHoy('finalizada');
    return {
      enProceso: ordenes.filter(o => o.estado === 'en_proceso').length,
      finalizadasHoy: finalizadasHoy.length,
      unidadesHoy: finalizadasHoy.reduce((suma, o) => suma + (Number(o.cantidad_producida) || 0), 0),
      canceladasHoy: cerradasHoy('cancelada').length
    };
  }, [ordenes]);

  const calcular = useCallback(async (productoId, cantidad) => {
    const res = await api.get(
      `/api/produccion/calcular?producto_id=${productoId}&cantidad=${cantidad}&panaderia_id=${PANADERIA_ID}`
    );
    return res.data;
  }, []);

  const cargarDetalle = useCallback(async (ordenId) => {
    const res = await api.get(`/api/produccion/ordenes/${ordenId}?panaderia_id=${PANADERIA_ID}`);
    return res.data;
  }, []);

  const crearOrden = async (datos) => {
    const res = await api.post('/api/produccion/ordenes', { ...datos, panaderia_id: PANADERIA_ID });
    const { orden, alertas_stock_bajo: alertas = [] } = res.data;
    setMostrarFormulario(false);
    const nuevos = [{
      tipo: 'exito',
      texto: `Orden #${orden.id} creada: ${formatNumber(orden.cantidad_planificada)} × ${orden.Producto?.nombre ?? 'producto'}. Los insumos se descontaron del inventario.`
    }];
    if (alertas.length > 0) {
      nuevos.push({
        tipo: 'info',
        texto: `Quedaron en su stock mínimo o por debajo: ${alertas.map(a => `${a.nombre} (${formatNumber(a.disponible)} ${a.unidad_medida})`).join(', ')}.`
      });
    }
    setAvisos(nuevos);
    await cargarOrdenes();
  };

  const finalizarOrden = async (datos) => {
    const orden = porFinalizar;
    await api.patch(`/api/produccion/ordenes/${orden.id}/finalizar?panaderia_id=${PANADERIA_ID}`, datos);
    setPorFinalizar(null);
    setAvisos([{
      tipo: 'exito',
      texto: `Orden #${orden.id} finalizada: ${formatNumber(datos.cantidad_producida)} unidades sumadas al stock del producto.`
    }]);
    await cargarOrdenes();
  };

  const cancelarOrden = async (cuerpo) => {
    const orden = porCancelar;
    await api.patch(`/api/produccion/ordenes/${orden.id}/cancelar?panaderia_id=${PANADERIA_ID}`, cuerpo);
    setPorCancelar(null);
    setAvisos([{
      tipo: 'exito',
      texto: cuerpo.devolver_insumos
        ? `Orden #${orden.id} cancelada. Los insumos indicados volvieron al inventario.`
        : `Orden #${orden.id} cancelada. Los insumos se registraron como merma.`
    }]);
    await cargarOrdenes();
  };

  const abrirFormulario = () => {
    setAvisos([]);
    setMostrarFormulario(true);
  };

  const sinDatos = (valor) => (cargando || errorOrdenes ? '—' : valor);
  const descritoPor = escribe ? undefined : ID_AVISO_CONSULTA;

  return (
    <div className="pansys-ui flex-1 px-4 py-6 md:px-6 lg:px-8 lg:py-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          antetitulo="Módulo"
          titulo="Producción"
          descripcion="Crea órdenes de producción a partir de las recetas y registra lo producido."
          acciones={
            <Boton onClick={abrirFormulario} disabled={!escribe || mostrarFormulario || cargando} aria-describedby={descritoPor}>
              <Plus className="size-4" aria-hidden="true" />
              Nueva orden
            </Boton>
          }
        />

        {!escribe && (
          <Aviso tipo="info" id={ID_AVISO_CONSULTA}>
            Modo consulta: tu rol permite ver la producción, pero no crear, finalizar ni cancelar órdenes.
          </Aviso>
        )}

        {avisos.map((a, i) => (
          <Aviso key={i} tipo={a.tipo} onCerrar={() => setAvisos(lista => lista.filter((_, j) => j !== i))}>
            {a.texto}
          </Aviso>
        ))}

        <section aria-label="Resumen de producción" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard tono="primario" etiqueta="Órdenes en proceso" valor={sinDatos(String(resumen.enProceso))} icono={ChefHat} />
          <StatCard etiqueta="Finalizadas hoy" valor={sinDatos(String(resumen.finalizadasHoy))} icono={CircleCheck} nota="Hora de Bogotá" />
          <StatCard etiqueta="Unidades producidas hoy" valor={sinDatos(formatNumber(resumen.unidadesHoy))} icono={PackageCheck} />
          <StatCard etiqueta="Canceladas hoy" valor={sinDatos(String(resumen.canceladasHoy))} icono={CircleX} />
        </section>

        {errorRecetas && <Aviso tipo="error" titulo="No se pudieron cargar las recetas">{errorRecetas}</Aviso>}

        {mostrarFormulario && (
          <FormularioOrden
            recetas={recetas}
            onCalcular={calcular}
            onCrear={crearOrden}
            onCancelar={() => setMostrarFormulario(false)}
          />
        )}

        {cargando ? (
          <p role="status" className="rounded-2xl border border-border/80 bg-card px-5 py-10 text-center text-sm text-muted-foreground">
            Cargando órdenes…
          </p>
        ) : errorOrdenes ? (
          <Aviso tipo="error" titulo="No se pudieron cargar las órdenes">{errorOrdenes}</Aviso>
        ) : (
          <TablaOrdenes
            ordenes={ordenes}
            puedeEditar={escribe}
            descritoPor={descritoPor}
            onVer={orden => setDetalleId(orden.id)}
            onFinalizar={setPorFinalizar}
            onCancelar={setPorCancelar}
          />
        )}
      </div>

      {porFinalizar && (
        <DialogoFinalizar orden={porFinalizar} onFinalizar={finalizarOrden} onCerrar={() => setPorFinalizar(null)} />
      )}
      {porCancelar && (
        <DialogoCancelar
          orden={porCancelar}
          onCargarDetalle={cargarDetalle}
          onCancelarOrden={cancelarOrden}
          onCerrar={() => setPorCancelar(null)}
        />
      )}
      {detalleId && (
        <DialogoDetalleOrden ordenId={detalleId} onCargarDetalle={cargarDetalle} onCerrar={() => setDetalleId(null)} />
      )}
    </div>
  );
};

export default Produccion;
