import { useRef, useState } from 'react';
import { mensajeError } from '../../lib/errores';
import { formatNumber } from '../../lib/formato';
import { leerNumero, leerTexto } from '../../lib/validacion';
import Aviso from '../ui/Aviso';
import Boton from '../ui/Boton';
import Campo from '../ui/Campo';
import Dialogo from '../ui/Dialogo';

// Finalizar: la cantidad producida es un entero entre 0 y la planificada (regla del backend)
const DialogoFinalizar = ({ orden, onFinalizar, onCerrar }) => {
  const [cantidad, setCantidad] = useState(String(orden.cantidad_planificada));
  const [observaciones, setObservaciones] = useState('');
  const [errores, setErrores] = useState({});
  const [errorGeneral, setErrorGeneral] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const guardandoRef = useRef(false);
  const refCantidad = useRef(null);

  const enviar = async (evento) => {
    evento.preventDefault();
    if (guardandoRef.current) return;

    const lecturaCantidad = leerNumero(cantidad, { entero: true, maximo: orden.cantidad_planificada });
    const lecturaObs = leerTexto(observaciones, { obligatorio: false, maximo: 500 });
    const nuevos = {};
    if (lecturaCantidad.error) nuevos.cantidad = lecturaCantidad.error;
    if (lecturaObs.error) nuevos.observaciones = lecturaObs.error;
    setErrores(nuevos);
    if (nuevos.cantidad) {
      refCantidad.current?.focus();
      return;
    }
    if (nuevos.observaciones) return;

    guardandoRef.current = true;
    setGuardando(true);
    setErrorGeneral(null);
    try {
      await onFinalizar({
        cantidad_producida: lecturaCantidad.valor,
        ...(lecturaObs.valor ? { observaciones: lecturaObs.valor } : {})
      });
    } catch (error) {
      setErrorGeneral(mensajeError(error, 'No se pudo finalizar la orden.'));
      guardandoRef.current = false;
      setGuardando(false);
    }
  };

  return (
    <Dialogo
      titulo={`Finalizar la orden #${orden.id}`}
      descripcion={`${orden.Producto?.nombre ?? 'Producto'} · planificadas ${formatNumber(orden.cantidad_planificada)} unidades. Lo producido se suma al stock del producto.`}
      bloqueado={guardando}
      refFocoInicial={refCantidad}
      onCerrar={onCerrar}
    >
      <form onSubmit={enviar} noValidate className="flex flex-col gap-4">
        {errorGeneral && <Aviso tipo="error">{errorGeneral}</Aviso>}
        <Campo
          ref={refCantidad}
          etiqueta="Cantidad producida"
          inputMode="numeric"
          value={cantidad}
          onChange={e => setCantidad(e.target.value)}
          error={errores.cantidad}
          ayuda={`Entre 0 y ${formatNumber(orden.cantidad_planificada)}`}
        />
        <Campo
          etiqueta="Observaciones (opcional)"
          value={observaciones}
          onChange={e => setObservaciones(e.target.value)}
          error={errores.observaciones}
          maxLength={500}
        />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Boton variante="contorno" onClick={onCerrar} disabled={guardando}>Volver</Boton>
          <Boton type="submit" cargando={guardando}>Finalizar orden</Boton>
        </div>
      </form>
    </Dialogo>
  );
};

export default DialogoFinalizar;
