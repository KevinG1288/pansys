// Pruebas unitarias del aislamiento por panadería que no cubren las demás suites unitarias:
// - exigirPanaderiaId (produccion.validaciones): solo un entero positivo es una panadería autorizada;
// - toda búsqueda por id de Inventario, Órdenes y Recetas lleva el filtro de panadería y, sin una
//   panadería válida, falla como error interno SIN enviar ninguna consulta (nunca busca sin filtro);
// - recetas inconsistentes (una línea que apunta a una materia prima de otra panadería, solo
//   posible con datos anteriores o SQL manual): calcular y crear la rechazan (422) sin leer ni
//   bloquear la materia prima ajena, y listar y obtener no revelan su nombre, unidad ni estado;
// - revisión del código: rutas sin panadería opcional, servicios sin búsquedas condicionales,
//   materias primas de recetas filtradas por panadería, ninguna llamada interna con null como
//   panadería y cuentas sin cambios de panadería.
// El middleware, el registro y la gestión de cuentas se prueban en respuestas.unitarias.js,
// auth.unitarias.js y usuarios.unitarias.js.
// No usan la base de datos ni el servidor: los modelos y la transacción se sustituyen por dobles en
// memoria. Se pueden ejecutar en cualquier momento.
//
// Uso (desde backend/):  node pruebas/permisos.unitarias.js

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

const fs = require('fs');
const path = require('path');

const resultados = [];
const igual = (descripcion, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  resultados.push(ok);
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${descripcion}${ok ? '' : ` -> obtenido ${JSON.stringify(real)}, esperado ${JSON.stringify(esperado)}`}`);
};
const resultado = (promesa) => promesa.then(r => ({ ok: true, r }), e => ({ ok: false, e }));
const lanza = (fn) => { try { fn(); return null; } catch (e) { return e; } };

const main = async () => {
  const { sequelize, MateriaPrima, Producto, OrdenProduccion, RecetaProducto } = require('../src/models/index');
  const inventarioService = require('../src/modules/inventario/inventario.service');
  const ordenesService = require('../src/modules/produccion/ordenes.service');
  const recetasService = require('../src/modules/produccion/recetas.service');
  const { exigirPanaderiaId } = require('../src/modules/produccion/produccion.validaciones');
  const { ErrorNegocio } = require('../src/utils/errores');

  // ---------- exigirPanaderiaId ----------
  console.log('\n== exigirPanaderiaId');
  for (const valor of [1, 20, 2147483647]) {
    igual(`${valor} -> se acepta`, [lanza(() => exigirPanaderiaId(valor)), exigirPanaderiaId(valor)], [null, valor]);
  }
  for (const valor of [null, undefined, 0, -1, 1.5, '20', NaN, Infinity, true, {}]) {
    const error = lanza(() => exigirPanaderiaId(valor));
    igual(`${String(valor)} (${typeof valor}) -> error interno (no de negocio)`,
      [error instanceof Error, error instanceof ErrorNegocio, error?.message], [true, false, 'Consulta por id sin una panadería autorizada']);
  }

  // ---------- Búsquedas por id ----------
  const originales = {
    materiaFindOne: MateriaPrima.findOne, productoFindOne: Producto.findOne,
    ordenFindOne: OrdenProduccion.findOne, transaction: sequelize.transaction
  };
  // Ningún registro existe: con una panadería válida se llega a la consulta (y al "no encontrado")
  let consultas;
  MateriaPrima.findOne = async (opciones) => { consultas.push(['materia_prima', opciones?.where]); return null; };
  Producto.findOne = async (opciones) => { consultas.push(['productos', opciones?.where]); return null; };
  OrdenProduccion.findOne = async (opciones) => { consultas.push(['orden_produccion', opciones?.where]); return null; };
  sequelize.transaction = async (fn) => fn({ LOCK: { UPDATE: 'UPDATE' } });

  // [descripción, llamada(panaderiaId), código y mensaje esperados con una panadería válida]
  const busquedas = [
    ['inventario.getById', (p) => inventarioService.getById('30', p), 404, 'Materia prima no encontrada'],
    ['inventario.actualizar', (p) => inventarioService.actualizar('30', { precio_unitario: '1' }, p), 400, 'Materia prima no encontrada'],
    ['inventario.eliminar', (p) => inventarioService.eliminar('30', p), 400, 'Materia prima no encontrada'],
    ['ordenes.obtener', (p) => ordenesService.obtener('5', p), 404, 'Orden de producción no encontrada'],
    ['ordenes.finalizar', (p) => ordenesService.finalizar('5', { cantidad_producida: 1 }, p, 11), 404, 'Orden de producción no encontrada'],
    ['ordenes.cancelar', (p) => ordenesService.cancelar('5', { motivo: 'Prueba', devolver_insumos: false }, p, 11), 404, 'Orden de producción no encontrada'],
    ['recetas.obtenerProducto', (p) => recetasService.obtenerProducto('40', p), 404, 'Producto no encontrado'],
    ['recetas.obtener', (p) => recetasService.obtener('40', p), 404, 'Producto no encontrado'],
    ['recetas.eliminar', (p) => recetasService.eliminar('40', p), 404, 'Producto no encontrado'],
    ['recetas.calcular', (p) => recetasService.calcular('40', 1, p), 404, 'Producto no encontrado']
  ];

  try {
    console.log('\n== búsquedas por id: sin panadería válida no se consulta nada');
    for (const [descripcion, llamar] of busquedas) {
      for (const invalida of [null, undefined, 0, '20']) {
        consultas = [];
        const r = await resultado(llamar(invalida));
        igual(`${descripcion} con panadería ${JSON.stringify(invalida) ?? 'undefined'} -> error interno sin ninguna consulta`,
          [r.ok, r.e instanceof ErrorNegocio, consultas.length], [false, false, 0]);
      }
    }

    console.log('\n== búsquedas por id: siempre con el filtro de la panadería autorizada');
    for (const [descripcion, llamar, codigo, mensaje] of busquedas) {
      consultas = [];
      const r = await resultado(llamar(20));
      igual(`${descripcion} con la panadería 20 -> filtra por ella y responde ${codigo} «${mensaje}» si no está`,
        [r.e instanceof ErrorNegocio, r.e?.status, r.e?.message, consultas.length > 0, consultas.every(([, where]) => where?.panaderia_id === 20)],
        [true, codigo, mensaje, true, true]);
    }
  } finally {
    MateriaPrima.findOne = originales.materiaFindOne;
    Producto.findOne = originales.productoFindOne;
    OrdenProduccion.findOne = originales.ordenFindOne;
    sequelize.transaction = originales.transaction;
  }

  // ---------- Recetas inconsistentes: materia prima de otra panadería ----------
  // Producto 40 de la panadería 20 con una receta de dos líneas: la materia prima 30 (propia) y la
  // 90 (de la panadería 21). Los dobles aplican los where como lo haría MySQL (incluido el de la
  // asociación, que con required: false es un LEFT JOIN con la condición en el ON).
  const originalesRecetas = {
    productoFindOne: Producto.findOne, productoFindAll: Producto.findAll, recetaFindAll: RecetaProducto.findAll,
    materiaFindAll: MateriaPrima.findAll, materiaUpdate: MateriaPrima.update, ordenCreate: OrdenProduccion.create,
    transaction: sequelize.transaction
  };
  const MATERIAS_DB = [
    { id: 30, nombre: 'Harina', unidad_medida: 'kg', panaderia_id: 20, estado: true, disponible: 100, minimo: 0, precio: 2 },
    { id: 90, nombre: 'Insumo Secreto', unidad_medida: 'g', panaderia_id: 21, estado: true, disponible: 100, minimo: 0, precio: 3 }
  ];
  const LINEAS_DB = [{ producto_id: 40, materia_prima_id: 30, cantidad_por_unidad: 0.1 }, { producto_id: 40, materia_prima_id: 90, cantidad_por_unidad: 0.2 }];
  const PRODUCTO_DB = { id: 40, nombre: 'Pan', panaderia_id: 20, estado: true };
  const cumple = (fila, where = {}) => Object.entries(where).every(([c, v]) => (Array.isArray(v) ? v.includes(fila[c]) : fila[c] === v));
  let lecturas; // [{ where, lock, ids devueltos }] de MateriaPrima.findAll
  let asociaciones; // where y required de cada asociación con MateriaPrima
  let escrituras;
  // Asocia a cada línea su materia prima solo si cumple el where de la asociación (LEFT JOIN)
  const conMateria = (linea, include) => {
    const asociacion = (include ?? []).find(i => i.model === MateriaPrima);
    if (!asociacion) return { ...linea };
    asociaciones.push({ where: asociacion.where ?? null, required: asociacion.required });
    const m = MATERIAS_DB.find(x => x.id === linea.materia_prima_id && cumple(x, asociacion.where));
    return { ...linea, MateriaPrima: m ? Object.fromEntries(asociacion.attributes.map(a => [a, m[a]])) : null };
  };
  Producto.findOne = async ({ where }) => (cumple(PRODUCTO_DB, where) ? { ...PRODUCTO_DB } : null);
  Producto.findAll = async ({ where, include }) => (cumple(PRODUCTO_DB, where)
    ? [{ ...PRODUCTO_DB, receta: LINEAS_DB.map(l => conMateria(l, include.find(i => i.model === RecetaProducto)?.include)) }]
    : []);
  RecetaProducto.findAll = async ({ where, include }) => LINEAS_DB.filter(l => cumple(l, where)).map(l => conMateria(l, include));
  MateriaPrima.findAll = async ({ where, lock }) => {
    const filas = MATERIAS_DB.filter(m => cumple(m, where));
    lecturas.push({ where, lock: lock ?? null, ids: filas.map(m => m.id) });
    return filas.map(m => ({ ...m, get: (campo) => m[campo] }));
  };
  MateriaPrima.update = async () => { escrituras.push('descuento'); return [1]; };
  OrdenProduccion.create = async () => { escrituras.push('orden'); return { id: 1 }; };
  sequelize.transaction = async (fn) => {
    escrituras.push('inicio');
    try {
      const r = await fn({ LOCK: { UPDATE: 'UPDATE' } });
      escrituras.push('commit');
      return r;
    } catch (error) {
      escrituras.push('rollback');
      throw error;
    }
  };
  const preparar = () => { lecturas = []; asociaciones = []; escrituras = []; };
  const DATOS_AJENOS = /Insumo Secreto|"g"/;

  try {
    console.log('\n== recetas inconsistentes: calcular y crear rechazan sin leer ni bloquear lo ajeno');
    preparar();
    const calculo = await resultado(recetasService.calcular('40', 1, 20));
    igual('calcular -> 422 con el mensaje y la materia prima de siempre',
      [calculo.e instanceof ErrorNegocio, calculo.e?.status, calculo.e?.message, calculo.e?.detalle],
      [true, 422, 'La receta incluye materias primas inactivas o de otra panadería', { materias_primas: [90] }]);
    igual('calcular: la consulta de materias primas filtra por la panadería del producto y no devuelve la ajena',
      lecturas.map(l => [l.where?.panaderia_id, l.ids]), [[20, [30]]]);

    preparar();
    const orden = await resultado(ordenesService.crear({ producto_id: 40, cantidad_planificada: 1 }, 20, 11));
    igual('crear orden -> 422 con el mismo mensaje y la materia prima', [orden.e?.status, orden.e?.detalle], [422, { materias_primas: [90] }]);
    igual('crear orden: el FOR UPDATE se pide solo sobre materias primas de la panadería del producto (la ajena no se bloquea)',
      lecturas.map(l => [l.lock, l.where?.panaderia_id, l.ids]), [['UPDATE', 20, [30]]]);
    igual('crear orden: sin descuento ni orden, y la transacción se deshace', escrituras, ['inicio', 'rollback']);

    console.log('\n== recetas inconsistentes: listar y obtener no revelan la materia prima ajena');
    const lineaEsperada = (id, nombre, unidad, activo, cantidad) =>
      ({ materia_prima_id: id, nombre, unidad_medida: unidad, activo, cantidad_por_unidad: cantidad });
    const INSUMOS = [lineaEsperada(30, 'Harina', 'kg', true, 0.1), lineaEsperada(90, null, null, false, 0.2)];
    preparar();
    const lista = await resultado(recetasService.listar(20));
    igual('listar: la línea ajena aparece como materia prima desaparecida (nombre y unidad nulos, inactiva)',
      [lista.ok, lista.r?.[0]?.insumos], [true, INSUMOS]);
    igual('listar: la asociación filtra por la panadería (LEFT JOIN, required: false)',
      asociaciones.slice(0, 1), [{ where: { panaderia_id: 20 }, required: false }]);
    igual('listar: la respuesta no contiene datos de la materia prima ajena', DATOS_AJENOS.test(JSON.stringify(lista.r)), false);

    preparar();
    const receta = await resultado(recetasService.obtener('40', 20));
    igual('obtener: misma estructura de siempre y la línea ajena como desaparecida',
      [receta.ok, Object.keys(receta.r ?? {}), receta.r?.insumos], [true, ['producto_id', 'producto', 'panaderia_id', 'insumos'], INSUMOS]);
    igual('obtener: la asociación filtra por la panadería del producto (LEFT JOIN, required: false)',
      asociaciones.slice(0, 1), [{ where: { panaderia_id: 20 }, required: false }]);
    igual('obtener: la respuesta no contiene datos de la materia prima ajena', DATOS_AJENOS.test(JSON.stringify(receta.r)), false);

    // Control: el doble sí devolvería la materia prima ajena sin el filtro (la prueba no es trivial)
    preparar();
    igual('control: sin filtro de panadería, el doble devolvería la materia prima ajena',
      conMateria(LINEAS_DB[1], [{ model: MateriaPrima, attributes: ['nombre'] }]).MateriaPrima, { nombre: 'Insumo Secreto' });
  } finally {
    Producto.findOne = originalesRecetas.productoFindOne;
    Producto.findAll = originalesRecetas.productoFindAll;
    RecetaProducto.findAll = originalesRecetas.recetaFindAll;
    MateriaPrima.findAll = originalesRecetas.materiaFindAll;
    MateriaPrima.update = originalesRecetas.materiaUpdate;
    OrdenProduccion.create = originalesRecetas.ordenCreate;
    sequelize.transaction = originalesRecetas.transaction;
  }

  // ---------- Revisión del código ----------
  console.log('\n== revisión del código');
  const leer = (relativa) => fs.readFileSync(path.join(__dirname, relativa), 'utf8');
  const sinComentarios = (codigo) => codigo.split(/\r?\n/).filter(l => !l.trim().startsWith('//')).join('\n');
  const rutas = ['inventario/inventario.routes.js', 'ventas/ventas.routes.js', 'produccion/produccion.routes.js', 'panaderias/panaderias.routes.js']
    .map(r => [r, sinComentarios(leer(`../src/modules/${r}`))]);
  for (const [archivo, codigo] of rutas) {
    igual(`${archivo}: resolverPanaderia siempre sin opciones (ninguna panadería opcional)`,
      [(codigo.match(/resolverPanaderia\(/g) ?? []).length > 0, (codigo.match(/resolverPanaderia\(/g) ?? []).length === (codigo.match(/resolverPanaderia\(\)/g) ?? []).length,
        /requerida|panaderiaOpcional/.test(codigo)], [true, true, false]);
  }
  for (const archivo of ['inventario/inventario.routes.js', 'ventas/ventas.routes.js', 'produccion/produccion.routes.js']) {
    const codigo = rutas.find(([r]) => r === archivo)[1];
    igual(`${archivo}: lectura y escritura incluyen resolverPanaderia() en la cadena común`,
      [/const lectura = \[[^\]]*resolverPanaderia\(\)\]/.test(codigo), /const escritura = \[[^\]]*resolverPanaderia\(\)\]/.test(codigo)], [true, true]);
  }
  for (const archivo of ['inventario/inventario.service.js', 'produccion/ordenes.service.js', 'produccion/recetas.service.js']) {
    const codigo = sinComentarios(leer(`../src/modules/${archivo}`));
    igual(`${archivo}: sin búsquedas condicionadas a la panadería y con exigirPanaderiaId`,
      [/panaderiaId \?|if \(panaderiaId\)|: \{ id \}/.test(codigo), /exigirPanaderiaId\(panaderiaId\)/.test(codigo)], [false, true]);
  }
  const recetas = sinComentarios(leer('../src/modules/produccion/recetas.service.js'));
  igual('recetas.service.js: las tres lecturas de materias primas de una receta filtran por panadería', [
    /where: \{ id: lineas\.map\(l => l\.materia_prima_id\), panaderia_id: producto\.panaderia_id \}/.test(recetas),
    /where: \{ panaderia_id: panaderiaId \}, required: false/.test(recetas),
    /where: \{ panaderia_id: producto\.panaderia_id \}, required: false/.test(recetas)
  ], [true, true, true]);
  igual('recetas.service.js: ninguna asociación con MateriaPrima queda sin filtro de panadería',
    (recetas.match(/model: MateriaPrima/g) ?? []).length, (recetas.match(/required: false/g) ?? []).length);
  // Llamadas internas con null como panadería (antes significaba «cualquier panadería»; ahora
  // exigirPanaderiaId lo rechaza). Para cada método de los servicios de negocio se toma de su firma
  // la posición del parámetro panaderiaId, y en cada llamada (this.metodo o <x>Service.metodo, en
  // servicios y controladores) solo se mira ese argumento: un null en otra posición o en otra
  // función no cuenta.
  const SERVICIOS = {
    inventarioService: 'inventario/inventario.service.js', ventasService: 'ventas/ventas.service.js',
    recetasService: 'produccion/recetas.service.js', ordenesService: 'produccion/ordenes.service.js'
  };
  const firmas = (codigo) => Object.fromEntries([...codigo.matchAll(/^\s+async (\w+)\(([^)]*)\)/gm)]
    .map(([, nombre, params]) => [nombre, params.split(',').map(p => p.trim().replace(/\s*=.*$/, '')).indexOf('panaderiaId')])
    .filter(([, posicion]) => posicion >= 0));
  // Argumentos de nivel superior de una llamada, desde la posición siguiente a su '('
  const argumentos = (texto, inicio) => {
    const args = [];
    let nivel = 0;
    let actual = '';
    for (let i = inicio; i < texto.length; i++) {
      const c = texto[i];
      if (')]}'.includes(c) && nivel === 0) { args.push(actual.trim()); return args; }
      if ('([{'.includes(c)) nivel++;
      if (')]}'.includes(c)) nivel--;
      if (c === ',' && nivel === 0) { args.push(actual.trim()); actual = ''; } else actual += c;
    }
    return null;
  };
  const llamadasConPanaderiaNula = (codigo, propias, ajenas) => {
    const hallazgos = [];
    for (const m of codigo.matchAll(/\b(this|\w+Service)\.(\w+)\(/g)) {
      const [, objeto, metodo] = m;
      const posicion = (objeto === 'this' ? propias : ajenas[objeto])?.[metodo];
      if (posicion === undefined) continue;
      const args = argumentos(codigo, m.index + m[0].length);
      if (args && args[posicion] === 'null') hallazgos.push(`${objeto}.${metodo}(${args.join(', ')})`);
    }
    return hallazgos;
  };
  const firmasPorServicio = Object.fromEntries(Object.entries(SERVICIOS).map(([nombre, archivo]) => [nombre, firmas(sinComentarios(leer(`../src/modules/${archivo}`)))]));
  // Autocomprobación del detector con fragmentos sintéticos (lo que debe y lo que no debe marcar)
  const deOrdenes = firmasPorServicio.ordenesService;
  igual('detector: las firmas de órdenes ubican panaderiaId (obtener: 2.º, finalizar: 3.º, crear: 2.º)',
    [deOrdenes.obtener, deOrdenes.finalizar, deOrdenes.crear], [1, 2, 1]);
  igual('detector: marca this.obtener(ordenId, null) y recetasService.obtenerProducto(id, null, {...})', [
    llamadasConPanaderiaNula('const orden = await this.obtener(ordenId, null);', deOrdenes, firmasPorServicio).length,
    llamadasConPanaderiaNula('await recetasService.obtenerProducto(productoId, null, { transaction: t });', deOrdenes, firmasPorServicio).length
  ], [1, 1]);
  igual('detector: no marca null fuera de la posición de la panadería ni en otras funciones', [
    llamadasConPanaderiaNula('return this.obtener(ordenId, panaderiaId);', deOrdenes, firmasPorServicio).length,
    llamadasConPanaderiaNula('await this.finalizar(null, datos, panaderiaId, 11);', deOrdenes, firmasPorServicio).length,
    llamadasConPanaderiaNula("const m = parsearTexto(datos?.motivo, 'motivo', null); this.alertasStockBajo(null);", deOrdenes, firmasPorServicio).length,
    llamadasConPanaderiaNula('await this.obtener(parsearId(id, null), panaderiaId);', deOrdenes, firmasPorServicio).length
  ], [0, 0, 0, 0]);
  const archivosConLlamadas = [
    ...Object.entries(SERVICIOS).map(([nombre, archivo]) => [archivo, firmasPorServicio[nombre]]),
    ...['inventario/inventario.controller.js', 'ventas/ventas.controller.js', 'produccion/recetas.controller.js', 'produccion/ordenes.controller.js']
      .map(archivo => [archivo, {}])
  ];
  const conNula = archivosConLlamadas.flatMap(([archivo, propias]) =>
    llamadasConPanaderiaNula(sinComentarios(leer(`../src/modules/${archivo}`)), propias, firmasPorServicio).map(h => `${archivo}: ${h}`));
  igual('ninguna llamada interna a un servicio de negocio pasa null como panadería', conNula, []);
  const usuarios = sinComentarios(leer('../src/modules/usuarios/usuarios.service.js'));
  igual('usuarios.service.js: ninguna actualización de cuentas escribe panaderia_id',
    /\.update\(\{[^}]*panaderia_id/.test(usuarios), false);
  igual('usuarios.service.js: listado y bloqueo de administradores filtrados por panadería',
    [/where: \{ panaderia_id: actor\.panaderia_id \}/.test(usuarios), /where: \{ rol_id: ROLES\.ADMINISTRADOR, estado: true, panaderia_id: panaderiaId \}/.test(usuarios)], [true, true]);
  const auth = sinComentarios(leer('../src/modules/auth/auth.service.js'));
  igual('auth.service.js: la cuenta nueva usa la panadería de quien actúa y no se consultan panaderías',
    [/const panaderiaId = actor\.panaderia_id;/.test(auth), /Panaderia/.test(auth)], [true, false]);
  const panaderias = sinComentarios(leer('../src/modules/panaderias/panaderias.routes.js'));
  igual('panaderias.routes.js: solo la panadería de la cuenta', /where: \{ id: req\.panaderiaId \}/.test(panaderias), true);
};

main()
  .catch(error => { resultados.push(false); console.log('FALLA ejecución abortada ->', error.message); })
  .finally(() => {
    const fallidas = resultados.filter(ok => !ok).length;
    console.log(`\n${resultados.length - fallidas}/${resultados.length} pruebas correctas`);
    process.exit(fallidas ? 1 : 0);
  });
