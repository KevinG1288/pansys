import { Handshake } from 'lucide-react';
import { PageHeader, Panel } from './ui/Panel';

// Solo quedan módulos sin funciones en el servidor
const PENDIENTES = {
  colaboracion: {
    titulo: 'Red colaborativa',
    icono: Handshake,
    nota: 'El servidor todavía no tiene las funciones de la red colaborativa (solicitudes y participación entre panaderías). Requiere desarrollo en el backend.'
  }
};

// Aviso para módulos sin pantalla todavía: no consulta la API ni muestra datos
const ModuloPendiente = ({ modulo }) => {
  const { titulo, icono: Icono, nota } = PENDIENTES[modulo];

  return (
    <div className="pansys-ui flex-1 px-4 py-6 md:px-6 lg:px-8 lg:py-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader titulo={titulo} />
        <Panel>
          <div role="status" className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-accent text-accent-foreground">
              <Icono className="size-6" aria-hidden="true" />
            </span>
            <p className="text-base font-semibold">Este módulo todavía no está disponible en la interfaz.</p>
            <p className="max-w-md text-sm text-muted-foreground">{nota}</p>
          </div>
        </Panel>
      </div>
    </div>
  );
};

export default ModuloPendiente;
