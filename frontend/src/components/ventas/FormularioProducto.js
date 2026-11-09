import { useEffect, useRef, useState } from 'react';
import { mensajeError } from '../../lib/errores';
import { formatNumber } from '../../lib/formato';
import { leerNumero, leerTexto, validar } from '../../lib/validacion';
import Aviso from '../ui/Aviso';
import Boton from '../ui/Boton';
import Campo from '../ui/Campo';
import Dialogo from '../ui/Dialogo';

const CAMPOS = ['nombre', 'precio_compra', 'precio_venta', 'cantidad_disponible'];
// Edición (RF-13): las existencias no se editan; cambian solo con ventas y producción
const CAMPOS_EDICION = ['nombre', 'precio_compra', 'precio_venta'];

// productos: precios FLOAT y cantidad_disponible INT en la base de datos (mismos límites que el backend)
const REGLAS = {
  nombre: (v) => leerTexto(v),
  precio_compra: (v) => leerNumero(v, { decimales: 2, maximo: 100000000 }),
  precio_venta: (v) => leerNumero(v, { decimales: 2, maximo: 100000000 }),
  cantidad_disponible: (v) => leerNumero(v, { entero: true, maximo: 100000 })
};
const REGLAS_EDICION = Object.fromEntries(CAMPOS_EDICION.map(c => [c, REGLAS[c]]));

const VACIO = { nombre: '', precio_compra: '', precio_venta: '', cantidad_disponible: '' };

// Precio guardado (FLOAT) a texto editable con máximo 2 decimales
const precioATexto = (valor) => {
  const numero = Number(valor);
  return Number.isFinite(numero) && numero >= 0 ? String(Math.round(numero * 100) / 100) : '';
};

const valoresDe = (producto) => ({
  nombre: producto.nombre ?? '',
  precio_compra: precioATexto(producto.precio_compra ?? 0),
  precio_venta: precioATexto(producto.precio_venta),
  cantidad_disponible: ''
});

// Alta (sin `producto`) o edición (con `producto`) de un producto. Valida, convierte (texto recortado
// y números JSON) y entrega los datos a onGuardar. En edición solo entrega los campos que cambiaron.
const FormularioProducto = ({ producto = null, onGuardar, onCancelar }) => {
  const editando = Boolean(producto);
  const [valores, setValores] = useState(() => (editando ? valoresDe(producto) : VACIO));
  const [errores, setErrores] = useState({});
  const [errorGeneral, setErrorGeneral] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const guardandoRef = useRef(false);

  const refNombre = useRef(null);
  const refCompra = useRef(null);
  const refVenta = useRef(null);
  const refCantidad = useRef(null);
  const refs = { nombre: refNombre, precio_compra: refCompra, precio_venta: refVenta, cantidad_disponible: refCantidad };

  useEffect(() => {
    refNombre.current?.focus();
  }, []);

  const cambiar = (campo) => (evento) => {
    setValores(v => ({ ...v, [campo]: evento.target.value }));
  };

  const enviar = async (evento) => {
    evento.preventDefault();
    if (guardandoRef.current) return;

    const campos = editando ? CAMPOS_EDICION : CAMPOS;
    const { datos, errores: nuevosErrores, valido } = validar(valores, editando ? REGLAS_EDICION : REGLAS);
    setErrores(nuevosErrores);
    setErrorGeneral(null);
    if (!valido) {
      refs[campos.find(c => nuevosErrores[c])].current?.focus();
      return;
    }

    // En edición se envían solo los campos modificados (así no se pisa otro cambio simultáneo)
    let envio = datos;
    if (editando) {
      const original = valoresDe(producto);
      envio = Object.fromEntries(Object.entries(datos).filter(([c, v]) =>
        c === 'nombre' ? v !== original.nombre.trim() : v !== Number(original[c])
      ));
      if (Object.keys(envio).length === 0) {
        setErrorGeneral('No hay cambios para guardar.');
        return;
      }
    }

    guardandoRef.current = true;
    setGuardando(true);
    try {
      await onGuardar(envio);
      // Si sale bien, Ventas cierra el formulario (este componente se desmonta)
    } catch (error) {
      setErrorGeneral(mensajeError(error, editando ? 'No se pudo guardar el producto.' : 'No se pudo crear el producto.'));
      guardandoRef.current = false;
      setGuardando(false);
    }
  };

  return (
    <Dialogo
      lateral
      bloqueado={guardando}
      refFocoInicial={refNombre}
      onCerrar={onCancelar}
      className="sm:max-w-2xl"
      titulo={editando ? 'Editar producto' : 'Nuevo producto'}
      descripcion={editando
        ? 'Actualiza el nombre y los precios. Las ventas ya registradas conservan el precio con que se vendieron.'
        : 'Registra un producto para venderlo en el punto de venta.'}
    >
      <form onSubmit={enviar} noValidate className="flex flex-col gap-5">
        {errorGeneral && <Aviso tipo="error">{errorGeneral}</Aviso>}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 sm:grid-cols-2">
          <Campo ref={refNombre} etiqueta="Nombre" value={valores.nombre} onChange={cambiar('nombre')} error={errores.nombre} placeholder="Ej.: Pan rollo" maxLength={255} />
          <Campo ref={refCompra} etiqueta="Precio de compra (COP)" inputMode="decimal" value={valores.precio_compra} onChange={cambiar('precio_compra')} error={errores.precio_compra} />
          <Campo ref={refVenta} etiqueta="Precio de venta (COP)" inputMode="decimal" value={valores.precio_venta} onChange={cambiar('precio_venta')} error={errores.precio_venta} />
          {editando ? (
            <div className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Existencias actuales</span>
              <p className="tabular-nums">{formatNumber(producto.cantidad_disponible)} unidades</p>
              <p className="text-xs text-muted-foreground">No se editan aquí: cambian con las ventas y la producción.</p>
            </div>
          ) : (
            <Campo ref={refCantidad} etiqueta="Cantidad disponible" inputMode="numeric" value={valores.cantidad_disponible} onChange={cambiar('cantidad_disponible')} error={errores.cantidad_disponible} ayuda="Unidades enteras" />
          )}
        </div>
        <div className="sticky bottom-0 -mx-5 -mb-5 mt-3 flex flex-col-reverse gap-2 border-t border-border bg-card px-5 py-4 sm:-mx-6 sm:flex-row sm:justify-end sm:px-6">
          <Boton variante="contorno" onClick={onCancelar} disabled={guardando}>Cancelar</Boton>
          <Boton type="submit" cargando={guardando}>{editando ? 'Guardar cambios' : 'Guardar producto'}</Boton>
        </div>
      </form>
    </Dialogo>
  );
};

export default FormularioProducto;
