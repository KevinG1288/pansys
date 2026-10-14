import { useEffect, useRef, useState } from 'react';
import { mensajeError } from '../../lib/errores';
import { leerNumero, leerTexto, validar } from '../../lib/validacion';
import Aviso from '../ui/Aviso';
import Boton from '../ui/Boton';
import Campo from '../ui/Campo';
import { Panel } from '../ui/Panel';

const CAMPOS = ['nombre', 'unidad_medida', 'cantidad_disponible', 'stock_minimo', 'precio_unitario'];

// Mismos límites acordados para el POST y el PUT de /api/inventario
const REGLAS = {
  nombre: (v) => leerTexto(v),
  unidad_medida: (v) => leerTexto(v),
  cantidad_disponible: (v) => leerNumero(v, { decimales: 4, maximo: 1000000 }),
  stock_minimo: (v) => leerNumero(v, { decimales: 4, maximo: 1000000 }),
  precio_unitario: (v) => leerNumero(v, { decimales: 2, maximo: 100000000 })
};

// Valor numérico del backend como texto editable, con la precisión que admite el formulario
const comoTexto = (valor, decimales) =>
  valor === null || valor === undefined ? '' : String(Number(Number(valor).toFixed(decimales)));

const valoresIniciales = (insumo) => ({
  nombre: insumo?.nombre ?? '',
  unidad_medida: insumo?.unidad_medida ?? '',
  cantidad_disponible: insumo ? comoTexto(insumo.cantidad_disponible, 4) : '',
  stock_minimo: insumo ? comoTexto(insumo.stock_minimo, 4) : '',
  precio_unitario: insumo ? comoTexto(insumo.precio_unitario, 2) : ''
});

// Formulario de alta y edición. Valida, convierte (textos recortados y números JSON)
// y entrega los datos a onGuardar, que hace la petición; si falla, muestra el error del backend.
const FormularioInsumo = ({ insumo, onGuardar, onCancelar }) => {
  const editando = Boolean(insumo);
  const [valores, setValores] = useState(() => valoresIniciales(insumo));
  const [errores, setErrores] = useState({});
  const [errorGeneral, setErrorGeneral] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const guardandoRef = useRef(false);

  const refNombre = useRef(null);
  const refUnidad = useRef(null);
  const refCantidad = useRef(null);
  const refMinimo = useRef(null);
  const refPrecio = useRef(null);
  const refs = {
    nombre: refNombre,
    unidad_medida: refUnidad,
    cantidad_disponible: refCantidad,
    stock_minimo: refMinimo,
    precio_unitario: refPrecio
  };

  useEffect(() => {
    refNombre.current?.focus();
  }, []);

  const cambiar = (campo) => (evento) => {
    setValores(v => ({ ...v, [campo]: evento.target.value }));
  };

  const enviar = async (evento) => {
    evento.preventDefault();
    if (guardandoRef.current) return;

    const { datos, errores: nuevosErrores, valido } = validar(valores, REGLAS);
    setErrores(nuevosErrores);
    setErrorGeneral(null);
    if (!valido) {
      const primero = CAMPOS.find(c => nuevosErrores[c]);
      refs[primero].current?.focus();
      return;
    }

    guardandoRef.current = true;
    setGuardando(true);
    try {
      await onGuardar(datos);
      // Si sale bien, Inventario cierra el formulario (este componente se desmonta)
    } catch (error) {
      setErrorGeneral(mensajeError(error, 'No se pudo guardar el insumo.'));
      guardandoRef.current = false;
      setGuardando(false);
    }
  };

  return (
    <Panel
      titulo={editando ? `Editar «${insumo.nombre}»` : 'Nuevo insumo'}
      descripcion={editando ? 'Actualiza los datos de la materia prima.' : 'Registra una nueva materia prima en el inventario.'}
    >
      <form onSubmit={enviar} noValidate className="flex flex-col gap-4 px-5 pb-5">
        {errorGeneral && <Aviso tipo="error">{errorGeneral}</Aviso>}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          <Campo
            ref={refNombre}
            etiqueta="Nombre"
            value={valores.nombre}
            onChange={cambiar('nombre')}
            error={errores.nombre}
            placeholder="Ej.: Harina de trigo"
            maxLength={255}
          />
          <Campo
            ref={refUnidad}
            etiqueta="Unidad de medida"
            value={valores.unidad_medida}
            onChange={cambiar('unidad_medida')}
            error={errores.unidad_medida}
            ayuda="Ej.: kg, litros, unidades"
            maxLength={255}
          />
          <Campo
            ref={refCantidad}
            etiqueta="Cantidad disponible"
            inputMode="decimal"
            value={valores.cantidad_disponible}
            onChange={cambiar('cantidad_disponible')}
            error={errores.cantidad_disponible}
            ayuda="Hasta 4 decimales"
          />
          <Campo
            ref={refMinimo}
            etiqueta="Stock mínimo"
            inputMode="decimal"
            value={valores.stock_minimo}
            onChange={cambiar('stock_minimo')}
            error={errores.stock_minimo}
            ayuda="Por debajo de este valor se marca «Stock bajo»"
          />
          <Campo
            ref={refPrecio}
            etiqueta="Precio unitario (COP)"
            inputMode="decimal"
            value={valores.precio_unitario}
            onChange={cambiar('precio_unitario')}
            error={errores.precio_unitario}
            ayuda="Hasta 2 decimales"
          />
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Boton variante="contorno" onClick={onCancelar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton type="submit" cargando={guardando}>
            {editando ? 'Guardar cambios' : 'Guardar insumo'}
          </Boton>
        </div>
      </form>
    </Panel>
  );
};

export default FormularioInsumo;
