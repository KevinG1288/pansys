import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookOpenText, Pencil, Plus, Trash2 } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { mensajeError } from '../lib/errores';
import { formatCOP, formatNumber } from '../lib/formato';
import { puedeEscribir } from '../lib/permisos';
import Aviso from '../components/ui/Aviso';
import Boton from '../components/ui/Boton';
import DialogoConfirmacion from '../components/ui/DialogoConfirmacion';
import EstadoVacio from '../components/ui/EstadoVacio';
import { PageHeader } from '../components/ui/Panel';
import StatusBadge from '../components/ui/StatusBadge';
import { Tabla, TablaCelda, TablaColumna, TablaCuerpo, TablaEncabezado, TablaFila } from '../components/ui/Tabla';
import EditorReceta from '../components/recetas/EditorReceta';

// Panadería con la que trabaja la interfaz (para panadero y gerente el backend usa la del token;
// para el administrador acota las consultas a esta panadería)
const PANADERIA_ID = 1;
const ID_AVISO_CONSULTA = 'aviso-modo-consulta-recetas';

const Recetas = () => {
  const { usuario } = useAuth();
  const escribe = puedeEscribir(usuario);

  const [recetas, setRecetas] = useState([]);
  const [materias, setMaterias] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [errorRecetas, setErrorRecetas] = useState(null);
  const [errorMaterias, setErrorMaterias] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [editando, setEditando] = useState(null);
  const [porEliminar, setPorEliminar] = useState(null);
  const [eliminando, setEliminando] = useState(false);
  const [errorEliminar, setErrorEliminar] = useState(null);

  const cargarRecetas = useCallback(async () => {
    setErrorRecetas(null);
    try {
      const res = await api.get(`/api/produccion/recetas?panaderia_id=${PANADERIA_ID}`);
      setRecetas(res.data);
    } catch (error) {
      setErrorRecetas(mensajeError(error, 'No se pudieron cargar las recetas.'));
    }
  }, []);

  // Materias primas activas (para elegir insumos y estimar el costo por unidad)
  const cargarMaterias = useCallback(async () => {
    setErrorMaterias(null);
    try {
      const res = await api.get(`/api/inventario?panaderia_id=${PANADERIA_ID}`);
      setMaterias(res.data);
    } catch (error) {
      setErrorMaterias(mensajeError(error, 'No se pudieron cargar las materias primas.'));
    }
  }, []);

  useEffect(() => {
    Promise.allSettled([cargarRecetas(), cargarMaterias()]).then(() => setCargando(false));
  }, [cargarRecetas, cargarMaterias]);

  const precioDe = useMemo(() => new Map(materias.map(m => [m.id, Number(m.precio_unitario) || 0])), [materias]);

  // Estimación con los precios actuales del inventario; null si falta el precio de algún insumo
  const costoPorUnidad = (receta) => {
    const insumos = receta.insumos ?? [];
    if (insumos.length === 0 || insumos.some(i => !precioDe.has(i.materia_prima_id))) return null;
    return insumos.reduce((suma, i) => suma + Number(i.cantidad_por_unidad) * precioDe.get(i.materia_prima_id), 0);
  };

  const guardarReceta = async (cuerpo, existe) => {
    const producto = editando;
    const url = `/api/produccion/recetas/${producto.producto_id}?panaderia_id=${PANADERIA_ID}`;
    if (existe) await api.put(url, cuerpo);
    else await api.post(url, cuerpo);
    setEditando(null);
    setAviso({ tipo: 'exito', texto: existe ? `Receta de «${producto.producto}» actualizada.` : `Receta de «${producto.producto}» creada.` });
    await cargarRecetas();
  };

  const confirmarEliminacion = async () => {
    setEliminando(true);
    setErrorEliminar(null);
    try {
      await api.delete(`/api/produccion/recetas/${porEliminar.producto_id}?panaderia_id=${PANADERIA_ID}`);
      setAviso({ tipo: 'exito', texto: `Receta de «${porEliminar.producto}» eliminada. Las órdenes existentes no cambian.` });
      setPorEliminar(null);
      await cargarRecetas();
    } catch (error) {
      setErrorEliminar(mensajeError(error, 'No se pudo eliminar la receta.'));
    } finally {
      setEliminando(false);
    }
  };

  const abrirEditor = (receta) => {
    setAviso(null);
    setEditando(receta);
  };

  const descritoPor = escribe ? undefined : ID_AVISO_CONSULTA;

  return (
    <div className="pansys-ui flex-1 px-4 py-6 md:px-6 lg:px-8 lg:py-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <PageHeader
          antetitulo="Módulo"
          titulo="Recetas"
          descripcion="Define qué materias primas necesita cada producto. Las órdenes de producción usan estas recetas."
        />

        {!escribe && (
          <Aviso tipo="info" id={ID_AVISO_CONSULTA}>
            Modo consulta: tu rol permite ver las recetas, pero no crearlas, editarlas ni eliminarlas.
          </Aviso>
        )}

        {aviso && <Aviso tipo={aviso.tipo} onCerrar={() => setAviso(null)}>{aviso.texto}</Aviso>}
        {errorMaterias && <Aviso tipo="error" titulo="No se pudieron cargar las materias primas">{errorMaterias}</Aviso>}

        {editando && (
          <EditorReceta
            key={editando.producto_id}
            receta={editando}
            materias={materias}
            onGuardar={guardarReceta}
            onCancelar={() => setEditando(null)}
          />
        )}

        {cargando ? (
          <p role="status" className="rounded-2xl border border-border/80 bg-card px-5 py-10 text-center text-sm text-muted-foreground">
            Cargando recetas…
          </p>
        ) : errorRecetas ? (
          <Aviso tipo="error" titulo="No se pudieron cargar las recetas">{errorRecetas}</Aviso>
        ) : recetas.length === 0 ? (
          <section className="rounded-2xl border border-border/80 bg-card shadow-panel">
            <EstadoVacio icono={BookOpenText} titulo="No hay productos" descripcion="Crea productos en Ventas para definir sus recetas." />
          </section>
        ) : (
          <section aria-label="Recetas por producto" className="rounded-2xl border border-border/80 bg-card shadow-panel">
            <Tabla>
              <TablaEncabezado>
                <tr>
                  <TablaColumna>Producto</TablaColumna>
                  <TablaColumna>Insumos por unidad</TablaColumna>
                  <TablaColumna className="text-right">Costo estimado por unidad</TablaColumna>
                  <TablaColumna>Estado</TablaColumna>
                  <TablaColumna className="text-right">Acciones</TablaColumna>
                </tr>
              </TablaEncabezado>
              <TablaCuerpo>
                {recetas.map(receta => {
                  const insumos = receta.insumos ?? [];
                  const tiene = insumos.length > 0;
                  const inactivos = insumos.filter(i => !i.activo);
                  const costo = costoPorUnidad(receta);
                  return (
                    <TablaFila key={receta.producto_id}>
                      <TablaCelda className="font-medium">{receta.producto}</TablaCelda>
                      <TablaCelda>
                        {tiene ? (
                          <ul className="flex flex-col gap-0.5 text-sm">
                            {insumos.map(i => (
                              <li key={i.materia_prima_id}>
                                {i.nombre ?? `#${i.materia_prima_id}`}: {formatNumber(i.cantidad_por_unidad)} {i.unidad_medida}
                                {!i.activo && <span className="text-destructive"> (inactiva)</span>}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <span className="text-sm text-muted-foreground">Sin receta</span>
                        )}
                      </TablaCelda>
                      <TablaCelda className="text-right tabular-nums">{costo === null ? '—' : formatCOP(costo)}</TablaCelda>
                      <TablaCelda>
                        {!tiene ? (
                          <StatusBadge tono="neutro">Sin receta</StatusBadge>
                        ) : inactivos.length > 0 ? (
                          <StatusBadge tono="alerta">Usa insumos inactivos</StatusBadge>
                        ) : (
                          <StatusBadge tono="exito">Lista para producir</StatusBadge>
                        )}
                      </TablaCelda>
                      <TablaCelda>
                        <div className="flex justify-end gap-1">
                          <Boton
                            variante="fantasma"
                            tamano="sm"
                            onClick={() => abrirEditor(receta)}
                            disabled={!escribe || Boolean(editando)}
                            aria-describedby={descritoPor}
                            aria-label={tiene ? `Editar receta de ${receta.producto}` : `Crear receta de ${receta.producto}`}
                          >
                            {tiene ? <Pencil className="size-4" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}
                            {tiene ? 'Editar' : 'Crear'}
                          </Boton>
                          {tiene && (
                            <Boton
                              variante="fantasma"
                              tamano="icono"
                              onClick={() => { setErrorEliminar(null); setPorEliminar(receta); }}
                              disabled={!escribe}
                              aria-describedby={descritoPor}
                              aria-label={`Eliminar receta de ${receta.producto}`}
                              className="text-destructive hover:bg-destructive/10"
                            >
                              <Trash2 className="size-4" aria-hidden="true" />
                            </Boton>
                          )}
                        </div>
                      </TablaCelda>
                    </TablaFila>
                  );
                })}
              </TablaCuerpo>
            </Tabla>
          </section>
        )}
      </div>

      {porEliminar && (
        <DialogoConfirmacion
          titulo={`¿Eliminar la receta de «${porEliminar.producto}»?`}
          descripcion="El producto no podrá producirse hasta tener una receta nueva. Las órdenes ya creadas conservan su copia de insumos."
          textoConfirmar="Eliminar"
          confirmando={eliminando}
          error={errorEliminar}
          onConfirmar={confirmarEliminacion}
          onCancelar={() => setPorEliminar(null)}
        />
      )}
    </div>
  );
};

export default Recetas;
