import { useEffect, useState } from 'react';
import { mensajeError } from '../../lib/errores';
import { fechaHoraCorta, formatCOP, formatNumber } from '../../lib/formato';
import Aviso from '../ui/Aviso';
import Dialogo from '../ui/Dialogo';
import StatusBadge from '../ui/StatusBadge';
import { Tabla, TablaCelda, TablaColumna, TablaCuerpo, TablaEncabezado, TablaFila } from '../ui/Tabla';
import { ESTADOS_ORDEN } from './TablaOrdenes';

const Dato = ({ etiqueta, children }) => (
  <div>
    <dt className="text-xs text-muted-foreground">{etiqueta}</dt>
    <dd className="text-sm font-medium">{children}</dd>
  </div>
);

// Detalle de una orden con la trazabilidad de cada insumo (descontado, consumido, devuelto, mermado)
const DialogoDetalleOrden = ({ ordenId, onCargarDetalle, onCerrar }) => {
  const [orden, setOrden] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let activo = true;
    onCargarDetalle(ordenId)
      .then(detalle => activo && setOrden(detalle))
      .catch(e => activo && setError(mensajeError(e, 'No se pudo cargar la orden.')));
    return () => { activo = false; };
  }, [ordenId, onCargarDetalle]);

  const estado = orden ? ESTADOS_ORDEN[orden.estado] ?? { etiqueta: orden.estado, tono: 'neutro' } : null;

  return (
    <Dialogo titulo={`Orden #${ordenId}`} onCerrar={onCerrar} className="max-w-3xl">
      {error && <Aviso tipo="error">{error}</Aviso>}
      {!orden && !error && <p role="status" className="text-sm text-muted-foreground">Cargando orden…</p>}
      {orden && (
        <div className="flex flex-col gap-5">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Dato etiqueta="Producto">{orden.Producto?.nombre ?? `#${orden.producto_id}`}</Dato>
            <Dato etiqueta="Estado"><StatusBadge tono={estado.tono}>{estado.etiqueta}</StatusBadge></Dato>
            <Dato etiqueta="Costo de insumos">{formatCOP(orden.costo_insumos)}</Dato>
            <Dato etiqueta="Planificada">{formatNumber(orden.cantidad_planificada)}</Dato>
            <Dato etiqueta="Producida">{orden.cantidad_producida === null ? '—' : formatNumber(orden.cantidad_producida)}</Dato>
            <Dato etiqueta="Creada">{orden.createdAt ? fechaHoraCorta(orden.createdAt) : orden.fecha}{orden.empleado?.email ? ` · ${orden.empleado.email}` : ''}</Dato>
            {orden.fecha_finalizacion && (
              <Dato etiqueta="Cerrada">{fechaHoraCorta(orden.fecha_finalizacion)}{orden.cerradoPor?.email ? ` · ${orden.cerradoPor.email}` : ''}</Dato>
            )}
            {orden.motivo_cancelacion && <Dato etiqueta="Motivo de cancelación">{orden.motivo_cancelacion}</Dato>}
            {orden.observaciones && <Dato etiqueta="Observaciones">{orden.observaciones}</Dato>}
          </dl>

          <div className="rounded-xl border border-border">
            <Tabla aria-label="Insumos de la orden">
              <TablaEncabezado>
                <tr>
                  <TablaColumna>Insumo</TablaColumna>
                  <TablaColumna className="text-right">Por unidad</TablaColumna>
                  <TablaColumna className="text-right">Descontado</TablaColumna>
                  <TablaColumna className="text-right">Consumido</TablaColumna>
                  <TablaColumna className="text-right">Devuelto</TablaColumna>
                  <TablaColumna className="text-right">Merma</TablaColumna>
                  <TablaColumna className="text-right">Costo</TablaColumna>
                </tr>
              </TablaEncabezado>
              <TablaCuerpo>
                {(orden.insumos ?? []).map(i => (
                  <TablaFila key={i.id}>
                    <TablaCelda className="font-medium">{i.MateriaPrima?.nombre ?? `#${i.materia_prima_id}`}</TablaCelda>
                    <TablaCelda className="text-right tabular-nums">{formatNumber(i.cantidad_por_unidad)} {i.unidad_medida}</TablaCelda>
                    <TablaCelda className="text-right tabular-nums">{formatNumber(i.cantidad_usada)}</TablaCelda>
                    <TablaCelda className="text-right tabular-nums">{formatNumber(i.cantidad_consumida)}</TablaCelda>
                    <TablaCelda className="text-right tabular-nums">{formatNumber(i.cantidad_devuelta)}</TablaCelda>
                    <TablaCelda className="text-right tabular-nums">{formatNumber(i.cantidad_mermada)}</TablaCelda>
                    <TablaCelda className="text-right tabular-nums">{formatCOP(i.costo)}</TablaCelda>
                  </TablaFila>
                ))}
              </TablaCuerpo>
            </Tabla>
          </div>
        </div>
      )}
    </Dialogo>
  );
};

export default DialogoDetalleOrden;
