// Pruebas unitarias de las respuestas de error de POST /api/auth/registrar (auth.controller y
// auth.service). Los rechazos de negocio responden 400 con su mensaje de siempre; cualquier error
// interno (base de datos, conexión, errores de programación) pasa por responderError y nunca llega
// al cliente con nombres de bases, tablas, restricciones ni detalles de conexión.
// No usan la base de datos ni el servidor: los modelos y bcrypt se sustituyen por dobles en memoria
// y la respuesta HTTP es un objeto falso. Se pueden ejecutar en cualquier momento.
//
// Uso (desde backend/):  node pruebas/auth.unitarias.js

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

// Cualquiera de estos textos en una respuesta sería una filtración de detalles internos
const FILTRACIONES = /pansys_|CONSTRAINT|FOREIGN KEY|ibfk|fk_usuarios|REFERENCES|ECONNREFUSED|3306|127\.0\.0\.1|Access denied|localhost|Duplicate entry|usuarios\.email|Lock wait|Deadlock|errno|sql|Cannot read|Sequelize/i;

const main = async () => {
  const bcrypt = require('bcrypt');
  const {
    ForeignKeyConstraintError, UniqueConstraintError, ConnectionRefusedError, AccessDeniedError, DatabaseError
  } = require('sequelize');
  const { Usuario, Panaderia } = require('../src/models/index');
  const authController = require('../src/modules/auth/auth.controller');
  const authService = require('../src/modules/auth/auth.service');
  const { ErrorNegocio } = require('../src/utils/errores');

  const originales = {
    panaderiaFindByPk: Panaderia.findByPk, usuarioFindOne: Usuario.findOne, usuarioCreate: Usuario.create,
    hash: bcrypt.hash, consolaError: console.error
  };

  // Escenario: la panadería 20 existe y el email EXISTENTE ya está registrado.
  // fallo = { en: 'panaderia' | 'buscar' | 'crear', error } lanza ese error en ese paso.
  const EXISTENTE = 'existente@pansys.test';
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

  Panaderia.findByPk = async (id) => {
    eventos.push(`panaderia:${id}`);
    if (fallo?.en === 'panaderia') throw fallo.error;
    return id === 20 ? { id: 20 } : null;
  };
  Usuario.findOne = async ({ where }) => {
    eventos.push('buscar');
    if (fallo?.en === 'buscar') throw fallo.error;
    return where.email === EXISTENTE ? { id: 5, email: EXISTENTE } : null;
  };
  Usuario.create = async (datos) => {
    eventos.push('crear');
    creado = datos;
    if (fallo?.en === 'crear') throw fallo.error;
    return { id: 77, ...datos };
  };
  bcrypt.hash = async (contrasena, rondas) => { eventos.push(`hash:${rondas}`); return 'hash-doble'; };
  // responderError registra en el servidor los errores internos: se capturan para comprobarlo
  console.error = (...args) => { erroresRegistrados.push(args); };

  const respuestaDoble = () => ({
    codigo: null, cuerpo: null,
    status(c) { this.codigo = c; return this; },
    json(b) { if (this.codigo === null) this.codigo = 200; this.cuerpo = b; return this; }
  });
  const registrar = async (body) => {
    const res = respuestaDoble();
    await authController.registrar({ body }, res);
    return res;
  };

  const VALIDO = { email: 'nueva@pansys.test', contrasena: 'Clave1234', rol_id: 2, panaderia_id: 20 };
  const ERROR_INTERNO = { error: 'Error interno del servidor' };
  const CONFLICTO = {
    error: 'La operación coincidió con otra simultánea. Inténtelo de nuevo.',
    codigo: 'CONFLICTO_CONCURRENCIA',
    reintentar: true
  };

  // Errores de MySQL tal como los entrega mysql2 (con errno, code y sql) envueltos por Sequelize
  const errorMysql = (mensaje, extra) => Object.assign(new Error(mensaje), { sqlMessage: mensaje, ...extra });
  const SQL_INSERT = 'INSERT INTO `usuarios` (`id`,`email`,`contrasena`,`rol_id`,`panaderia_id`) VALUES (DEFAULT,?,?,?,?);';
  const FK_PANADERIA = 'Cannot add or update a child row: a foreign key constraint fails (`pansys_db`.`usuarios`, CONSTRAINT `fk_usuarios_panaderia` FOREIGN KEY (`panaderia_id`) REFERENCES `panaderias` (`id`))';
  const FK_ROL = 'Cannot add or update a child row: a foreign key constraint fails (`pansys_test`.`usuarios`, CONSTRAINT `usuarios_ibfk_3` FOREIGN KEY (`rol_id`) REFERENCES `roles` (`id`) ON DELETE CASCADE ON UPDATE CASCADE)';

  try {
    // ---------- Cuerpo ausente o incompleto ----------
    console.log('\n== cuerpo ausente o incompleto');
    for (const [descripcion, body] of [['cuerpo indefinido (petición sin JSON)', undefined], ['cuerpo nulo', null], ['faltan campos', { email: VALIDO.email }]]) {
      preparar();
      const r = await registrar(body);
      igual(`${descripcion} -> 400 con el mensaje de siempre`, [r.codigo, r.cuerpo], [400, { error: 'Todos los campos son requeridos' }]);
      igual(`${descripcion}: no consulta ni escribe nada`, eventos, []);
    }

    // ---------- Rechazos de negocio ----------
    console.log('\n== rechazos de negocio: 400 con el mensaje literal');
    const rechazos = [
      ['rol inválido', { ...VALIDO, rol_id: 9 }, 'Rol inválido'],
      ['administrador con panadería', { ...VALIDO, rol_id: 1, panaderia_id: 20 }, 'El administrador general no se asigna a una panadería'],
      ['panadería inexistente', { ...VALIDO, panaderia_id: 99 }, 'Debe indicar una panadería válida para este rol'],
      ['panadería no numérica', { ...VALIDO, rol_id: 3, panaderia_id: 'abc' }, 'Debe indicar una panadería válida para este rol'],
      ['email ya registrado', { ...VALIDO, email: EXISTENTE }, 'El email ya está registrado'],
      ['email sin formato', { ...VALIDO, email: 'sinarroba' }, 'El email no es válido'],
      ['contraseña corta', { ...VALIDO, contrasena: 'Ab1' }, 'La contraseña debe tener al menos 8 caracteres']
    ];
    for (const [descripcion, body, mensaje] of rechazos) {
      preparar();
      const r = await registrar(body);
      igual(`${descripcion} -> 400 { error } con el mensaje literal`, [r.codigo, r.cuerpo], [400, { error: mensaje }]);
      igual(`${descripcion}: no crea la cuenta ni se registra como error interno`, [eventos.includes('crear'), erroresRegistrados.length], [false, 0]);
    }

    // Los cuatro rechazos propios del servicio son ErrorNegocio 400 (antes eran Error genéricos)
    const delServicio = rechazos.filter(([d]) => ['rol inválido', 'administrador con panadería', 'panadería inexistente', 'email ya registrado'].includes(d));
    for (const [descripcion, { email, contrasena, rol_id, panaderia_id }, mensaje] of delServicio) {
      preparar();
      const s = await resultado(authService.registrar(email, contrasena, rol_id, panaderia_id));
      igual(`servicio, ${descripcion}: ErrorNegocio 400 con el mensaje literal`,
        [s.ok, s.e instanceof ErrorNegocio, s.e?.status, s.e?.message], [false, true, 400, mensaje]);
    }

    // ---------- Errores internos ----------
    console.log('\n== errores internos: sin detalles para el cliente');
    const internos = [
      ['clave foránea de panadería (pansys_db)', 'crear', new ForeignKeyConstraintError({
        parent: errorMysql(FK_PANADERIA, { errno: 1452, code: 'ER_NO_REFERENCED_ROW_2', sql: SQL_INSERT }),
        fields: ['panaderia_id'], table: 'panaderias', index: 'fk_usuarios_panaderia'
      })],
      ['clave foránea de rol (pansys_test)', 'crear', new ForeignKeyConstraintError({
        parent: errorMysql(FK_ROL, { errno: 1452, code: 'ER_NO_REFERENCED_ROW_2', sql: SQL_INSERT }),
        fields: ['rol_id'], table: 'roles', index: 'usuarios_ibfk_3'
      })],
      ['conexión rechazada (ECONNREFUSED)', 'panaderia', new ConnectionRefusedError(
        Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:3306'), { code: 'ECONNREFUSED', errno: -4078, address: '127.0.0.1', port: 3306 })
      )],
      ['acceso denegado a MySQL', 'buscar', new AccessDeniedError(
        errorMysql("Access denied for user 'pansys'@'localhost' (using password: YES)", { errno: 1045, code: 'ER_ACCESS_DENIED_ERROR' })
      )],
      ['error de base de datos con SQL', 'crear', new DatabaseError(
        errorMysql("Unknown column 'version_sesion' in 'field list' (pansys_db.usuarios)", { errno: 1054, code: 'ER_BAD_FIELD_ERROR', sql: SQL_INSERT })
      )],
      ['error de programación (TypeError)', 'crear', new TypeError("Cannot read properties of undefined (reading 'id')")]
    ];
    for (const [descripcion, en, error] of internos) {
      // Control: el doble sí lleva detalles internos; si no, la comprobación de filtración no probaría nada
      igual(`control, ${descripcion}: el error simulado contiene detalles internos`, FILTRACIONES.test(error.message), true);
      preparar({ en, error });
      const r = await registrar(VALIDO);
      igual(`${descripcion} -> 500 { error } genérico`, [r.codigo, r.cuerpo], [500, ERROR_INTERNO]);
      igual(`${descripcion}: la respuesta no filtra base, tabla, restricción ni conexión`, FILTRACIONES.test(JSON.stringify(r.cuerpo)), false);
      igual(`${descripcion}: el detalle queda solo en el registro del servidor`,
        [erroresRegistrados.length, erroresRegistrados[0]?.[1] === error], [1, true]);
    }

    // ---------- Conflictos ----------
    console.log('\n== conflictos: 409 sin detalles');
    const unico = new UniqueConstraintError({
      parent: errorMysql("Duplicate entry 'nueva@pansys.test' for key 'usuarios.email'", { errno: 1062, code: 'ER_DUP_ENTRY', sql: SQL_INSERT }),
      fields: { email: 'nueva@pansys.test' },
      message: 'Validation error'
    });
    preparar({ en: 'crear', error: unico });
    const duplicado = await registrar(VALIDO);
    igual('email duplicado por concurrencia (UNIQUE) -> 409 { error } genérico', [duplicado.codigo, duplicado.cuerpo], [409, { error: 'El registro ya existe' }]);
    igual('UNIQUE: la respuesta no filtra el email ni el índice', FILTRACIONES.test(JSON.stringify(duplicado.cuerpo)), false);

    const conflictos = [
      ['bloqueo agotado (1205)', 'buscar', errorMysql('Lock wait timeout exceeded; try restarting transaction', { errno: 1205, code: 'ER_LOCK_WAIT_TIMEOUT', sql: 'SELECT `id` FROM `usuarios` WHERE `email` = ?;' })],
      ['interbloqueo (1213)', 'crear', errorMysql('Deadlock found when trying to get lock; try restarting transaction', { errno: 1213, code: 'ER_LOCK_DEADLOCK', sql: SQL_INSERT })]
    ];
    for (const [descripcion, en, parent] of conflictos) {
      preparar({ en, error: new DatabaseError(parent) });
      const r = await registrar(VALIDO);
      igual(`${descripcion} -> 409 CONFLICTO_CONCURRENCIA reintentable`, [r.codigo, r.cuerpo], [409, CONFLICTO]);
      igual(`${descripcion}: la respuesta no filtra el mensaje de MySQL`, FILTRACIONES.test(JSON.stringify(r.cuerpo)), false);
    }

    // ---------- Registro correcto ----------
    console.log('\n== registro correcto: contrato de siempre');
    preparar();
    const panadero = await registrar({ ...VALIDO, email: `  ${VALIDO.email} ` });
    igual('panadero -> 201 { mensaje, id }', [panadero.codigo, panadero.cuerpo], [201, { mensaje: 'Usuario creado exitosamente', id: 77 }]);
    igual('guarda el email recortado, el hash (no la contraseña), el rol y la panadería',
      creado, { email: VALIDO.email, contrasena: 'hash-doble', rol_id: 2, panaderia_id: 20 });
    igual('orden: panadería, email repetido, hash, creación', eventos, ['panaderia:20', 'buscar', 'hash:10', 'crear']);

    preparar();
    const admin = await registrar({ email: 'admin.nuevo@pansys.test', contrasena: 'Clave1234', rol_id: 1 });
    igual('administrador sin panadería -> 201', [admin.codigo, admin.cuerpo], [201, { mensaje: 'Usuario creado exitosamente', id: 77 }]);
    igual('administrador: panaderia_id nulo y sin consultar panaderías',
      [creado?.panaderia_id, eventos.some(e => e.startsWith('panaderia:'))], [null, false]);
    igual('registros correctos: ningún error interno registrado', erroresRegistrados.length, 0);

    // ---------- Código fuente ----------
    console.log('\n== código fuente');
    const leer = (relativa) => fs.readFileSync(path.join(__dirname, relativa), 'utf8');
    const controlador = leer('../src/modules/auth/auth.controller.js');
    const servicio = leer('../src/modules/auth/auth.service.js');
    igual('auth.controller.js no devuelve error.message al cliente', /error\.message/.test(controlador), false);
    igual('auth.controller.js: los tres catch usan responderError', (controlador.match(/responderError\(res, error\)/g) ?? []).length, 3);
    igual('auth.service.js no lanza Error genéricos (solo ErrorNegocio)', /new Error\(/.test(servicio), false);
  } finally {
    Panaderia.findByPk = originales.panaderiaFindByPk;
    Usuario.findOne = originales.usuarioFindOne;
    Usuario.create = originales.usuarioCreate;
    bcrypt.hash = originales.hash;
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
