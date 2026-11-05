import { useRef, useState } from 'react';
import api from '../../services/api';
import { mensajeError } from '../../lib/errores';
import { validarSolicitud } from '../../lib/red';
import Dialogo from '../ui/Dialogo';
import Boton from '../ui/Boton';
import Campo from '../ui/Campo';
import Selector from '../ui/Selector';
import Aviso from '../ui/Aviso';
import { EstadoCarga, useConsultaRed } from './comunes';

const NuevaSolicitud = ({ panaderias, inicial, onCerrar, onHecho }) => {
  const inventario = useConsultaRed('/api/inventario');
  const [proveedora, setProveedora] = useState(String(inicial || ''));
  const [nota, setNota] = useState('');
  const [lineas, setLineas] = useState([{ clave: 0, destino: '', cantidad: '' }]);
  const siguiente = useRef(1), enviando = useRef(false);
  const [ocupado, setOcupado] = useState(false), [error, setError] = useState(null);
  const materias = Array.isArray(inventario.data) ? inventario.data : [];
  const cambiar = (clave, campo, valor) => setLineas(ls => ls.map(l => l.clave === clave ? { ...l, [campo]: valor } : l));
  const enviar = async e => {
    e.preventDefault(); if (enviando.current) return;
    setError(null);
    try {
      if (!panaderias.some(p => p.id === Number(proveedora))) throw new Error('Selecciona una panadería participante.');
      const cuerpo = validarSolicitud(proveedora, nota, lineas, materias);
      enviando.current = true; setOcupado(true);
      await api.post('/api/red/solicitudes', cuerpo);
      onHecho('Solicitud enviada correctamente.');
    } catch (e) { setError(enviando.current ? mensajeError(e, 'No se pudo enviar la solicitud.') : e.message); }
    finally { enviando.current = false; setOcupado(false); }
  };
  return <Dialogo lateral titulo="Nueva solicitud de materias primas" bloqueado={ocupado} onCerrar={onCerrar} className="sm:max-w-2xl">
    <EstadoCarga consulta={inventario}>
      <form onSubmit={enviar} noValidate className="flex flex-col gap-5">
        <p className="text-sm text-muted-foreground">Solicita insumos para tu panadería. El destino es un insumo de tu propio inventario; la proveedora elegirá de dónde transferirlo.</p>
        {error && <Aviso tipo="error">{error}</Aviso>}
        {!materias.length && <Aviso tipo="info">Registra primero un insumo de destino en Inventario.</Aviso>}
        <fieldset disabled={ocupado} className="flex flex-col gap-4">
          <Selector etiqueta="Panadería proveedora" value={proveedora} onChange={e => setProveedora(e.target.value)}><option value="">Selecciona una panadería</option>{panaderias.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}</Selector>
          {lineas.map((l, i) => <div key={l.clave} className="grid gap-3 rounded-xl border border-border p-4 sm:grid-cols-[minmax(0,1fr)_120px_auto]">
            <Selector etiqueta={`Insumo de destino ${i + 1}`} value={l.destino} onChange={e => cambiar(l.clave, 'destino', e.target.value)}>
              <option value="">Selecciona un insumo propio</option>{materias.map(m => <option key={m.id} value={m.id}>{m.nombre} ({m.unidad_medida})</option>)}
            </Selector>
            <Campo etiqueta={`Cantidad ${i + 1}`} inputMode="decimal" value={l.cantidad} onChange={e => cambiar(l.clave, 'cantidad', e.target.value)} ayuda="Hasta 4 decimales" />
            <Boton variante="fantasma" aria-label={`Quitar línea ${i + 1}`} disabled={lineas.length === 1} onClick={() => setLineas(ls => ls.filter(x => x.clave !== l.clave))}>Quitar</Boton>
          </div>)}
          <Boton variante="contorno" disabled={lineas.length >= 20} onClick={() => setLineas(ls => [...ls, { clave: siguiente.current++, destino: '', cantidad: '' }])}>Añadir línea</Boton>
          <Campo etiqueta="Nota (opcional)" maxLength={255} value={nota} onChange={e => setNota(e.target.value)} />
          <p className="-mt-2 text-right text-xs tabular-nums text-muted-foreground">{nota.length}/255 caracteres</p>
        </fieldset>
        <div className="flex flex-wrap justify-end gap-2"><Boton variante="contorno" disabled={ocupado} onClick={onCerrar}>Volver</Boton><Boton type="submit" cargando={ocupado} disabled={!materias.length}>Enviar solicitud</Boton></div>
      </form>
    </EstadoCarga>
  </Dialogo>;
};
export default NuevaSolicitud;
