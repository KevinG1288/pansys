import { useEffect, useRef, useState } from 'react';
import { mensajeError } from '../../lib/errores';
import { leerNumero, leerTexto, MAXIMO_DECIMAL_12_4, validar } from '../../lib/validacion';
import Aviso from '../ui/Aviso';
import Boton from '../ui/Boton';
import Campo from '../ui/Campo';
import Dialogo from '../ui/Dialogo';

const CAMPOS = ['nombre', 'unidad_medida', 'cantidad_disponible', 'stock_minimo', 'precio_unitario'];

// Mismos límites que valida el backend en el POST y el PUT de /api/inventario: las tres columnas
// son DECIMAL(12,4), de 0 a 99.999.999,9999 con máximo 4 decimales (también el precio)
const REGLA_DECIMAL = (v) => leerNumero(v, { decimales: 4, maximo: MAXIMO_DECIMAL_12_4 });
const REGLAS = {
  nombre: (v) => leerTexto(v),
  unidad_medida: (v) => leerTexto(v),
  cantidad_disponible: REGLA_DECIMAL,
  stock_minimo: REGLA_DECIMAL,
  precio_unitario: REGLA_DECIMAL
};

// Valor numérico del backend como texto editable. Con 4 decimales no se pierde nada: es la
// precisión de la columna, así que editar y guardar no redondea el valor existente.
const comoTexto = (valor) =>
  valor === null || valor === undefined ? '' : String(Number(Number(valor).toFixed(4)));

const valoresIniciales = (insumo) => ({
  nombre: insumo?.nombre ?? '',
  unidad_medida: insumo?.unidad_medida ?? '',
  cantidad_disponible: insumo ? comoTexto(insumo.cantidad_disponible) : '',
  stock_minimo: insumo ? comoTexto(insumo.stock_minimo) : '',
  precio_unitario: insumo ? comoTexto(insumo.precio_unitario) : ''
});

// Formulario de alta y edición. Valida, convierte (textos recortados y números JSON)
// y entrega los datos a onGuardar, que hace la petición; si falla, muestra el error del backend.
const FormularioInsumo = ({ insumo, onGuardar, onCancelar, onRecargar }) => {
  const editando = Boolean(insumo);
  const [valores, setValores] = useState(() => valoresIniciales(insumo));
  const [errores, setErrores] = useState({});
  const [errorGeneral, setErrorGeneral] = useState(null);
  const [conflicto, setConflicto] = useState(false);
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
    if (guardandoRef.current || conflicto) return;

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
      setConflicto(error.response?.status === 409 && error.response?.data?.codigo === 'VERSION_DESACTUALIZADA');
      setErrorGeneral(mensajeError(error, 'No se pudo guardar el insumo.'));
      guardandoRef.current = false;
      setGuardando(false);
    }
  };

  return (
    <Dialogo lateral bloqueado={guardando} refFocoInicial={refNombre} onCerrar={onCancelar}
      titulo={editando ? `Editar «${insumo.nombre}»` : 'Nuevo insumo'}
      descripcion={editando ? 'Actualiza los datos de la materia prima.' : 'Registra una nueva materia prima en el inventario.'}
    >
      <form onSubmit={enviar} noValidate className="flex flex-col gap-5">
        {errorGeneral && <Aviso tipo="error">{errorGeneral}</Aviso>}
        {conflicto && <Aviso tipo="info">
          <p>El insumo cambió mientras lo editabas. Tus datos escritos se conservan. Para continuar, carga la versión actual; esta acción reemplazará los valores del formulario. Después revisa y guarda manualmente.</p>
          <Boton variante="contorno" className="mt-3" cargando={guardando} onClick={async () => {
            if (guardandoRef.current) return;
            guardandoRef.current = true; setGuardando(true);
            try { await onRecargar(); }
            catch (e) { setErrorGeneral(mensajeError(e, e.message || 'No se pudo actualizar el insumo.')); }
            finally { guardandoRef.current = false; setGuardando(false); }
          }}>Cargar versión actual</Boton>
        </Aviso>}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
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
            ayuda="Hasta 4 decimales"
          />
        </div>
        <div className="pansys-form-actions sticky bottom-0 -mx-5 -mb-5 mt-2 flex flex-col-reverse gap-2 border-t border-border bg-card px-5 py-4 sm:-mx-6 sm:flex-row sm:justify-end sm:px-6">
          <Boton variante="contorno" onClick={onCancelar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton type="submit" cargando={guardando} disabled={conflicto}>
            {editando ? 'Guardar cambios' : 'Guardar insumo'}
          </Boton>
        </div>
      </form>
    </Dialogo>
  );
};

export default FormularioInsumo;
