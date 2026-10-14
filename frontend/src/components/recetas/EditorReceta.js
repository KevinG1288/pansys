import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { mensajeError } from '../../lib/errores';
import { leerNumero } from '../../lib/validacion';
import Aviso from '../ui/Aviso';
import Boton from '../ui/Boton';
import Campo from '../ui/Campo';
import { Panel } from '../ui/Panel';
import Selector from '../ui/Selector';

const MAX_INSUMOS = 50; // límite del backend

let siguienteClave = 0;
const nuevaLinea = (materiaId = '', cantidad = '') => ({ clave: ++siguienteClave, materiaId: String(materiaId), cantidad: String(cantidad) });

// Editor de la receta de un producto: cantidad de cada materia prima para UNA unidad.
// Envía { insumos: [{ materia_prima_id, cantidad_por_unidad }] } (contrato de POST/PUT /recetas/:producto_id)
const EditorReceta = ({ receta, materias, onGuardar, onCancelar }) => {
  const existe = (receta.insumos ?? []).length > 0;
  const [lineas, setLineas] = useState(() =>
    existe ? receta.insumos.map(i => nuevaLinea(i.materia_prima_id, Number(i.cantidad_por_unidad))) : [nuevaLinea()]
  );
  const [errores, setErrores] = useState({});
  const [errorGeneral, setErrorGeneral] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const guardandoRef = useRef(false);
  const refPrimero = useRef(null);

  useEffect(() => {
    refPrimero.current?.focus();
  }, []);

  // Materias activas de inventario y, si la receta usa alguna que ya no lo está, también esa
  const opciones = [
    ...materias.map(m => ({ id: m.id, nombre: m.nombre, unidad: m.unidad_medida, activo: true })),
    ...(receta.insumos ?? [])
      .filter(i => !materias.some(m => m.id === i.materia_prima_id))
      .map(i => ({ id: i.materia_prima_id, nombre: i.nombre ?? `#${i.materia_prima_id}`, unidad: i.unidad_medida, activo: false }))
  ];

  const cambiar = (clave, campo, valor) =>
    setLineas(actual => actual.map(l => (l.clave === clave ? { ...l, [campo]: valor } : l)));

  const enviar = async (evento) => {
    evento.preventDefault();
    if (guardandoRef.current) return;

    const nuevos = {};
    const vistos = new Set();
    const insumos = lineas.map(l => {
      if (!l.materiaId) nuevos[`materia-${l.clave}`] = 'Elige una materia prima';
      else if (vistos.has(l.materiaId)) nuevos[`materia-${l.clave}`] = 'Esta materia prima ya está en la receta';
      vistos.add(l.materiaId);
      const lectura = leerNumero(l.cantidad, { decimales: 4, maximo: 100000 });
      if (lectura.error) nuevos[`cantidad-${l.clave}`] = lectura.error;
      else if (lectura.valor <= 0) nuevos[`cantidad-${l.clave}`] = 'Debe ser mayor que 0';
      return { materia_prima_id: Number(l.materiaId), cantidad_por_unidad: lectura.valor };
    });
    if (lineas.length === 0) nuevos.general = 'Agrega al menos un insumo.';

    setErrores(nuevos);
    if (Object.keys(nuevos).length > 0) return;

    guardandoRef.current = true;
    setGuardando(true);
    setErrorGeneral(null);
    try {
      await onGuardar({ insumos }, existe);
    } catch (error) {
      const noEncontradas = error?.response?.data?.materias_primas;
      const detalle = Array.isArray(noEncontradas) && noEncontradas.length > 0 ? ` (materias primas: ${noEncontradas.join(', ')})` : '';
      setErrorGeneral(`${mensajeError(error, 'No se pudo guardar la receta.')}${detalle}`);
      guardandoRef.current = false;
      setGuardando(false);
    }
  };

  return (
    <Panel
      titulo={existe ? `Editar receta de «${receta.producto}»` : `Crear receta de «${receta.producto}»`}
      descripcion="Indica cuánto de cada materia prima se necesita para elaborar UNA unidad del producto."
    >
      <form onSubmit={enviar} noValidate className="flex flex-col gap-4 px-5 pb-5">
        {errorGeneral && <Aviso tipo="error">{errorGeneral}</Aviso>}
        {errores.general && <Aviso tipo="error">{errores.general}</Aviso>}
        {materias.length === 0 && (
          <Aviso tipo="info">No hay materias primas activas en el inventario. Regístralas en Inventario para usarlas en la receta.</Aviso>
        )}

        <ul className="flex flex-col gap-3">
          {lineas.map((l, indice) => {
            const opcion = opciones.find(o => String(o.id) === l.materiaId);
            return (
              <li key={l.clave} className="grid grid-cols-1 items-start gap-3 rounded-xl border border-border p-3 md:grid-cols-[1fr_220px_auto]">
                <Selector
                  ref={indice === 0 ? refPrimero : undefined}
                  etiqueta={`Materia prima ${indice + 1}`}
                  value={l.materiaId}
                  onChange={e => cambiar(l.clave, 'materiaId', e.target.value)}
                  error={errores[`materia-${l.clave}`]}
                >
                  <option value="">Elige una materia prima…</option>
                  {opciones.map(o => (
                    <option key={o.id} value={o.id}>
                      {o.nombre} ({o.unidad}){o.activo ? '' : ' — inactiva'}
                    </option>
                  ))}
                </Selector>
                <Campo
                  etiqueta={`Cantidad por unidad ${indice + 1}`}
                  inputMode="decimal"
                  value={l.cantidad}
                  onChange={e => cambiar(l.clave, 'cantidad', e.target.value)}
                  error={errores[`cantidad-${l.clave}`]}
                  ayuda={opcion ? `En ${opcion.unidad}; hasta 4 decimales` : 'Hasta 4 decimales'}
                />
                <Boton
                  variante="fantasma"
                  tamano="icono"
                  className="mt-7 text-destructive hover:bg-destructive/10"
                  onClick={() => setLineas(actual => actual.filter(x => x.clave !== l.clave))}
                  disabled={lineas.length === 1 || guardando}
                  aria-label={`Quitar materia prima ${indice + 1}`}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Boton>
              </li>
            );
          })}
        </ul>

        <div>
          <Boton
            variante="contorno"
            tamano="sm"
            onClick={() => setLineas(actual => [...actual, nuevaLinea()])}
            disabled={lineas.length >= MAX_INSUMOS || guardando}
          >
            <Plus className="size-4" aria-hidden="true" />
            Agregar insumo
          </Boton>
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Boton variante="contorno" onClick={onCancelar} disabled={guardando}>Cancelar</Boton>
          <Boton type="submit" cargando={guardando}>{existe ? 'Guardar cambios' : 'Crear receta'}</Boton>
        </div>
      </form>
    </Panel>
  );
};

export default EditorReceta;
