import { useState, useEffect } from 'react';
import api from '../services/api';

const Inventario = () => {
  const [items, setItems] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [form, setForm] = useState({
    nombre: '', unidad_medida: '', cantidad_disponible: '',
    stock_minimo: '', precio_unitario: '', panaderia_id: 1
  });

  useEffect(() => {
    cargarInventario();
  }, []);

  const cargarInventario = async () => {
    try {
      const res = await api.get('/api/inventario?panaderia_id=1');
      setItems(res.data);
    } catch (error) {
      console.error('Error cargando inventario:', error);
    } finally {
      setCargando(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/api/inventario', form);
      setMostrarForm(false);
      setForm({
        nombre: '', unidad_medida: '', cantidad_disponible: '',
        stock_minimo: '', precio_unitario: '', panaderia_id: 1
      });
      cargarInventario();
    } catch (error) {
      console.error('Error creando item:', error);
    }
  };

  const handleEliminar = async (id) => {
    if (window.confirm('¿Eliminar este insumo?')) {
      await api.delete(`/api/inventario/${id}`);
      cargarInventario();
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.titulo}>📦 Inventario de Materia Prima</h2>
        <button style={styles.btnNuevo} onClick={() => setMostrarForm(!mostrarForm)}>
          {mostrarForm ? '✕ Cancelar' : '+ Nuevo insumo'}
        </button>
      </div>

      {mostrarForm && (
        <div style={styles.form}>
          <h3 style={styles.formTitulo}>Nuevo insumo</h3>
          <form onSubmit={handleSubmit}>
            <div style={styles.formGrid}>
              <div style={styles.inputGroup}>
                <label style={styles.label}>Nombre</label>
                <input style={styles.input} value={form.nombre}
                  onChange={e => setForm({...form, nombre: e.target.value})}
                  placeholder="Ej: Harina de trigo" required />
              </div>
              <div style={styles.inputGroup}>
                <label style={styles.label}>Unidad de medida</label>
                <input style={styles.input} value={form.unidad_medida}
                  onChange={e => setForm({...form, unidad_medida: e.target.value})}
                  placeholder="Ej: kg, litros, unidades" required />
              </div>
              <div style={styles.inputGroup}>
                <label style={styles.label}>Cantidad disponible</label>
                <input style={styles.input} type="number" value={form.cantidad_disponible}
                  onChange={e => setForm({...form, cantidad_disponible: e.target.value})}
                  placeholder="0" required />
              </div>
              <div style={styles.inputGroup}>
                <label style={styles.label}>Stock mínimo</label>
                <input style={styles.input} type="number" value={form.stock_minimo}
                  onChange={e => setForm({...form, stock_minimo: e.target.value})}
                  placeholder="0" required />
              </div>
              <div style={styles.inputGroup}>
                <label style={styles.label}>Precio unitario</label>
                <input style={styles.input} type="number" value={form.precio_unitario}
                  onChange={e => setForm({...form, precio_unitario: e.target.value})}
                  placeholder="0" required />
              </div>
            </div>
            <button style={styles.btnGuardar} type="submit">
              💾 Guardar insumo
            </button>
          </form>
        </div>
      )}

      {cargando ? (
        <p style={styles.cargando}>Cargando inventario...</p>
      ) : (
        <div style={styles.tabla}>
          <table style={styles.table}>
            <thead>
              <tr style={styles.thead}>
                <th style={styles.th}>Nombre</th>
                <th style={styles.th}>Unidad</th>
                <th style={styles.th}>Disponible</th>
                <th style={styles.th}>Stock mínimo</th>
                <th style={styles.th}>Precio unitario</th>
                <th style={styles.th}>Estado</th>
                <th style={styles.th}>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan="7" style={styles.vacio}>
                    No hay insumos registrados
                  </td>
                </tr>
              ) : (
                items.map(item => (
                  <tr key={item.id} style={styles.tr}>
                    <td style={styles.td}>{item.nombre}</td>
                    <td style={styles.td}>{item.unidad_medida}</td>
                    <td style={styles.td}>
                      <span style={{
                        color: item.cantidad_disponible <= item.stock_minimo ? 'red' : 'green',
                        fontWeight: 'bold'
                      }}>
                        {item.cantidad_disponible}
                      </span>
                    </td>
                    <td style={styles.td}>{item.stock_minimo}</td>
                    <td style={styles.td}>${item.precio_unitario?.toLocaleString()}</td>
                    <td style={styles.td}>
                      <span style={{
                        background: item.cantidad_disponible <= item.stock_minimo ? '#fee2e2' : '#dcfce7',
                        color: item.cantidad_disponible <= item.stock_minimo ? '#991b1b' : '#166534',
                        padding: '4px 10px', borderRadius: '20px', fontSize: '12px'
                      }}>
                        {item.cantidad_disponible <= item.stock_minimo ? '⚠️ Stock bajo' : '✅ Normal'}
                      </span>
                    </td>
                    <td style={styles.td}>
                      <button style={styles.btnEliminar}
                        onClick={() => handleEliminar(item.id)}>
                        🗑️
                      </button>
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
  container: { padding: '0' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' },
  titulo: { color: '#0d2b5e', margin: 0 },
  btnNuevo: { padding: '10px 20px', background: '#1168bd', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' },
  form: { background: '#fff', borderRadius: '12px', padding: '24px', marginBottom: '24px', boxShadow: '0 2px 12px rgba(0,0,0,0.08)' },
  formTitulo: { color: '#0d2b5e', marginTop: 0 },
  formGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '16px' },
  inputGroup: { display: 'flex', flexDirection: 'column' },
  label: { fontSize: '13px', fontWeight: 'bold', color: '#334', marginBottom: '6px' },
  input: { padding: '10px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px' },
  btnGuardar: { padding: '10px 24px', background: '#0f6e56', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold' },
  cargando: { textAlign: 'center', color: '#888' },
  tabla: { background: '#fff', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 2px 12px rgba(0,0,0,0.08)' },
  table: { width: '100%', borderCollapse: 'collapse' },
  thead: { background: '#0d2b5e' },
  th: { padding: '14px 16px', color: '#fff', textAlign: 'left', fontSize: '13px' },
  tr: { borderBottom: '1px solid #f0f0f0' },
  td: { padding: '14px 16px', fontSize: '14px', color: '#334' },
  vacio: { textAlign: 'center', padding: '40px', color: '#888' },
  btnEliminar: { background: '#fee2e2', border: 'none', borderRadius: '6px', padding: '6px 10px', cursor: 'pointer' }
};

export default Inventario;