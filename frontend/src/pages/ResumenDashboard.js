import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowRight, ChefHat, Croissant, PackageSearch, Receipt, TriangleAlert, Wallet } from 'lucide-react';
import api from '../services/api';
import { cn } from '../lib/utils';
import { mensajeError } from '../lib/errores';
import { esHoyEnBogota, fechaHoraCorta, fechaLarga, formatCOP, formatNumber, saludo } from '../lib/formato';
import Aviso from '../components/ui/Aviso';
import Boton from '../components/ui/Boton';
import EstadoVacio from '../components/ui/EstadoVacio';
import { PageHeader, Panel } from '../components/ui/Panel';
import StatCard from '../components/ui/StatCard';
import StatusBadge from '../components/ui/StatusBadge';
import { Tabla, TablaCelda, TablaColumna, TablaCuerpo, TablaEncabezado, TablaFila } from '../components/ui/Tabla';
import { estadoInsumo } from '../components/inventario/TablaInsumos';

// Panadería con la que trabaja la interfaz (para panadero y gerente el backend usa la del token)
const PANADERIA_ID = 1;

// Endpoints de lectura existentes (permitidos a los tres roles)
const FUENTES = {
  insumos: `/api/inventario?panaderia_id=${PANADERIA_ID}`,
  ventas: `/api/ventas?panaderia_id=${PANADERIA_ID}`,
  productos: `/api/ventas/productos?panaderia_id=${PANADERIA_ID}`,
  ordenes: `/api/produccion/ordenes?panaderia_id=${PANADERIA_ID}`
};

const lineasDe = (venta) => venta.DetalleVenta ?? venta.DetalleVentas ?? [];

const IrA = ({ etiqueta, onClick }) => (
  <Boton variante="fantasma" tamano="sm" onClick={onClick} className="text-primary">
    {etiqueta}
    <ArrowRight className="size-4" aria-hidden="true" />
  </Boton>
);

// Portada del Dashboard: resumen del día con datos reales de inventario, ventas y producción.
// Cada fuente se carga por separado: si una falla, el resto del resumen sigue visible.
const ResumenDashboard = ({ onIrA }) => {
  const [datos, setDatos] = useState({ insumos: null, ventas: null, productos: null, ordenes: null });
  const [errores, setErrores] = useState({});

  const cargar = useCallback(async () => {
    const claves = Object.keys(FUENTES);
    const resultados = await Promise.allSettled(claves.map(c => api.get(FUENTES[c])));
    const nuevosDatos = {};
    const nuevosErrores = {};
    resultados.forEach((r, i) => {
      if (r.status === 'fulfilled') nuevosDatos[claves[i]] = r.value.data;
      else nuevosErrores[claves[i]] = mensajeError(r.reason, 'No se pudo cargar la información.');
    });
    setDatos(d => ({ ...d, ...nuevosDatos }));
    setErrores(nuevosErrores);
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const resumen = useMemo(() => {
    const { insumos, ventas, productos, ordenes } = datos;

    const ventasHoy = ventas ? ventas.filter(v => v.createdAt && esHoyEnBogota(v.createdAt)) : null;
    const alertas = insumos
      ? insumos
          .filter(i => estadoInsumo(i) !== 'disponible')
          .sort((a, b) => (Number(a.cantidad_disponible) || 0) / (Number(a.stock_minimo) || 1) - (Number(b.cantidad_disponible) || 0) / (Number(b.stock_minimo) || 1))
      : null;

    // Más vendidos hoy: suma real de las líneas de las ventas de hoy
    const porProducto = new Map();
    (ventasHoy ?? []).forEach(v => lineasDe(v).forEach(l => {
      const actual = porProducto.get(l.producto_id) ?? { nombre: l.Producto?.nombre ?? `Producto #${l.producto_id}`, unidades: 0, ingresos: 0 };
      actual.unidades += Number(l.cantidad) || 0;
      actual.ingresos += Number(l.subtotal) || 0;
      porProducto.set(l.producto_id, actual);
    }));

    return {
      ventasHoy,
      totalHoy: (ventasHoy ?? []).reduce((s, v) => s + (Number(v.total) || 0), 0),
      alertas,
      agotados: alertas ? alertas.filter(i => estadoInsumo(i) === 'agotado').length : 0,
      productosConStock: productos ? productos.filter(p => Number(p.cantidad_disponible) > 0).length : null,
      enProceso: ordenes ? ordenes.filter(o => o.estado === 'en_proceso') : null,
      finalizadasHoy: ordenes ? ordenes.filter(o => o.estado === 'finalizada' && o.fecha_finalizacion && esHoyEnBogota(o.fecha_finalizacion)).length : 0,
      masVendidos: [...porProducto.values()].sort((a, b) => b.ingresos - a.ingresos).slice(0, 5),
      ultimasVentas: ventas ? ventas.slice(0, 5) : null
    };
  }, [datos]);

  // Valor de un indicador: "—" mientras carga o si su fuente falló
  const valor = (fuente, texto) => (errores[fuente] || datos[fuente] === null ? '—' : texto);

  const fallidas = Object.keys(errores);

  return (
    <div className="pansys-ui flex-1 px-4 py-6 md:px-6 lg:px-8 lg:py-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          antetitulo={fechaLarga()}
          titulo={saludo()}
          descripcion="Así va tu panadería hoy: ventas, producción en curso e insumos que necesitan atención."
        />

        {fallidas.length > 0 && (
          <Aviso tipo="error" titulo="Parte del resumen no está disponible">
            {fallidas.map(f => <p key={f}>{errores[f]}</p>)}
            <Boton variante="contorno" tamano="sm" className="mt-3" onClick={cargar}>Reintentar</Boton>
          </Aviso>
        )}

        <section aria-label="Indicadores del día" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard
            tono="primario"
            etiqueta="Ventas de hoy"
            valor={valor('ventas', formatCOP(resumen.totalHoy))}
            icono={Wallet}
            nota={resumen.ventasHoy ? `${resumen.ventasHoy.length} transacciones · hora de Bogotá` : undefined}
          />
          <StatCard
            etiqueta="Productos con stock"
            valor={valor('productos', `${resumen.productosConStock} de ${datos.productos?.length ?? 0}`)}
            icono={Croissant}
          />
          <StatCard
            etiqueta="Órdenes en proceso"
            valor={valor('ordenes', String(resumen.enProceso?.length ?? 0))}
            icono={ChefHat}
            nota={resumen.enProceso ? `${resumen.finalizadasHoy} finalizadas hoy` : undefined}
          />
          <StatCard
            tono="alerta"
            etiqueta="Alertas de inventario"
            valor={valor('insumos', String(resumen.alertas?.length ?? 0))}
            icono={TriangleAlert}
            nota={resumen.alertas ? `${resumen.agotados} sin existencias · ${resumen.alertas.length - resumen.agotados} con stock bajo` : undefined}
          />
        </section>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
          <Panel
            titulo="Alertas de inventario"
            descripcion="Insumos en su mínimo o por debajo"
            accion={<IrA etiqueta="Ver inventario" onClick={() => onIrA('inventario')} />}
          >
            {!resumen.alertas ? (
              <p className="px-5 pb-5 text-sm text-muted-foreground">{errores.insumos ? 'No disponible.' : 'Cargando…'}</p>
            ) : resumen.alertas.length === 0 ? (
              <EstadoVacio icono={PackageSearch} titulo="Todo en orden" descripcion="Ningún insumo está en su mínimo." />
            ) : (
              <ul aria-label="Insumos con alerta" className="flex flex-col divide-y divide-border/70 px-5 pb-3">
                {resumen.alertas.slice(0, 6).map(i => {
                  const agotado = estadoInsumo(i) === 'agotado';
                  const minimo = Number(i.stock_minimo) || 0;
                  const pct = minimo > 0 ? Math.min(100, ((Number(i.cantidad_disponible) || 0) / minimo) * 100) : 0;
                  return (
                    <li key={i.id} className="flex flex-col gap-2 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{i.nombre}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatNumber(i.cantidad_disponible)} {i.unidad_medida} de {formatNumber(minimo)} {i.unidad_medida} mínimo
                          </p>
                        </div>
                        <StatusBadge tono={agotado ? 'peligro' : 'alerta'}>{agotado ? 'Sin existencias' : 'Stock bajo'}</StatusBadge>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                        <div className={cn('h-full rounded-full', agotado ? 'bg-destructive' : 'bg-warning')} style={{ width: `${Math.max(pct, 3)}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <Panel
            titulo="Órdenes en proceso"
            descripcion="Producción pendiente de finalizar"
            accion={<IrA etiqueta="Ver producción" onClick={() => onIrA('produccion')} />}
          >
            {!resumen.enProceso ? (
              <p className="px-5 pb-5 text-sm text-muted-foreground">{errores.ordenes ? 'No disponible.' : 'Cargando…'}</p>
            ) : resumen.enProceso.length === 0 ? (
              <EstadoVacio icono={ChefHat} titulo="Sin órdenes en proceso" />
            ) : (
              <ul aria-label="Órdenes en proceso" className="flex flex-col gap-3 px-5 pb-5">
                {resumen.enProceso.slice(0, 5).map(o => (
                  <li key={o.id} className="flex items-center gap-3 rounded-xl border border-border/70 bg-background/60 p-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <ChefHat className="size-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{o.Producto?.nombre ?? `Producto #${o.producto_id}`}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        #{o.id} · {formatNumber(o.cantidad_planificada)} und{o.createdAt ? ` · ${fechaHoraCorta(o.createdAt)}` : ''}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel titulo="Más vendidos hoy" descripcion="Por ingresos de las ventas de hoy" className="lg:col-span-2 xl:col-span-1">
            {!resumen.ventasHoy ? (
              <p className="px-5 pb-5 text-sm text-muted-foreground">{errores.ventas ? 'No disponible.' : 'Cargando…'}</p>
            ) : resumen.masVendidos.length === 0 ? (
              <EstadoVacio icono={Receipt} titulo="Aún no hay ventas hoy" />
            ) : (
              <ol aria-label="Más vendidos hoy" className="flex flex-col gap-1 px-3 pb-4">
                {resumen.masVendidos.map((p, i) => (
                  <li key={p.nombre} className="flex items-center gap-3 rounded-xl px-2 py-2">
                    <span className="w-4 text-center text-xs font-semibold text-muted-foreground">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{p.nombre}</p>
                      <p className="text-xs text-muted-foreground">{formatNumber(p.unidades)} und</p>
                    </div>
                    <p className="text-sm font-semibold tabular-nums">{formatCOP(p.ingresos)}</p>
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>

        <Panel
          titulo="Últimas ventas"
          descripcion="Las 5 ventas más recientes"
          accion={<IrA etiqueta="Ver ventas" onClick={() => onIrA('ventas')} />}
        >
          {!resumen.ultimasVentas ? (
            <p className="px-5 pb-5 text-sm text-muted-foreground">{errores.ventas ? 'No disponible.' : 'Cargando…'}</p>
          ) : resumen.ultimasVentas.length === 0 ? (
            <EstadoVacio icono={Receipt} titulo="Aún no hay ventas registradas" />
          ) : (
            <div className="pb-2">
              <Tabla aria-label="Últimas ventas">
                <TablaEncabezado>
                  <tr>
                    <TablaColumna>Venta</TablaColumna>
                    <TablaColumna>Fecha y hora</TablaColumna>
                    <TablaColumna className="text-right">Unidades</TablaColumna>
                    <TablaColumna className="text-right">Total</TablaColumna>
                  </tr>
                </TablaEncabezado>
                <TablaCuerpo>
                  {resumen.ultimasVentas.map(v => (
                    <TablaFila key={v.id}>
                      <TablaCelda className="font-medium">#{v.id}</TablaCelda>
                      <TablaCelda className="text-muted-foreground">{v.createdAt ? fechaHoraCorta(v.createdAt) : v.fecha}</TablaCelda>
                      <TablaCelda className="text-right tabular-nums">
                        {formatNumber(lineasDe(v).reduce((s, l) => s + (Number(l.cantidad) || 0), 0))}
                      </TablaCelda>
                      <TablaCelda className="text-right font-medium tabular-nums">{formatCOP(v.total)}</TablaCelda>
                    </TablaFila>
                  ))}
                </TablaCuerpo>
              </Tabla>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
};

export default ResumenDashboard;
