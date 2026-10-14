import { useMemo, useState } from 'react';
import { PackageSearch, Pencil, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { formatCOP, formatNumber } from '../../lib/formato';
import { estiloControl } from '../ui/Campo';
import Boton from '../ui/Boton';
import EstadoVacio from '../ui/EstadoVacio';
import StatusBadge from '../ui/StatusBadge';
import { Tabla, TablaCelda, TablaColumna, TablaCuerpo, TablaEncabezado, TablaFila } from '../ui/Tabla';

// Estado de un insumo con los campos reales del backend. "Stock bajo" + "Sin existencias"
// es el mismo conjunto que devuelve GET /api/inventario/stock-bajo (cantidad <= mínimo).
export const estadoInsumo = (insumo) => {
  const cantidad = Number(insumo.cantidad_disponible) || 0;
  if (cantidad <= 0) return 'agotado';
  if (cantidad <= (Number(insumo.stock_minimo) || 0)) return 'bajo';
  return 'disponible';
};

const ESTADOS = {
  disponible: { etiqueta: 'Disponible', tono: 'exito', barra: 'bg-success' },
  bajo: { etiqueta: 'Stock bajo', tono: 'alerta', barra: 'bg-warning' },
  agotado: { etiqueta: 'Sin existencias', tono: 'peligro', barra: 'bg-destructive' }
};

const FILTROS = [
  { valor: 'todos', etiqueta: 'Todos' },
  { valor: 'disponible', etiqueta: 'Disponibles' },
  { valor: 'bajo', etiqueta: 'Stock bajo' },
  { valor: 'agotado', etiqueta: 'Sin existencias' }
];

// Minúsculas y sin tildes, para buscar "azucar" y encontrar "Azúcar"
const normalizar = (texto) => String(texto ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Nivel respecto al doble del mínimo (como en el diseño de v0)
const porcentajeNivel = (insumo) => {
  const cantidad = Number(insumo.cantidad_disponible) || 0;
  const minimo = Number(insumo.stock_minimo) || 0;
  if (minimo <= 0) return cantidad > 0 ? 100 : 0;
  return Math.min(100, (cantidad / (minimo * 2)) * 100);
};

const TablaInsumos = ({ insumos, puedeEditar, descritoPor, onEditar, onEliminar }) => {
  const [filtro, setFiltro] = useState('todos');
  const [busqueda, setBusqueda] = useState('');

  const conteos = useMemo(() => {
    const c = { todos: insumos.length, disponible: 0, bajo: 0, agotado: 0 };
    insumos.forEach(i => { c[estadoInsumo(i)] += 1; });
    return c;
  }, [insumos]);

  const filas = useMemo(() => {
    const texto = normalizar(busqueda.trim());
    return insumos.filter(i =>
      (filtro === 'todos' || estadoInsumo(i) === filtro) &&
      (!texto || normalizar(i.nombre).includes(texto) || normalizar(i.unidad_medida).includes(texto))
    );
  }, [insumos, filtro, busqueda]);

  if (insumos.length === 0) {
    return (
      <section className="rounded-2xl border border-border/80 bg-card shadow-panel">
        <EstadoVacio
          icono={PackageSearch}
          titulo="Aún no hay insumos registrados"
          descripcion="Registra tu primera materia prima para empezar a controlar las existencias."
        />
      </section>
    );
  }

  return (
    <section aria-label="Insumos" className="rounded-2xl border border-border/80 bg-card shadow-panel">
      <div className="flex flex-col gap-3 border-b border-border/70 p-4 md:flex-row md:items-center md:justify-between">
        <div role="group" aria-label="Filtrar por estado" className="flex flex-wrap gap-1.5">
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
        <label className="relative md:w-72">
          <span className="sr-only">Buscar insumo por nombre o unidad</span>
          <PackageSearch
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            type="search"
            value={busqueda}
            onChange={e => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre o unidad…"
            className={cn(estiloControl, 'h-9 pl-9')}
          />
        </label>
      </div>

      <p className="sr-only" aria-live="polite">{`${filas.length} insumos en la lista`}</p>

      {filas.length === 0 ? (
        <EstadoVacio
          icono={PackageSearch}
          titulo="No encontramos insumos"
          descripcion="Prueba con otro nombre o cambia el filtro de estado."
        />
      ) : (
        <Tabla>
          <TablaEncabezado>
            <tr>
              <TablaColumna>Insumo</TablaColumna>
              <TablaColumna>Existencias</TablaColumna>
              <TablaColumna className="text-right">Stock mínimo</TablaColumna>
              <TablaColumna className="text-right">Precio unitario</TablaColumna>
              <TablaColumna>Estado</TablaColumna>
              <TablaColumna className="text-right">Acciones</TablaColumna>
            </tr>
          </TablaEncabezado>
          <TablaCuerpo>
            {filas.map(insumo => {
              const estado = ESTADOS[estadoInsumo(insumo)];
              return (
                <TablaFila key={insumo.id}>
                  <TablaCelda>
                    <p className="font-medium">{insumo.nombre}</p>
                    <p className="text-xs text-muted-foreground">Unidad: {insumo.unidad_medida}</p>
                  </TablaCelda>
                  <TablaCelda>
                    <p className="font-medium tabular-nums">
                      {formatNumber(insumo.cantidad_disponible)} <span className="text-muted-foreground">{insumo.unidad_medida}</span>
                    </p>
                    <div className="mt-1.5 h-1 w-24 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                      <div className={cn('h-full rounded-full', estado.barra)} style={{ width: `${Math.max(porcentajeNivel(insumo), 2)}%` }} />
                    </div>
                  </TablaCelda>
                  <TablaCelda className="text-right tabular-nums">
                    {formatNumber(insumo.stock_minimo)} <span className="text-muted-foreground">{insumo.unidad_medida}</span>
                  </TablaCelda>
                  <TablaCelda className="text-right tabular-nums">{formatCOP(insumo.precio_unitario)}</TablaCelda>
                  <TablaCelda>
                    <StatusBadge tono={estado.tono}>{estado.etiqueta}</StatusBadge>
                  </TablaCelda>
                  <TablaCelda>
                    <div className="flex justify-end gap-1">
                      <Boton
                        variante="fantasma"
                        tamano="icono"
                        onClick={() => onEditar(insumo)}
                        disabled={!puedeEditar}
                        aria-describedby={descritoPor}
                        aria-label={`Editar ${insumo.nombre}`}
                      >
                        <Pencil className="size-4" aria-hidden="true" />
                      </Boton>
                      <Boton
                        variante="fantasma"
                        tamano="icono"
                        onClick={() => onEliminar(insumo)}
                        disabled={!puedeEditar}
                        aria-describedby={descritoPor}
                        aria-label={`Eliminar ${insumo.nombre}`}
                        className="text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </Boton>
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

export default TablaInsumos;
