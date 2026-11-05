import { useRef, useState } from 'react';
import api from '../../services/api';
import { mensajeError } from '../../lib/errores';
import { fechaHoraCorta, formatNumber } from '../../lib/formato';
import { validarOrigenes } from '../../lib/red';
import Dialogo from '../ui/Dialogo';
import Boton from '../ui/Boton';
import Selector from '../ui/Selector';
import Campo from '../ui/Campo';
import Aviso from '../ui/Aviso';
import { EstadoCarga, EstadoRed, useConsultaRed } from './comunes';
import SeguimientoSolicitud from './SeguimientoSolicitud';

const AccionSolicitud = ({ solicitud, accion, onVolver, onHecho }) => {
  const inventario = useConsultaRed(accion === 'aceptar' ? '/api/inventario' : null);
  const [seleccion, setSeleccion] = useState({}), [motivo, setMotivo] = useState('');
  const [error, setError] = useState(null), [ocupado, setOcupado] = useState(false);
  const enviando = useRef(false);
  const materias = Array.isArray(inventario.data) ? inventario.data : [];
  const enviar = async e => {
    e.preventDefault(); if (enviando.current) return;
    setError(null);
    try {
      let cuerpo = {};
      if (accion === 'aceptar') cuerpo = validarOrigenes(solicitud, seleccion, materias);
      if (accion === 'rechazar') {
        if (!motivo.trim() || motivo.trim().length > 255) throw new Error('Escribe un motivo de rechazo de hasta 255 caracteres.');
        cuerpo = { motivo: motivo.trim() };
      }
      enviando.current = true; setOcupado(true); onVolver(true);
      await api.post(`/api/red/solicitudes/${solicitud.id}/${accion}`, cuerpo);
      onHecho(accion === 'aceptar' ? 'Solicitud aceptada. El inventario se transfirió correctamente.' : accion === 'rechazar' ? 'Solicitud rechazada.' : 'Solicitud cancelada.');
    } catch (e) { setError(enviando.current ? mensajeError(e, 'No se pudo completar la operación.') : e.message); }
    finally { enviando.current = false; setOcupado(false); onVolver(false); }
  };
  const contenido = <form onSubmit={enviar} noValidate className="flex flex-col gap-4 border-t border-border pt-4">
    <h3 className="font-semibold">{accion === 'aceptar' ? 'Seleccionar orígenes y confirmar transferencia' : accion === 'rechazar' ? 'Rechazar solicitud' : 'Cancelar solicitud enviada'}</h3>
    {error && <Aviso tipo="error">{error} No se reintentará automáticamente. Puedes actualizar el detalle antes de volver a intentarlo.</Aviso>}
    <fieldset disabled={ocupado} className="flex flex-col gap-4">
      {accion === 'aceptar' && <>
        <Aviso tipo="info">Se descontarán las cantidades de tu inventario y se sumarán al inventario de la solicitante. La transferencia se confirma completa.</Aviso>
        {solicitud.lineas.map(l => <Selector key={l.id} etiqueta={`Origen para ${l.nombre} (línea ${l.linea})`} ayuda={`Se transferirán ${formatNumber(l.cantidad)} ${l.unidad_medida}`} value={seleccion[l.id] || ''} onChange={e => setSeleccion(s => ({ ...s, [l.id]: e.target.value }))}>
          <option value="">Selecciona un insumo propio</option>{materias.filter(m => m.unidad_medida === l.unidad_medida).map(m => <option key={m.id} value={m.id}>{m.nombre} · {formatNumber(m.cantidad_disponible)} {m.unidad_medida}</option>)}
        </Selector>)}
        <section aria-label="Resumen de transferencia" className="rounded-xl border border-primary/20 bg-accent/20 p-4">
          <h4 className="text-sm font-semibold">Revisa antes de confirmar</h4>
          <p className="mt-1 text-xs text-muted-foreground">De {solicitud.proveedora.nombre} a {solicitud.solicitante.nombre}</p>
          <ul className="mt-3 space-y-2 text-sm">{solicitud.lineas.map(l => <li key={l.id} className="flex flex-wrap justify-between gap-2">
            <span>{materias.find(m => m.id === Number(seleccion[l.id]))?.nombre || 'Origen por seleccionar'} → {l.nombre}</span>
            <strong className="tabular-nums">{formatNumber(l.cantidad)} {l.unidad_medida}</strong>
          </li>)}</ul>
        </section>
      </>}
      {accion === 'rechazar' && <Campo etiqueta="Motivo del rechazo" maxLength={255} value={motivo} onChange={e => setMotivo(e.target.value)} />}
      {accion === 'cancelar' && <p className="text-sm">La solicitud dejará de estar pendiente. Esta acción no transfiere inventario.</p>}
    </fieldset>
    <Boton type="submit" variante={accion === 'aceptar' ? 'primario' : 'peligro'} cargando={ocupado}>Confirmar {accion === 'aceptar' ? 'transferencia' : accion === 'rechazar' ? 'rechazo' : 'cancelación'}</Boton>
  </form>;
  return accion === 'aceptar' ? <EstadoCarga consulta={inventario}>{contenido}</EstadoCarga> : contenido;
};

const DetalleSolicitud = ({ id, escribe, onCerrar, onHecho }) => {
  const [revision, setRevision] = useState(0), [accion, setAccion] = useState(null), [ocupado, setOcupado] = useState(false);
  const consulta = useConsultaRed(`/api/red/solicitudes/${id}`, revision);
  const s = consulta.data;
  const actualizar = () => { setAccion(null); setRevision(r => r + 1); };
  return <Dialogo lateral titulo={`Solicitud #${id}`} bloqueado={ocupado} onCerrar={onCerrar} className="sm:max-w-2xl">
    <EstadoCarga consulta={consulta}>{s && <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><EstadoRed estado={s.estado} /><Boton variante="contorno" tamano="sm" disabled={ocupado} onClick={actualizar}>Actualizar detalle</Boton></div>
      <SeguimientoSolicitud estado={s.estado} />
      <dl className="grid gap-4 rounded-xl border border-border bg-background p-4 text-sm sm:grid-cols-2">
        <div><dt className="text-muted-foreground">Solicitante</dt><dd className="font-medium">{s.solicitante.nombre}</dd></div>
        <div><dt className="text-muted-foreground">Proveedora</dt><dd className="font-medium">{s.proveedora.nombre}</dd></div>
        <div><dt className="text-muted-foreground">Creada</dt><dd>{fechaHoraCorta(s.creada_en)}</dd></div>
        {s.cerrada_en && <div><dt className="text-muted-foreground">Cerrada</dt><dd>{fechaHoraCorta(s.cerrada_en)}</dd></div>}
      </dl>
      {s.nota && <p className="break-words rounded-xl bg-secondary p-3 text-sm">Nota: {s.nota}</p>}
      {s.motivo_rechazo && <Aviso tipo="info">Motivo del rechazo: {s.motivo_rechazo}</Aviso>}
      <ul aria-label="Insumos solicitados" className="divide-y divide-border rounded-xl border border-border">{s.lineas.map(l => <li key={l.id} className="flex flex-wrap justify-between gap-2 p-3 text-sm"><span>{l.nombre}</span><strong>{formatNumber(l.cantidad)} {l.unidad_medida}</strong></li>)}</ul>
      <section><h3 className="mb-4 text-sm font-semibold">Historial de la solicitud</h3><ol className="pansys-timeline space-y-4 border-l border-border pl-4 text-sm text-muted-foreground">{s.eventos.map((e, i) => <li key={i}>
        <p className="font-medium text-foreground">{({ creada: 'Solicitud enviada', aceptada: 'Transferencia confirmada', rechazada: 'Solicitud rechazada', cancelada: 'Solicitud cancelada' })[e.tipo] || e.tipo}</p>
        <p className="mt-1 text-xs">{e.lado === 'proveedora' ? s.proveedora.nombre : s.solicitante.nombre} · <time dateTime={e.fecha}>{fechaHoraCorta(e.fecha)}</time></p>
      </li>)}</ol></section>
      {escribe && s.estado === 'pendiente' && <>
        <p className="text-sm text-muted-foreground">{s.rol === 'proveedora' ? 'Para aceptar, selecciona los insumos de tu inventario que vas a transferir. También puedes rechazar indicando el motivo.' : 'La proveedora debe responder. Puedes cancelar esta solicitud mientras siga pendiente.'}</p>
        <div className="flex flex-wrap gap-2 rounded-xl border border-border bg-background p-3">
          {s.rol === 'proveedora' ? <><Boton disabled={ocupado} onClick={() => setAccion('aceptar')}>Aceptar solicitud</Boton><Boton variante="contorno" disabled={ocupado} onClick={() => setAccion('rechazar')}>Rechazar solicitud</Boton></> : <Boton variante="contorno" disabled={ocupado} onClick={() => setAccion('cancelar')}>Cancelar solicitud</Boton>}
        </div>
        {accion && <AccionSolicitud key={`${accion}-${revision}`} solicitud={s} accion={accion} onVolver={setOcupado} onHecho={onHecho} />}
      </>}
    </div>}</EstadoCarga>
  </Dialogo>;
};
export default DetalleSolicitud;
