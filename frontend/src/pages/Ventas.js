import { useState, useEffect } from 'react';
import api from '../services/api';

const Ventas = () => {
  const [ventas, setVentas] = useState([]);
  const [productos, setProductos] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [mostrarFormProducto, setMostrarFormProducto] = useState(false);
  const [carrito, setCarrito] = useState([]);
  const [formProducto, setFormProducto] = useState({
    nombre: '', precio_compra: '', precio_venta: '',
    cantidad_disponible: '', panaderia_id: 1
  });

  useEffect(() => {
    cargarDatos();
  }, []);

  const cargarDatos = async () => {
    try {
      const [ventasRes, productosRes] = await Promise.all([
        api.get('/api/ventas?panaderia_id=1'),
        api.get('/api/ventas/productos?panaderia_id=1')
      ]);
      setVentas(ventasRes.data);
      setProductos(productosRes.data);
    } catch (error) {
      console.error(error);
    } finally {
      setCargando(false);
    }
  };

  const agregarAlCarrito = (producto) => {
    const existe = carrito.find(c => c.producto_id === producto.id);
    if (existe) {
      setCarrito(carrito.map(c =>
        c.producto_id === producto.id
          ? { ...c, cantidad: c.cantidad + 1 }
          : c
      ));
    } else {
      setCarrito([...carrito, {
        producto_id: producto.id,
        nombre: producto.nombre,
        precio: producto.precio_venta,
        cantidad: 1
      }]);
    }
  };

  const quitarDelCarrito = (producto_id) => {
    setCarrito(carrito.filter(c => c.producto_id !== producto_id));
  };

  const totalCarrito = carrito.reduce((acc, c) => acc + c.precio * c.cantidad, 0);

  const registrarVenta = async () => {
    if (carrito.length === 0) return;
    try {
      await api.post('/api/ventas', {
        empleado_id: 1,
        panaderia_id: 1,
        productos: carrito.map(c => ({
          producto_id: c.producto_id,
          cantidad: c.cantidad
        }))
      });
      setCarrito([]);
      setMostrarForm(false);
      cargarDatos();
      alert('✅ Venta registrada correctamente');
    } catch (error) {
      console.error(error);
    }
  };

  const crearProducto = async (e) => {
    e.preventDefault();
    try {
      await api.post('/api/ventas/productos', formProducto);
      setMostrarFormProducto(false);
      setFormProducto({
        nombre: '', precio_compra: '', precio_venta: '',
        cantidad_disponible: '', panaderia_id: 1
      });
      cargarDatos();
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <div>
      <div style={styles.header}>
        <h2 style={styles.titulo}>🛒 Ventas</h2>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button style={styles.btnSecundario}
            onClick={() => setMostrarFormProducto(!mostrarFormProducto)}>
            + Nuevo producto
          </button>
          <button style={styles.btnNuevo}
            onClick={() => setMostrarForm(!mostrarForm)}>
            + Nueva venta
          </button>
        </div>
      </div>

      {/* Formulario nuevo producto */}
      {mostrarFormProducto && (
        <div style={styles.form}>
          <h3 style={styles.formTitulo}>Nuevo producto</h3>
          <form onSubmit={crearProducto}>
            <div style={styles.formGrid}>
              <div style={styles.inputGroup}>
                <label style={styles.label}>Nombre</label>
                <input style={styles.input} value={formProducto.nombre}
                  onChange={e => setFormProducto({...formProducto, nombre: e.target.value})}
                  placeholder="Ej: Pan dulce" required />
              </div>
              <div style={styles.inputGroup}>
                <label style={styles.label}>Precio compra</label>
                <input style={styles.input} type="number" value={formProducto.precio_compra}
                  onChange={e => setFormProducto({...formProducto, precio_compra: e.target.value})}
                  placeholder="0" required />
              </div>
              <div style={styles.inputGroup}>
                <label style={styles.label}>Precio venta</label>
                <input style={styles.input} type="number" value={formProducto.precio_venta}
                  onChange={e => setFormProducto({...formProducto, precio_venta: e.target.value})}
                  placeholder="0" required />
              </div>
              <div style={styles.inputGroup}>
                <label style={styles.label}>Cantidad disponible</label>
                <input style={styles.input} type="number" value={formProducto.cantidad_disponible}
                  onChange={e => setFormProducto({...formProducto, cantidad_disponible: e.target.value})}
                  placeholder="0" required />
              </div>
            </div>
            <button style={styles.btnGuardar} type="submit">
              💾 Guardar producto
            </button>
          </form>
        </div>
      )}

      {/* Formulario nueva venta */}
      {mostrarForm && (
        <div style={styles.form}>
          <h3 style={styles.formTitulo}>Nueva venta</h3>
          <div style={styles.ventaGrid}>
            <div>
              <h4 style={{ color: '#0d2b5e' }}>Productos disponibles</h4>
              <div style={styles.productosGrid}>
                {productos.map(p => (
                  <div key={p.id} style={styles.productoCard}
                    onClick={() => agregarAlCarrito(p)}>
                    <p style={styles.productoNombre}>{p.nombre}</p>
                    <p style={styles.productoPrecio}>${p.precio_venta?.toLocaleString()}</p>
                    <p style={styles.productoStock}>Stock: {p.cantidad_disponible}</p>
                  </div>
                ))}
              </div>
            </div>

            <div style={styles.carrito}>
              <h4 style={{ color: '#0d2b5e' }}>🛒 Carrito</h4>
              {carrito.length === 0 ? (
                <p style={{ color: '#888', fontSize: '14px' }}>
                  Selecciona productos
                </p>
              ) : (
                <>
                  {carrito.map(c => (
                    <div key={c.producto_id} style={styles.carritoItem}>
                      <span style={{ fontSize: '13px' }}>{c.nombre}</span>
                      <span style={{ fontSize: '13px' }}>x{c.cantidad}</span>
                      <span style={{ fontSize: '13px', fontWeight: 'bold' }}>
                        ${(c.precio * c.cantidad).toLocaleString()}
                      </span>
                      <button style={styles.btnQuitar}
                        onClick={() => quitarDelCarrito(c.producto_id)}>✕</button>
                    </div>
                  ))}
                  <div style={styles.total}>
                    <strong>Total: ${totalCarrito.toLocaleString()}</strong>
                  </div>
                  <button style={styles.btnRegistrar} onClick={registrarVenta}>
                    ✅ Registrar venta
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Lista de ventas */}
      {cargando ? (
        <p>Cargando ventas...</p>
      ) : (
        <div style={styles.tabla}>
          <table style={styles.table}>
            <thead>
              <tr style={styles.thead}>
                <th style={styles.th}>#</th>
                <th style={styles.th}>Fecha</th>
                <th style={styles.th}>Total</th>
                <th style={styles.th}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {ventas.length === 0 ? (
                <tr>
                  <td colSpan="4" style={styles.vacio}>
                    No hay ventas registradas
                  </td>
                </tr>
              ) : (
                ventas.map(v => (
                  <tr key={v.id} style={styles.tr}>
                    <td style={styles.td}>#{v.id}</td>
                    <td style={styles.td}>{v.fecha}</td>
                    <td style={styles.td}>
                      <strong>${v.total?.toLocaleString()}</strong>
                    </td>
                    <td style={styles.td}>
                      <span style={{
                        background: '#dcfce7', color: '#166534',
                        padding: '4px 10px', borderRadius: '20px', fontSize: '12px'
                      }}>
                        ✅ {v.estado}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const styles = {
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' },
  titulo: { color: '#0d2b5e', margin: 0 },
  btnNuevo: { padding: '10px 20px', background: '#1168bd', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' },
  btnSecundario: { padding: '10px 20px', background: '#0f6e56', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' },
  form: { background: '#fff', borderRadius: '12px', padding: '24px', marginBottom: '24px', boxShadow: '0 2px 12px rgba(0,0,0,0.08)' },
  formTitulo: { color: '#0d2b5e', marginTop: 0 },
  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '16px' },
  inputGroup: { display: 'flex', flexDirection: 'column' },
  label: { fontSize: '13px', fontWeight: 'bold', color: '#334', marginBottom: '6px' },
  input: { padding: '10px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px' },
  btnGuardar: { padding: '10px 24px', background: '#0f6e56', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' },
  ventaGrid: { display: 'grid', gridTemplateColumns: '1fr 300px', gap: '24px' },
  productosGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginTop: '12px' },
  productoCard: { background: '#f4f7fc', borderRadius: '8px', padding: '16px', cursor: 'pointer', border: '2px solid transparent', textAlign: 'center' },
  productoNombre: { fontWeight: 'bold', color: '#0d2b5e', margin: '0 0 8px 0', fontSize: '14px' },
  productoPrecio: { color: '#1168bd', fontWeight: 'bold', margin: '0 0 4px 0' },
  productoStock: { color: '#888', fontSize: '12px', margin: 0 },
  carrito: { background: '#f4f7fc', borderRadius: '8px', padding: '16px' },
  carritoItem: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #e0e0e0' },
  btnQuitar: { background: '#fee2e2', border: 'none', borderRadius: '4px', padding: '2px 6px', cursor: 'pointer', color: '#991b1b' },
  total: { padding: '12px 0', fontSize: '16px', color: '#0d2b5e', textAlign: 'right' },
  btnRegistrar: { width: '100%', padding: '12px', background: '#1168bd', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '15px' },
  tabla: { background: '#fff', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.08)' },
  table: { width: '100%', borderCollapse: 'collapse' },
  thead: { background: '#0d2b5e' },
  th: { padding: '14px 16px', color: '#fff', textAlign: 'left', fontSize: '13px' },
  tr: { borderBottom: '1px solid #f0f0f0' },
  td: { padding: '14px 16px', fontSize: '14px', color: '#334' },
  vacio: { textAlign: 'center', padding: '40px', color: '#888' }
};

export default Ventas;