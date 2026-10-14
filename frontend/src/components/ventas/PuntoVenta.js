import { useRef, useState } from 'react';
import { Minus, Plus, ShoppingBasket, Trash2, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { formatCOP } from '../../lib/formato';
import { mensajeError } from '../../lib/errores';
import Aviso from '../ui/Aviso';
import Boton from '../ui/Boton';
import EstadoVacio from '../ui/EstadoVacio';
import { Panel } from '../ui/Panel';

const stockDe = (producto) => Math.max(Number(producto?.cantidad_disponible) || 0, 0);

// Punto de venta: catálogo de productos y carrito. El total que se muestra es orientativo;
// el total real lo calcula el backend. Nunca permite pedir más unidades que el stock conocido.
const PuntoVenta = ({ productos, onRegistrar, onCerrar }) => {
  const [carrito, setCarrito] = useState([]); // [{ producto_id, cantidad }]
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);
  const enviandoRef = useRef(false);

  const productoPorId = new Map(productos.map(p => [p.id, p]));
  const cantidadEnCarrito = (id) => carrito.find(l => l.producto_id === id)?.cantidad ?? 0;

  const lineas = carrito.map(l => {
    const producto = productoPorId.get(l.producto_id);
    const precio = Number(producto?.precio_venta) || 0;
    return { ...l, producto, precio, stock: stockDe(producto), subtotal: precio * l.cantidad };
  });
  const total = lineas.reduce((suma, l) => suma + l.subtotal, 0);

  const cambiarCantidad = (id, diferencia) => {
    setError(null);
    setCarrito(actual => {
      const existente = actual.find(l => l.producto_id === id);
      const nueva = (existente?.cantidad ?? 0) + diferencia;
      if (nueva > stockDe(productoPorId.get(id))) return actual;
      if (nueva <= 0) return actual.filter(l => l.producto_id !== id);
      if (!existente) return [...actual, { producto_id: id, cantidad: nueva }];
      return actual.map(l => (l.producto_id === id ? { ...l, cantidad: nueva } : l));
    });
  };

  const quitar = (id) => setCarrito(actual => actual.filter(l => l.producto_id !== id));

  const registrar = async () => {
    // La referencia frena un segundo clic antes de que React vuelva a pintar el botón deshabilitado
    if (enviandoRef.current || carrito.length === 0) return;
    enviandoRef.current = true;
    setEnviando(true);
    setError(null);
    try {
      await onRegistrar(carrito);
      setCarrito([]);
    } catch (err) {
      // El carrito se conserva para que el usuario ajuste las cantidades (p. ej. tras un 409)
      setError(mensajeError(err, 'No se pudo registrar la venta.'));
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  };

  return (
    <Panel
      titulo="Nueva venta"
      descripcion="Elige los productos y registra la venta. El stock se descuenta al confirmar."
      accion={
        <Boton variante="fantasma" tamano="icono" onClick={onCerrar} disabled={enviando} aria-label="Cerrar punto de venta">
          <X className="size-4" aria-hidden="true" />
        </Boton>
      }
    >
      <div className="grid grid-cols-1 gap-6 px-5 pb-5 lg:grid-cols-[1fr_340px]">
        <section aria-label="Productos disponibles">
          {productos.length === 0 ? (
            <EstadoVacio
              icono={ShoppingBasket}
              titulo="No hay productos"
              descripcion="Crea un producto para empezar a vender."
            />
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {productos.map(producto => {
                const stock = stockDe(producto);
                const agotado = stock === 0;
                const alMaximo = !agotado && cantidadEnCarrito(producto.id) >= stock;
                return (
                  <li key={producto.id}>
                    <button
                      type="button"
                      onClick={() => cambiarCantidad(producto.id, 1)}
                      disabled={agotado || alMaximo || enviando}
                      aria-label={`Añadir ${producto.nombre}`}
                      className={cn(
                        'flex w-full flex-col gap-1 rounded-xl border border-border bg-background/60 p-4 text-left transition-colors',
                        'hover:border-primary/40 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        'disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border disabled:hover:bg-background/60'
                      )}
                    >
                      <span className="font-medium">{producto.nombre}</span>
                      <span className="font-semibold tabular-nums text-primary">{formatCOP(producto.precio_venta)}</span>
                      <span className={cn('text-xs', agotado ? 'font-medium text-destructive' : 'text-muted-foreground')}>
                        {agotado ? 'Sin stock' : `Stock: ${stock}`}
                        {alMaximo && ' · todo en el carrito'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section aria-label="Carrito" className="flex flex-col gap-3 rounded-xl border border-border bg-secondary/40 p-4">
          <h3 className="text-sm font-semibold">Carrito</h3>
          {lineas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Selecciona productos para agregarlos.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border/70">
              {lineas.map(l => {
                const nombre = l.producto?.nombre ?? `Producto #${l.producto_id}`;
                const excede = l.cantidad > l.stock;
                return (
                  <li key={l.producto_id} className="flex flex-col gap-2 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{nombre}</p>
                        <p className="text-xs text-muted-foreground tabular-nums">{formatCOP(l.precio)} c/u</p>
                      </div>
                      <p className="text-sm font-semibold tabular-nums">{formatCOP(l.subtotal)}</p>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1">
                        <Boton
                          variante="contorno"
                          tamano="icono"
                          className="size-8"
                          onClick={() => cambiarCantidad(l.producto_id, -1)}
                          disabled={l.cantidad <= 1 || enviando}
                          aria-label={`Quitar una unidad de ${nombre}`}
                        >
                          <Minus className="size-3.5" aria-hidden="true" />
                        </Boton>
                        <span className="w-8 text-center text-sm font-semibold tabular-nums" aria-label={`Cantidad de ${nombre}`}>
                          {l.cantidad}
                        </span>
                        <Boton
                          variante="contorno"
                          tamano="icono"
                          className="size-8"
                          onClick={() => cambiarCantidad(l.producto_id, 1)}
                          disabled={l.cantidad >= l.stock || enviando}
                          aria-label={`Añadir una unidad de ${nombre}`}
                        >
                          <Plus className="size-3.5" aria-hidden="true" />
                        </Boton>
                      </div>
                      <Boton
                        variante="fantasma"
                        tamano="icono"
                        className="size-8 text-destructive hover:bg-destructive/10"
                        onClick={() => quitar(l.producto_id)}
                        disabled={enviando}
                        aria-label={`Quitar ${nombre} del carrito`}
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      </Boton>
                    </div>
                    {excede ? (
                      <p className="text-xs font-medium text-destructive">Solo quedan {l.stock} disponibles: reduce la cantidad.</p>
                    ) : l.cantidad >= l.stock && (
                      <p className="text-xs text-muted-foreground">Máximo disponible: {l.stock}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {error && <Aviso tipo="error">{error}</Aviso>}

          <div className="mt-auto flex items-center justify-between border-t border-border pt-3">
            <span className="text-sm text-muted-foreground">Total</span>
            <span className="font-serif text-xl font-semibold tabular-nums" aria-label="Total de la venta">{formatCOP(total)}</span>
          </div>
          <Boton onClick={registrar} cargando={enviando} disabled={lineas.length === 0} className="w-full">
            Registrar venta
          </Boton>
        </section>
      </div>
    </Panel>
  );
};

export default PuntoVenta;
