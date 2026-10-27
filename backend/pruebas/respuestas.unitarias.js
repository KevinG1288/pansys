// Pruebas unitarias de las respuestas de error de Inventario, Ventas (consultas y creación de
// productos) y del middleware resolverPanaderia. Los errores de negocio conservan su código y su
// mensaje; un dato inválido enviado por el cliente es un 400 que solo nombra campos del cliente; y
// cualquier error interno (base de datos, conexión, errores de programación) es un 500 genérico que
// nunca llega al cliente con SQL, nombres de bases, tablas, restricciones ni detalles de Sequelize.
// No usan la base de datos ni el servidor: los modelos se sustituyen por dobles en memoria (las
// validaciones del modelo son las reales: build().validate() no consulta la base) y la respuesta
// HTTP es un objeto falso. Se pueden ejecutar en cualquier momento.
//
// Uso (desde backend/):  node pruebas/respuestas.unitarias.js

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

// Cualquiera de estos textos en una respuesta de error sería una filtración de detalles internos
const FILTRACIONES = /pansys_|CONSTRAINT|FOREIGN KEY|ibfk|fk_|REFERENCES|ECONNREFUSED|3306|127\.0\.0\.1|Access denied|localhost|Duplicate entry|Lock wait|Deadlock|errno|sql|Cannot read|Sequelize|notNull|violation|MateriaPrima|Producto\.|Unknown column|Data too long|Data truncated|Incorrect|Out of range|cannot be null|at row/i;

const main = async () => {
  const {
    ForeignKeyConstraintError, UniqueConstraintError, ConnectionRefusedError, AccessDeniedError, DatabaseError,
    ValidationError, ValidationErrorItem
  } = require('sequelize');
  const { Panaderia, MateriaPrima, Producto, Venta } = require('../src/models/index');
  const { resolverPanaderia } = require('../src/middlewares/roles.middleware');
  const ventasController = require('../src/modules/ventas/ventas.controller');
  const inventarioController = require('../src/modules/inventario/inventario.controller');
  const inventarioService = require('../src/modules/inventario/inventario.service');
  const { ErrorNegocio, responderError } = require('../src/utils/errores');

  const originales = {
    panaderiaFindByPk: Panaderia.findByPk, materiaFindAll: MateriaPrima.findAll, materiaFindOne: MateriaPrima.findOne,
    materiaCreate: MateriaPrima.create, productoFindAll: Producto.findAll, productoCreate: Producto.create,
    ventaFindAll: Venta.findAll, consolaError: console.error
  };

  // Escenario: panadería 20 con dos materias primas (30 con stock bajo, 32 no), un producto y una venta.
  // fallo = { en, error } lanza ese error en ese paso.
  const MATERIAS = [
    { id: 30, nombre: 'Harina', unidad_medida: 'kg', cantidad_disponible: 2, stock_minimo: 5, precio_unitario: 1.5, panaderia_id: 20, estado: true },
    { id: 32, nombre: 'Azúcar', unidad_medida: 'kg', cantidad_disponible: 10, stock_minimo: 5, precio_unitario: 2, panaderia_id: 20, estado: true }
  ];
  const PRODUCTOS = [{ id: 40, nombre: 'Pan', precio_compra: 200, precio_venta: 500, cantidad_disponible: 12, panaderia_id: 20, estado: true }];
  const VENTAS = [{ id: 50, total: 1000, panaderia_id: 20, DetalleVenta: [{ producto_id: 40, cantidad: 2 }] }];
  let eventos;
  let fallo;
  let creado;
  let erroresRegistrados;
  const preparar = (nuevoFallo = null) => {
    eventos = [];
    fallo = nuevoFallo;
    creado = null;
    erroresRegistrados = [];
  };
  const fallarSi = (paso) => { if (fallo?.en === paso) throw fallo.error; };
  const copia = (valor) => JSON.parse(JSON.stringify(valor));

  Panaderia.findByPk = async (id) => { eventos.push(`panaderia:${id}`); fallarSi('panaderia'); return id === 20 ? { id: 20 } : null; };
  MateriaPrima.findAll = async ({ where }) => {
    eventos.push(`listarMaterias:${where.panaderia_id}`);
    fallarSi('listarMaterias');
    return copia(MATERIAS.filter(m => m.panaderia_id === where.panaderia_id && m.estado === where.estado));
  };
  // Instancia falsa con update(): las validaciones del modelo son las reales
  const instanciaMateria = (datos) => ({
    ...datos,
    async update(campos) {
      eventos.push('guardar');
      fallarSi('guardar');
      const nueva = { ...datos, ...campos };
      await MateriaPrima.build(nueva).validate();
      return nueva;
    }
  });
  MateriaPrima.findOne = async ({ where }) => {
    eventos.push('buscarMateria');
    fallarSi('buscarMateria');
    const m = MATERIAS.find(x => x.id === Number(where.id) && (where.panaderia_id === undefined || x.panaderia_id === where.panaderia_id));
    return m ? instanciaMateria(copia(m)) : null;
  };
  MateriaPrima.create = async (valores) => {
    eventos.push('crearMateria');
    creado = valores;
    fallarSi('crearMateria');
    await MateriaPrima.build(valores).validate();
    return { id: 31, ...valores };
  };
  Producto.findAll = async ({ where }) => {
    eventos.push(`listarProductos:${where.panaderia_id}`);
    fallarSi('listarProductos');
    return copia(PRODUCTOS.filter(p => p.panaderia_id === where.panaderia_id));
  };
  Producto.create = async (valores) => {
    eventos.push('crearProducto');
    creado = valores;
    fallarSi('crearProducto');
    await Producto.build(valores).validate();
    return { id: 41, ...valores };
  };
  Venta.findAll = async ({ where }) => {
    eventos.push(`listarVentas:${where.panaderia_id}`);
    fallarSi('listarVentas');
    return copia(VENTAS.filter(v => v.panaderia_id === where.panaderia_id));
  };
  // responderError registra en el servidor los errores internos: se capturan para comprobarlo
  console.error = (...args) => { erroresRegistrados.push(args); };

  const respuestaDoble = () => ({
    codigo: null, cuerpo: null,
    status(c) { this.codigo = c; return this; },
    // Como Express: el cuerpo es lo que se serializaría como JSON
    json(b) { if (this.codigo === null) this.codigo = 200; this.cuerpo = copia(b); return this; }
  });
  const llamar = async (metodo, req) => {
    const res = respuestaDoble();
    await metodo({ panaderiaId: 20, params: {}, query: {}, usuario: { id: 11, rol_id: 2, panaderia_id: 20 }, ...req }, res);
    return res;
  };
  // Middleware: devuelve la respuesta (si respondió), si llamó a next() y el req resultante
  const middleware = async (opciones, req) => {
    const res = respuestaDoble();
    const peticion = { query: {}, ...req };
    let siguio = false;
    await resolverPanaderia(opciones)(peticion, res, () => { siguio = true; });
    return { codigo: res.codigo, cuerpo: res.cuerpo, siguio, panaderiaId: peticion.panaderiaId };
  };
  const PANADERO = { id: 11, rol_id: 2, panaderia_id: 20 };
  const ADMIN = { id: 10, rol_id: 1, panaderia_id: null };

  const ERROR_INTERNO = { error: 'Error interno del servidor' };
  const CONFLICTO = {
    error: 'La operación coincidió con otra simultánea. Inténtelo de nuevo.',
    codigo: 'CONFLICTO_CONCURRENCIA',
    reintentar: true
  };
  const NO_ENCONTRADA = { error: 'Materia prima no encontrada' };

  // Errores de MySQL tal como los entrega mysql2 (con errno, code y sql) envueltos por Sequelize
  const errorMysql = (mensaje, extra) => Object.assign(new Error(mensaje), { sqlMessage: mensaje, ...extra });
  const SQL_INSERT = 'INSERT INTO `materia_prima` (`id`,`nombre`,`unidad_medida`,`panaderia_id`) VALUES (DEFAULT,?,?,?);';
  const datosMysql = (errno, code, mensaje) => new DatabaseError(errorMysql(mensaje, { errno, code, sql: SQL_INSERT }));
  const internos = () => [
    ['clave foránea (pansys_db)', new ForeignKeyConstraintError({
      parent: errorMysql('Cannot add or update a child row: a foreign key constraint fails (`pansys_db`.`materia_prima`, CONSTRAINT `fk_materia_panaderia` FOREIGN KEY (`panaderia_id`) REFERENCES `panaderias` (`id`))',
        { errno: 1452, code: 'ER_NO_REFERENCED_ROW_2', sql: SQL_INSERT }),
      fields: ['panaderia_id'], table: 'panaderias', index: 'fk_materia_panaderia'
    })],
    ['conexión rechazada (ECONNREFUSED)', new ConnectionRefusedError(
      Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3306'), { code: 'ECONNREFUSED', errno: -4078, address: '127.0.0.1', port: 3306 }))],
    ['acceso denegado a MySQL', new AccessDeniedError(
      errorMysql("Access denied for user 'pansys'@'localhost' (using password: YES)", { errno: 1045, code: 'ER_ACCESS_DENIED_ERROR' }))],
    ['error de base de datos con SQL', datosMysql(1054, 'ER_BAD_FIELD_ERROR', "Unknown column 'version_sesion' in 'field list' (pansys_db.materia_prima)")],
    ['error de programación (TypeError)', new TypeError("Cannot read properties of undefined (reading 'id')")]
  ];

  // Los nueve puntos, más resolverPanaderia: cómo se invoca cada uno y en qué paso fallaría
  const puntos = [
    ['resolverPanaderia', 'panaderia', async () => middleware(undefined, { usuario: ADMIN, query: { panaderia_id: '20' } })],
    ['GET /api/ventas', 'listarVentas', () => llamar(ventasController.getAll, {})],
    ['GET /api/ventas/productos', 'listarProductos', () => llamar(ventasController.getProductos, {})],
    ['POST /api/ventas/productos', 'crearProducto', () => llamar(ventasController.crearProducto, { body: { nombre: 'Torta', precio_venta: 900 } })],
    ['GET /api/inventario', 'listarMaterias', () => llamar(inventarioController.getAll, {})],
    ['GET /api/inventario/:id', 'buscarMateria', () => llamar(inventarioController.getById, { params: { id: '30' } })],
    ['POST /api/inventario', 'crearMateria', () => llamar(inventarioController.crear, { body: { nombre: 'Sal', unidad_medida: 'kg' } })],
    ['PUT /api/inventario/:id', 'guardar', () => llamar(inventarioController.actualizar, { params: { id: '30' }, body: { precio_unitario: '2.5' } })],
    ['DELETE /api/inventario/:id', 'guardar', () => llamar(inventarioController.eliminar, { params: { id: '30' } })],
    ['GET /api/inventario/stock-bajo', 'listarMaterias', () => llamar(inventarioController.stockBajo, {})]
  ];

  try {
    // ---------- Respuestas correctas: contrato de siempre ----------
    console.log('\n== respuestas correctas (contrato de siempre)');
    preparar();
    let r = await llamar(ventasController.getAll, {});
    igual('GET /api/ventas -> 200 con las ventas de la panadería', [r.codigo, r.cuerpo, eventos], [200, VENTAS, ['listarVentas:20']]);
    preparar();
    r = await llamar(ventasController.getProductos, {});
    igual('GET /api/ventas/productos -> 200 con los productos', [r.codigo, r.cuerpo, eventos], [200, PRODUCTOS, ['listarProductos:20']]);
    preparar();
    r = await llamar(ventasController.crearProducto, {
      body: { nombre: 'Torta', precio_compra: 400, precio_venta: 900, cantidad_disponible: 3, panaderia_id: 99, estado: false, extra: 'x' }
    });
    igual('POST /api/ventas/productos -> 201 con el producto creado',
      [r.codigo, r.cuerpo], [201, { id: 41, nombre: 'Torta', precio_compra: 400, precio_venta: 900, cantidad_disponible: 3, panaderia_id: 20 }]);
    igual('crear producto: solo los campos del cliente; panadería y estado los fija el servidor',
      creado, { nombre: 'Torta', precio_compra: 400, precio_venta: 900, cantidad_disponible: 3, panaderia_id: 20 });
    preparar();
    r = await llamar(inventarioController.getAll, {});
    igual('GET /api/inventario -> 200 con las materias primas activas', [r.codigo, r.cuerpo, eventos], [200, MATERIAS, ['listarMaterias:20']]);
    preparar();
    r = await llamar(inventarioController.stockBajo, {});
    igual('GET /api/inventario/stock-bajo -> 200 solo con cantidad <= mínimo', [r.codigo, r.cuerpo.map(m => m.id)], [200, [30]]);
    preparar();
    r = await llamar(inventarioController.getById, { params: { id: '30' } });
    igual('GET /api/inventario/:id -> 200 con la materia prima', [r.codigo, r.cuerpo], [200, MATERIAS[0]]);
    preparar();
    r = await llamar(inventarioController.getById, { params: { id: '30' }, panaderiaId: null });
    igual('GET /api/inventario/:id como administrador sin panadería -> 200', r.codigo, 200);
    preparar();
    r = await llamar(inventarioController.crear, {
      body: { nombre: 'Levadura', unidad_medida: 'g', cantidad_disponible: '1.2345', stock_minimo: 0, precio_unitario: 10, panaderia_id: 99, estado: false }
    });
    const levadura = { nombre: 'Levadura', unidad_medida: 'g', cantidad_disponible: 1.2345, stock_minimo: 0, precio_unitario: 10, panaderia_id: 20 };
    igual('POST /api/inventario -> 201 con la materia prima creada', [r.codigo, r.cuerpo], [201, { id: 31, ...levadura }]);
    igual('crear materia prima: decimales convertidos; panadería y estado los fija el servidor', creado, levadura);
    preparar();
    r = await llamar(inventarioController.actualizar, { params: { id: '30' }, body: { precio_unitario: '2.5' } });
    igual('PUT /api/inventario/:id -> 200 con la materia prima editada', [r.codigo, r.cuerpo], [200, { ...MATERIAS[0], precio_unitario: 2.5 }]);
    preparar();
    r = await llamar(inventarioController.eliminar, { params: { id: '30' } });
    igual('DELETE /api/inventario/:id -> 200 con el mensaje de siempre', [r.codigo, r.cuerpo], [200, { mensaje: 'Materia prima eliminada correctamente' }]);
    igual('respuestas correctas: ningún error interno registrado', erroresRegistrados.length, 0);

    // ---------- resolverPanaderia ----------
    console.log('\n== resolverPanaderia');
    preparar();
    let m = await middleware(undefined, { usuario: PANADERO, query: { panaderia_id: '99' } });
    igual('panadero: usa la panadería del token e ignora la del cliente, sin consultar',
      [m.siguio, m.panaderiaId, m.codigo, eventos], [true, 20, null, []]);
    preparar();
    m = await middleware(undefined, { usuario: { id: 12, rol_id: 3, panaderia_id: null } });
    igual('gerente sin panadería -> 403', [m.codigo, m.cuerpo, m.siguio], [403, { error: 'El usuario no tiene una panadería asignada' }, false]);
    preparar();
    m = await middleware(undefined, { usuario: ADMIN });
    igual('administrador sin panaderia_id (requerida) -> 400', [m.codigo, m.cuerpo, m.siguio], [400, { error: 'panaderia_id es requerido' }, false]);
    preparar();
    m = await middleware({ requerida: false }, { usuario: ADMIN, query: { panaderia_id: '' } });
    igual('administrador sin panaderia_id (opcional) -> sigue con null', [m.siguio, m.panaderiaId, m.codigo], [true, null, null]);
    for (const valor of ['abc', '0', '-3', '1.5']) {
      preparar();
      m = await middleware(undefined, { usuario: ADMIN, query: { panaderia_id: valor } });
      igual(`administrador con panaderia_id "${valor}" -> 400 sin consultar`, [m.codigo, m.cuerpo, m.siguio, eventos], [400, { error: 'panaderia_id inválido' }, false, []]);
    }
    preparar();
    m = await middleware(undefined, { usuario: ADMIN, query: { panaderia_id: '99' } });
    igual('administrador con panadería inexistente -> 404', [m.codigo, m.cuerpo, m.siguio], [404, { error: 'Panadería no encontrada' }, false]);
    preparar();
    m = await middleware(undefined, { usuario: ADMIN, query: { panaderia_id: '20' } });
    igual('administrador con panadería en la query -> sigue con su id', [m.siguio, m.panaderiaId, eventos], [true, 20, ['panaderia:20']]);
    preparar();
    m = await middleware(undefined, { usuario: ADMIN, body: { panaderia_id: 20 } });
    igual('administrador con panadería en el cuerpo -> sigue con su id', [m.siguio, m.panaderiaId], [true, 20]);

    // ---------- Errores internos en los diez puntos ----------
    console.log('\n== errores internos: 500 genérico, sin filtraciones, con registro en el servidor');
    for (const [descripcion, error] of internos()) {
      // Control: el doble sí lleva detalles internos; si no, la comprobación de filtración no probaría nada
      igual(`control, ${descripcion}: el error simulado contiene detalles internos`, FILTRACIONES.test(error.message), true);
    }
    for (const [punto, en, invocar] of puntos) {
      for (const [descripcion, error] of internos()) {
        preparar({ en, error });
        const res = await invocar();
        igual(`${punto}, ${descripcion} -> 500 genérico, sin filtrar nada, registrado en el servidor`,
          [res.codigo, res.cuerpo, FILTRACIONES.test(JSON.stringify(res.cuerpo)), erroresRegistrados.length, erroresRegistrados[0]?.[1] === error, res.siguio ?? false],
          [500, ERROR_INTERNO, false, 1, true, false]);
      }
    }

    // ---------- Concurrencia ----------
    console.log('\n== concurrencia: 409 reintentable');
    const conflictos = [
      ['bloqueo agotado (1205)', 1205, 'ER_LOCK_WAIT_TIMEOUT', 'Lock wait timeout exceeded; try restarting transaction'],
      ['interbloqueo (1213)', 1213, 'ER_LOCK_DEADLOCK', 'Deadlock found when trying to get lock; try restarting transaction']
    ];
    for (const [punto, en, invocar] of puntos) {
      for (const [descripcion, errno, code, mensaje] of conflictos) {
        preparar({ en, error: datosMysql(errno, code, mensaje) });
        const res = await invocar();
        igual(`${punto}, ${descripcion} -> 409 CONFLICTO_CONCURRENCIA sin el mensaje de MySQL`,
          [res.codigo, res.cuerpo, FILTRACIONES.test(JSON.stringify(res.cuerpo))], [409, CONFLICTO, false]);
      }
    }

    // ---------- Validación de cantidades (parsearCantidad) ----------
    console.log('\n== parsearCantidad: 400 con el mensaje de siempre, sin escribir');
    const cantidades = [
      ['crear con 5 decimales', inventarioController.crear, {}, { nombre: 'Sal', unidad_medida: 'kg', cantidad_disponible: '5.12345' },
        'cantidad_disponible debe ser un número no negativo con máximo 4 decimales'],
      ['crear negativo', inventarioController.crear, {}, { nombre: 'Sal', unidad_medida: 'kg', precio_unitario: -1 },
        'precio_unitario debe ser un número no negativo con máximo 4 decimales'],
      ['crear fuera de rango', inventarioController.crear, {}, { nombre: 'Sal', unidad_medida: 'kg', stock_minimo: '100000000' },
        'stock_minimo supera el máximo permitido'],
      ['crear con una lista', inventarioController.crear, {}, { nombre: 'Sal', unidad_medida: 'kg', cantidad_disponible: [1] },
        'cantidad_disponible debe ser un número no negativo con máximo 4 decimales'],
      ['editar con 5 decimales', inventarioController.actualizar, { id: '30' }, { cantidad_disponible: '5.12345' },
        'cantidad_disponible debe ser un número no negativo con máximo 4 decimales'],
      ['editar fuera de rango', inventarioController.actualizar, { id: '30' }, { stock_minimo: '100000000' },
        'stock_minimo supera el máximo permitido']
    ];
    for (const [descripcion, metodo, params, body, mensaje] of cantidades) {
      preparar();
      const res = await llamar(metodo, { params, body });
      igual(`${descripcion} -> 400 { error } con el mensaje literal`, [res.codigo, res.cuerpo], [400, { error: mensaje }]);
      igual(`${descripcion}: no consulta ni escribe nada y no es un error interno`, [eventos, erroresRegistrados.length], [[], 0]);
    }

    // ---------- Materia prima inexistente (A1: 404 al consultar, 400 al editar o eliminar) ----------
    console.log('\n== materia prima inexistente');
    for (const [descripcion, metodo, req, codigo] of [
      ['GET de una inexistente', inventarioController.getById, { params: { id: '99' } }, 404],
      ['GET de una de otra panadería', inventarioController.getById, { params: { id: '30' }, panaderiaId: 21 }, 404],
      ['PUT de una inexistente', inventarioController.actualizar, { params: { id: '99' }, body: { precio_unitario: '1' } }, 400],
      ['DELETE de una inexistente', inventarioController.eliminar, { params: { id: '99' } }, 400],
      ['DELETE de una de otra panadería', inventarioController.eliminar, { params: { id: '30' }, panaderiaId: 21 }, 400]
    ]) {
      preparar();
      const res = await llamar(metodo, req);
      igual(`${descripcion} -> ${codigo} con el mensaje de siempre, sin escribir`,
        [res.codigo, res.cuerpo, eventos.includes('guardar'), erroresRegistrados.length], [codigo, NO_ENCONTRADA, false, 0]);
    }
    for (const [descripcion, invocar, codigo] of [
      ['getById', () => inventarioService.getById('99', 20), 404],
      ['actualizar', () => inventarioService.actualizar('99', {}, 20), 400],
      ['eliminar', () => inventarioService.eliminar('99', 20), 400]
    ]) {
      preparar();
      const s = await resultado(invocar());
      igual(`servicio, ${descripcion} inexistente: ErrorNegocio ${codigo}`,
        [s.ok, s.e instanceof ErrorNegocio, s.e?.status, s.e?.message], [false, true, codigo, 'Materia prima no encontrada']);
    }

    // ---------- Campos requeridos o inválidos (validación real del modelo) ----------
    console.log('\n== campos requeridos o inválidos: 400 que solo nombra campos del cliente');
    const campos = [
      ['producto sin cuerpo (petición sin JSON)', ventasController.crearProducto, { body: undefined }, 'nombre, precio_venta'],
      ['producto con cuerpo nulo', ventasController.crearProducto, { body: null }, 'nombre, precio_venta'],
      ['producto sin precio de venta', ventasController.crearProducto, { body: { nombre: 'Torta' } }, 'precio_venta'],
      ['producto con nombre que no es texto', ventasController.crearProducto, { body: { nombre: { a: 1 }, precio_venta: 900 } }, 'nombre'],
      ['materia prima sin cuerpo', inventarioController.crear, { body: undefined }, 'nombre, unidad_medida'],
      ['materia prima sin unidad', inventarioController.crear, { body: { nombre: 'Sal' } }, 'unidad_medida'],
      ['materia prima con nombre lista', inventarioController.crear, { body: { nombre: ['Sal'], unidad_medida: 'kg' } }, 'nombre'],
      ['editar con nombre nulo', inventarioController.actualizar, { params: { id: '30' }, body: { nombre: null } }, 'nombre']
    ];
    for (const [descripcion, metodo, req, lista] of campos) {
      preparar();
      const res = await llamar(metodo, req);
      igual(`${descripcion} -> 400 que nombra ${lista}`,
        [res.codigo, res.cuerpo, FILTRACIONES.test(JSON.stringify(res.cuerpo)), erroresRegistrados.length],
        [400, { error: `Campos requeridos o inválidos: ${lista}` }, false, 0]);
    }

    // Un campo que fija el servidor (panaderia_id) o un validador no estándar no son culpa del cliente
    preparar();
    let res = await llamar(ventasController.crearProducto, { body: { nombre: 'Torta', precio_venta: 900 }, panaderiaId: null });
    igual('panaderia_id nulo (lo fija el servidor) -> 500 genérico, registrado', [res.codigo, res.cuerpo, erroresRegistrados.length], [500, ERROR_INTERNO, 1]);
    preparar({ en: 'crearMateria', error: new ValidationError('Validation error', [new ValidationErrorItem('Validación propia', 'Validation error', 'nombre', 'x')]) });
    res = await llamar(inventarioController.crear, { body: { nombre: 'Sal', unidad_medida: 'kg' } });
    igual('ValidationError de un validador no estándar -> 500 genérico', [res.codigo, res.cuerpo], [500, ERROR_INTERNO]);
    preparar({ en: 'crearMateria', error: new ValidationError('Validation error', []) });
    res = await llamar(inventarioController.crear, { body: { nombre: 'Sal', unidad_medida: 'kg' } });
    igual('ValidationError sin elementos -> 500 genérico', [res.codigo, res.cuerpo], [500, ERROR_INTERNO]);
    preparar({ en: 'crearMateria', error: new UniqueConstraintError({
      parent: errorMysql("Duplicate entry 'Sal' for key 'materia_prima.nombre'", { errno: 1062, code: 'ER_DUP_ENTRY', sql: SQL_INSERT }),
      fields: { nombre: 'Sal' }, message: 'Validation error'
    }) });
    res = await llamar(inventarioController.crear, { body: { nombre: 'Sal', unidad_medida: 'kg' } });
    igual('UNIQUE -> 409 { error } genérico (como siempre en responderError)', [res.codigo, res.cuerpo], [409, { error: 'El registro ya existe' }]);

    // ---------- Formato, rango o longitud rechazados por MySQL ----------
    console.log('\n== datos rechazados por MySQL: 400 solo si la columna es un campo del cliente');
    const datosCliente = [
      ['texto demasiado largo (1406)', 'crearMateria', inventarioController.crear, 1406, 'ER_DATA_TOO_LONG', "Data too long for column 'nombre' at row 1"],
      ['columna nula (1048)', 'crearMateria', inventarioController.crear, 1048, 'ER_BAD_NULL_ERROR', "Column 'unidad_medida' cannot be null"],
      ['valor incorrecto con base y tabla (1366)', 'crearProducto', ventasController.crearProducto, 1366, 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD',
        "Incorrect integer value: 'abc' for column `pansys_test`.`productos`.`cantidad_disponible` at row 1"],
      ['valor truncado (1265)', 'crearProducto', ventasController.crearProducto, 1265, 'WARN_DATA_TRUNCATED', "Data truncated for column 'precio_venta' at row 1"],
      ['fuera de rango (1264)', 'crearProducto', ventasController.crearProducto, 1264, 'ER_WARN_DATA_OUT_OF_RANGE', "Out of range value for column 'cantidad_disponible' at row 1"],
      ['al editar: texto demasiado largo (1406)', 'guardar', inventarioController.actualizar, 1406, 'ER_DATA_TOO_LONG', "Data too long for column 'unidad_medida' at row 1"]
    ];
    const cuerpos = { crearMateria: { nombre: 'Sal', unidad_medida: 'kg' }, crearProducto: { nombre: 'Torta', precio_venta: 900 }, guardar: { precio_unitario: '1' } };
    for (const [descripcion, en, metodo, errno, code, mensaje] of datosCliente) {
      preparar({ en, error: datosMysql(errno, code, mensaje) });
      const r2 = await llamar(metodo, { params: { id: '30' }, body: cuerpos[en] });
      igual(`${descripcion} -> 400 { error: 'Datos inválidos' } sin la columna ni el mensaje de MySQL`,
        [r2.codigo, r2.cuerpo, FILTRACIONES.test(JSON.stringify(r2.cuerpo)), erroresRegistrados.length], [400, { error: 'Datos inválidos' }, false, 0]);
    }
    const datosInternos = [
      ['columna que fija el servidor (panaderia_id, 1048)', 1048, 'ER_BAD_NULL_ERROR', "Column 'panaderia_id' cannot be null"],
      ['columna que fija el servidor (estado, 1366)', 1366, 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD', "Incorrect integer value: 'x' for column 'estado' at row 1"],
      ['código de datos sin columna en el mensaje (1406)', 1406, 'ER_DATA_TOO_LONG', 'Data too long'],
      ['código no admitido aunque nombre una columna del cliente (1292)', 1292, 'ER_TRUNCATED_WRONG_VALUE', "Truncated incorrect DOUBLE value: 'abc' for column 'nombre' at row 1"]
    ];
    for (const [descripcion, errno, code, mensaje] of datosInternos) {
      preparar({ en: 'crearMateria', error: datosMysql(errno, code, mensaje) });
      const r2 = await llamar(inventarioController.crear, { body: cuerpos.crearMateria });
      igual(`${descripcion} -> 500 genérico, registrado`, [r2.codigo, r2.cuerpo, erroresRegistrados.length], [500, ERROR_INTERNO, 1]);
    }

    // ---------- responderError no cambia para los demás módulos ----------
    console.log('\n== responderError: mismo comportamiento de siempre');
    preparar();
    const directo = respuestaDoble();
    responderError(directo, new ValidationError('Validation error', [new ValidationErrorItem('nombre cannot be null', 'notNull Violation', 'nombre', null)]));
    igual('un ValidationError sigue siendo un 500 genérico con responderError', [directo.codigo, directo.cuerpo], [500, ERROR_INTERNO]);
    const negocio = respuestaDoble();
    responderError(negocio, new ErrorNegocio('Mensaje de negocio', 422, { materias_primas: [30] }));
    igual('un ErrorNegocio sigue respondiendo su código, su mensaje y su detalle', [negocio.codigo, negocio.cuerpo], [422, { error: 'Mensaje de negocio', materias_primas: [30] }]);

    // ---------- Código fuente ----------
    console.log('\n== código fuente');
    const leer = (relativa) => fs.readFileSync(path.join(__dirname, relativa), 'utf8');
    for (const [archivo, usos] of [
      ['../src/middlewares/roles.middleware.js', 1],
      ['../src/modules/ventas/ventas.controller.js', 4],
      ['../src/modules/inventario/inventario.controller.js', 6]
    ]) {
      const codigo = leer(archivo);
      igual(`${path.basename(archivo)} no devuelve error.message al cliente`, /error\.message/.test(codigo), false);
      igual(`${path.basename(archivo)}: los ${usos} catch usan responderError o responderErrorDeDatos`,
        (codigo.match(/responderError(DeDatos)?\(res, error/g) ?? []).length, usos);
    }
    igual('inventario.service.js no lanza Error genéricos (solo ErrorNegocio)', /new Error\(/.test(leer('../src/modules/inventario/inventario.service.js')), false);
  } finally {
    Panaderia.findByPk = originales.panaderiaFindByPk;
    MateriaPrima.findAll = originales.materiaFindAll;
    MateriaPrima.findOne = originales.materiaFindOne;
    MateriaPrima.create = originales.materiaCreate;
    Producto.findAll = originales.productoFindAll;
    Producto.create = originales.productoCreate;
    Venta.findAll = originales.ventaFindAll;
    console.error = originales.consolaError;
  }
};

main()
  .catch(error => { resultados.push(false); console.log('FALLA ejecución abortada ->', error.message); })
  .finally(() => {
    const fallidas = resultados.filter(ok => !ok).length;
    console.log(`\n${resultados.length - fallidas}/${resultados.length} pruebas correctas`);
    process.exit(fallidas ? 1 : 0);
  });
