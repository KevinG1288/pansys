import { useMemo, useState } from 'react';
import { Croissant, PackageSearch, Pencil } from 'lucide-react';
import { cn } from '../../lib/utils';
import { formatCOP, formatNumber } from '../../lib/formato';
import { estiloControl } from '../ui/Campo';
import Boton from '../ui/Boton';
import EstadoVacio from '../ui/EstadoVacio';
import { Panel } from '../ui/Panel';
import StatusBadge from '../ui/StatusBadge';
import { Tabla, TablaCelda, TablaColumna, TablaCuerpo, TablaEncabezado, TablaFila } from '../ui/Tabla';

// Minúsculas y sin tildes, para buscar "cafe" y encontrar "Café"
const normalizar = (texto) => String(texto ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Productos activos de la panadería (GET /api/ventas/productos) con la acción de editar (RF-13).
// Las existencias solo se muestran: cambian con las ventas y la producción.
const TablaProductos = ({ productos, puedeEditar, descritoPor, onEditar }) => {
  const [busqueda, setBusqueda] = useState('');

  const filas = useMemo(() => {
    const texto = normalizar(busqueda.trim());
    return [...productos]
      .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'))
      .filter(p => !texto || normalizar(p.nombre).includes(texto));
  }, [productos, busqueda]);

  return (
    <Panel titulo="Productos" descripcion="Productos a la venta en tu panadería. Edita el nombre y los precios; las existencias cambian con ventas y producción.">
      {productos.length === 0 ? (
        <EstadoVacio icono={Croissant} titulo="Aún no hay productos registrados" descripcion="Crea un producto para venderlo en el punto de venta." />
      ) : (
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-4 pb-4">
            <label className="relative w-full md:w-72">
              <span className="sr-only">Buscar producto por nombre</span>
              <PackageSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input
                type="search"
                value={busqueda}
                onChange={e => setBusqueda(e.target.value)}
                placeholder="Buscar producto…"
                className={cn(estiloControl, 'h-9 pl-9')}
              />
            </label>
            <span className="text-xs text-muted-foreground">{filas.length} de {productos.length} productos</span>
          </div>

          {filas.length === 0 ? (
            <EstadoVacio icono={PackageSearch} titulo="No encontramos productos" descripcion="Prueba con otro nombre.">
              <Boton variante="contorno" onClick={() => setBusqueda('')}>Limpiar búsqueda</Boton>
            </EstadoVacio>
          ) : (
            <Tabla aria-label="Productos de la panadería">
              <TablaEncabezado>
                <tr>
                  <TablaColumna>Producto</TablaColumna>
                  <TablaColumna className="text-right">Precio de compra</TablaColumna>
                  <TablaColumna className="text-right">Precio de venta</TablaColumna>
                  <TablaColumna className="text-right">Existencias</TablaColumna>
                  <TablaColumna className="text-right">Acciones</TablaColumna>
                </tr>
              </TablaEncabezado>
              <TablaCuerpo>
                {filas.map(producto => {
                  const existencias = Number(producto.cantidad_disponible) || 0;
                  return (
                    <TablaFila key={producto.id}>
                      <TablaCelda className="font-medium">{producto.nombre}</TablaCelda>
                      <TablaCelda className="text-right tabular-nums">{formatCOP(producto.precio_compra)}</TablaCelda>
                      <TablaCelda className="text-right font-medium tabular-nums">{formatCOP(producto.precio_venta)}</TablaCelda>
                      <TablaCelda className="text-right tabular-nums">
                        {existencias > 0 ? formatNumber(existencias) : <StatusBadge tono="peligro">Sin existencias</StatusBadge>}
                      </TablaCelda>
                      <TablaCelda>
                        <div className="flex justify-end">
                          <Boton
                            variante="fantasma"
                            tamano="icono"
                            onClick={() => onEditar(producto)}
                            disabled={!puedeEditar}
                            aria-describedby={descritoPor}
                            aria-label={`Editar ${producto.nombre}`}
                          >
                            <Pencil className="size-4" aria-hidden="true" />
                          </Boton>
                        </div>
                      </TablaCelda>
                    </TablaFila>
                  );
                })}
              </TablaCuerpo>
            </Tabla>
          )}
        </div>
      )}
    </Panel>
  );
};

export default TablaProductos;
