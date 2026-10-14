import { useEffect, useRef, useState } from 'react';
import { Calculator } from 'lucide-react';
import { mensajeError } from '../../lib/errores';
import { formatCOP, formatNumber } from '../../lib/formato';
import { leerNumero, leerTexto } from '../../lib/validacion';
import Aviso from '../ui/Aviso';
import Boton from '../ui/Boton';
import Campo from '../ui/Campo';
import { Panel } from '../ui/Panel';
import Selector from '../ui/Selector';
import StatusBadge from '../ui/StatusBadge';
import { Tabla, TablaCelda, TablaColumna, TablaCuerpo, TablaEncabezado, TablaFila } from '../ui/Tabla';

const MAX_CANTIDAD_ORDEN = 100000; // mismo límite que el backend

// Tabla de necesidades: sirve para el cálculo previo y para los faltantes de un 409
const TablaNecesidades = ({ insumos, etiqueta }) => (
  <Tabla aria-label={etiqueta}>
    <TablaEncabezado>
      <tr>
        <TablaColumna>Insumo</TablaColumna>
        <TablaColumna className="text-right">Necesario</TablaColumna>
        <TablaColumna className="text-right">Disponible</TablaColumna>
        <TablaColumna className="text-right">Faltante</TablaColumna>
        <TablaColumna className="text-right">Costo estimado</TablaColumna>
      </tr>
    </TablaEncabezado>
    <TablaCuerpo>
      {insumos.map(i => (
        <TablaFila key={i.materia_prima_id}>
          <TablaCelda className="font-medium">{i.nombre}</TablaCelda>
          <TablaCelda className="text-right tabular-nums">{formatNumber(i.necesario)} {i.unidad_medida}</TablaCelda>
          <TablaCelda className="text-right tabular-nums">{formatNumber(i.disponible)} {i.unidad_medida}</TablaCelda>
          <TablaCelda className={i.faltante > 0 ? 'text-right font-semibold tabular-nums text-destructive' : 'text-right tabular-nums text-muted-foreground'}>
            {i.faltante > 0 ? `${formatNumber(i.faltante)} ${i.unidad_medida}` : '—'}
          </TablaCelda>
          <TablaCelda className="text-right tabular-nums">{formatCOP(i.costo_estimado)}</TablaCelda>
        </TablaFila>
      ))}
    </TablaCuerpo>
  </Tabla>
);

// Nueva orden de producción: un producto con receta y una cantidad entera.
// Permite calcular antes (GET /calcular) y muestra los faltantes si el backend responde 409.
const FormularioOrden = ({ recetas, onCalcular, onCrear, onCancelar }) => {
  const [productoId, setProductoId] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [errores, setErrores] = useState({});
  const [calculo, setCalculo] = useState(null);
  const [calculando, setCalculando] = useState(false);
  const [errorGeneral, setErrorGeneral] = useState(null);
  const [faltantes, setFaltantes] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const guardandoRef = useRef(false);
  const refProducto = useRef(null);
  const refCantidad = useRef(null);
  const refObservaciones = useRef(null);

  useEffect(() => {
    refProducto.current?.focus();
  }, []);

  // Cualquier cambio invalida el cálculo y los faltantes anteriores
  const limpiarResultados = () => {
    setCalculo(null);
    setFaltantes(null);
    setErrorGeneral(null);
  };

  const leerFormulario = () => {
    const nuevos = {};
    if (!productoId) nuevos.producto_id = 'Elige un producto';
    const lecturaCantidad = leerNumero(cantidad, { entero: true, maximo: MAX_CANTIDAD_ORDEN });
    if (lecturaCantidad.error) nuevos.cantidad_planificada = lecturaCantidad.error;
    else if (lecturaCantidad.valor < 1) nuevos.cantidad_planificada = 'Debe ser al menos 1';
    const lecturaObs = leerTexto(observaciones, { obligatorio: false, maximo: 500 });
    if (lecturaObs.error) nuevos.observaciones = lecturaObs.error;

    setErrores(nuevos);
    if (nuevos.producto_id) refProducto.current?.focus();
    else if (nuevos.cantidad_planificada) refCantidad.current?.focus();
    else if (nuevos.observaciones) refObservaciones.current?.focus();
    if (Object.keys(nuevos).length > 0) return null;

    return {
      producto_id: Number(productoId),
      cantidad_planificada: lecturaCantidad.valor,
      ...(lecturaObs.valor ? { observaciones: lecturaObs.valor } : {})
    };
  };

  const calcular = async () => {
    const datos = leerFormulario();
    if (!datos) return;
    limpiarResultados();
    setCalculando(true);
    try {
      setCalculo(await onCalcular(datos.producto_id, datos.cantidad_planificada));
    } catch (error) {
      setErrorGeneral(mensajeError(error, 'No se pudo calcular la orden.'));
    } finally {
      setCalculando(false);
    }
  };

  const enviar = async (evento) => {
    evento.preventDefault();
    if (guardandoRef.current) return;
    const datos = leerFormulario();
    if (!datos) return;

    guardandoRef.current = true;
    setGuardando(true);
    setErrorGeneral(null);
    setFaltantes(null);
    try {
      await onCrear(datos);
      // Si sale bien, Producción cierra el formulario (este componente se desmonta)
    } catch (error) {
      setErrorGeneral(mensajeError(error, 'No se pudo crear la orden.'));
      setFaltantes(error?.response?.data?.faltantes ?? null);
      guardandoRef.current = false;
      setGuardando(false);
    }
  };

  return (
    <Panel titulo="Nueva orden de producción" descripcion="Al crearla se descuentan los insumos de la receta del inventario.">
      <form onSubmit={enviar} noValidate className="flex flex-col gap-4 px-5 pb-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Selector
            ref={refProducto}
            etiqueta="Producto"
            value={productoId}
            onChange={e => { setProductoId(e.target.value); limpiarResultados(); }}
            error={errores.producto_id}
            ayuda="Solo se pueden producir productos con receta"
          >
            <option value="">Elige un producto…</option>
            {recetas.map(r => (
              <option key={r.producto_id} value={r.producto_id} disabled={(r.insumos ?? []).length === 0}>
                {r.producto}{(r.insumos ?? []).length === 0 ? ' (sin receta)' : ''}
              </option>
            ))}
          </Selector>
          <Campo
            ref={refCantidad}
            etiqueta="Cantidad a producir"
            inputMode="numeric"
            value={cantidad}
            onChange={e => { setCantidad(e.target.value); limpiarResultados(); }}
            error={errores.cantidad_planificada}
            ayuda="Unidades enteras"
          />
          <Campo
            ref={refObservaciones}
            etiqueta="Observaciones (opcional)"
            value={observaciones}
            onChange={e => setObservaciones(e.target.value)}
            error={errores.observaciones}
            maxLength={500}
          />
        </div>

        {errorGeneral && <Aviso tipo="error">{errorGeneral}</Aviso>}
        {faltantes && faltantes.length > 0 && (
          <div className="rounded-xl border border-destructive/30">
            <TablaNecesidades insumos={faltantes} etiqueta="Insumos faltantes" />
          </div>
        )}

        {calculo && (
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-secondary/30 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold">
                Insumos para {formatNumber(calculo.cantidad)} × {calculo.producto}
              </p>
              <div className="flex items-center gap-3">
                <span className="text-sm">Costo estimado: <strong className="tabular-nums">{formatCOP(calculo.costo_total_estimado)}</strong></span>
                <StatusBadge tono={calculo.alcanza ? 'exito' : 'peligro'}>
                  {calculo.alcanza ? 'Hay insumos suficientes' : 'Faltan insumos'}
                </StatusBadge>
              </div>
            </div>
            <TablaNecesidades insumos={calculo.insumos} etiqueta="Insumos necesarios" />
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Boton variante="contorno" onClick={onCancelar} disabled={guardando}>Cancelar</Boton>
          <Boton variante="contorno" onClick={calcular} cargando={calculando} disabled={guardando}>
            <Calculator className="size-4" aria-hidden="true" />
            Calcular insumos
          </Boton>
          <Boton type="submit" cargando={guardando} disabled={calculando}>Crear orden</Boton>
        </div>
      </form>
    </Panel>
  );
};

export default FormularioOrden;
