import { useState } from 'react';
import { ArrowDownLeft, ArrowUpRight, Handshake, Plus, RotateCw, Store, Inbox, Send, ArrowLeftRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { puedeEscribir } from '../lib/permisos';
import { fechaHoraCorta, formatNumber } from '../lib/formato';
import { ESTADOS_RED } from '../lib/red';
import Boton from '../components/ui/Boton';
import Aviso from '../components/ui/Aviso';
import EstadoVacio from '../components/ui/EstadoVacio';
import Secciones from '../components/ui/Secciones';
import StatusBadge from '../components/ui/StatusBadge';
import Selector from '../components/ui/Selector';
import Campo from '../components/ui/Campo';
import StatCard from '../components/ui/StatCard';
import { PageHeader, Panel } from '../components/ui/Panel';
import { Tabla, TablaEncabezado, TablaCuerpo, TablaFila, TablaColumna, TablaCelda } from '../components/ui/Tabla';
import { EstadoCarga, EstadoRed, PaginacionRed, useConsultaRed } from '../components/red/comunes';
import NuevaSolicitud from '../components/red/NuevaSolicitud';
import DetalleSolicitud from '../components/red/DetalleSolicitud';

const Disponibilidad = ({ panaderia, revision }) => {
  const consulta = useConsultaRed(`/api/red/panaderias/${panaderia.id}/disponibilidad`, revision);
  return <Panel titulo={`Disponibilidad de ${panaderia.nombre}`} descripcion="Solo se comparte la disponibilidad autorizada; no se muestran precios ni costos.">
    <EstadoCarga consulta={consulta}>{consulta.data && (consulta.data.materias.length ? <Tabla><TablaEncabezado><TablaFila>{['Insumo', 'Disponible', 'Nivel'].map(t => <TablaColumna key={t} className={t === 'Disponible' ? 'text-right' : undefined}>{t}</TablaColumna>)}</TablaFila></TablaEncabezado><TablaCuerpo>{consulta.data.materias.map(m => <TablaFila key={m.id}><TablaCelda>{m.nombre}</TablaCelda><TablaCelda className="text-right tabular-nums">{formatNumber(m.cantidad_disponible)} {m.unidad_medida}</TablaCelda><TablaCelda>{{ agotado: 'Agotado', bajo: 'Bajo', disponible: 'Disponible' }[m.nivel]}</TablaCelda></TablaFila>)}</TablaCuerpo></Tabla> : <p className="p-5 text-sm text-muted-foreground">Esta panadería no tiene insumos compartidos.</p>)}</EstadoCarga>
  </Panel>;
};
const Bandeja = ({ tipo, revision, onDetalle }) => {
  const [estado, setEstado] = useState(''), [pagina, setPagina] = useState(1);
  const q = new URLSearchParams({ bandeja: tipo, estado, pagina: String(pagina) });
  const consulta = useConsultaRed(`/api/red/solicitudes?${q}`, revision);
  const data = consulta.data;
  return <Panel titulo={`Solicitudes ${tipo}`}><div className="max-w-sm px-5 pb-4"><Selector etiqueta="Estado de solicitud" value={estado} onChange={e => { setEstado(e.target.value); setPagina(1); }}><option value="">Todos los estados</option>{Object.entries(ESTADOS_RED).map(([id, texto]) => <option key={id} value={id}>{texto}</option>)}</Selector></div>
    <EstadoCarga consulta={consulta}>{data && <>
      {data.solicitudes?.length ? <Tabla><TablaEncabezado><TablaFila>{['Solicitud', 'Panadería', 'Estado', 'Creada', 'Detalle'].map(t => <TablaColumna key={t}>{t}</TablaColumna>)}</TablaFila></TablaEncabezado><TablaCuerpo>{data.solicitudes.map(s => <TablaFila key={s.id}><TablaCelda>#{s.id} · {s.lineas} insumos</TablaCelda><TablaCelda>{s.contraparte.nombre}</TablaCelda><TablaCelda><EstadoRed estado={s.estado} /></TablaCelda><TablaCelda>{fechaHoraCorta(s.creada_en)}</TablaCelda><TablaCelda><Boton variante="contorno" tamano="sm" aria-label={`Ver solicitud ${s.id}`} onClick={() => onDetalle(s.id)}>Ver detalle</Boton></TablaCelda></TablaFila>)}</TablaCuerpo></Tabla> : <EstadoVacio icono={Inbox} titulo="No hay solicitudes para estos filtros." descripcion="Prueba con otro estado o revisa la otra bandeja." />}
      <PaginacionRed pagina={pagina} total={data.total} tamano={data.tamano_pagina} onCambiar={setPagina} />
    </>}</EstadoCarga>
  </Panel>;
};
const Movimientos = ({ revision, onDetalle }) => {
  const [fechas, setFechas] = useState({ desde: '', hasta: '' }), [filtros, setFiltros] = useState({ desde: '', hasta: '' });
  const [pagina, setPagina] = useState(1), [error, setError] = useState(null);
  const consulta = useConsultaRed(`/api/red/movimientos?${new URLSearchParams({ ...filtros, pagina: String(pagina) })}`, revision);
  const data = consulta.data;
  return <Panel titulo="Movimientos de tu panadería" descripcion="Entradas y salidas confirmadas de materias primas.">
    <form className="flex flex-wrap items-end gap-3 px-5 pb-4" onSubmit={e => { e.preventDefault(); if (fechas.desde && fechas.hasta && fechas.desde > fechas.hasta) { setError('La fecha inicial no puede ser posterior a la final.'); return; } setError(null); setFiltros({ ...fechas }); setPagina(1); }}>
      <Campo etiqueta="Desde" type="date" value={fechas.desde} onChange={e => setFechas(f => ({ ...f, desde: e.target.value }))} /><Campo etiqueta="Hasta" type="date" value={fechas.hasta} onChange={e => setFechas(f => ({ ...f, hasta: e.target.value }))} /><Boton type="submit" variante="contorno">Aplicar fechas</Boton>
    </form>{error && <div className="px-5 pb-4"><Aviso tipo="error">{error}</Aviso></div>}
    <EstadoCarga consulta={consulta}>{data && <>
      {data.movimientos?.length ? <Tabla><TablaEncabezado><TablaFila>{['Fecha', 'Movimiento', 'Insumo', 'Cantidad', 'Saldo anterior', 'Saldo posterior', 'Solicitud'].map(t => <TablaColumna key={t} className={['Cantidad', 'Saldo anterior', 'Saldo posterior'].includes(t) ? 'text-right' : undefined}>{t}</TablaColumna>)}</TablaFila></TablaEncabezado><TablaCuerpo>{data.movimientos.map(m => <TablaFila key={m.id}><TablaCelda>{fechaHoraCorta(m.fecha)}</TablaCelda><TablaCelda>{m.tipo === 'entrada' ? 'Entrada' : 'Salida'}</TablaCelda><TablaCelda>{m.materia_nombre}</TablaCelda><TablaCelda className="text-right tabular-nums">{formatNumber(m.cantidad)} {m.unidad_medida}</TablaCelda><TablaCelda className="text-right tabular-nums">{formatNumber(m.saldo_anterior)}</TablaCelda><TablaCelda className="text-right tabular-nums">{formatNumber(m.saldo_posterior)}</TablaCelda><TablaCelda><Boton variante="fantasma" tamano="sm" onClick={() => onDetalle(m.solicitud_id)}>Ver solicitud {m.solicitud_id}</Boton></TablaCelda></TablaFila>)}</TablaCuerpo></Tabla> : <EstadoVacio icono={ArrowLeftRight} titulo="No hay transferencias para estas fechas." descripcion="Las entradas y salidas aparecen al aceptar solicitudes. Puedes ampliar el rango de fechas." />}
      <PaginacionRed pagina={pagina} total={data.total} tamano={data.tamano_pagina} onCambiar={setPagina} />
    </>}</EstadoCarga>
  </Panel>;
};
const Colaboracion = () => {
  const { usuario } = useAuth();
  const escribe = puedeEscribir(usuario);
  const [revision, setRevision] = useState(0), [vista, setVista] = useState('panaderias');
  const [seleccionada, setSeleccionada] = useState(null), [nueva, setNueva] = useState(null), [detalle, setDetalle] = useState(null), [aviso, setAviso] = useState(null);
  const directorio = useConsultaRed('/api/red/panaderias', revision), resumen = useConsultaRed('/api/red/resumen', revision);
  const panaderias = Array.isArray(directorio.data) ? directorio.data : [];
  const propia = panaderias.find(p => p.es_propia), otras = panaderias.filter(p => !p.es_propia && p.en_red);
  const hecho = texto => { setNueva(null); setDetalle(null); setAviso(texto); setRevision(r => r + 1); };
  return <div className="pansys-ui flex-1 px-4 py-6 md:px-6 lg:px-8 lg:py-8"><div className="mx-auto flex max-w-7xl flex-col gap-6">
    <PageHeader antetitulo="Módulo" titulo="Red colaborativa" descripcion="Comparte recursos y coordina solicitudes de materias primas entre panaderías." acciones={<>
      <Boton variante="contorno" disabled={directorio.cargando || resumen.cargando} onClick={() => setRevision(r => r + 1)}><RotateCw className="size-4" aria-hidden="true" />Actualizar</Boton>
      {escribe && <Boton disabled={!propia?.en_red || !otras.length} onClick={() => setNueva({})}><Plus className="size-4" aria-hidden="true" />Nueva solicitud</Boton>}
    </>} />
    {!escribe && <Aviso tipo="info">Modo consulta: puedes ver la red, las solicitudes y los movimientos. Tu rol no permite realizar operaciones.</Aviso>}
    {!directorio.cargando && propia && !propia.en_red && <Aviso tipo="info">Tu panadería no participa actualmente en la red. Puedes consultar tu historial.</Aviso>}
    {aviso && <Aviso tipo="exito" onCerrar={() => setAviso(null)}>{aviso}</Aviso>}
    <EstadoCarga consulta={resumen}><section aria-label="Resumen de red colaborativa" className="grid gap-4 sm:grid-cols-3">
      <StatCard etiqueta="Recibidas pendientes" valor={String(resumen.data?.recibidas_pendientes ?? 0)} icono={ArrowDownLeft} /><StatCard etiqueta="Enviadas pendientes" valor={String(resumen.data?.enviadas_pendientes ?? 0)} icono={ArrowUpRight} /><StatCard etiqueta="Transferencias en 30 días" valor={String(resumen.data?.transferencias_30_dias ?? 0)} icono={Handshake} />
    </section></EstadoCarga>
    <Secciones etiqueta="Secciones de red colaborativa" activo={vista} onCambiar={setVista} items={[
      { id: 'panaderias', nombre: 'Panaderías', icono: Store }, { id: 'recibidas', nombre: 'Recibidas', icono: Inbox },
      { id: 'enviadas', nombre: 'Enviadas', icono: Send }, { id: 'movimientos', nombre: 'Movimientos', icono: ArrowLeftRight }
    ]} />
    {vista === 'panaderias' && <>
      <EstadoCarga consulta={directorio}><div className="grid gap-4 md:grid-cols-2">{panaderias.map(p => <Panel key={p.id} className={p.es_propia ? 'pansys-network-card' : 'pansys-network-card border-primary/25'} accion={<span className="rounded-xl bg-accent/60 p-2.5 text-primary"><Store className="size-5" aria-hidden="true" /></span>} titulo={p.nombre} descripcion={p.localidad || 'Localidad no registrada'}><div className="flex flex-wrap items-center gap-3 px-5 pb-5"><span className="w-full text-sm text-muted-foreground">{p.es_propia ? 'Tu panadería' : 'Panadería participante'} · {p.en_red ? 'En red' : 'Fuera de red'}</span><StatusBadge tono={p.en_red ? 'exito' : 'neutro'}>{p.es_propia ? 'Tu establecimiento' : 'Colaboración disponible'}</StatusBadge>{!p.es_propia && p.en_red && propia?.en_red && <><Boton variante="contorno" tamano="sm" onClick={() => setSeleccionada(p)}>Ver disponibilidad de {p.nombre}</Boton>{escribe && <Boton tamano="sm" onClick={() => setNueva({ inicial: p.id })}>Solicitar a {p.nombre}</Boton>}</>}</div></Panel>)}{!panaderias.length && <p className="p-5 text-muted-foreground">No hay panaderías disponibles.</p>}</div></EstadoCarga>
      {seleccionada && <Disponibilidad key={seleccionada.id} panaderia={seleccionada} revision={revision} />}
    </>}
    {['recibidas', 'enviadas'].includes(vista) && <Bandeja key={vista} tipo={vista} revision={revision} onDetalle={setDetalle} />}
    {vista === 'movimientos' && <Movimientos revision={revision} onDetalle={setDetalle} />}
  </div>{nueva && escribe && <NuevaSolicitud panaderias={otras} inicial={nueva.inicial} onCerrar={() => setNueva(null)} onHecho={hecho} />}
    {detalle !== null && <DetalleSolicitud id={detalle} escribe={escribe} onCerrar={() => setDetalle(null)} onHecho={hecho} />}
  </div>;
};
export default Colaboracion;
