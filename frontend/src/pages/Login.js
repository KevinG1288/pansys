import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';

const Login = () => {
  const [email, setEmail] = useState('');
  const [contrasena, setContrasena] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setCargando(true);
    setError('');

    try {
      const res = await api.post('/api/auth/login', { email, contrasena });
      login(res.data.token, res.data.usuario);
      navigate('/dashboard');
    } catch (err) {
      setError('Email o contraseña incorrectos');
    } finally {
      setCargando(false);
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <h1 style={styles.logo}>🥖 Pansys</h1>
        <p style={styles.subtitle}>Sistema de gestión de panaderías</p>

        <form onSubmit={handleSubmit}>
          <div style={styles.inputGroup}>
            <label style={styles.label}>Email</label>
            <input
              style={styles.input}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@pansys.com"
              required
            />
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>Contraseña</label>
            <input
              style={styles.input}
              type="password"
              value={contrasena}
              onChange={(e) => setContrasena(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>

          {error && <p style={styles.error}>{error}</p>}

          <button
            style={styles.button}
            type="submit"
            disabled={cargando}
          >
            {cargando ? 'Iniciando sesión...' : 'Iniciar sesión'}
          </button>
        </form>
      </div>
    </div>
  );
};

const styles = {
  container: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #1168bd 0%, #0d2b5e 100%)'
  },
  card: {
    background: '#fff',
    borderRadius: '16px',
    padding: '40px',
    width: '100%',
    maxWidth: '400px',
    boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
  },
  logo: {
    textAlign: 'center',
    fontSize: '32px',
    color: '#1168bd',
    margin: '0 0 8px 0'
  },
  subtitle: {
    textAlign: 'center',
    color: '#888',
    marginBottom: '32px',
    fontSize: '14px'
  },
  inputGroup: {
    marginBottom: '20px'
  },
  label: {
    display: 'block',
    marginBottom: '6px',
    color: '#334',
    fontWeight: 'bold',
    fontSize: '14px'
  },
  input: {
    width: '100%',
    padding: '12px',
    border: '1px solid #ddd',
    borderRadius: '8px',
    fontSize: '14px',
    boxSizing: 'border-box',
    outline: 'none'
  },
  button: {
    width: '100%',
    padding: '14px',
    background: '#1168bd',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    fontSize: '16px',
    fontWeight: 'bold',
    cursor: 'pointer',
    marginTop: '8px'
  },
  error: {
    color: 'red',
    fontSize: '13px',
    marginBottom: '12px'
  }
};

export default Login;