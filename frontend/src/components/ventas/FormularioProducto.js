import { useEffect, useRef, useState } from 'react';
import { mensajeError } from '../../lib/errores';
import { leerNumero, leerTexto, validar } from '../../lib/validacion';
import Aviso from '../ui/Aviso';
import Boton from '../ui/Boton';
import Campo from '../ui/Campo';
import { Panel } from '../ui/Panel';

const CAMPOS = ['nombre', 'precio_compra', 'precio_venta', 'cantidad_disponible'];

// productos: precios FLOAT y cantidad_disponible INT en la base de datos
const REGLAS = {
  nombre: (v) => leerTexto(v),
  precio_compra: (v) => leerNumero(v, { decimales: 2, maximo: 100000000 }),
  precio_venta: (v) => leerNumero(v, { decimales: 2, maximo: 100000000 }),
  cantidad_disponible: (v) => leerNumero(v, { entero: true, maximo: 100000 })
};

const VACIO = { nombre: '', precio_compra: '', precio_venta: '', cantidad_disponible: '' };

// Alta de producto. Valida, convierte (texto recortado y números JSON) y entrega los datos a onGuardar
const FormularioProducto = ({ onGuardar, onCancelar }) => {
  const [valores, setValores] = useState(VACIO);
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

    const { datos, errores: nuevosErrores, valido } = validar(valores, REGLAS);
    setErrores(nuevosErrores);
    setErrorGeneral(null);
    if (!valido) {
      refs[CAMPOS.find(c => nuevosErrores[c])].current?.focus();
      return;
    }

    guardandoRef.current = true;
    setGuardando(true);
    try {
      await onGuardar(datos);
      // Si sale bien, Ventas cierra el formulario (este componente se desmonta)
    } catch (error) {
      setErrorGeneral(mensajeError(error, 'No se pudo crear el producto.'));
      guardandoRef.current = false;
      setGuardando(false);
    }
  };

  return (
    <Panel titulo="Nuevo producto" descripcion="Registra un producto para venderlo en el punto de venta.">
      <form onSubmit={enviar} noValidate className="flex flex-col gap-4 px-5 pb-5">
        {errorGeneral && <Aviso tipo="error">{errorGeneral}</Aviso>}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Campo ref={refNombre} etiqueta="Nombre" value={valores.nombre} onChange={cambiar('nombre')} error={errores.nombre} placeholder="Ej.: Pan rollo" maxLength={255} />
          <Campo ref={refCompra} etiqueta="Precio de compra (COP)" inputMode="decimal" value={valores.precio_compra} onChange={cambiar('precio_compra')} error={errores.precio_compra} />
          <Campo ref={refVenta} etiqueta="Precio de venta (COP)" inputMode="decimal" value={valores.precio_venta} onChange={cambiar('precio_venta')} error={errores.precio_venta} />
          <Campo ref={refCantidad} etiqueta="Cantidad disponible" inputMode="numeric" value={valores.cantidad_disponible} onChange={cambiar('cantidad_disponible')} error={errores.cantidad_disponible} ayuda="Unidades enteras" />
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Boton variante="contorno" onClick={onCancelar} disabled={guardando}>Cancelar</Boton>
          <Boton type="submit" cargando={guardando}>Guardar producto</Boton>
        </div>
      </form>
    </Panel>
  );
};

export default FormularioProducto;
