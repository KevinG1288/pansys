// Pruebas unitarias de RF-12 (crear producto) y RF-13 (editar producto):
//  1. Validación de nombre y precios al crear y al editar (negativos, no numéricos, tipos raros,
//     decimales, máximos) y rechazo de campos no permitidos (cantidad_disponible al editar,
//     panaderia_id, estado, id, fechas...).
//  2. PUT /api/ventas/productos/:id: solo la panadería de la sesión (otra panadería, inactivo o
//     inexistente -> 404 sin escribir), solo nombre y precios, fila bloqueada en una transacción,
//     existencias intactas y ventas anteriores intactas (detalle_ventas no se toca).
//  3. Permisos con los middlewares reales de la ruta: administrador y panadero editan; el gerente
//     solo consulta (403); sin panadería asignada, 403. No existe ruta para borrar productos.
//  4. Errores: conflicto de concurrencia -> 409 reintentable; error interno -> 500 sin detalles.
// No usan la base de datos ni el servidor: los modelos y la transacción se sustituyen por dobles en
// memoria y la respuesta HTTP es un objeto falso. Se pueden ejecutar en cualquier momento.
//
// Uso (desde backend/):  node pruebas/productos.unitarias.js

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
const resultado = (fn) => { try { return { ok: true, r: fn() }; } catch (e) { return { ok: false, e }; } };

const FILTRACIONES = /pansys_|CONSTRAINT|FOREIGN KEY|ECONNREFUSED|3306|errno|sql|Sequelize|Unknown column|Deadlock|Lock wait/i;
const ERROR_INTERNO = { error: 'Error interno del servidor' };

const main = async () => {
  const { sequelize, Producto, DetalleVenta, Venta } = require('../src/models/index');
  const ventasController = require('../src/modules/ventas/ventas.controller');
  const ventasRoutes = require('../src/modules/ventas/ventas.routes');
  const verificarToken = require('../src/middlewares/auth.middleware');
  const { ErrorNegocio } = require('../src/utils/errores');
  const { ADMINISTRADOR, PANADERO, GERENTE } = require('../src/config/roles');
  const {
    validarCreacionProducto, validarEdicionProducto, CAMPOS_CREACION, CAMPOS_EDICION
  } = require('../src/modules/ventas/productos.validaciones');

  // ---------- 1. Validación ----------
  console.log('\n== validación al crear (RF-12)');
  igual('campos de creación', CAMPOS_CREACION, ['nombre', 'precio_compra', 'precio_venta', 'cantidad_disponible']);
  igual('campos de edición: sin cantidad_disponible', CAMPOS_EDICION, ['nombre', 'precio_compra', 'precio_venta']);

  const crearValidos = [
    ['mínimo: nombre recortado y precio de venta', { nombre: '  Pan rollo ', precio_venta: 500 }, { nombre: 'Pan rollo', precio_venta: 500 }],
    ['completo con textos numéricos', { nombre: 'Torta', precio_compra: '800', precio_venta: '1500.5', cantidad_disponible: '10' },
      { nombre: 'Torta', precio_compra: 800, precio_venta: 1500.5, cantidad_disponible: 10 }],
    ['precios y existencia en 0', { nombre: 'Muestra', precio_compra: 0, precio_venta: 0, cantidad_disponible: 0 },
      { nombre: 'Muestra', precio_compra: 0, precio_venta: 0, cantidad_disponible: 0 }],
    ['dos decimales y máximos', { nombre: 'x'.repeat(255), precio_venta: 100000000, precio_compra: 99.99, cantidad_disponible: 100000 },
      { nombre: 'x'.repeat(255), precio_compra: 99.99, precio_venta: 100000000, cantidad_disponible: 100000 }]
  ];
  for (const [descripcion, datos, esperado] of crearValidos) {
    const v = resultado(() => validarCreacionProducto(datos));
    igual(`crear válido: ${descripcion}`, [v.ok, v.r], [true, esperado]);
  }

  const invalido = (lista) => `Campos requeridos o inválidos: ${lista}`;
  const crearInvalidos = [
    ['sin cuerpo', undefined, invalido('nombre, precio_venta')],
    ['cuerpo nulo', null, invalido('nombre, precio_venta')],
    ['cuerpo que es una lista', [{ nombre: 'Pan' }], invalido('nombre, precio_venta')],
    ['precio de venta negativo', { nombre: 'Pan', precio_venta: -1 }, invalido('precio_venta')],
    ['precio de venta negativo en texto', { nombre: 'Pan', precio_venta: '-1' }, invalido('precio_venta')],
    ['precio de compra negativo', { nombre: 'Pan', precio_venta: 500, precio_compra: -0.5 }, invalido('precio_compra')],
    ['precio no numérico', { nombre: 'Pan', precio_venta: 'abc' }, invalido('precio_venta')],
    ['precio en notación exponencial', { nombre: 'Pan', precio_venta: '1e3' }, invalido('precio_venta')],
    ['precio con coma decimal', { nombre: 'Pan', precio_venta: '1,5' }, invalido('precio_venta')],
    ['precio vacío', { nombre: 'Pan', precio_venta: '' }, invalido('precio_venta')],
    ['precio NaN', { nombre: 'Pan', precio_venta: NaN }, invalido('precio_venta')],
    ['precio Infinity', { nombre: 'Pan', precio_venta: Infinity }, invalido('precio_venta')],
    ['precio booleano', { nombre: 'Pan', precio_venta: true }, invalido('precio_venta')],
    ['precio en una lista', { nombre: 'Pan', precio_venta: [500] }, invalido('precio_venta')],
    ['precio en un objeto', { nombre: 'Pan', precio_venta: { valor: 500 } }, invalido('precio_venta')],
    ['precio nulo', { nombre: 'Pan', precio_venta: null }, invalido('precio_venta')],
    ['precio con tres decimales', { nombre: 'Pan', precio_venta: 1.234 }, invalido('precio_venta')],
    ['precio por encima del máximo', { nombre: 'Pan', precio_venta: 100000000.01 }, invalido('precio_venta')],
    ['nombre vacío', { nombre: '', precio_venta: 500 }, invalido('nombre')],
    ['nombre de solo espacios', { nombre: '   ', precio_venta: 500 }, invalido('nombre')],
    ['nombre de más de 255 caracteres', { nombre: 'x'.repeat(256), precio_venta: 500 }, invalido('nombre')],
    ['nombre numérico', { nombre: 123, precio_venta: 500 }, invalido('nombre')],
    ['existencia negativa', { nombre: 'Pan', precio_venta: 500, cantidad_disponible: -1 }, invalido('cantidad_disponible')],
    ['existencia decimal', { nombre: 'Pan', precio_venta: 500, cantidad_disponible: 1.5 }, invalido('cantidad_disponible')],
    ['existencia por encima del máximo', { nombre: 'Pan', precio_venta: 500, cantidad_disponible: 100001 }, invalido('cantidad_disponible')],
    ['varios campos inválidos, en orden', { nombre: ' ', precio_compra: 'x', precio_venta: -2 }, invalido('nombre, precio_compra, precio_venta')],
    ['panaderia_id', { nombre: 'Pan', precio_venta: 500, panaderia_id: 2 }, 'Campos no permitidos: panaderia_id'],
    ['estado', { nombre: 'Pan', precio_venta: 500, estado: false }, 'Campos no permitidos: estado'],
    ['id y fechas', { nombre: 'Pan', precio_venta: 500, id: 7, createdAt: 'x', updatedAt: 'y' }, 'Campos no permitidos: id, createdAt, updatedAt'],
    ['campo no permitido junto a uno inválido: primero los no permitidos', { precio_venta: -1, extra: 1 }, 'Campos no permitidos: extra']
  ];
  for (const [descripcion, datos, mensaje] of crearInvalidos) {
    const v = resultado(() => validarCreacionProducto(datos));
    igual(`crear inválido: ${descripcion} -> 400`, [v.ok, v.e instanceof ErrorNegocio, v.e?.status, v.e?.message], [false, true, 400, mensaje]);
  }

  console.log('\n== validación al editar (RF-13)');
  const editarValidos = [
    ['solo precio de venta', { precio_venta: 700 }, { precio_venta: 700 }],
    ['solo nombre, recortado', { nombre: '  Pan integral ' }, { nombre: 'Pan integral' }],
    ['nombre y precios en texto', { nombre: 'Pan', precio_compra: '250.25', precio_venta: '600' }, { nombre: 'Pan', precio_compra: 250.25, precio_venta: 600 }],
    ['precio de compra en 0', { precio_compra: 0 }, { precio_compra: 0 }]
  ];
  for (const [descripcion, datos, esperado] of editarValidos) {
    const v = resultado(() => validarEdicionProducto(datos));
    igual(`editar válido: ${descripcion}`, [v.ok, v.r], [true, esperado]);
  }
  const NINGUNO = 'Indique al menos un campo para editar: nombre, precio_compra, precio_venta';
  const editarInvalidos = [
    ['sin cuerpo', undefined, NINGUNO],
    ['cuerpo vacío', {}, NINGUNO],
    ['cuerpo que es una lista', [], NINGUNO],
    ['cantidad_disponible', { cantidad_disponible: 5 }, 'Campos no permitidos: cantidad_disponible'],
    ['cantidad_disponible junto a un precio válido', { precio_venta: 700, cantidad_disponible: 5 }, 'Campos no permitidos: cantidad_disponible'],
    ['panaderia_id', { nombre: 'Pan', panaderia_id: 2 }, 'Campos no permitidos: panaderia_id'],
    ['estado (no se da de baja por aquí)', { estado: false }, 'Campos no permitidos: estado'],
    ['id, version_fila y fechas', { id: 9, version_fila: 0, updatedAt: 'x' }, 'Campos no permitidos: id, version_fila, updatedAt'],
    ['nombre nulo', { nombre: null }, invalido('nombre')],
    ['nombre vacío', { nombre: '  ' }, invalido('nombre')],
    ['precio de compra negativo', { precio_compra: -5 }, invalido('precio_compra')],
    ['precio de venta no numérico', { precio_venta: 'gratis' }, invalido('precio_venta')],
    ['precio de venta booleano', { precio_venta: false }, invalido('precio_venta')],
    ['precio con tres decimales', { precio_venta: '10.123' }, invalido('precio_venta')]
  ];
  for (const [descripcion, datos, mensaje] of editarInvalidos) {
    const v = resultado(() => validarEdicionProducto(datos));
    igual(`editar inválido: ${descripcion} -> 400`, [v.ok, v.e instanceof ErrorNegocio, v.e?.status, v.e?.message], [false, true, 400, mensaje]);
  }

  // ---------- Dobles en memoria ----------
  // Panadería 20: Pan (40, activo) y Viejo (42, inactivo). Panadería 21: Ajeno (41).
  // Venta 50 de la panadería 20 con una línea de Pan a 500.
  const originales = {
    transaction: sequelize.transaction, findOne: Producto.findOne, findAll: Producto.findAll, create: Producto.create,
    productoUpdate: Producto.update, productoDestroy: Producto.destroy,
    detalleUpdate: DetalleVenta.update, detalleDestroy: DetalleVenta.destroy, detalleCreate: DetalleVenta.create,
    detalleBulk: DetalleVenta.bulkCreate, ventaUpdate: Venta.update, ventaDestroy: Venta.destroy,
    consolaError: console.error
  };
  let productos, detalles, eventos, consultas, erroresRegistrados, falloFindOne;
  const preparar = () => {
    productos = [
      { id: 40, nombre: 'Pan', precio_compra: 200, precio_venta: 500, cantidad_disponible: 12, panaderia_id: 20, estado: true },
      { id: 41, nombre: 'Ajeno', precio_compra: 100, precio_venta: 300, cantidad_disponible: 5, panaderia_id: 21, estado: true },
      { id: 42, nombre: 'Viejo', precio_compra: 100, precio_venta: 300, cantidad_disponible: 0, panaderia_id: 20, estado: false }
    ];
    detalles = [{ id: 1, venta_id: 50, producto_id: 40, cantidad: 2, precio_unitario: 500, subtotal: 1000 }];
    eventos = [];
    consultas = [];
    erroresRegistrados = [];
    falloFindOne = null;
  };
  const copia = (v) => JSON.parse(JSON.stringify(v));
  const cumple = (fila, where) => Object.entries(where).every(([k, v]) => fila[k] === v);
  const TRANSACCION = { id: 'T1', LOCK: { UPDATE: 'UPDATE' } };

  sequelize.transaction = async (fn) => { eventos.push('transaccion'); return fn(TRANSACCION); };
  Producto.findOne = async (opciones) => {
    consultas.push({ where: { ...opciones.where }, lock: opciones.lock, transaccion: opciones.transaction?.id });
    eventos.push('buscar');
    if (falloFindOne) throw falloFindOne();
    const fila = productos.find(p => cumple(p, opciones.where));
    if (!fila) return null;
    // Instancia mínima: update escribe solo los campos indicados en `fields`
    return {
      update: async (campos, opts) => {
        eventos.push(`actualizar:${opts.fields.join(',')}:${opts.transaction?.id}`);
        for (const c of opts.fields) fila[c] = campos[c];
      },
      toJSON: () => ({ ...fila })
    };
  };
  Producto.findAll = async ({ where }) => { eventos.push(`listar:${where.panaderia_id}`); return copia(productos.filter(p => cumple(p, where))); };
  Producto.create = async (valores) => { eventos.push('crear'); return { id: 43, ...valores }; };
  const prohibido = (nombre) => async () => { eventos.push(`PROHIBIDO:${nombre}`); return [0]; };
  Producto.update = prohibido('Producto.update');
  Producto.destroy = prohibido('Producto.destroy');
  DetalleVenta.update = prohibido('DetalleVenta.update');
  DetalleVenta.destroy = prohibido('DetalleVenta.destroy');
  DetalleVenta.create = prohibido('DetalleVenta.create');
  DetalleVenta.bulkCreate = prohibido('DetalleVenta.bulkCreate');
  Venta.update = prohibido('Venta.update');
  Venta.destroy = prohibido('Venta.destroy');
  console.error = (...args) => { erroresRegistrados.push(args.map(String).join(' ')); };

  const respuesta = () => ({
    codigo: 200, cuerpo: undefined,
    status(c) { this.codigo = c; return this; },
    json(b) { this.cuerpo = copia(b); return this; }
  });
  const llamar = async (metodo, { params = {}, body, panaderiaId = 20 } = {}) => {
    const res = respuesta();
    await metodo({ params, body, panaderiaId, usuario: { id: 7 } }, res);
    return res;
  };
  const prohibidos = () => eventos.filter(e => e.startsWith('PROHIBIDO'));

  try {
    // ---------- 2. Crear por el controlador ----------
    console.log('\n== POST /api/ventas/productos');
    preparar();
    let r = await llamar(ventasController.crearProducto, { body: { nombre: ' Pan de queso ', precio_compra: '800', precio_venta: 1500.5, cantidad_disponible: 10 } });
    igual('crear -> 201 con valores normalizados y la panadería de la sesión',
      [r.codigo, r.cuerpo], [201, { id: 43, nombre: 'Pan de queso', precio_compra: 800, precio_venta: 1500.5, cantidad_disponible: 10, panaderia_id: 20 }]);
    preparar();
    r = await llamar(ventasController.crearProducto, { body: { nombre: 'Pan', precio_venta: -100 } });
    igual('crear con precio negativo -> 400 sin escribir', [r.codigo, r.cuerpo, eventos], [400, { error: invalido('precio_venta') }, []]);
    preparar();
    r = await llamar(ventasController.crearProducto, { body: { nombre: 'Pan', precio_venta: 500, panaderia_id: 21 } });
    igual('crear con panaderia_id de otra panadería -> 400 sin escribir', [r.codigo, r.cuerpo, eventos], [400, { error: 'Campos no permitidos: panaderia_id' }, []]);

    // ---------- 3. Editar por el controlador ----------
    console.log('\n== PUT /api/ventas/productos/:id');
    preparar();
    r = await llamar(ventasController.actualizarProducto, { params: { id: '40' }, body: { nombre: ' Pan francés ', precio_compra: 250, precio_venta: '700' } });
    igual('editar -> 200 con el producto actualizado; existencias, panadería y estado intactos',
      [r.codigo, r.cuerpo], [200, { id: 40, nombre: 'Pan francés', precio_compra: 250, precio_venta: 700, cantidad_disponible: 12, panaderia_id: 20, estado: true }]);
    igual('editar: busca con la panadería de la sesión, solo activos, con FOR UPDATE dentro de la transacción',
      consultas, [{ where: { id: 40, panaderia_id: 20, estado: true }, lock: 'UPDATE', transaccion: 'T1' }]);
    igual('editar: una transacción, una búsqueda y un UPDATE solo de nombre y precios',
      eventos, ['transaccion', 'buscar', 'actualizar:nombre,precio_compra,precio_venta:T1']);
    igual('editar: las ventas anteriores conservan su precio (detalle_ventas intacto)',
      detalles, [{ id: 1, venta_id: 50, producto_id: 40, cantidad: 2, precio_unitario: 500, subtotal: 1000 }]);
    igual('editar: no se llama a ninguna escritura de ventas, detalles ni borrado de productos', prohibidos(), []);
    igual('editar: el otro producto y el inactivo no cambian',
      [productos[1].nombre, productos[1].precio_venta, productos[2].nombre], ['Ajeno', 300, 'Viejo']);

    preparar();
    r = await llamar(ventasController.actualizarProducto, { params: { id: '40' }, body: { precio_venta: 650 } });
    igual('editar solo el precio de venta: UPDATE solo de precio_venta',
      [r.codigo, r.cuerpo.precio_venta, r.cuerpo.nombre, r.cuerpo.precio_compra, eventos[2]], [200, 650, 'Pan', 200, 'actualizar:precio_venta:T1']);

    for (const [descripcion, id, panaderiaId] of [
      ['producto de otra panadería', '41', 20],
      ['producto inactivo (dado de baja)', '42', 20],
      ['producto inexistente', '999', 20],
      ['producto propio pedido desde la otra panadería', '40', 21]
    ]) {
      preparar();
      r = await llamar(ventasController.actualizarProducto, { params: { id }, body: { precio_venta: 1 }, panaderiaId });
      igual(`editar ${descripcion} -> 404 sin escribir`,
        [r.codigo, r.cuerpo, eventos.filter(e => e.startsWith('actualizar')), prohibidos(), productos.map(p => p.precio_venta)],
        [404, { error: 'Producto no encontrado' }, [], [], [500, 300, 300]]);
    }

    for (const [descripcion, body, mensaje] of [
      ['con cantidad_disponible', { precio_venta: 700, cantidad_disponible: 999 }, 'Campos no permitidos: cantidad_disponible'],
      ['con panaderia_id', { panaderia_id: 21 }, 'Campos no permitidos: panaderia_id'],
      ['con estado', { estado: false }, 'Campos no permitidos: estado'],
      ['con id', { id: 41, nombre: 'Pan' }, 'Campos no permitidos: id'],
      ['con precio negativo', { precio_venta: -1 }, invalido('precio_venta')],
      ['con precio no numérico', { precio_compra: 'diez' }, invalido('precio_compra')],
      ['sin cuerpo', undefined, NINGUNO]
    ]) {
      preparar();
      r = await llamar(ventasController.actualizarProducto, { params: { id: '40' }, body });
      igual(`editar ${descripcion} -> 400 sin consultar ni escribir`,
        [r.codigo, r.cuerpo, eventos, productos[0]],
        [400, { error: mensaje }, [], { id: 40, nombre: 'Pan', precio_compra: 200, precio_venta: 500, cantidad_disponible: 12, panaderia_id: 20, estado: true }]);
    }

    for (const id of ['abc', '0', '-1', '1.5', '2147483648']) {
      preparar();
      r = await llamar(ventasController.actualizarProducto, { params: { id }, body: { precio_venta: 1 } });
      igual(`editar con id "${id}" -> 400 sin consultar`, [r.codigo, r.cuerpo, eventos], [400, { error: 'id inválido' }, []]);
    }

    preparar();
    r = await llamar(ventasController.actualizarProducto, { params: { id: '40' }, body: { precio_venta: 1 }, panaderiaId: null });
    igual('editar sin panadería autorizada -> 500 genérico, sin consultar', [r.codigo, r.cuerpo, eventos, erroresRegistrados.length], [500, ERROR_INTERNO, [], 1]);

    // ---------- 4. Errores internos y concurrencia ----------
    console.log('\n== errores internos y concurrencia');
    preparar();
    falloFindOne = () => Object.assign(new Error('Deadlock found when trying to get lock'), { parent: { errno: 1213 } });
    r = await llamar(ventasController.actualizarProducto, { params: { id: '40' }, body: { precio_venta: 1 } });
    igual('interbloqueo persistente -> 3 intentos y 409 reintentable sin detalles',
      [r.codigo, r.cuerpo?.codigo, r.cuerpo?.reintentar, FILTRACIONES.test(JSON.stringify(r.cuerpo)), eventos.filter(e => e === 'transaccion').length],
      [409, 'CONFLICTO_CONCURRENCIA', true, false, 3]);
    preparar();
    falloFindOne = () => Object.assign(new Error("Unknown column 'x' in pansys_test.productos"), { name: 'SequelizeDatabaseError', parent: { errno: 1054, sqlMessage: "Unknown column 'x'" } });
    r = await llamar(ventasController.actualizarProducto, { params: { id: '40' }, body: { precio_venta: 1 } });
    igual('error de base de datos -> 500 genérico, registrado en el servidor, sin filtrar detalles',
      [r.codigo, r.cuerpo, FILTRACIONES.test(JSON.stringify(r.cuerpo)), erroresRegistrados.length], [500, ERROR_INTERNO, false, 1]);

    // ---------- 5. Permisos con los middlewares reales de la ruta ----------
    console.log('\n== permisos de la ruta (middlewares reales)');
    const capa = (metodo, ruta) => ventasRoutes.stack.find(l => l.route?.path === ruta && l.route.methods[metodo]);
    const editar = capa('put', '/productos/:id');
    igual('existe PUT /productos/:id', Boolean(editar), true);
    const manejadores = editar.route.stack.map(l => l.handle);
    igual('PUT /productos/:id: verificarToken, permitirRoles, resolverPanaderia y el controlador',
      [manejadores.length, manejadores[0] === verificarToken], [4, true]);
    igual('no hay ruta DELETE para productos (no se borran físicamente)',
      ventasRoutes.stack.some(l => l.route?.methods.delete), false);

    // Se ejecuta la cadena desde permitirRoles (verificarToken ya habría cargado req.usuario de la base)
    const ejecutar = async (capaRuta, usuario, params, body) => {
      const res = respuesta();
      const req = { usuario, params, body };
      for (const h of capaRuta.route.stack.slice(1).map(l => l.handle)) {
        let siguiente = false;
        await h(req, res, () => { siguiente = true; });
        if (!siguiente) break;
      }
      return res;
    };
    const usuario = (rol_id, panaderia_id = 20) => ({ id: 7, rol_id, panaderia_id });

    for (const [nombre, rol] of [['administrador', ADMINISTRADOR], ['panadero', PANADERO]]) {
      preparar();
      r = await ejecutar(editar, usuario(rol), { id: '40' }, { precio_venta: 800 });
      igual(`${nombre} edita su producto -> 200`, [r.codigo, r.cuerpo?.precio_venta, productos[0].precio_venta], [200, 800, 800]);
    }
    preparar();
    r = await ejecutar(editar, usuario(GERENTE), { id: '40' }, { precio_venta: 800 });
    igual('gerente intenta editar -> 403 sin consultar ni escribir',
      [r.codigo, r.cuerpo, eventos, productos[0].precio_venta], [403, { error: 'No tiene permisos para realizar esta acción' }, [], 500]);
    preparar();
    r = await ejecutar(capa('post', '/productos'), usuario(GERENTE), {}, { nombre: 'Pan', precio_venta: 500 });
    igual('gerente intenta crear -> 403 sin escribir', [r.codigo, eventos], [403, []]);
    preparar();
    r = await ejecutar(capa('get', '/productos'), usuario(GERENTE), {}, undefined);
    igual('gerente consulta los productos -> 200, solo los activos de su panadería',
      [r.codigo, r.cuerpo.map(p => p.id), eventos], [200, [40], ['listar:20']]);
    preparar();
    r = await ejecutar(editar, usuario(ADMINISTRADOR, null), { id: '40' }, { precio_venta: 800 });
    igual('cuenta sin panadería asignada -> 403 sin consultar', [r.codigo, eventos], [403, []]);
    preparar();
    r = await ejecutar(editar, usuario(PANADERO, 21), { id: '40' }, { precio_venta: 800 });
    igual('panadero de otra panadería -> 404, busca con su propia panadería y no escribe',
      [r.codigo, consultas[0]?.where, productos[0].precio_venta], [404, { id: 40, panaderia_id: 21, estado: true }, 500]);

    // ---------- 6. Revisión estática ----------
    console.log('\n== revisión estática');
    const servicio = fs.readFileSync(path.join(__dirname, '../src/modules/ventas/ventas.service.js'), 'utf8');
    const cuerpoEdicion = servicio.slice(servicio.indexOf('async actualizarProducto'));
    igual('actualizarProducto no menciona cantidad_disponible, DetalleVenta, Venta ni destroy',
      /cantidad_disponible|DetalleVenta|Venta\.|destroy/.test(cuerpoEdicion), false);
    igual('actualizarProducto escribe con fields limitados a los campos validados',
      /fields: Object\.keys\(campos\)/.test(cuerpoEdicion), true);
  } finally {
    sequelize.transaction = originales.transaction;
    Producto.findOne = originales.findOne;
    Producto.findAll = originales.findAll;
    Producto.create = originales.create;
    Producto.update = originales.productoUpdate;
    Producto.destroy = originales.productoDestroy;
    DetalleVenta.update = originales.detalleUpdate;
    DetalleVenta.destroy = originales.detalleDestroy;
    DetalleVenta.create = originales.detalleCreate;
    DetalleVenta.bulkCreate = originales.detalleBulk;
    Venta.update = originales.ventaUpdate;
    Venta.destroy = originales.ventaDestroy;
    console.error = originales.consolaError;
  }

  const correctas = resultados.filter(Boolean).length;
  console.log(`\n${correctas}/${resultados.length} pruebas correctas`);
  process.exitCode = correctas === resultados.length ? 0 : 1;
  await sequelize.close().catch(() => {});
};

main().catch((error) => {
  console.error('Error inesperado en las pruebas:', error);
  process.exitCode = 1;
});
