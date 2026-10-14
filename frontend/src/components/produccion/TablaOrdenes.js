import { useMemo, useState } from 'react';
import { ChefHat, CircleCheck, CircleX, Eye } from 'lucide-react';
import { cn } from '../../lib/utils';
import { fechaHoraCorta, formatCOP, formatNumber } from '../../lib/formato';
import Boton from '../ui/Boton';
import EstadoVacio from '../ui/EstadoVacio';
import StatusBadge from '../ui/StatusBadge';
import { Tabla, TablaCelda, TablaColumna, TablaCuerpo, TablaEncabezado, TablaFila } from '../ui/Tabla';

// Estados reales del backend (ENUM de orden_produccion)
export const ESTADOS_ORDEN = {
  en_proceso: { etiqueta: 'En proceso', tono: 'info' },
  finalizada: { etiqueta: 'Finalizada', tono: 'exito' },
  cancelada: { etiqueta: 'Cancelada', tono: 'neutro' }
};

const FILTROS = [
  { valor: 'todas', etiqueta: 'Todas' },
  { valor: 'en_proceso', etiqueta: 'En proceso' },
  { valor: 'finalizada', etiqueta: 'Finalizadas' },
  { valor: 'cancelada', etiqueta: 'Canceladas' }
];

const TablaOrdenes = ({ ordenes, puedeEditar, descritoPor, onVer, onFinalizar, onCancelar }) => {
  const [filtro, setFiltro] = useState('todas');

  const conteos = useMemo(() => {
    const c = { todas: ordenes.length, en_proceso: 0, finalizada: 0, cancelada: 0 };
    ordenes.forEach(o => { if (c[o.estado] !== undefined) c[o.estado] += 1; });
    return c;
  }, [ordenes]);

  const filas = filtro === 'todas' ? ordenes : ordenes.filter(o => o.estado === filtro);

  if (ordenes.length === 0) {
    return (
      <section className="rounded-2xl border border-border/80 bg-card shadow-panel">
        <EstadoVacio icono={ChefHat} titulo="Aún no hay órdenes de producción" descripcion="Crea una orden para producir un producto con receta." />
      </section>
    );
  }

  return (
    <section aria-label="Órdenes de producción" className="rounded-2xl border border-border/80 bg-card shadow-panel">
      <div className="border-b border-border/70 p-4">
        <div role="group" aria-label="Filtrar órdenes por estado" className="flex flex-wrap gap-1.5">
          {FILTROS.map(f => (
            <button
              key={f.valor}
              type="button"
              aria-pressed={filtro === f.valor}
              onClick={() => setFiltro(f.valor)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                filtro === f.valor ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              )}
            >
              {f.etiqueta}
              <span className={cn('rounded-full px-1.5 text-xs tabular-nums', filtro === f.valor ? 'bg-background/20' : 'bg-muted')}>
                {conteos[f.valor]}
              </span>
            </button>
          ))}
        </div>
      </div>

      {filas.length === 0 ? (
        <EstadoVacio icono={ChefHat} titulo="No hay órdenes con este estado" />
      ) : (
        <Tabla>
          <TablaEncabezado>
            <tr>
              <TablaColumna>Orden</TablaColumna>
              <TablaColumna>Producto</TablaColumna>
              <TablaColumna className="text-right">Planificada</TablaColumna>
              <TablaColumna className="text-right">Producida</TablaColumna>
              <TablaColumna className="text-right">Costo insumos</TablaColumna>
              <TablaColumna>Estado</TablaColumna>
              <TablaColumna className="text-right">Acciones</TablaColumna>
            </tr>
          </TablaEncabezado>
          <TablaCuerpo>
            {filas.map(orden => {
              const estado = ESTADOS_ORDEN[orden.estado] ?? { etiqueta: orden.estado, tono: 'neutro' };
              const abierta = orden.estado === 'en_proceso';
              const nombre = orden.Producto?.nombre ?? `Producto #${orden.producto_id}`;
              return (
                <TablaFila key={orden.id}>
                  <TablaCelda>
                    <p className="font-medium">#{orden.id}</p>
                    <p className="text-xs text-muted-foreground">{orden.createdAt ? fechaHoraCorta(orden.createdAt) : orden.fecha}</p>
                  </TablaCelda>
                  <TablaCelda>
                    <p className="font-medium">{nombre}</p>
                    {orden.empleado?.email && <p className="text-xs text-muted-foreground">{orden.empleado.email}</p>}
                  </TablaCelda>
                  <TablaCelda className="text-right tabular-nums">{formatNumber(orden.cantidad_planificada)}</TablaCelda>
                  <TablaCelda className="text-right tabular-nums">
                    {orden.cantidad_producida === null || orden.cantidad_producida === undefined ? '—' : formatNumber(orden.cantidad_producida)}
                  </TablaCelda>
                  <TablaCelda className="text-right tabular-nums">{formatCOP(orden.costo_insumos)}</TablaCelda>
                  <TablaCelda>
                    <StatusBadge tono={estado.tono}>{estado.etiqueta}</StatusBadge>
                  </TablaCelda>
                  <TablaCelda>
                    <div className="flex justify-end gap-1">
                      <Boton variante="fantasma" tamano="icono" onClick={() => onVer(orden)} aria-label={`Ver detalle de la orden #${orden.id}`}>
                        <Eye className="size-4" aria-hidden="true" />
                      </Boton>
                      {abierta && (
                        <>
                          <Boton
                            variante="fantasma"
                            tamano="icono"
                            onClick={() => onFinalizar(orden)}
                            disabled={!puedeEditar}
                            aria-describedby={descritoPor}
                            aria-label={`Finalizar la orden #${orden.id}`}
                            className="text-success hover:bg-success/10"
                          >
                            <CircleCheck className="size-4" aria-hidden="true" />
                          </Boton>
                          <Boton
                            variante="fantasma"
                            tamano="icono"
                            onClick={() => onCancelar(orden)}
                            disabled={!puedeEditar}
                            aria-describedby={descritoPor}
                            aria-label={`Cancelar la orden #${orden.id}`}
                            className="text-destructive hover:bg-destructive/10"
                          >
                            <CircleX className="size-4" aria-hidden="true" />
                          </Boton>
                        </>
                      )}
                    </div>
                  </TablaCelda>
                </TablaFila>
              );
            })}
          </TablaCuerpo>
        </Tabla>
      )}
    </section>
  );
};

export default TablaOrdenes;
