import { useEffect, useState } from 'react';
import { Ban, CircleCheck, CircleX, Clock3 } from 'lucide-react';
import api from '../../services/api';
import { mensajeError } from '../../lib/errores';
import Boton from '../ui/Boton';
import Aviso from '../ui/Aviso';
import StatusBadge from '../ui/StatusBadge';
import Carga from '../ui/Carga';
import { ESTADOS_RED } from '../../lib/red';

// Ignora respuestas de una selección anterior o de un componente desmontado.
export const useConsultaRed = (url, revision = 0) => {
  const [intento, setIntento] = useState(0);
  const [estado, setEstado] = useState({ data: null, cargando: true, error: null });
  useEffect(() => {
    if (!url) return;
    let vigente = true;
    setEstado({ data: null, cargando: true, error: null });
    api.get(url).then(r => { if (vigente) setEstado({ data: r.data, cargando: false, error: null }); }, e => {
      if (vigente) setEstado({ data: null, cargando: false, error: mensajeError(e, 'No se pudieron cargar los datos.') });
    });
    return () => { vigente = false; };
  }, [url, revision, intento]);
  return { ...estado, reintentar: () => setIntento(i => i + 1) };
};
export const EstadoCarga = ({ consulta, children }) => consulta.cargando ? <Carga /> : consulta.error ? (
  <div className="p-5"><Aviso tipo="error">{consulta.error}</Aviso><p className="mt-2 text-xs text-muted-foreground">Puedes volver a cargar esta sección sin salir de la pantalla.</p><Boton variante="contorno" className="mt-3" onClick={consulta.reintentar}>Reintentar</Boton></div>
) : children;
export const EstadoRed = ({ estado }) => <StatusBadge icono={{ pendiente: Clock3, aceptada: CircleCheck, rechazada: CircleX, cancelada: Ban }[estado]} tono={estado === 'pendiente' ? 'alerta' : estado === 'aceptada' ? 'exito' : estado === 'rechazada' ? 'peligro' : 'neutro'}>{ESTADOS_RED[estado] || estado}</StatusBadge>;
export const PaginacionRed = ({ pagina, total = 0, tamano = 20, onCambiar }) => (
  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border p-4 text-sm">
    <span>{total} registros · Página {pagina} de {Math.max(1, Math.ceil(total / tamano))}</span>
    <div className="flex gap-2"><Boton variante="contorno" tamano="sm" disabled={pagina <= 1} onClick={() => onCambiar(pagina - 1)}>Anterior</Boton>
      <Boton variante="contorno" tamano="sm" disabled={pagina * tamano >= total || pagina >= 10000} onClick={() => onCambiar(pagina + 1)}>Siguiente</Boton></div>
  </div>
);
