import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import Inventario from './Inventario';
import Ventas from './Ventas';
import Produccion from './Produccion';
import Recetas from './Recetas';
import Cuentas from './Cuentas';
import MiCuenta from './MiCuenta';
import ResumenDashboard from './ResumenDashboard';
import Sidebar from '../components/layout/Sidebar';
import Topbar from '../components/layout/Topbar';
import MenuMovil from '../components/layout/MenuMovil';
import { etiquetaModulo } from '../components/layout/navegacion';
import ModuloPendiente from '../components/ModuloPendiente';

const Dashboard = () => {
  const { usuario, logout } = useAuth();
  const navigate = useNavigate();
  const [moduloActivo, setModuloActivo] = useState('dashboard');
  const [menuAbierto, setMenuAbierto] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const renderContenido = () => {
    switch(moduloActivo) {
      case 'inventario': return <Inventario />;
      case 'ventas': return <Ventas />;
      case 'produccion': return <Produccion />;
      case 'recetas': return <Recetas />;
      // Red colaborativa: el backend no tiene modelos ni endpoints todavía
      case 'colaboracion': return <ModuloPendiente modulo={moduloActivo} />;
      // Solo aparece en el menú del administrador; la página también lo comprueba
      case 'cuentas': return <Cuentas />;
      case 'micuenta': return <MiCuenta />;
      default: return <ResumenDashboard onIrA={setModuloActivo} />;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Con el menú móvil abierto, el resto de la pantalla queda inerte (sin foco ni clics) */}
      <div className="flex min-h-screen" inert={menuAbierto} data-testid="contenido-principal">
        <aside className="pansys-ui sticky top-0 hidden h-screen w-64 shrink-0 lg:block">
          <Sidebar activo={moduloActivo} rolId={usuario?.rol_id} onSeleccionar={setModuloActivo} onLogout={handleLogout} />
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar
            titulo={etiquetaModulo(moduloActivo)}
            usuario={usuario}
            onAbrirMenu={() => setMenuAbierto(true)}
          />
          <main className="flex flex-1 flex-col">
            {renderContenido()}
          </main>
        </div>
      </div>
      {menuAbierto && (
        <MenuMovil
          activo={moduloActivo}
          rolId={usuario?.rol_id}
          onSeleccionar={setModuloActivo}
          onLogout={handleLogout}
          onCerrar={() => setMenuAbierto(false)}
        />
      )}
    </div>
  );
};

export default Dashboard;
