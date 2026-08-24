import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import Inventario from './Inventario';

const Dashboard = () => {
  const { usuario, logout } = useAuth();
  const navigate = useNavigate();
  const [moduloActivo, setModuloActivo] = useState('dashboard');
  const [statsInventario, setStatsInventario] = useState(0);

  useEffect(() => {
    cargarStats();
  }, []);

  const cargarStats = async () => {
    try {
      const res = await api.get('/api/inventario?panaderia_id=1');
      setStatsInventario(res.data.length);
    } catch (error) {
      console.error(error);
    }
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const renderContenido = () => {
    switch(moduloActivo) {
      case 'inventario': return <Inventario />;
      default: return (
        <div>
          <div style={styles.header}>
            <h1 style={styles.titulo}>Dashboard</h1>
            <span style={styles.bienvenida}>👤 {usuario?.email} — {usuario?.rol}</span>
          </div>
          <div style={styles.cards}>
            <div style={{...styles.card, borderTop: '4px solid #1168bd'}}
              onClick={() => setModuloActivo('inventario')}>
              <h3 style={styles.cardTitulo}>📦 Inventario</h3>
              <p style={styles.cardNum}>{statsInventario}</p>
              <p style={styles.cardSub}>materias primas</p>
            </div>
            <div style={{...styles.card, borderTop: '4px solid #0f6e56'}}>
              <h3 style={styles.cardTitulo}>🛒 Ventas hoy</h3>
              <p style={styles.cardNum}>--</p>
              <p style={styles.cardSub}>transacciones</p>
            </div>
            <div style={{...styles.card, borderTop: '4px solid #993c1d'}}>
              <h3 style={styles.cardTitulo}>🏭 Producción</h3>
              <p style={styles.cardNum}>--</p>
              <p style={styles.cardSub}>órdenes activas</p>
            </div>
            <div style={{...styles.card, borderTop: '4px solid #534ab7'}}>
              <h3 style={styles.cardTitulo}>🤝 Red Colab</h3>
              <p style={styles.cardNum}>--</p>
              <p style={styles.cardSub}>solicitudes activas</p>
            </div>
          </div>
        </div>
      );
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.sidebar}>
        <h2 style={styles.logo}>🥖 Pansys</h2>
        <nav>
          {[
            { id: 'dashboard', label: '🏠 Dashboard' },
            { id: 'inventario', label: '📦 Inventario' },
            { id: 'ventas', label: '🛒 Ventas' },
            { id: 'produccion', label: '🏭 Producción' },
            { id: 'colaboracion', label: '🤝 Red Colab' },
            { id: 'reportes', label: '📊 Reportes' },
          ].map(m => (
            <button key={m.id} style={{
              ...styles.navBtn,
              background: moduloActivo === m.id ? 'rgba(255,255,255,0.15)' : 'transparent'
            }} onClick={() => setModuloActivo(m.id)}>
              {m.label}
            </button>
          ))}
        </nav>
        <button style={styles.logoutBtn} onClick={handleLogout}>
          🚪 Cerrar sesión
        </button>
      </div>
      <div style={styles.main}>
        {renderContenido()}
      </div>
    </div>
  );
};

const styles = {
  container: { display: 'flex', minHeight: '100vh', background: '#f4f7fc' },
  sidebar: { width: '220px', background: '#0d2b5e', padding: '24px 16px', display: 'flex', flexDirection: 'column' },
  logo: { color: '#fff', textAlign: 'center', marginBottom: '32px' },
  navBtn: { display: 'block', width: '100%', padding: '12px 16px', color: '#cce0ff', border: 'none', borderRadius: '8px', textAlign: 'left', fontSize: '14px', cursor: 'pointer', marginBottom: '4px' },
  logoutBtn: { marginTop: 'auto', padding: '12px', background: '#991b1b', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '14px' },
  main: { flex: 1, padding: '32px' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' },
  titulo: { color: '#0d2b5e', margin: 0 },
  bienvenida: { color: '#888', fontSize: '14px' },
  cards: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px' },
  card: { background: '#fff', borderRadius: '12px', padding: '24px', boxShadow: '0 2px 12px rgba(0,0,0,0.08)', cursor: 'pointer' },
  cardTitulo: { margin: '0 0 12px 0', color: '#334', fontSize: '14px' },
  cardNum: { fontSize: '36px', fontWeight: 'bold', color: '#0d2b5e', margin: '0' },
  cardSub: { color: '#888', fontSize: '12px', margin: '4px 0 0 0' }
};

export default Dashboard;