import { Fragment, useState } from 'react';
import { ChevronDown, Receipt } from 'lucide-react';
import { cn } from '../../lib/utils';
import { fechaHoraCorta, formatCOP, formatNumber } from '../../lib/formato';
import Boton from '../ui/Boton';
import EstadoVacio from '../ui/EstadoVacio';
import { Panel } from '../ui/Panel';
import StatusBadge from '../ui/StatusBadge';
import { Tabla, TablaCelda, TablaColumna, TablaCuerpo, TablaEncabezado, TablaFila } from '../ui/Tabla';

// GET /api/ventas incluye el detalle como "DetalleVenta" (nombre que genera Sequelize)
const lineasDe = (venta) => venta.DetalleVenta ?? venta.DetalleVentas ?? [];

const capitalizar = (texto) => (texto ? texto.charAt(0).toUpperCase() + texto.slice(1) : '—');

// Historial con los datos reales de cada venta; el detalle ya llega en la respuesta
const HistorialVentas = ({ ventas }) => {
  const [abierta, setAbierta] = useState(null);

  return (
    <Panel titulo="Historial de ventas" descripcion="Ventas registradas, de la más reciente a la más antigua.">
      {ventas.length === 0 ? (
        <EstadoVacio icono={Receipt} titulo="Aún no hay ventas registradas" descripcion="Las ventas aparecerán aquí al registrarlas." />
      ) : (
        <div className="pb-2">
          <Tabla>
            <TablaEncabezado>
              <tr>
                <TablaColumna>Venta</TablaColumna>
                <TablaColumna>Fecha y hora</TablaColumna>
                <TablaColumna className="text-right">Productos</TablaColumna>
                <TablaColumna className="text-right">Total</TablaColumna>
                <TablaColumna>Estado</TablaColumna>
                <TablaColumna className="text-right">Detalle</TablaColumna>
              </tr>
            </TablaEncabezado>
            <TablaCuerpo>
              {ventas.map(venta => {
                const lineas = lineasDe(venta);
                const unidades = lineas.reduce((suma, l) => suma + (Number(l.cantidad) || 0), 0);
                const expandida = abierta === venta.id;
                const idDetalle = `detalle-venta-${venta.id}`;
                return (
                  <Fragment key={venta.id}>
                    <TablaFila>
                      <TablaCelda className="font-medium">#{venta.id}</TablaCelda>
                      <TablaCelda className="whitespace-nowrap text-muted-foreground">
                        {venta.createdAt ? fechaHoraCorta(venta.createdAt) : venta.fecha}
                      </TablaCelda>
                      <TablaCelda className="text-right tabular-nums">{formatNumber(unidades)}</TablaCelda>
                      <TablaCelda className="text-right font-medium tabular-nums">{formatCOP(venta.total)}</TablaCelda>
                      <TablaCelda>
                        <StatusBadge tono={venta.estado === 'completada' ? 'exito' : 'neutro'}>{capitalizar(venta.estado)}</StatusBadge>
                      </TablaCelda>
                      <TablaCelda className="text-right">
                        <Boton
                          variante="fantasma"
                          tamano="sm"
                          onClick={() => setAbierta(expandida ? null : venta.id)}
                          aria-expanded={expandida}
                          aria-controls={idDetalle}
                          aria-label={`Ver detalle de la venta #${venta.id}`}
                        >
                          <ChevronDown className={cn('size-4 transition-transform', expandida && 'rotate-180')} aria-hidden="true" />
                        </Boton>
                      </TablaCelda>
                    </TablaFila>
                    {expandida && (
                      <tr id={idDetalle}>
                        <td colSpan={6} className="bg-secondary/40 px-5 py-3">
                          {lineas.length === 0 ? (
                            <p className="text-sm text-muted-foreground">Esta venta no tiene detalle.</p>
                          ) : (
                            <ul aria-label={`Productos de la venta #${venta.id}`} className="flex flex-col gap-1.5 text-sm">
                              {lineas.map(l => (
                                <li key={l.id} className="flex justify-between gap-4">
                                  <span>
                                    {l.Producto?.nombre ?? `Producto #${l.producto_id}`} × {formatNumber(l.cantidad)}
                                    <span className="text-muted-foreground"> · {formatCOP(l.precio_unitario)} c/u</span>
                                  </span>
                                  <span className="font-medium tabular-nums">{formatCOP(l.subtotal)}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </TablaCuerpo>
          </Tabla>
        </div>
      )}
    </Panel>
  );
};

export default HistorialVentas;
