import { useCallback, useEffect, useMemo, useState } from 'react';
import { Croissant, Plus, Receipt, ShoppingBasket, Ticket, Wallet } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { mensajeError } from '../lib/errores';
import { esHoyEnBogota, formatCOP } from '../lib/formato';
import { puedeEscribir } from '../lib/permisos';
import Aviso from '../components/ui/Aviso';
import Boton from '../components/ui/Boton';
import { PageHeader } from '../components/ui/Panel';
import StatCard from '../components/ui/StatCard';
import FormularioProducto from '../components/ventas/FormularioProducto';
import HistorialVentas from '../components/ventas/HistorialVentas';
import PuntoVenta from '../components/ventas/PuntoVenta';

// Panadería con la que trabaja la interfaz (para panadero y gerente el backend usa la del token)
const PANADERIA_ID = 1;
// Se mantiene el contrato actual del POST; el backend ignora este valor y usa el usuario del token
const EMPLEADO_ID = 1;
const ID_AVISO_CONSULTA = 'aviso-modo-consulta-ventas';

const Ventas = () => {
  const { usuario } = useAuth();
  const escribe = puedeEscribir(usuario);

  const [ventas, setVentas] = useState([]);
  const [productos, setProductos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [errorVentas, setErrorVentas] = useState(null);
  const [errorProductos, setErrorProductos] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [mostrarPuntoVenta, setMostrarPuntoVenta] = useState(false);
  const [mostrarFormProducto, setMostrarFormProducto] = useState(false);

  const cargarVentas = useCallback(async () => {
    setErrorVentas(null);
    try {
      const res = await api.get(`/api/ventas?panaderia_id=${PANADERIA_ID}`);
      setVentas(res.data);
    } catch (error) {
      setErrorVentas(mensajeError(error, 'No se pudieron cargar las ventas.'));
    }
  }, []);

  const cargarProductos = useCallback(async () => {
    setErrorProductos(null);
    try {
      const res = await api.get(`/api/ventas/productos?panaderia_id=${PANADERIA_ID}`);
      setProductos(res.data);
    } catch (error) {
      setErrorProductos(mensajeError(error, 'No se pudieron cargar los productos.'));
    }
  }, []);

  // Cada carga gestiona su propio error: si una falla, la otra parte de la pantalla sigue funcionando
  const cargarDatos = useCallback(async () => {
    await Promise.allSettled([cargarVentas(), cargarProductos()]);
    setCargando(false);
  }, [cargarVentas, cargarProductos]);

  useEffect(() => {
    cargarDatos();
  }, [cargarDatos]);

  // Indicadores calculados con datos reales; "hoy" según createdAt en la zona horaria de Bogotá
  const resumen = useMemo(() => {
    const deHoy = ventas.filter(v => v.createdAt && esHoyEnBogota(v.createdAt));
    const total = deHoy.reduce((suma, v) => suma + (Number(v.total) || 0), 0);
    return {
      total,
      transacciones: deHoy.length,
      ticket: deHoy.length > 0 ? total / deHoy.length : null,
      conStock: productos.filter(p => Number(p.cantidad_disponible) > 0).length
    };
  }, [ventas, productos]);

  // Contrato actual del POST /api/ventas. Si falla, PuntoVenta muestra el error y conserva el carrito
  const registrarVenta = async (carrito) => {
    try {
      const res = await api.post('/api/ventas', {
        empleado_id: EMPLEADO_ID,
        panaderia_id: PANADERIA_ID,
        productos: carrito.map(c => ({ producto_id: c.producto_id, cantidad: c.cantidad }))
      });
      setAviso({ tipo: 'exito', texto: `Venta #${res.data.id} registrada por ${formatCOP(res.data.total)}.` });
      await Promise.allSettled([cargarVentas(), cargarProductos()]);
    } catch (error) {
      // Stock insuficiente: se recargan los productos para mostrar el stock real
      if (error?.response?.status === 409) cargarProductos();
      throw error;
    }
  };

  const crearProducto = async (datos) => {
    await api.post('/api/ventas/productos', { ...datos, panaderia_id: PANADERIA_ID });
    setMostrarFormProducto(false);
    setAviso({ tipo: 'exito', texto: `Producto «${datos.nombre}» creado.` });
    await cargarProductos();
  };

  const abrirPuntoVenta = () => {
    setAviso(null);
    setMostrarPuntoVenta(true);
  };

  const abrirFormProducto = () => {
    setAviso(null);
    setMostrarFormProducto(true);
  };

  const sinDatos = (valor, error) => (cargando || error ? '—' : valor);
  const descritoPor = escribe ? undefined : ID_AVISO_CONSULTA;

  return (
    <div className="pansys-ui flex-1 px-4 py-6 md:px-6 lg:px-8 lg:py-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          antetitulo="Módulo"
          titulo="Ventas"
          descripcion="Registra ventas en el punto de venta y consulta el historial de la panadería."
          acciones={
            <>
              <Boton variante="contorno" onClick={abrirFormProducto} disabled={!escribe || mostrarFormProducto} aria-describedby={descritoPor}>
                <Plus className="size-4" aria-hidden="true" />
                Nuevo producto
              </Boton>
              <Boton onClick={abrirPuntoVenta} disabled={!escribe || mostrarPuntoVenta} aria-describedby={descritoPor}>
                <ShoppingBasket className="size-4" aria-hidden="true" />
                Nueva venta
              </Boton>
            </>
          }
        />

        {!escribe && (
          <Aviso tipo="info" id={ID_AVISO_CONSULTA}>
            Modo consulta: tu rol permite ver las ventas, pero no registrar ventas ni crear productos.
          </Aviso>
        )}

        {aviso && (
          <Aviso tipo={aviso.tipo} onCerrar={() => setAviso(null)}>
            {aviso.texto}
          </Aviso>
        )}

        <section aria-label="Resumen de ventas" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard tono="primario" etiqueta="Ventas de hoy" valor={sinDatos(formatCOP(resumen.total), errorVentas)} icono={Wallet} nota="Hora de Bogotá" />
          <StatCard etiqueta="Transacciones de hoy" valor={sinDatos(String(resumen.transacciones), errorVentas)} icono={Receipt} />
          <StatCard
            etiqueta="Ticket promedio de hoy"
            valor={sinDatos(resumen.ticket === null ? '—' : formatCOP(resumen.ticket), errorVentas)}
            icono={Ticket}
          />
          <StatCard
            etiqueta="Productos con stock"
            valor={sinDatos(`${resumen.conStock} de ${productos.length}`, errorProductos)}
            icono={Croissant}
          />
        </section>

        {errorProductos && <Aviso tipo="error" titulo="No se pudieron cargar los productos">{errorProductos}</Aviso>}

        {mostrarFormProducto && (
          <FormularioProducto onGuardar={crearProducto} onCancelar={() => setMostrarFormProducto(false)} />
        )}

        {mostrarPuntoVenta && (
          <PuntoVenta productos={productos} onRegistrar={registrarVenta} onCerrar={() => setMostrarPuntoVenta(false)} />
        )}

        {cargando ? (
          <p role="status" className="rounded-2xl border border-border/80 bg-card px-5 py-10 text-center text-sm text-muted-foreground">
            Cargando ventas…
          </p>
        ) : errorVentas ? (
          <Aviso tipo="error" titulo="No se pudieron cargar las ventas">{errorVentas}</Aviso>
        ) : (
          <HistorialVentas ventas={ventas} />
        )}
      </div>
    </div>
  );
};

export default Ventas;
