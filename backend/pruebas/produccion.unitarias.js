// Pruebas unitarias del rechazo de precios unitarios inválidos en Producción (recetas.service y
// ordenes.service). Sustituyen al caso de la suite de integración que fijaba un precio negativo
// escribiendo directamente en materia_prima: la API ya no permite crear ese dato, pero puede existir
// de antes, y Producción debe rechazarlo (422) antes de descontar stock o crear la orden.
// No usan la base de datos ni el servidor: los modelos y la transacción se sustituyen por dobles en
// memoria. Se pueden ejecutar en cualquier momento.
//
// Uso (desde backend/):  node pruebas/produccion.unitarias.js

// Seguridad: antes de cargar la configuración, la conexión apunta a un host que no existe (dominio
// .invalid, reservado) y toda conexión de red queda bloqueada. Si alguna consulta escapara a los
// dobles, fallaría al instante sin llegar nunca a pansys_db ni a pansys_test.
process.env.DB_HOST = 'base-inexistente.invalid';
process.env.DB_NAME = 'sin_base_pruebas_unitarias';
const net = require('net');
const tls = require('tls');
const redBloqueada = () => { throw new Error('Red bloqueada en las pruebas unitarias'); };
net.connect = net.createConnection = redBloqueada;
net.Socket.prototype.connect = redBloqueada;
tls.connect = redBloqueada;
require('dotenv').config({ quiet: true });

const resultados = [];
const igual = (descripcion, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  resultados.push(ok);
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${descripcion}${ok ? '' : ` -> obtenido ${JSON.stringify(real)}, esperado ${JSON.stringify(esperado)}`}`);
};
const resultado = (promesa) => promesa.then(r => ({ ok: true, r }), e => ({ ok: false, e }));

const main = async () => {
  const { sequelize, Producto, MateriaPrima, RecetaProducto, OrdenProduccion, InsumoUsado } = require('../src/models/index');
  const recetasService = require('../src/modules/produccion/recetas.service');
  const ordenesService = require('../src/modules/produccion/ordenes.service');
  const { ErrorNegocio, responderError } = require('../src/utils/errores');

  const originales = {
    transaction: sequelize.transaction,
    productoFindOne: Producto.findOne,
    recetaFindAll: RecetaProducto.findAll,
    materiaFindAll: MateriaPrima.findAll,
    materiaUpdate: MateriaPrima.update,
    ordenCreate: OrdenProduccion.create,
    ordenFindOne: OrdenProduccion.findOne,
    insumosBulkCreate: InsumoUsado.bulkCreate
  };

  // Escenario: producto 40 de la panadería 20 con una receta de materias primas de esa panadería
  let eventos;
  let materias;
  let lineas;
  const preparar = (precios) => {
    eventos = [];
    materias = Object.entries(precios).map(([id, precio]) => {
      const valores = { disponible: 100, minimo: 0, precio };
      return {
        id: Number(id), nombre: `Insumo ${id}`, unidad_medida: 'kg', panaderia_id: 20, estado: true,
        get: (campo) => valores[campo]
      };
    });
    lineas = materias.map(m => ({ materia_prima_id: m.id, cantidad_por_unidad: 0.01 }));
  };

  // Transacción gestionada falsa: ejecuta el callback y confirma, o lo deshace todo
  sequelize.transaction = async (fn) => {
    eventos.push('inicio');
    try {
      const r = await fn({ LOCK: { UPDATE: 'UPDATE' } });
      eventos.push('commit');
      return r;
    } catch (error) {
      eventos.push('rollback');
      throw error;
    }
  };
  Producto.findOne = async ({ where }) => (where.id === 40 && (!where.panaderia_id || where.panaderia_id === 20)
    ? { id: 40, nombre: 'Pan salado', panaderia_id: 20, estado: true } : null);
  RecetaProducto.findAll = async () => lineas;
  MateriaPrima.findAll = async (opciones) => {
    if (opciones?.lock) eventos.push('bloqueo-materias');
    return materias;
  };
  // Cualquier escritura queda registrada: en los casos inválidos no debe ocurrir ninguna
  MateriaPrima.update = async () => { eventos.push('descuento'); return [1]; };
  OrdenProduccion.create = async () => { eventos.push('orden'); return { id: 1 }; };
  OrdenProduccion.findOne = async () => { eventos.push('lectura-orden'); return { id: 1 }; };
  InsumoUsado.bulkCreate = async () => { eventos.push('insumos'); return []; };
  const ESCRITURAS = ['descuento', 'orden', 'insumos'];

  try {
    // ---------- calcular ----------
    console.log('\n== calcular: precio negativo heredado');
    preparar({ 30: -5 });
    const calculo = await resultado(recetasService.calcular(40, 10, 20));
    igual('precio negativo -> ErrorNegocio 422', [calculo.ok, calculo.e instanceof ErrorNegocio, calculo.e?.status], [false, true, 422]);
    igual('señala la materia prima con el precio inválido', calculo.e?.detalle, { materias_primas: [30] });
    igual('el mensaje pide corregirlo en Inventario', /precio unitario inválido/.test(calculo.e?.message ?? ''), true);
    igual('calcular no escribe nada', eventos.filter(e => ESCRITURAS.includes(e)), []);

    preparar({ 30: 1.5, 31: -0.0001, 32: 0 });
    const mezcla = await resultado(recetasService.calcular(40, 10, 20));
    igual('con varios insumos solo señala el de precio negativo (0 es válido)', [mezcla.e?.status, mezcla.e?.detalle], [422, { materias_primas: [31] }]);

    preparar({ 30: 1.5, 32: 0 });
    const valido = await resultado(recetasService.calcular(40, 10, 20));
    igual('control: precios válidos (incluido 0) -> cálculo correcto', [valido.ok, valido.r?.insumos?.map(i => i.precio_unitario)], [true, [1.5, 0]]);

    // ---------- crear orden ----------
    console.log('\n== crear orden: precio negativo heredado');
    preparar({ 30: -5 });
    const orden = await resultado(ordenesService.crear({ producto_id: 40, cantidad_planificada: 10 }, 20, 11));
    igual('orden con precio negativo -> ErrorNegocio 422 con la materia prima', [orden.ok, orden.e?.status, orden.e?.detalle], [false, 422, { materias_primas: [30] }]);
    igual('se rechaza dentro de la transacción, tras bloquear las materias primas, y se deshace',
      eventos, ['inicio', 'bloqueo-materias', 'rollback']);
    igual('ni descuento de stock, ni orden, ni insumos', eventos.filter(e => ESCRITURAS.includes(e)), []);

    // ---------- respuesta HTTP ----------
    console.log('\n== respuesta HTTP del rechazo');
    const respuesta = { codigo: null, cuerpo: null, status(c) { this.codigo = c; return this; }, json(b) { this.cuerpo = b; return this; } };
    responderError(respuesta, orden.e);
    igual('422 con solo el mensaje y las materias primas (sin detalles internos)',
      [respuesta.codigo, Object.keys(respuesta.cuerpo ?? {}).sort(), respuesta.cuerpo?.materias_primas], [422, ['error', 'materias_primas'], [30]]);

    preparar({ 30: 2 });
    const control = await resultado(ordenesService.crear({ producto_id: 40, cantidad_planificada: 10 }, 20, 11));
    igual('control: con un precio válido la orden sí descuenta, se crea y guarda sus insumos',
      [control.ok, ESCRITURAS.every(e => eventos.includes(e)), eventos.indexOf('commit') > eventos.indexOf('insumos')], [true, true, true]);
  } finally {
    sequelize.transaction = originales.transaction;
    Producto.findOne = originales.productoFindOne;
    RecetaProducto.findAll = originales.recetaFindAll;
    MateriaPrima.findAll = originales.materiaFindAll;
    MateriaPrima.update = originales.materiaUpdate;
    OrdenProduccion.create = originales.ordenCreate;
    OrdenProduccion.findOne = originales.ordenFindOne;
    InsumoUsado.bulkCreate = originales.insumosBulkCreate;
  }
};

main()
  .catch(error => { resultados.push(false); console.log('FALLA ejecución abortada ->', error.message); })
  .finally(() => {
    const fallidas = resultados.filter(ok => !ok).length;
    console.log(`\n${resultados.length - fallidas}/${resultados.length} pruebas correctas`);
    process.exit(fallidas ? 1 : 0);
  });
