import { useEffect, useRef, useState } from 'react';
import { mensajeError } from '../../lib/errores';
import { formatNumber } from '../../lib/formato';
import { leerNumero, leerTexto } from '../../lib/validacion';
import Aviso from '../ui/Aviso';
import Boton from '../ui/Boton';
import Campo from '../ui/Campo';
import Dialogo from '../ui/Dialogo';

const OPCIONES = [
  { valor: 'todo', etiqueta: 'Devolver todos los insumos', ayuda: 'Se suman de nuevo al inventario.' },
  { valor: 'nada', etiqueta: 'No devolver insumos', ayuda: 'Todo lo descontado se registra como merma.' },
  { valor: 'parcial', etiqueta: 'Devolver solo una parte', ayuda: 'Indica cuánto se devuelve de cada insumo; el resto es merma.' }
];

// Cancelar: motivo obligatorio y decisión del panadero sobre los insumos (contrato del backend:
// { motivo, devolver_insumos, insumos?: [{ materia_prima_id, cantidad_devuelta }] })
const DialogoCancelar = ({ orden, onCargarDetalle, onCancelarOrden, onCerrar }) => {
  const [motivo, setMotivo] = useState('');
  const [opcion, setOpcion] = useState('todo');
  const [insumos, setInsumos] = useState(null);
  const [errorDetalle, setErrorDetalle] = useState(null);
  const [devoluciones, setDevoluciones] = useState({});
  const [errores, setErrores] = useState({});
  const [errorGeneral, setErrorGeneral] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const guardandoRef = useRef(false);
  const refMotivo = useRef(null);

  // Los insumos descontados de la orden (para mostrar cuánto se puede devolver)
  useEffect(() => {
    let activo = true;
    onCargarDetalle(orden.id)
      .then(detalle => {
        if (!activo) return;
        const lista = detalle.insumos ?? [];
        setInsumos(lista);
        setDevoluciones(Object.fromEntries(lista.map(i => [i.materia_prima_id, String(Number(i.cantidad_usada))])));
      })
      .catch(error => activo && setErrorDetalle(mensajeError(error, 'No se pudieron cargar los insumos de la orden.')));
    return () => { activo = false; };
  }, [orden.id, onCargarDetalle]);

  const enviar = async (evento) => {
    evento.preventDefault();
    if (guardandoRef.current) return;

    const nuevos = {};
    const lecturaMotivo = leerTexto(motivo, { maximo: 500 });
    if (lecturaMotivo.error) nuevos.motivo = lecturaMotivo.error;

    let detalle;
    if (opcion === 'parcial') {
      if (!insumos) {
        nuevos.general = 'Espera a que carguen los insumos de la orden.';
      } else {
        detalle = insumos.map(i => {
          const lectura = leerNumero(devoluciones[i.materia_prima_id], { decimales: 4, maximo: Number(i.cantidad_usada) });
          if (lectura.error) nuevos[`insumo-${i.materia_prima_id}`] = lectura.error;
          return { materia_prima_id: i.materia_prima_id, cantidad_devuelta: lectura.valor };
        });
      }
    }

    setErrores(nuevos);
    if (Object.keys(nuevos).length > 0) {
      if (nuevos.motivo) refMotivo.current?.focus();
      return;
    }

    const cuerpo = {
      motivo: lecturaMotivo.valor,
      devolver_insumos: opcion !== 'nada',
      ...(opcion === 'parcial' ? { insumos: detalle } : {})
    };

    guardandoRef.current = true;
    setGuardando(true);
    setErrorGeneral(null);
    try {
      await onCancelarOrden(cuerpo);
    } catch (error) {
      setErrorGeneral(mensajeError(error, 'No se pudo cancelar la orden.'));
      guardandoRef.current = false;
      setGuardando(false);
    }
  };

  return (
    <Dialogo
      titulo={`Cancelar la orden #${orden.id}`}
      descripcion={`${orden.Producto?.nombre ?? 'Producto'} · ${formatNumber(orden.cantidad_planificada)} unidades planificadas.`}
      bloqueado={guardando}
      refFocoInicial={refMotivo}
      onCerrar={onCerrar}
    >
      <form onSubmit={enviar} noValidate className="flex flex-col gap-4">
        {errorGeneral && <Aviso tipo="error">{errorGeneral}</Aviso>}
        {errores.general && <Aviso tipo="error">{errores.general}</Aviso>}
        <Campo
          ref={refMotivo}
          etiqueta="Motivo de la cancelación"
          value={motivo}
          onChange={e => setMotivo(e.target.value)}
          error={errores.motivo}
          maxLength={500}
        />

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium">¿Qué pasa con los insumos descontados?</legend>
          {OPCIONES.map(o => (
            <label key={o.valor} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 has-[:checked]:border-primary has-[:checked]:bg-accent/40">
              <input
                type="radio"
                name="devolucion"
                value={o.valor}
                checked={opcion === o.valor}
                onChange={() => setOpcion(o.valor)}
                className="mt-1 accent-[rgb(var(--primary))]"
              />
              <span>
                <span className="block text-sm font-medium">{o.etiqueta}</span>
                <span className="block text-xs text-muted-foreground">{o.ayuda}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {opcion === 'parcial' && (
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-secondary/30 p-4">
            {errorDetalle && <Aviso tipo="error">{errorDetalle}</Aviso>}
            {!insumos && !errorDetalle && <p role="status" className="text-sm text-muted-foreground">Cargando insumos de la orden…</p>}
            {insumos && insumos.map(i => (
              <Campo
                key={i.materia_prima_id}
                etiqueta={`Devolver de ${i.MateriaPrima?.nombre ?? `insumo #${i.materia_prima_id}`} (${i.unidad_medida})`}
                inputMode="decimal"
                value={devoluciones[i.materia_prima_id] ?? ''}
                onChange={e => setDevoluciones(d => ({ ...d, [i.materia_prima_id]: e.target.value }))}
                error={errores[`insumo-${i.materia_prima_id}`]}
                ayuda={`Descontado: ${formatNumber(i.cantidad_usada)} ${i.unidad_medida}`}
              />
            ))}
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Boton variante="contorno" onClick={onCerrar} disabled={guardando}>Volver</Boton>
          <Boton type="submit" variante="peligro" cargando={guardando}>Cancelar orden</Boton>
        </div>
      </form>
    </Dialogo>
  );
};

export default DialogoCancelar;
