// Pruebas unitarias de pruebas/aislamiento.js (bloqueo de suite, registro de lo propio y
// limpieza transaccional). No usan MySQL: la conexión dedicada y la de Sequelize se sustituyen
// por dobles en memoria que simulan GET_LOCK, transacciones y las claves foráneas de
// crear_pansys_test.sql (RESTRICT, CASCADE y SET NULL). Se pueden ejecutar en cualquier momento.
//
// Uso (desde backend/):  node pruebas/aislamiento.unitarias.js

// Seguridad: si algo escapara a los dobles, apuntaría a un host que no existe
process.env.DB_HOST = 'base-inexistente.invalid';

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const { spawnSync } = require('child_process');
const {
  NOMBRE_BLOQUEO, ErrorAislamiento, verificarConfiguracion, iniciarEjecucion, Ejecucion, abrirBloqueo,
  PLANTILLA_CUENTA, PLANTILLA_PANADERIA, PLANTILLA_PRODUCTO, limpiezaCorrecta, describirPendientes
} = require('./aislamiento');

const resultados = [];
const igual = (descripcion, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  resultados.push(ok);
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${descripcion}${ok ? '' : ` -> obtenido ${JSON.stringify(real)}, esperado ${JSON.stringify(esperado)}`}`);
};
const falla = async (fn) => {
  try { await fn(); return null; } catch (error) { return error; }
};

const ENV = { DB_NAME: 'pansys_test', DB_HOST: 'base-inexistente.invalid', DB_USER: 'doble', DB_PASSWORD: 'doble' };

// ---------- Doble del servidor MySQL ----------

// [tabla hija, columna, tabla madre, acción ON DELETE] (crear_pansys_test.sql y diseño del SQL 005)
const FKS = [
  ['panaderias', 'usuario_id', 'usuarios', 'CASCADE'],
  ['usuarios', 'panaderia_id', 'panaderias', 'RESTRICT'],
  ['materia_prima', 'panaderia_id', 'panaderias', 'CASCADE'],
  ['productos', 'panaderia_id', 'panaderias', 'CASCADE'],
  ['ventas', 'panaderia_id', 'panaderias', 'CASCADE'],
  ['detalle_ventas', 'venta_id', 'ventas', 'CASCADE'],
  ['detalle_ventas', 'producto_id', 'productos', 'CASCADE'],
  ['receta_producto', 'producto_id', 'productos', 'RESTRICT'],
  ['receta_producto', 'materia_prima_id', 'materia_prima', 'RESTRICT'],
  ['orden_produccion', 'empleado_id', 'usuarios', 'RESTRICT'],
  ['orden_produccion', 'cerrado_por', 'usuarios', 'RESTRICT'],
  ['orden_produccion', 'producto_id', 'productos', 'RESTRICT'],
  ['orden_produccion', 'panaderia_id', 'panaderias', 'RESTRICT'],
  ['insumo_usado', 'orden_id', 'orden_produccion', 'RESTRICT'],
  ['insumo_usado', 'materia_prima_id', 'materia_prima', 'RESTRICT'],
  ['eventos_seguridad', 'usuario_id', 'usuarios', 'RESTRICT'],
  ['eventos_seguridad', 'actor_id', 'usuarios', 'RESTRICT'],
  ['restablecimientos_contrasena', 'usuario_id', 'usuarios', 'CASCADE'],
  ['restablecimientos_contrasena', 'solicitado_por', 'usuarios', 'SET NULL']
];

const copiar = (valor) => JSON.parse(JSON.stringify(valor));
const errorMysql = (code, mensaje) => Object.assign(new Error(mensaje), { code });

// Borra filas aplicando las claves foráneas (como InnoDB: RESTRICT falla, CASCADE arrastra)
const borrarConFks = (db, tablaMadre, ids) => {
  if (!ids.length) return;
  for (const [hija, columna, madre, accion] of FKS) {
    if (madre !== tablaMadre || !db[hija]) continue;
    const afectadas = db[hija].filter(f => ids.includes(f[columna]));
    if (!afectadas.length) continue;
    if (accion === 'RESTRICT') {
      throw errorMysql('ER_ROW_IS_REFERENCED_2', `Cannot delete a parent row: ${hija}.${columna} -> ${madre}`);
    }
    if (accion === 'SET NULL') afectadas.forEach(f => { f[columna] = null; });
    if (accion === 'CASCADE') {
      const idsHijas = afectadas.map(f => f.id);
      borrarConFks(db, hija, idsHijas);
      db[hija] = db[hija].filter(f => !idsHijas.includes(f.id));
    }
  }
  db[tablaMadre] = db[tablaMadre].filter(f => !ids.includes(f.id));
};

// Evalúa las formas de WHERE que genera aislamiento.js; cualquier otra falla a propósito
const filtrar = (db, nombreTabla, where, params) => {
  const valores = [...params];
  const tipo = where.includes(' OR ') ? 'OR' : 'AND';
  const predicados = where.split(` ${tipo} `).map((condicion) => {
    let m;
    if ((m = condicion.match(/^(\w+) IS NOT NULL$/))) {
      const col = m[1];
      return f => f[col] !== null && f[col] !== undefined;
    }
    if ((m = condicion.match(/^(\w+) (NOT IN|IN) \(SELECT id FROM pansys_test\.(\w+) WHERE (\w+) IN \(\?\)\)$/))) {
      const [, col, op, madre, colMadre] = m;
      const lista = valores.shift();
      if (!Array.isArray(lista) || !lista.length) throw errorMysql('ER_PARSE_ERROR', 'IN () vacío');
      const ids = new Set(db[madre].filter(f => lista.includes(f[colMadre])).map(f => f.id));
      return f => (op === 'IN' ? ids.has(f[col]) : f[col] !== null && !ids.has(f[col]));
    }
    if ((m = condicion.match(/^(\w+) (NOT IN|IN) \(\?\)$/))) {
      const [, col, op] = m;
      const lista = valores.shift();
      if (!Array.isArray(lista) || !lista.length) throw errorMysql('ER_PARSE_ERROR', 'IN () vacío');
      // Semántica SQL: NULL IN (...) y NULL NOT IN (...) no son verdaderos
      return f => f[col] !== null && f[col] !== undefined && (op === 'IN' ? lista.includes(f[col]) : !lista.includes(f[col]));
    }
    throw new Error(`Condición no soportada por el doble: ${condicion}`);
  });
  if (valores.length) throw new Error('Parámetros sobrantes en la consulta');
  if (!db[nombreTabla]) throw errorMysql('ER_NO_SUCH_TABLE', `Table pansys_test.${nombreTabla} doesn't exist`);
  return db[nombreTabla].filter(f => (tipo === 'OR' ? predicados.some(p => p(f)) : predicados.every(p => p(f))));
};

const crearServidor = (db) => ({ db, base: 'pansys_test', bloqueos: new Map(), siguienteId: 100, siguienteFila: 500, antes: null, conexiones: [] });

class ConexionDoble extends EventEmitter {
  constructor(servidor) {
    super();
    this.servidor = servidor;
    this.id = servidor.siguienteId++;
    this.registro = [];
    this.cerrada = false;
    this.copiaTransaccion = null;
    servidor.conexiones.push(this);
  }

  soltarBloqueos() {
    for (const [nombre, dueno] of this.servidor.bloqueos) if (dueno === this.id) this.servidor.bloqueos.delete(nombre);
  }

  // Simula la caída de la conexión: MySQL deshace la transacción abierta y suelta los bloqueos
  perder() {
    if (this.cerrada) return;
    this.cerrada = true;
    if (this.copiaTransaccion) this.servidor.db = this.copiaTransaccion;
    this.copiaTransaccion = null;
    this.soltarBloqueos();
    this.emit('error', errorMysql('PROTOCOL_CONNECTION_LOST', 'Connection lost'));
  }

  async end() {
    if (this.cerrada) return;
    this.cerrada = true;
    if (this.copiaTransaccion) this.servidor.db = this.copiaTransaccion;
    this.copiaTransaccion = null;
    this.soltarBloqueos();
    this.emit('end');
  }

  async query(sql, params = []) {
    this.registro.push(sql);
    if (this.cerrada) throw errorMysql('PROTOCOL_ENQUEUE_AFTER_QUIT', 'Connection closed');
    if (this.servidor.antes) this.servidor.antes(sql, this);
    if (this.cerrada) throw errorMysql('PROTOCOL_CONNECTION_LOST', 'Connection lost');
    const s = this.servidor;
    const consulta = sql.replace(/\s+FOR UPDATE$/, '');
    let m;
    if (consulta === 'SELECT DATABASE() AS base') return [[{ base: s.base }]];
    if (consulta === 'SELECT GET_LOCK(?, 0) AS obtenido, CONNECTION_ID() AS id') {
      if (s.getLockNull) return [[{ obtenido: null, id: this.id }]];
      const dueno = s.bloqueos.get(params[0]);
      if (dueno !== undefined && dueno !== this.id) return [[{ obtenido: 0, id: this.id }]];
      s.bloqueos.set(params[0], this.id);
      return [[{ obtenido: 1, id: s.idNulo ? null : this.id }]];
    }
    if (consulta === 'SELECT IS_USED_LOCK(?) AS dueno') {
      if (s.lockSinFilas) return [[]];
      return [[{ dueno: s.bloqueos.get(params[0]) ?? null }]];
    }
    if (consulta === 'SELECT RELEASE_LOCK(?) AS liberado') {
      if (s.bloqueos.get(params[0]) !== this.id) return [[{ liberado: 0 }]];
      s.bloqueos.delete(params[0]);
      return [[{ liberado: 1 }]];
    }
    if (consulta === 'START TRANSACTION') { this.copiaTransaccion = copiar(s.db); return [{}]; }
    if (consulta === 'COMMIT') {
      this.copiaTransaccion = null;
      // Caso ambiguo: el COMMIT se aplica, pero la conexión cae antes de que llegue la respuesta
      if (s.perderTrasCommit) {
        s.perderTrasCommit = false;
        this.perder();
        throw errorMysql('PROTOCOL_CONNECTION_LOST', 'Connection lost');
      }
      return [{}];
    }
    if (consulta === 'ROLLBACK') {
      if (this.copiaTransaccion) s.db = this.copiaTransaccion;
      this.copiaTransaccion = null;
      return [{}];
    }
    if (consulta === 'SELECT TABLE_NAME AS tabla FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?)') {
      return [params[1].filter(t => params[0] === 'pansys_test' && s.db[t]).map(tabla => ({ tabla }))];
    }
    // Toda tabla de datos debe ir calificada con pansys_test
    for (const [, esquema] of consulta.matchAll(/(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)(?=\s|$)/g)) {
      throw new Error(`Tabla sin base explícita en: ${sql} (${esquema})`);
    }
    for (const [, esquema] of consulta.matchAll(/(?:FROM|JOIN|INTO|UPDATE)\s+(\w+)\.\w+/g)) {
      if (esquema !== 'pansys_test') throw new Error(`Consulta fuera de pansys_test: ${sql}`);
    }
    if ((m = consulta.match(/^SELECT COUNT\(\*\) AS n FROM pansys_test\.(\w+) WHERE (.+)$/))) {
      return [[{ n: filtrar(s.db, m[1], m[2], params).length }]];
    }
    if ((m = consulta.match(/^SELECT ([\w, ]+) FROM pansys_test\.(\w+) WHERE (.+)$/))) {
      const columnas = m[1].split(',').map(c => c.trim());
      return [filtrar(s.db, m[2], m[3], params).map(f => Object.fromEntries(columnas.map(c => [c, f[c]])))];
    }
    // Las dos plantillas de escritura protegida (texto exacto) y sus restricciones: email único y
    // claves foráneas hacia roles, panaderias y usuarios. Errores de MySQL con errno y sqlState.
    if (consulta === PLANTILLA_CUENTA || consulta === PLANTILLA_PANADERIA || consulta === PLANTILLA_PRODUCTO) {
      const errorSql = (errno, code) => Object.assign(new Error(code), { errno, code, sqlState: '23000', fatal: false });
      let fila;
      if (consulta === PLANTILLA_CUENTA) {
        const [email, rolId, panaderiaId, estado] = params;
        if (s.db.usuarios.some(u => u.email === email)) throw errorSql(1062, 'ER_DUP_ENTRY');
        if (!s.db.roles.some(r => r.id === rolId)) throw errorSql(1452, 'ER_NO_REFERENCED_ROW_2');
        if (panaderiaId !== null && !s.db.panaderias.some(p => p.id === panaderiaId)) throw errorSql(1452, 'ER_NO_REFERENCED_ROW_2');
        fila = { id: s.siguienteFila++, email, panaderia_id: panaderiaId, contrasena: '!', rol_id: rolId, estado, version_sesion: 0 };
        s.db.usuarios.push(fila);
      } else if (consulta === PLANTILLA_PRODUCTO) {
        const [nombre, precioVenta, cantidad, panaderiaId, estado] = params;
        if (!s.db.panaderias.some(p => p.id === panaderiaId)) throw errorSql(1452, 'ER_NO_REFERENCED_ROW_2');
        fila = { id: s.siguienteFila++, panaderia_id: panaderiaId, nombre, precio_compra: 0, precio_venta: precioVenta, cantidad_disponible: cantidad, estado };
        s.db.productos.push(fila);
      } else {
        const [nombre, usuarioId] = params;
        if (!s.db.usuarios.some(u => u.id === usuarioId)) throw errorSql(1452, 'ER_NO_REFERENCED_ROW_2');
        fila = { id: s.siguienteFila++, nombre, usuario_id: usuarioId, direccion: 'Dirección temporal de pruebas' };
        s.db.panaderias.push(fila);
      }
      // Gancho para simular un resultado incierto DESPUÉS de aplicar el INSERT
      if (s.trasInsert) s.trasInsert(this, fila);
      return [s.respuestaInsert ?? { insertId: fila.id, affectedRows: 1 }];
    }
    if ((m = consulta.match(/^DELETE FROM pansys_test\.(\w+) WHERE (.+)$/))) {
      const ids = filtrar(s.db, m[1], m[2], params).map(f => f.id);
      const trabajo = copiar(s.db); // cada sentencia es atómica
      borrarConFks(trabajo, m[1], ids);
      s.db = trabajo;
      return [{ affectedRows: ids.length }];
    }
    throw new Error(`SQL no soportado por el doble: ${sql}`);
  }
}

const fabricaConexiones = (servidor, llamadas = { n: 0 }) => async () => {
  llamadas.n++;
  return new ConexionDoble(servidor);
};
const sequelizeDoble = (base) => ({ query: async () => [[{ base }]] });

// Datos ajenos: semilla 1-4, una cuenta creada en la demo (5) y datos de negocio en la panadería 1
const dbBase = ({ opcionales = false } = {}) => {
  const db = {
    roles: [{ id: 1, nombre: 'administrador' }, { id: 2, nombre: 'panadero' }, { id: 3, nombre: 'gerente' }],
    usuarios: [
      { id: 1, email: 'admin@pansys.test', panaderia_id: null },
      { id: 2, email: 'panadero1@pansys.test', panaderia_id: 1 },
      { id: 3, email: 'panadero2@pansys.test', panaderia_id: 2 },
      { id: 4, email: 'gerente1@pansys.test', panaderia_id: 1 },
      { id: 5, email: 'cuenta.demo@pansys.test', panaderia_id: 1 }
    ],
    panaderias: [
      { id: 1, nombre: 'Panadería Prueba Uno', usuario_id: 1 },
      { id: 2, nombre: 'Panadería Prueba Dos', usuario_id: 1 }
    ],
    materia_prima: [{ id: 1, panaderia_id: 1 }],
    productos: [{ id: 1, panaderia_id: 1 }],
    ventas: [{ id: 1, panaderia_id: 1 }],
    detalle_ventas: [{ id: 1, venta_id: 1, producto_id: 1 }],
    receta_producto: [{ id: 1, producto_id: 1, materia_prima_id: 1 }],
    orden_produccion: [{ id: 1, panaderia_id: 1, producto_id: 1, empleado_id: 2, cerrado_por: null }],
    insumo_usado: [{ id: 1, orden_id: 1, materia_prima_id: 1 }]
  };
  if (opcionales) {
    db.eventos_seguridad = [{ id: 1, usuario_id: 5, actor_id: 1 }];
    db.restablecimientos_contrasena = [{ id: 1, usuario_id: 5, solicitado_por: 1 }];
  }
  return db;
};

// Datos de la ejecución: administradora 10 (propietaria de las panaderías 20 y 21), empleados 11 y 12
const crearPropios = (servidor, ej, { opcionales = false } = {}) => {
  const db = servidor.db;
  db.usuarios.push(
    { id: 10, email: ej.correo('admin'), panaderia_id: null },
    { id: 11, email: ej.correo('panadero'), panaderia_id: 20 },
    { id: 12, email: ej.correo('gerente'), panaderia_id: 21 }
  );
  db.panaderias.push(
    { id: 20, nombre: ej.nombre('A'), usuario_id: 10 },
    { id: 21, nombre: ej.nombre('B'), usuario_id: 10 }
  );
  db.materia_prima.push({ id: 30, panaderia_id: 20 });
  db.productos.push({ id: 40, panaderia_id: 20 }, { id: 41, panaderia_id: 21 });
  db.receta_producto.push({ id: 50, producto_id: 40, materia_prima_id: 30 });
  db.orden_produccion.push({ id: 60, panaderia_id: 20, producto_id: 40, empleado_id: 11, cerrado_por: 11 });
  db.insumo_usado.push({ id: 70, orden_id: 60, materia_prima_id: 30 });
  db.ventas.push({ id: 80, panaderia_id: 20 });
  db.detalle_ventas.push({ id: 90, venta_id: 80, producto_id: 40 });
  if (opcionales) {
    db.eventos_seguridad.push({ id: 2, usuario_id: 11, actor_id: 10 }, { id: 3, usuario_id: 12, actor_id: 1 });
    db.restablecimientos_contrasena.push({ id: 2, usuario_id: 11, solicitado_por: 10 });
  }
  [10, 11, 12].forEach(id => ej.registrar('usuarios', id));
  [20, 21].forEach(id => ej.registrar('panaderias', id));
};

let contadorRun = 0;
const runIdFijo = () => (++contadorRun).toString(16).padStart(16, 'a');

const preparar = async ({ opcionales = false, propios = true } = {}) => {
  const servidor = crearServidor(dbBase({ opcionales }));
  const ajenos = copiar(servidor.db);
  const ej = await iniciarEjecucion({ suite: 'usuarios', env: ENV, crearConexion: fabricaConexiones(servidor), generarRunId: runIdFijo });
  if (propios) crearPropios(servidor, ej, { opcionales });
  return { servidor, ej, ajenos, conexion: servidor.conexiones[0] };
};

const sentencias = (conexion, prefijo) => conexion.registro.filter(s => s.startsWith(prefijo));
const ESCRITURAS = /^(DELETE|INSERT|UPDATE|START TRANSACTION|TRUNCATE|DROP|ALTER)/;

const main = async () => {
  // ---------- Configuración y apertura ----------
  console.log('\n== Configuración y bloqueo de suite');
  igual('verificarConfiguracion acepta pansys_test', await falla(() => verificarConfiguracion(ENV)), null);
  {
    const llamadas = { n: 0 };
    const error = await falla(() => iniciarEjecucion({ suite: 'ventas', env: { ...ENV, DB_NAME: 'pansys_db' }, crearConexion: fabricaConexiones(crearServidor(dbBase()), llamadas) }));
    igual('DB_NAME = pansys_db -> ErrorAislamiento sin abrir ninguna conexión', [error instanceof ErrorAislamiento, llamadas.n], [true, 0]);
    const sinNombre = await falla(() => iniciarEjecucion({ suite: 'ventas', env: { ...ENV, DB_NAME: undefined }, crearConexion: fabricaConexiones(crearServidor(dbBase()), llamadas) }));
    igual('DB_NAME ausente -> ErrorAislamiento sin abrir ninguna conexión', [sinNombre instanceof ErrorAislamiento, llamadas.n], [true, 0]);
  }
  {
    const servidor = crearServidor(dbBase());
    servidor.base = 'pansys_db';
    const error = await falla(() => iniciarEjecucion({ suite: 'ventas', env: ENV, crearConexion: fabricaConexiones(servidor) }));
    const c = servidor.conexiones[0];
    igual('SELECT DATABASE() = pansys_db -> error, sin GET_LOCK y conexión cerrada',
      [error instanceof ErrorAislamiento, c.registro, c.cerrada], [true, ['SELECT DATABASE() AS base'], true]);
  }
  {
    const servidor = crearServidor(dbBase());
    servidor.bloqueos.set(NOMBRE_BLOQUEO, 999);
    const antes = copiar(servidor.db);
    const error = await falla(() => iniciarEjecucion({ suite: 'ventas', env: ENV, crearConexion: fabricaConexiones(servidor) }));
    const c = servidor.conexiones[0];
    igual('bloqueo ocupado por otra suite -> error "Otra suite"', [error instanceof ErrorAislamiento, /Otra suite/.test(error?.message)], [true, true]);
    igual('bloqueo ocupado: ninguna escritura, datos intactos y conexión cerrada',
      [c.registro.filter(s => ESCRITURAS.test(s)), JSON.stringify(servidor.db) === JSON.stringify(antes), c.cerrada], [[], true, true]);
    igual('bloqueo ocupado: el dueño sigue siendo la otra suite', servidor.bloqueos.get(NOMBRE_BLOQUEO), 999);
  }
  {
    const servidor = crearServidor(dbBase());
    servidor.getLockNull = true;
    const error = await falla(() => iniciarEjecucion({ suite: 'ventas', env: ENV, crearConexion: fabricaConexiones(servidor) }));
    igual('GET_LOCK devuelve NULL -> error y conexión cerrada', [error instanceof ErrorAislamiento, servidor.conexiones[0].cerrada], [true, true]);
  }
  {
    const servidor = crearServidor(dbBase());
    const error = await falla(() => iniciarEjecucion({ suite: 'ventas', env: ENV, crearConexion: async () => { throw errorMysql('ECONNREFUSED', 'refused'); } }));
    igual('no se puede conectar -> ErrorAislamiento con el código, sin mostrar credenciales',
      [error instanceof ErrorAislamiento, /ECONNREFUSED/.test(error?.message), /doble/.test(error?.message)], [true, true, false]);
    igual('sin conexión no hay bloqueos tomados', servidor.bloqueos.size, 0);
  }
  {
    const servidor = crearServidor(dbBase());
    const error = await falla(() => iniciarEjecucion({ suite: 'ventas', env: ENV, crearConexion: fabricaConexiones(servidor), sequelize: sequelizeDoble('pansys_db') }));
    igual('Sequelize conectado a pansys_db -> error y bloqueo liberado',
      [error instanceof ErrorAislamiento, servidor.bloqueos.size, servidor.conexiones[0].cerrada], [true, 0, true]);
  }
  for (const suite of ['', 'Ventas', 'ventas-1', '../x', undefined]) {
    const llamadas = { n: 0 };
    const error = await falla(() => iniciarEjecucion({ suite, env: ENV, crearConexion: fabricaConexiones(crearServidor(dbBase()), llamadas) }));
    igual(`nombre de suite no válido (${JSON.stringify(suite)}) -> error sin conectar`, [error instanceof ErrorAislamiento, llamadas.n], [true, 0]);
  }
  {
    const servidor = crearServidor(dbBase());
    const ej = await iniciarEjecucion({ suite: 'ventas', env: ENV, crearConexion: fabricaConexiones(servidor), sequelize: sequelizeDoble('pansys_test') });
    const c = servidor.conexiones[0];
    igual('éxito: solo DATABASE() y GET_LOCK en la conexión dedicada',
      c.registro, ['SELECT DATABASE() AS base', 'SELECT GET_LOCK(?, 0) AS obtenido, CONNECTION_ID() AS id']);
    igual('éxito: el bloqueo pertenece a la conexión dedicada', [servidor.bloqueos.get(NOMBRE_BLOQUEO), ej.bloqueo.idConexion], [c.id, c.id]);
    igual('runId de 16 caracteres hexadecimales', /^[0-9a-f]{16}$/.test(ej.runId), true);
    const segunda = await falla(() => iniciarEjecucion({ suite: 'produccion', env: ENV, crearConexion: fabricaConexiones(servidor) }));
    igual('otra suite simultánea no obtiene el bloqueo', segunda instanceof ErrorAislamiento, true);
    await ej.cerrar();
    igual('cerrar: libera el bloqueo y cierra la conexión', [servidor.bloqueos.size, c.cerrada], [0, true]);
    await ej.cerrar();
    igual('cerrar dos veces no falla ni repite RELEASE_LOCK', sentencias(c, 'SELECT RELEASE_LOCK').length, 1);
    const tercera = await iniciarEjecucion({ suite: 'produccion', env: ENV, crearConexion: fabricaConexiones(servidor) });
    igual('tras cerrar, otra suite sí obtiene el bloqueo', servidor.bloqueos.get(NOMBRE_BLOQUEO), tercera.bloqueo.idConexion);
    await tercera.cerrar();
  }
  {
    const servidor = crearServidor(dbBase());
    const a = await iniciarEjecucion({ suite: 'ventas', env: ENV, crearConexion: fabricaConexiones(servidor) });
    await a.cerrar();
    const b = await iniciarEjecucion({ suite: 'ventas', env: ENV, crearConexion: fabricaConexiones(servidor) });
    await b.cerrar();
    igual('runId aleatorio distinto en cada ejecución', a.runId !== b.runId, true);
  }

  // ---------- Registro de lo propio ----------
  console.log('\n== Registro de identificadores propios');
  {
    const { ej } = await preparar({ propios: false });
    igual('correo marcado con suite y runId', ej.correo('admin'), `prueba.usuarios.${ej.runId}.admin@pansys.test`);
    igual('nombre marcado con runId', ej.nombre('A'), `PRUEBA ${ej.runId} A`);
    igual('etiqueta de correo no válida -> error', (await falla(() => ej.correo('a@b'))) instanceof ErrorAislamiento, true);
    for (const [tipo, id] of [['usuarios', 1], ['usuarios', 4], ['panaderias', 1], ['panaderias', 2]]) {
      igual(`registrar ${tipo} ${id} (semilla) -> error`, (await falla(() => ej.registrar(tipo, id))) instanceof ErrorAislamiento, true);
    }
    for (const id of [0, -5, 1.5, '7', null, Number.MAX_SAFE_INTEGER + 2]) {
      igual(`registrar id no válido ${JSON.stringify(id)} -> error`, (await falla(() => ej.registrar('usuarios', id))) instanceof ErrorAislamiento, true);
    }
    igual('registrar un tipo no registrable (productos) -> error', (await falla(() => ej.registrar('productos', 40))) instanceof ErrorAislamiento, true);
    ej.registrar('usuarios', 12); ej.registrar('usuarios', 5); ej.registrar('usuarios', 12);
    igual('ids propios ordenados y sin duplicados', ej.ids('usuarios'), [5, 12]);
    await ej.cerrar();
  }

  // ---------- Pérdida del bloqueo antes de limpiar ----------
  console.log('\n== Pérdida de la conexión o del bloqueo');
  {
    const { servidor, ej, conexion } = await preparar();
    igual('exigirBloqueo con el bloqueo vigente -> sin error', await falla(() => ej.exigirBloqueo()), null);
    const antes = copiar(servidor.db);
    conexion.perder();
    const error = await falla(() => ej.exigirBloqueo());
    igual('conexión perdida -> exigirBloqueo detiene la suite', [error instanceof ErrorAislamiento, ej.estado], [true, 'abortada']);
    igual('ejecución detenida: no se pueden registrar más filas', (await falla(() => ej.registrar('usuarios', 99))) instanceof ErrorAislamiento, true);
    const n = conexion.registro.length;
    const limpieza = await ej.limpiar();
    igual('conexión perdida -> la limpieza no se inicia', [limpieza.ok, /no iniciada/.test(limpieza.motivo)], [false, true]);
    igual('conexión perdida -> ninguna consulta más en la conexión', conexion.registro.length, n);
    igual('conexión perdida -> registros temporales conservados y listados',
      [JSON.stringify(servidor.db) === JSON.stringify(antes), limpieza.pendientes], [true, { runId: ej.runId, usuarios: [10, 11, 12], panaderias: [20, 21], productos: [], escriturasInciertas: [] }]);
    const otra = await iniciarEjecucion({ suite: 'ventas', env: ENV, crearConexion: fabricaConexiones(servidor) });
    igual('con el bloqueo perdido otra suite puede empezar...', servidor.bloqueos.get(NOMBRE_BLOQUEO), otra.bloqueo.idConexion);
    const otraVez = await ej.limpiar();
    igual('...y la ejecución que lo perdió sigue sin limpiar', [otraVez.ok, JSON.stringify(servidor.db) === JSON.stringify(antes)], [false, true]);
    await ej.cerrar();
    igual('cerrar tras la pérdida no intenta RELEASE_LOCK ni suelta el bloqueo ajeno',
      [sentencias(conexion, 'SELECT RELEASE_LOCK').length, servidor.bloqueos.get(NOMBRE_BLOQUEO)], [0, otra.bloqueo.idConexion]);
    await otra.cerrar();
  }
  {
    const { servidor, ej, conexion } = await preparar();
    servidor.bloqueos.set(NOMBRE_BLOQUEO, 999); // el bloqueo ya no es de esta conexión
    const error = await falla(() => ej.exigirBloqueo());
    igual('bloqueo con otro dueño (conexión viva) -> exigirBloqueo detiene la suite', [error instanceof ErrorAislamiento, ej.estado], [true, 'abortada']);
    const limpieza = await ej.limpiar();
    igual('bloqueo con otro dueño -> limpieza no iniciada, sin START TRANSACTION ni DELETE',
      [limpieza.ok, conexion.registro.filter(s => ESCRITURAS.test(s))], [false, []]);
    await ej.cerrar();
    igual('cerrar con el bloqueo en manos de otra conexión: sin RELEASE_LOCK y el dueño no cambia',
      [sentencias(conexion, 'SELECT RELEASE_LOCK').length, servidor.bloqueos.get(NOMBRE_BLOQUEO), conexion.cerrada], [0, 999, true]);
  }
  {
    const { servidor, ej, conexion } = await preparar();
    servidor.bloqueos.delete(NOMBRE_BLOQUEO); // bloqueo liberado sin que la conexión lo sepa
    const limpieza = await ej.limpiar();
    igual('bloqueo libre al empezar la limpieza -> no se inicia', [limpieza.ok, conexion.registro.filter(s => ESCRITURAS.test(s))], [false, []]);
    await ej.cerrar();
  }

  // ---------- Limpieza correcta ----------
  console.log('\n== Limpieza de lo propio');
  {
    const { servidor, ej, ajenos, conexion } = await preparar();
    const limpieza = await ej.limpiar();
    igual('limpieza correcta -> ok', [limpieza.ok, limpieza.motivo], [true, null]);
    igual('los datos ajenos (semilla, demo y panadería 1) quedan exactamente igual y lo propio desaparece',
      JSON.stringify(servidor.db), JSON.stringify(ajenos));
    igual('filas borradas por paso', limpieza.borrados, {
      insumo_usado: 1, orden_produccion: 1, receta_producto: 1, detalle_ventas: 1, ventas: 1, productos: 2,
      materia_prima: 1, 'usuarios (empleados)': 2, panaderias: 2, 'usuarios (propietarias)': 1
    });
    igual('orden de borrado según las claves foráneas', sentencias(conexion, 'DELETE').map(s => s.match(/pansys_test\.(\w+)/)[1]), [
      'insumo_usado', 'orden_produccion', 'receta_producto', 'detalle_ventas', 'ventas', 'productos', 'materia_prima',
      'usuarios', 'panaderias', 'usuarios'
    ]);
    const todas = conexion.registro.filter(s => /^(DELETE|SELECT COUNT|SELECT id)/.test(s));
    igual('toda sentencia de limpieza usa pansys_test.<tabla> y filtra por IN (?)',
      todas.every(s => /FROM pansys_test\.\w+ WHERE/.test(s) && /IN \(/.test(s)), true);
    igual('ninguna sentencia usa rangos, patrones ni borrados globales',
      conexion.registro.some(s => /id\s*[<>]|LIKE|TRUNCATE|DELETE FROM \S+\s*$/.test(s)), false);
    const iTx = conexion.registro.indexOf('START TRANSACTION');
    const iBase = conexion.registro.indexOf('SELECT DATABASE() AS base', iTx);
    const iPrimerDelete = conexion.registro.findIndex(s => s.startsWith('DELETE'));
    const iCommit = conexion.registro.indexOf('COMMIT');
    const iUltimoLock = conexion.registro.lastIndexOf('SELECT IS_USED_LOCK(?) AS dueno');
    igual('DATABASE() se comprueba dentro de la transacción y antes del primer DELETE', iTx < iBase && iBase < iPrimerDelete, true);
    igual('el bloqueo se comprueba antes de la transacción y otra vez justo antes del COMMIT',
      [conexion.registro.indexOf('SELECT IS_USED_LOCK(?) AS dueno') < iTx, iUltimoLock > iPrimerDelete && iUltimoLock === iCommit - 1], [true, true]);
    igual('las filas propias se bloquean (FOR UPDATE) antes de borrar',
      conexion.registro.filter(s => s.endsWith('FOR UPDATE')).length, 2);
    const repetida = await ej.limpiar();
    igual('segunda limpieza -> rechazada sin consultas nuevas', [repetida.ok, /ya está hecha/.test(repetida.motivo)], [false, true]);
    await ej.cerrar();
  }
  {
    const { servidor, ej, ajenos } = await preparar({ opcionales: true });
    const limpieza = await ej.limpiar();
    igual('con las tablas del SQL 005: borra eventos y enlaces propios y conserva los ajenos',
      [limpieza.ok, JSON.stringify(servidor.db) === JSON.stringify(ajenos), limpieza.borrados.eventos_seguridad, limpieza.borrados.restablecimientos_contrasena],
      [true, true, 2, 1]);
    await ej.cerrar();
  }
  {
    const { servidor, ej, ajenos, conexion } = await preparar({ propios: false });
    const limpieza = await ej.limpiar();
    igual('sin nada registrado -> ok sin ningún DELETE', [limpieza.ok, sentencias(conexion, 'DELETE').length, JSON.stringify(servidor.db) === JSON.stringify(ajenos)], [true, 0, true]);
    await ej.cerrar();
  }
  {
    // Solo cuentas, sin panaderías: no se generan IN () vacíos
    const { servidor, ej, conexion } = await preparar({ propios: false });
    servidor.db.usuarios.push({ id: 15, email: ej.correo('suelta'), panaderia_id: null });
    ej.registrar('usuarios', 15);
    const limpieza = await ej.limpiar();
    igual('solo cuentas registradas -> borra la cuenta sin tocar tablas de panadería',
      [limpieza.ok, servidor.db.usuarios.some(f => f.id === 15), sentencias(conexion, 'DELETE').length], [true, false, 2]);
    await ej.cerrar();
  }

  // ---------- Limpieza abortada: los registros se conservan ----------
  console.log('\n== Limpieza abortada');
  const abortada = async (descripcion, modificar, patronMotivo) => {
    const { servidor, ej, conexion } = await preparar({ opcionales: true });
    modificar(servidor, ej);
    const antes = copiar(servidor.db);
    const limpieza = await ej.limpiar();
    igual(`${descripcion} -> abortada`, [limpieza.ok, patronMotivo.test(limpieza.motivo ?? '')], [false, true]);
    igual(`${descripcion} -> datos idénticos a antes de limpiar`, JSON.stringify(servidor.db) === JSON.stringify(antes), true);
    igual(`${descripcion} -> sin COMMIT y con la ejecución abortada`, [conexion.registro.includes('COMMIT'), ej.estado], [false, 'abortada']);
    await ej.cerrar();
    return { conexion, limpieza };
  };

  {
    const { conexion } = await abortada('cuenta ajena asignada a una panadería propia',
      (s) => { s.db.usuarios.push({ id: 6, email: 'otra.demo@pansys.test', panaderia_id: 20 }); }, /cuentas ajenas/);
    igual('cuenta ajena en panadería propia: ningún DELETE ejecutado', sentencias(conexion, 'DELETE').length, 0);
  }
  await abortada('cuenta propia propietaria de una panadería ajena',
    (s) => { s.db.panaderias.push({ id: 22, nombre: 'Panadería de la demo', usuario_id: 10 }); }, /panadería ajena/);
  await abortada('cuenta propia asignada a una panadería ajena',
    (s) => { s.db.usuarios.find(f => f.id === 11).panaderia_id = 1; }, /asignada a una panadería ajena/);
  await abortada('id registrado de una cuenta ajena (sin la marca)',
    (s, ej) => { ej.registrar('usuarios', 5); }, /no tiene la marca/);
  await abortada('correo de una cuenta propia cambiado sin la marca',
    (s) => { s.db.usuarios.find(f => f.id === 12).email = 'renombrada@pansys.test'; }, /no tiene la marca/);
  await abortada('id registrado de una panadería ajena',
    (s, ej) => { s.db.panaderias.push({ id: 23, nombre: 'Panadería real', usuario_id: 1 }); ej.registrar('panaderias', 23); }, /panadería 23/);
  {
    const { limpieza } = await abortada('fila ajena que depende de una propia (RESTRICT)',
      (s) => { s.db.insumo_usado.push({ id: 2, orden_id: 1, materia_prima_id: 30 }); }, /ROLLBACK/);
    igual('RESTRICT: se listan los registros pendientes de revisión', limpieza.pendientes?.usuarios, [10, 11, 12]);
  }
  await abortada('otro proceso añade una fila entre el recuento y el DELETE',
    (s) => {
      s.antes = (sql) => {
        if (sql.startsWith('DELETE FROM pansys_test.productos')) { s.db.productos.push({ id: 42, panaderia_id: 21 }); s.antes = null; }
      };
    }, /se esperaban 2 filas y se borraron 3/);
  {
    const { conexion } = await abortada('el bloqueo cambia de dueño durante la limpieza',
      (s) => {
        s.antes = (sql) => {
          if (sql === 'DELETE FROM pansys_test.usuarios WHERE id IN (?)') { s.bloqueos.set(NOMBRE_BLOQUEO, 999); s.antes = null; }
        };
      }, /Bloqueo de suite perdido/);
    igual('bloqueo perdido antes del COMMIT -> ROLLBACK ejecutado', conexion.registro.includes('ROLLBACK'), true);
  }
  await abortada('la conexión se pierde a mitad de la limpieza',
    (s) => {
      s.antes = (sql, c) => {
        if (sql.startsWith('DELETE FROM pansys_test.ventas')) { s.antes = null; c.perder(); }
      };
    }, /ROLLBACK/);
  {
    const { conexion } = await abortada('la conexión dedicada apunta a otra base al limpiar',
      (s) => { s.antes = (sql) => { if (sql === 'START TRANSACTION') s.base = 'pansys_db'; }; }, /pansys_db/);
    igual('base distinta al limpiar: ningún DELETE ejecutado', sentencias(conexion, 'DELETE').length, 0);
  }

  // ---------- Barrera explícita: una ejecución abortada no limpia ----------
  // Bloqueo falso cuya verificación siempre "responde bien": así se prueba la barrera del estado
  // por sí sola, sin que la verificación con MySQL la cubra.
  console.log('\n== Ejecución abortada: la limpieza no empieza aunque la verificación respondiera bien');
  const bloqueoFalso = ({ perdido = false, liberado = false, fallosVerificar = 0 } = {}) => {
    const llamadas = [];
    let fallos = fallosVerificar;
    return {
      llamadas, perdido, liberado, motivoPerdida: perdido ? 'error simulado de la conexión' : null,
      verificar: async () => {
        llamadas.push('verificar');
        if (fallos-- > 0) throw new ErrorAislamiento('Bloqueo de suite perdido: fallo simulado');
      },
      consultar: async (sql) => { llamadas.push(sql); return [{ n: 0, base: 'pansys_test', affectedRows: 0 }]; },
      deshacer: async () => { llamadas.push('ROLLBACK'); },
      liberar: async () => { llamadas.push('liberar'); }
    };
  };
  const ejecucionFalsa = (bloqueo) => {
    const ej = new Ejecucion({ suite: 'usuarios', bloqueo, runId: 'abcdef0123456789' });
    ej.registrar('usuarios', 10);
    ej.registrar('panaderias', 20);
    return ej;
  };
  {
    const bloqueo = bloqueoFalso({ perdido: true });
    const ej = ejecucionFalsa(bloqueo);
    const limpieza = await ej.limpiar();
    igual('bloqueo marcado como perdido (verificación que respondería bien) -> ni verificación, ni consultas, ni DELETE',
      [limpieza.ok, bloqueo.llamadas, ej.estado, /no iniciada/.test(limpieza.motivo)], [false, [], 'abortada', true]);
    igual('bloqueo perdido: los registros quedan listados para revisión', limpieza.pendientes, { runId: 'abcdef0123456789', usuarios: [10], panaderias: [20], productos: [], escriturasInciertas: [] });
  }
  {
    const bloqueo = bloqueoFalso({ fallosVerificar: 1 });
    const ej = ejecucionFalsa(bloqueo);
    const error = await falla(() => ej.exigirBloqueo());
    const limpieza = await ej.limpiar();
    igual('abortada por exigirBloqueo (la verificación ya volvería a responder bien) -> sin ninguna consulta de limpieza',
      [error instanceof ErrorAislamiento, limpieza.ok, bloqueo.llamadas], [true, false, ['verificar']]);
    igual('el motivo del aborto se conserva', /fallo simulado/.test(limpieza.motivo), true);
  }
  {
    const bloqueo = bloqueoFalso();
    const ej = ejecucionFalsa(bloqueo);
    ej.abortar('detenida por la suite');
    const limpieza = await ej.limpiar();
    igual('ejecución abortada con el bloqueo intacto -> sin ninguna consulta', [limpieza.ok, bloqueo.llamadas], [false, []]);
    igual('una ejecución abortada no vuelve a registrar ni a exigir el bloqueo',
      [(await falla(() => ej.registrar('usuarios', 11))) instanceof ErrorAislamiento, (await falla(() => ej.exigirBloqueo())) instanceof ErrorAislamiento, bloqueo.llamadas],
      [true, true, []]);
  }
  {
    const bloqueo = bloqueoFalso({ liberado: true });
    const ej = ejecucionFalsa(bloqueo);
    const limpieza = await ej.limpiar();
    igual('bloqueo ya liberado -> sin ninguna consulta', [limpieza.ok, bloqueo.llamadas], [false, []]);
  }

  // ---------- Conexión con error pero aún viva ----------
  console.log('\n== Error en la conexión dedicada sin cierre');
  {
    const { servidor, ej, conexion } = await preparar();
    const antes = copiar(servidor.db);
    conexion.emit('error', errorMysql('ECONNRESET', 'reset')); // la conexión doble sigue respondiendo
    const n = conexion.registro.length;
    igual('desde la ejecución no hay forma de enviar consultas (la vista del bloqueo no tiene consultar)', typeof ej.bloqueo.consultar, 'undefined');
    igual('MySQL sigue diciendo que el bloqueo es nuestro (la barrera es local)', servidor.bloqueos.get(NOMBRE_BLOQUEO), conexion.id);
    igual('exigirBloqueo detiene la suite sin consultar', [(await falla(() => ej.exigirBloqueo())) instanceof ErrorAislamiento, conexion.registro.length], [true, n]);
    const limpieza = await ej.limpiar();
    igual('limpieza no iniciada: ni IS_USED_LOCK, ni START TRANSACTION, ni DELETE',
      [limpieza.ok, conexion.registro.length, JSON.stringify(servidor.db) === JSON.stringify(antes)], [false, n, true]);
    await ej.cerrar();
    igual('cerrar: sin RELEASE_LOCK; al cerrar la conexión MySQL suelta el bloqueo propio',
      [sentencias(conexion, 'SELECT RELEASE_LOCK').length, conexion.cerrada, servidor.bloqueos.size], [0, true, 0]);
  }
  {
    // La guarda de Bloqueo, probada directamente sobre un objeto Bloqueo de abrirBloqueo()
    const servidor = crearServidor(dbBase());
    const bloqueo = await abrirBloqueo({ env: ENV, crearConexion: fabricaConexiones(servidor) });
    const c = servidor.conexiones[0];
    c.emit('error', errorMysql('ECONNRESET', 'reset')); // la conexión doble sigue respondiendo
    const n = c.registro.length;
    const consulta = await falla(() => bloqueo.consultar('SELECT DATABASE() AS base'));
    igual('Bloqueo: tras el error no envía más consultas', [consulta instanceof ErrorAislamiento, c.registro.length], [true, n]);
    igual('Bloqueo: tampoco abre una transacción nueva', [(await falla(() => bloqueo.consultar('START TRANSACTION'))) instanceof ErrorAislamiento, c.registro.length], [true, n]);
    igual('Bloqueo: ROLLBACK sí se permite tras la pérdida', [await falla(() => bloqueo.deshacer()), c.registro.slice(n)], [null, ['ROLLBACK']]);
    await bloqueo.liberar();
    igual('Bloqueo: liberar tras la pérdida no envía RELEASE_LOCK y cierra la conexión', [sentencias(c, 'SELECT RELEASE_LOCK').length, c.cerrada], [0, true]);
  }

  // ---------- Vista de solo lectura del bloqueo ----------
  console.log('\n== Vista de solo lectura del bloqueo');
  {
    const { servidor, ej, conexion } = await preparar({ propios: false });
    const vista = ej.bloqueo;
    igual('la vista tiene solo idConexion, perdido, liberado y motivoPerdida', Object.keys(vista), ['idConexion', 'perdido', 'liberado', 'motivoPerdida']);
    igual('la vista no expone métodos', ['consultar', 'verificar', 'deshacer', 'liberar', 'marcarPerdido', 'conexion'].map(m => typeof vista[m]),
      ['undefined', 'undefined', 'undefined', 'undefined', 'undefined', 'undefined']);
    igual('la vista está congelada', Object.isFrozen(vista), true);
    try { vista.perdido = true; vista.consultar = () => {}; } catch { /* en modo estricto lanzaría */ }
    igual('asignar en la vista no cambia nada', [vista.perdido, typeof vista.consultar, ej.bloqueo.perdido], [false, 'undefined', false]);
    try { ej.bloqueo = { perdido: true }; } catch { /* sin setter */ }
    igual('no se puede sustituir el bloqueo de la ejecución', [ej.bloqueo.perdido, ej.bloqueo.idConexion], [false, conexion.id]);
    igual('idConexion coincide con la conexión dedicada (lo que usa aislamiento.mysql.js)', ej.bloqueo.idConexion, conexion.id);
    conexion.emit('error', errorMysql('ECONNRESET', 'reset'));
    igual('la vista refleja los cambios de estado en cada lectura', [ej.bloqueo.perdido, typeof ej.bloqueo.motivoPerdida], [true, 'string']);
    igual('una vista leída antes no cambia después (es una copia)', vista.perdido, false);
    await ej.cerrar();
    igual('tras cerrar, la vista indica liberado', ej.bloqueo.liberado, true);
    igual('el campo privado no es accesible por nombre', [ej['#bloqueo'], Object.keys(ej).includes('bloqueo')], [undefined, false]);
    igual('el servidor doble no recibió ninguna consulta desde la vista', servidor.conexiones.length, 1);
  }

  // ---------- Una limpieza abortada no se reintenta ----------
  console.log('\n== Reintento de una limpieza abortada');
  {
    const { servidor, ej, conexion } = await preparar();
    servidor.db.usuarios.push({ id: 6, email: 'otra.demo@pansys.test', panaderia_id: 20 });
    const primera = await ej.limpiar();
    servidor.db.usuarios = servidor.db.usuarios.filter(f => f.id !== 6); // la causa desaparece
    const antes = copiar(servidor.db);
    const n = conexion.registro.length;
    const segunda = await ej.limpiar();
    igual('tras abortar, un segundo intento no consulta ni borra aunque la causa ya no exista',
      [primera.ok, segunda.ok, conexion.registro.length - n, JSON.stringify(servidor.db) === JSON.stringify(antes)], [false, false, 0, true]);
    await ej.cerrar();
    igual('cerrar una ejecución abortada con el bloqueo propio libera solo ese bloqueo', [sentencias(conexion, 'SELECT RELEASE_LOCK').length, servidor.bloqueos.size], [1, 0]);
  }

  // ---------- Fallos al verificar el bloqueo ----------
  console.log('\n== Fallos al verificar el bloqueo');
  {
    const { servidor, ej, conexion } = await preparar();
    servidor.antes = (sql) => { if (sql.startsWith('SELECT IS_USED_LOCK')) { servidor.antes = null; throw errorMysql('ETIMEDOUT', 'timeout'); } };
    const error = await falla(() => ej.exigirBloqueo());
    const limpieza = await ej.limpiar();
    igual('IS_USED_LOCK falla en exigirBloqueo -> suite detenida y limpieza no iniciada',
      [error instanceof ErrorAislamiento, ej.bloqueo.perdido, limpieza.ok, conexion.registro.filter(s => ESCRITURAS.test(s))], [true, true, false, []]);
    await ej.cerrar();
  }
  {
    const { servidor, ej, conexion } = await preparar();
    const antes = copiar(servidor.db);
    servidor.antes = (sql) => { if (sql.startsWith('SELECT IS_USED_LOCK')) { servidor.antes = null; throw errorMysql('ETIMEDOUT', 'timeout'); } };
    const limpieza = await ej.limpiar();
    igual('IS_USED_LOCK falla al empezar la limpieza -> sin START TRANSACTION ni DELETE y datos intactos',
      [limpieza.ok, conexion.registro.filter(s => ESCRITURAS.test(s)), JSON.stringify(servidor.db) === JSON.stringify(antes)], [false, [], true]);
    await ej.cerrar();
  }
  {
    const { servidor, ej, conexion } = await preparar();
    const antes = copiar(servidor.db);
    servidor.antes = (sql, c) => {
      if (sql.startsWith('SELECT IS_USED_LOCK') && c.registro.some(s => s.startsWith('DELETE'))) { servidor.antes = null; throw errorMysql('ETIMEDOUT', 'timeout'); }
    };
    const limpieza = await ej.limpiar();
    igual('IS_USED_LOCK falla justo antes del COMMIT -> ROLLBACK, sin COMMIT y datos intactos',
      [limpieza.ok, conexion.registro.includes('ROLLBACK'), conexion.registro.includes('COMMIT'), JSON.stringify(servidor.db) === JSON.stringify(antes)],
      [false, true, false, true]);
    await ej.cerrar();
  }
  {
    const { servidor, ej, conexion } = await preparar();
    servidor.lockSinFilas = true;
    const limpieza = await ej.limpiar();
    igual('IS_USED_LOCK sin filas -> se trata como bloqueo perdido y no se limpia',
      [limpieza.ok, ej.bloqueo.perdido, conexion.registro.filter(s => ESCRITURAS.test(s))], [false, true, []]);
    await ej.cerrar();
  }
  {
    const servidor = crearServidor(dbBase());
    servidor.idNulo = true;
    const error = await falla(() => iniciarEjecucion({ suite: 'ventas', env: ENV, crearConexion: fabricaConexiones(servidor) }));
    igual('GET_LOCK sin CONNECTION_ID válido -> error, bloqueo liberado y conexión cerrada',
      [error instanceof ErrorAislamiento, servidor.bloqueos.size, servidor.conexiones[0].cerrada], [true, 0, true]);
  }

  // ---------- Registro previo a la limpieza ----------
  console.log('\n== Registro antes de limpiar');
  {
    const { servidor, ej } = await preparar();
    servidor.db.usuarios.push({ id: 13, email: ej.correo('noregistrada'), panaderia_id: null });
    let errorRegistro = null;
    servidor.antes = (sql) => {
      if (sql.startsWith('DELETE')) {
        servidor.antes = null;
        try { ej.registrar('usuarios', 5); } catch (error) { errorRegistro = error; }
      }
    };
    const limpieza = await ej.limpiar();
    igual('registrar durante la limpieza -> rechazado', errorRegistro instanceof ErrorAislamiento, true);
    igual('la limpieza usa la copia de lo registrado antes de empezar: la cuenta 5 (demo) sigue intacta',
      [limpieza.ok, servidor.db.usuarios.some(f => f.id === 5)], [true, true]);
    igual('una fila con la marca pero sin registrar no se borra (la marca solo verifica, no selecciona)',
      servidor.db.usuarios.some(f => f.id === 13), true);
    igual('tras limpiar no se puede registrar más', (await falla(() => ej.registrar('usuarios', 14))) instanceof ErrorAislamiento, true);
    await ej.cerrar();
  }

  // ---------- Escrituras protegidas: crearCuenta y crearPanaderia ----------
  console.log('\n== Escrituras protegidas: casos autorizados');
  const INSERTS = (c) => c.registro.filter(s => s.startsWith('INSERT'));
  const datosPropios = async (ej) => {
    const admin = await ej.crearCuenta({ etiqueta: 'admin', rol: 'administrador', activa: false });
    const pan = await ej.crearPanaderia({ etiqueta: 'Inventario', propietariaId: admin });
    const panadero = await ej.crearCuenta({ etiqueta: 'panadero', rol: 'panadero', panaderiaId: pan, activa: true });
    return { admin, pan, panadero };
  };
  {
    const { servidor, ej, conexion, ajenos } = await preparar({ propios: false });
    const inicio = conexion.registro.length;
    const { admin, pan, panadero } = await datosPropios(ej);
    igual('los id devueltos quedan registrados como propios', [ej.ids('usuarios'), ej.ids('panaderias')], [[admin, panadero].sort((a, b) => a - b), [pan]]);
    const filaAdmin = servidor.db.usuarios.find(u => u.id === admin);
    const filaPanadero = servidor.db.usuarios.find(u => u.id === panadero);
    const filaPan = servidor.db.panaderias.find(p => p.id === pan);
    igual('administradora temporal: correo marcado, rol 1, sin panadería, inactiva, contraseña "!" y versión 0',
      [filaAdmin?.email, filaAdmin?.rol_id, filaAdmin?.panaderia_id, filaAdmin?.estado, filaAdmin?.contrasena, filaAdmin?.version_sesion],
      [ej.correo('admin'), 1, null, 0, '!', 0]);
    igual('panadería temporal: nombre marcado y propietaria propia', [filaPan?.nombre, filaPan?.usuario_id], [`PRUEBA ${ej.runId} Inventario`, admin]);
    igual('panadero temporal: rol 2, en la panadería propia y ACTIVO', [filaPanadero?.rol_id, filaPanadero?.panaderia_id, filaPanadero?.estado], [2, pan, 1]);
    igual('secuencia exacta: bloqueo, base, roles (una vez) y plantilla, por cada escritura', conexion.registro.slice(inicio), [
      'SELECT IS_USED_LOCK(?) AS dueno', 'SELECT DATABASE() AS base', 'SELECT id, nombre FROM pansys_test.roles WHERE id IN (?)', PLANTILLA_CUENTA,
      'SELECT IS_USED_LOCK(?) AS dueno', 'SELECT DATABASE() AS base', PLANTILLA_PANADERIA,
      'SELECT IS_USED_LOCK(?) AS dueno', 'SELECT DATABASE() AS base', PLANTILLA_CUENTA
    ]);
    // Datos de negocio creados después dentro de la panadería propia (como haría la API)
    servidor.db.materia_prima.push({ id: 31, panaderia_id: pan });
    const limpieza = await ej.limpiar();
    igual('limpiar() borra cuentas, panadería y sus datos, y lo ajeno queda idéntico',
      [limpieza.ok, limpieza.resultado, JSON.stringify(servidor.db) === JSON.stringify(ajenos)], [true, 'limpia', true]);
    igual('recuentos de la limpieza', [limpieza.borrados.materia_prima, limpieza.borrados['usuarios (empleados)'], limpieza.borrados.panaderias, limpieza.borrados['usuarios (propietarias)']], [1, 1, 1, 1]);
    igual('tras limpiar, no se admiten más escrituras',
      [(await falla(() => ej.crearCuenta({ etiqueta: 'otra', rol: 'administrador', activa: false }))) instanceof ErrorAislamiento, INSERTS(conexion).length], [true, 3]);
    await ej.cerrar();
  }
  {
    const { ej, conexion } = await preparar({ propios: false });
    const inicio = conexion.registro.length;
    const [a, b] = await Promise.all([
      ej.crearCuenta({ etiqueta: 'uno', rol: 'administrador', activa: false }),
      ej.crearCuenta({ etiqueta: 'dos', rol: 'administrador', activa: false })
    ]);
    igual('dos escrituras simultáneas van en serie (sin intercalar comprobaciones e INSERT)', conexion.registro.slice(inicio), [
      'SELECT IS_USED_LOCK(?) AS dueno', 'SELECT DATABASE() AS base', 'SELECT id, nombre FROM pansys_test.roles WHERE id IN (?)', PLANTILLA_CUENTA,
      'SELECT IS_USED_LOCK(?) AS dueno', 'SELECT DATABASE() AS base', PLANTILLA_CUENTA
    ]);
    igual('ambas quedan registradas', ej.ids('usuarios'), [a, b].sort((x, y) => x - y));
    await ej.cerrar();
  }

  console.log('\n== Escrituras protegidas: rechazos sin enviar nada');
  {
    const { ej, conexion } = await preparar({ propios: false });
    const admin = await ej.crearCuenta({ etiqueta: 'admin', rol: 'administrador', activa: false });
    const pan = await ej.crearPanaderia({ etiqueta: 'Propia', propietariaId: admin });
    const casos = [
      ['etiqueta con mayúsculas', () => ej.crearCuenta({ etiqueta: 'Admin2', rol: 'administrador', activa: false })],
      ['etiqueta con guion', () => ej.crearCuenta({ etiqueta: 'a-b', rol: 'administrador', activa: false })],
      ['etiqueta vacía', () => ej.crearCuenta({ etiqueta: '', rol: 'administrador', activa: false })],
      ['etiqueta numérica', () => ej.crearCuenta({ etiqueta: 5, rol: 'administrador', activa: false })],
      ['etiqueta de cuenta repetida', () => ej.crearCuenta({ etiqueta: 'admin', rol: 'administrador', activa: false })],
      ['rol desconocido', () => ej.crearCuenta({ etiqueta: 'x1', rol: 'jefe', activa: false })],
      ['rol heredado de Object', () => ej.crearCuenta({ etiqueta: 'x2', rol: 'toString', activa: false })],
      ['activa como texto', () => ej.crearCuenta({ etiqueta: 'x3', rol: 'administrador', activa: 'true' })],
      ['activa ausente', () => ej.crearCuenta({ etiqueta: 'x4', rol: 'administrador' })],
      ['administradora con panadería', () => ej.crearCuenta({ etiqueta: 'x5', rol: 'administrador', panaderiaId: pan, activa: false })],
      ['panadero sin panadería', () => ej.crearCuenta({ etiqueta: 'x6', rol: 'panadero', activa: true })],
      ['panadero en la panadería semilla 1', () => ej.crearCuenta({ etiqueta: 'x7', rol: 'panadero', panaderiaId: 1, activa: true })],
      ['gerente en una panadería sin registrar', () => ej.crearCuenta({ etiqueta: 'x8', rol: 'gerente', panaderiaId: 99, activa: true })],
      ['panadería con propietaria semilla 1', () => ej.crearPanaderia({ etiqueta: 'P1', propietariaId: 1 })],
      ['panadería con propietaria ajena 5', () => ej.crearPanaderia({ etiqueta: 'P2', propietariaId: 5 })],
      ['panadería con etiqueta con espacios', () => ej.crearPanaderia({ etiqueta: 'con espacio', propietariaId: admin })],
      ['etiqueta de panadería repetida', () => ej.crearPanaderia({ etiqueta: 'Propia', propietariaId: admin })],
      ['sin argumentos', () => ej.crearCuenta()]
    ];
    for (const [descripcion, llamada] of casos) {
      const n = conexion.registro.length;
      const error = await falla(llamada);
      igual(`rechazo por parámetros (${descripcion}): sin ninguna consulta y la ejecución sigue activa`,
        [error instanceof ErrorAislamiento, conexion.registro.length - n, ej.estado], [true, 0, 'activa']);
    }
    igual('ningún rechazo registró filas', [ej.ids('usuarios'), ej.ids('panaderias')], [[admin], [pan]]);
    await ej.cerrar();
  }
  {
    // El objeto Ejecucion no ofrece ninguna vía para enviar SQL propio
    const { ej } = await preparar({ propios: false });
    igual('no hay métodos públicos de escritura aparte de crearCuenta y crearPanaderia',
      ['insertar', 'escribirCuenta', 'escribirPanaderia', 'encolar', 'comprobarAntesDeEscribir', 'consultarSQL', 'ejecutar'].map(m => typeof ej[m]),
      ['undefined', 'undefined', 'undefined', 'undefined', 'undefined', 'undefined', 'undefined']);
    await ej.cerrar();
  }
  const rechazoDeSeguridad = async (descripcion, preparar_, { abortada = true } = {}) => {
    const { servidor, ej, conexion } = await preparar({ propios: false });
    await preparar_(servidor, ej, conexion);
    const n = INSERTS(conexion).length;
    const error = await falla(() => ej.crearCuenta({ etiqueta: 'tarde', rol: 'administrador', activa: false }));
    igual(`${descripcion} -> rechazada sin INSERT${abortada ? ' y ejecución abortada' : ''}`,
      [error instanceof ErrorAislamiento, INSERTS(conexion).length - n, ej.estado === 'abortada'], [true, 0, abortada]);
    await ej.cerrar();
    return { servidor, ej, conexion };
  };
  await rechazoDeSeguridad('ejecución abortada', (s, ej) => { ej.abortar('detenida por la suite'); });
  await rechazoDeSeguridad('conexión dedicada perdida', (s, ej, c) => { c.perder(); });
  await rechazoDeSeguridad('bloqueo con otro dueño', (s) => { s.bloqueos.set(NOMBRE_BLOQUEO, 999); });
  await rechazoDeSeguridad('IS_USED_LOCK sin filas', (s) => { s.lockSinFilas = true; });
  await rechazoDeSeguridad('IS_USED_LOCK con error', (s) => { s.antes = (sql) => { if (sql.startsWith('SELECT IS_USED_LOCK')) { s.antes = null; throw errorMysql('ETIMEDOUT', 'timeout'); } }; });
  await rechazoDeSeguridad('SELECT DATABASE() en otra base', (s) => { s.base = 'pansys_db'; });
  {
    // DB_NAME cambiado después de iniciar: se rechaza antes de cualquier consulta
    const servidor = crearServidor(dbBase());
    const env = { ...ENV };
    const ej = await iniciarEjecucion({ suite: 'usuarios', env, crearConexion: fabricaConexiones(servidor), generarRunId: runIdFijo });
    const c = servidor.conexiones[0];
    env.DB_NAME = 'pansys_db';
    const n = c.registro.length;
    const error = await falla(() => ej.crearCuenta({ etiqueta: 'x', rol: 'administrador', activa: false }));
    igual('DB_NAME cambiado tras iniciar -> rechazada sin ninguna consulta y ejecución abortada',
      [error instanceof ErrorAislamiento, c.registro.length - n, ej.estado], [true, 0, 'abortada']);
    await ej.cerrar();
  }
  {
    // Escritura pendiente cuando empieza la limpieza: se rechaza sin enviarse
    const { ej, conexion } = await preparar({ propios: false });
    const limpieza = ej.limpiar();
    const error = await falla(() => ej.crearCuenta({ etiqueta: 'tarde', rol: 'administrador', activa: false }));
    const r = await limpieza;
    igual('escritura pedida durante la limpieza -> rechazada sin INSERT; la limpieza termina',
      [error instanceof ErrorAislamiento, INSERTS(conexion).length, r.resultado], [true, 0, 'limpia']);
    await ej.cerrar();
  }
  {
    // Roles distintos de los esperados: no se escribe ninguna cuenta; lo demás sigue permitido
    const { servidor, ej, conexion } = await preparar({ propios: false });
    servidor.db.roles[1].nombre = 'otro';
    const error = await falla(() => ej.crearCuenta({ etiqueta: 'admin', rol: 'administrador', activa: false }));
    igual('roles de la base distintos -> sin INSERT, escrituras detenidas y ejecución activa',
      [error instanceof ErrorAislamiento, INSERTS(conexion).length, Boolean(ej.escriturasDetenidas), ej.estado], [true, 0, true, 'activa']);
    igual('con las escrituras detenidas, exigirBloqueo detiene la suite', (await falla(() => ej.exigirBloqueo())) instanceof ErrorAislamiento, true);
    const limpieza = await ej.limpiar();
    igual('y la limpieza (sin nada registrado) sigue permitida', [limpieza.ok, limpieza.resultado], [true, 'limpia']);
    await ej.cerrar();
  }

  console.log('\n== Escrituras protegidas: errores definitivos e inciertos');
  {
    // Error SQL definitivo: correo ya existente (ER_DUP_ENTRY con la conexión viva)
    const { servidor, ej, conexion } = await preparar({ propios: false });
    servidor.db.usuarios.push({ id: 7, email: ej.correo('admin'), panaderia_id: null });
    const error = await falla(() => ej.crearCuenta({ etiqueta: 'admin', rol: 'administrador', activa: false }));
    igual('error SQL definitivo -> ErrorAislamiento, nada registrado, sin escrituras inciertas y ejecución activa',
      [error instanceof ErrorAislamiento, /rechazó/.test(error?.message), ej.ids('usuarios'), ej.escriturasInciertas, ej.estado], [true, true, [], [], 'activa']);
    const otra = await ej.crearCuenta({ etiqueta: 'admin2', rol: 'administrador', activa: false });
    igual('tras un error definitivo se puede seguir escribiendo', ej.ids('usuarios'), [otra]);
    const limpieza = await ej.limpiar();
    igual('la limpieza borra lo registrado y deja la fila ajena del correo duplicado',
      [limpieza.ok, servidor.db.usuarios.some(u => u.id === otra), servidor.db.usuarios.some(u => u.id === 7)], [true, false, true]);
    igual('una escritura que se rechazó no deja ninguna fila nueva', INSERTS(conexion).length, 2);
    await ej.cerrar();
  }
  {
    // La guarda local corta la escritura si el bloqueo se pierde entre la comprobación y el INSERT
    const { servidor, ej, conexion } = await preparar({ propios: false });
    await ej.crearCuenta({ etiqueta: 'admin', rol: 'administrador', activa: false }); // roles ya comprobados
    servidor.antes = (sql, c) => { if (sql === 'SELECT DATABASE() AS base') { servidor.antes = null; c.emit('error', errorMysql('ECONNRESET', 'reset')); } };
    const error = await falla(() => ej.crearCuenta({ etiqueta: 'admin2', rol: 'administrador', activa: false }));
    igual('bloqueo perdido justo antes del INSERT -> la guarda local no lo envía, ejecución abortada, sin escrituras inciertas',
      [error instanceof ErrorAislamiento, /Bloqueo de suite perdido/.test(error?.message), INSERTS(conexion).length, ej.estado, ej.escriturasInciertas], [true, true, 1, 'abortada', []]);
    igual('el último INSERT intentado se cortó antes de enviarse (la última sentencia es SELECT DATABASE())',
      conexion.registro.at(-1), 'SELECT DATABASE() AS base');
    await ej.cerrar();
  }
  {
    // Resultado incierto con la conexión perdida: la fila existe pero no se sabe su id
    const { servidor, ej, conexion } = await preparar({ propios: false });
    servidor.trasInsert = (c) => { servidor.trasInsert = null; c.perder(); throw Object.assign(new Error('Connection lost'), { code: 'PROTOCOL_CONNECTION_LOST', fatal: true }); };
    const error = await falla(() => ej.crearCuenta({ etiqueta: 'admin', rol: 'administrador', activa: false }));
    const fila = servidor.db.usuarios.find(u => u.email === ej.correo('admin'));
    igual('INSERT incierto con conexión perdida -> ejecución abortada, fila NO registrada y anotada como incierta',
      [error instanceof ErrorAislamiento, /incierto/.test(error?.message), ej.estado, ej.ids('usuarios'), ej.escriturasInciertas, Boolean(fila)],
      [true, true, 'abortada', [], [{ tabla: 'usuarios', marca: ej.correo('admin') }], true]);
    const n = conexion.registro.length;
    const limpieza = await ej.limpiar();
    igual('con la conexión perdida no se limpia nada y los pendientes incluyen la escritura incierta',
      [limpieza.resultado, conexion.registro.length - n, limpieza.pendientes.escriturasInciertas.length, Boolean(servidor.db.usuarios.find(u => u.email === ej.correo('admin')))],
      ['no_iniciada', 0, 1, true]);
    igual('nunca se reintenta: hubo un único INSERT', INSERTS(conexion).length, 1);
    await ej.cerrar();
  }
  {
    // Caso C: incierta con la conexión viva, administradora sin dependencias: se limpia lo registrado
    const { servidor, ej, conexion } = await preparar({ propios: false });
    const { admin, pan } = await datosPropios(ej);
    servidor.trasInsert = () => { servidor.trasInsert = null; throw new Error('respuesta no válida'); };
    const error = await falla(() => ej.crearCuenta({ etiqueta: 'admin2', rol: 'administrador', activa: false }));
    const incierta = servidor.db.usuarios.find(u => u.email === ej.correo('admin2'));
    igual('incierta con la conexión viva -> escrituras detenidas, ejecución activa, fila anotada y no registrada',
      [error instanceof ErrorAislamiento, ej.estado, Boolean(ej.escriturasDetenidas), ej.escriturasInciertas.map(e => e.marca), ej.ids('usuarios').includes(incierta?.id)],
      [true, 'activa', true, [ej.correo('admin2')], false]);
    igual('no se admiten más escrituras ni bloques de pruebas',
      [(await falla(() => ej.crearPanaderia({ etiqueta: 'Otra', propietariaId: admin }))) instanceof ErrorAislamiento, (await falla(() => ej.exigirBloqueo())) instanceof ErrorAislamiento, INSERTS(conexion).length],
      [true, true, 4]);
    const limpieza = await ej.limpiar();
    igual('se borra lo registrado; la fila incierta se conserva y el resultado NO es ok',
      [limpieza.resultado, limpieza.ok, servidor.db.panaderias.some(p => p.id === pan), servidor.db.usuarios.some(u => u.id === admin), servidor.db.usuarios.some(u => u.id === incierta?.id)],
      ['limpia', false, false, false, true]);
    igual('los pendientes distinguen registradas (ya borradas) e inciertas',
      limpieza.pendientes, { runId: ej.runId, usuarios: [], panaderias: [], productos: [], escriturasInciertas: [{ tabla: 'usuarios', marca: ej.correo('admin2') }] });
    igual('el motivo pide revisión manual', /revisión manual/.test(limpieza.motivo), true);
    await ej.cerrar();
  }
  {
    // Caso C: cuenta incierta asignada a la panadería propia -> la limpieza aborta sin borrar
    const { servidor, ej } = await preparar({ propios: false });
    const admin = await ej.crearCuenta({ etiqueta: 'admin', rol: 'administrador', activa: false });
    const pan = await ej.crearPanaderia({ etiqueta: 'Propia', propietariaId: admin });
    servidor.trasInsert = () => { servidor.trasInsert = null; throw new Error('respuesta no válida'); };
    await falla(() => ej.crearCuenta({ etiqueta: 'panadero', rol: 'panadero', panaderiaId: pan, activa: true }));
    const antes = copiar(servidor.db);
    const limpieza = await ej.limpiar();
    igual('cuenta incierta en una panadería propia -> revertida, sin borrar nada y con todo pendiente',
      [limpieza.resultado, JSON.stringify(servidor.db) === JSON.stringify(antes), limpieza.pendientes.usuarios, limpieza.pendientes.panaderias, limpieza.pendientes.escriturasInciertas.length],
      ['revertida', true, [admin], [pan], 1]);
    await ej.cerrar();
  }
  {
    // Caso C: panadería incierta propiedad de una cuenta propia -> la limpieza aborta (la cascada la borraría)
    const { servidor, ej } = await preparar({ propios: false });
    const admin = await ej.crearCuenta({ etiqueta: 'admin', rol: 'administrador', activa: false });
    servidor.trasInsert = () => { servidor.trasInsert = null; throw new Error('respuesta no válida'); };
    await falla(() => ej.crearPanaderia({ etiqueta: 'Incierta', propietariaId: admin }));
    const antes = copiar(servidor.db);
    const limpieza = await ej.limpiar();
    igual('panadería incierta de una propietaria propia -> revertida y sin borrar nada',
      [limpieza.resultado, /propietaria de una panadería ajena/.test(limpieza.motivo), JSON.stringify(servidor.db) === JSON.stringify(antes)], ['revertida', true, true]);
    await ej.cerrar();
  }
  {
    // Respuesta sin id válido: se trata como incierta
    const { servidor, ej, conexion } = await preparar({ propios: false });
    servidor.respuestaInsert = { insertId: 0, affectedRows: 1 };
    const error = await falla(() => ej.crearCuenta({ etiqueta: 'admin', rol: 'administrador', activa: false }));
    igual('INSERT sin un id válido -> incierta, no registrada y escrituras detenidas',
      [error instanceof ErrorAislamiento, ej.ids('usuarios'), ej.escriturasInciertas.length, Boolean(ej.escriturasDetenidas), INSERTS(conexion).length], [true, [], 1, true, 1]);
    servidor.respuestaInsert = undefined;
    await ej.cerrar();
  }

  // ---------- crearProducto ----------
  console.log('\n== crearProducto: casos autorizados');
  const conPanaderia = async () => {
    const p = await preparar({ propios: false });
    const admin = await p.ej.crearCuenta({ etiqueta: 'admin', rol: 'administrador', activa: false });
    const pan = await p.ej.crearPanaderia({ etiqueta: 'Ventas', propietariaId: admin });
    return { ...p, admin, pan };
  };
  {
    const { servidor, ej, conexion, ajenos, pan } = await conPanaderia();
    const inicio = conexion.registro.length;
    const activo = await ej.crearProducto({ etiqueta: 'Pan', panaderiaId: pan, precio: 500, cantidad: 10, activo: true });
    const inactivo = await ej.crearProducto({ etiqueta: 'Inactivo', panaderiaId: pan, precio: 100.5, cantidad: 0, activo: false });
    igual('secuencia exacta por producto: bloqueo, base y plantilla (sin consultar roles)', conexion.registro.slice(inicio), [
      'SELECT IS_USED_LOCK(?) AS dueno', 'SELECT DATABASE() AS base', PLANTILLA_PRODUCTO,
      'SELECT IS_USED_LOCK(?) AS dueno', 'SELECT DATABASE() AS base', PLANTILLA_PRODUCTO
    ]);
    const filaActivo = servidor.db.productos.find(p => p.id === activo);
    const filaInactivo = servidor.db.productos.find(p => p.id === inactivo);
    igual('producto activo: nombre marcado, panadería propia, precio, cantidad, precio_compra 0 y estado 1',
      [filaActivo?.nombre, filaActivo?.panaderia_id, filaActivo?.precio_venta, filaActivo?.cantidad_disponible, filaActivo?.precio_compra, filaActivo?.estado],
      [`PRUEBA ${ej.runId} Pan`, pan, 500, 10, 0, 1]);
    igual('producto inactivo: estado 0', [filaInactivo?.estado, filaInactivo?.precio_venta, filaInactivo?.cantidad_disponible], [0, 100.5, 0]);
    igual('los id quedan registrados de inmediato (pendientes.productos), sin tocar las listas de cuentas y panaderías',
      [ej.pendientes().productos, ej.ids('panaderias'), ej.ids('usuarios').length], [[activo, inactivo].sort((a, b) => a - b), [pan], 1]);
    const limpieza = await ej.limpiar();
    igual('limpiar() borra los productos con su panadería y lo ajeno queda idéntico',
      [limpieza.ok, limpieza.resultado, limpieza.borrados.productos, JSON.stringify(servidor.db) === JSON.stringify(ajenos)], [true, 'limpia', 2, true]);
    igual('describirPendientes de una limpieza correcta no lista productos', describirPendientes(limpieza), ['Limpieza correcta: no queda ninguna fila pendiente.']);
    await ej.cerrar();
  }

  console.log('\n== crearProducto: rechazos sin enviar nada');
  {
    const { ej, conexion, pan } = await conPanaderia();
    await ej.crearProducto({ etiqueta: 'Base', panaderiaId: pan, precio: 1, cantidad: 1, activo: true });
    const valido = { etiqueta: 'Otro', panaderiaId: pan, precio: 500, cantidad: 10, activo: true };
    const casos = [
      ['etiqueta con espacios', { ...valido, etiqueta: 'con espacio' }], ['etiqueta vacía', { ...valido, etiqueta: '' }],
      ['etiqueta numérica', { ...valido, etiqueta: 5 }], ['etiqueta repetida', { ...valido, etiqueta: 'Base' }],
      ['panadería semilla 1', { ...valido, panaderiaId: 1 }], ['panadería semilla 2', { ...valido, panaderiaId: 2 }],
      ['panadería sin registrar', { ...valido, panaderiaId: 99 }], ['panadería nula', { ...valido, panaderiaId: null }],
      ['panadería como texto', { ...valido, panaderiaId: String(pan) }], ['panadería ausente', { ...valido, panaderiaId: undefined }],
      ['precio como texto', { ...valido, precio: '500' }], ['precio negativo', { ...valido, precio: -1 }],
      ['precio NaN', { ...valido, precio: NaN }], ['precio infinito', { ...valido, precio: Infinity }],
      ['precio excesivo', { ...valido, precio: 1e10 }], ['precio ausente', { ...valido, precio: undefined }],
      ['cantidad decimal', { ...valido, cantidad: 1.5 }], ['cantidad negativa', { ...valido, cantidad: -1 }],
      ['cantidad como texto', { ...valido, cantidad: '3' }], ['cantidad excesiva', { ...valido, cantidad: 2000000 }],
      ['cantidad ausente', { ...valido, cantidad: undefined }],
      ['activo como texto', { ...valido, activo: 'true' }], ['activo numérico', { ...valido, activo: 1 }], ['activo ausente', { ...valido, activo: undefined }]
    ];
    for (const [descripcion, opciones] of casos) {
      const n = conexion.registro.length;
      const error = await falla(() => ej.crearProducto(opciones));
      igual(`crearProducto rechaza ${descripcion}: sin ninguna consulta y con la ejecución activa`,
        [error instanceof ErrorAislamiento, conexion.registro.length - n, ej.estado], [true, 0, 'activa']);
    }
    igual('crearProducto sin argumentos -> rechazo sin consultas', [(await falla(() => ej.crearProducto())) instanceof ErrorAislamiento], [true]);
    igual('ningún rechazo registró productos', ej.pendientes().productos.length, 1);
    await ej.cerrar();
  }
  {
    // Panadería de OTRA ejecución (existe en la base, pero no está registrada aquí)
    const { servidor, ej, conexion } = await conPanaderia();
    servidor.db.panaderias.push({ id: 77, nombre: 'PRUEBA ffffffffffffffff Ajena', usuario_id: 1 });
    const n = conexion.registro.length;
    const error = await falla(() => ej.crearProducto({ etiqueta: 'Intruso', panaderiaId: 77, precio: 1, cantidad: 1, activo: true }));
    igual('panadería existente pero no registrada por esta ejecución -> rechazo sin consultas',
      [error instanceof ErrorAislamiento, conexion.registro.length - n, servidor.db.productos.some(p => p.panaderia_id === 77)], [true, 0, false]);
    await ej.cerrar();
  }
  for (const [descripcion, alterar] of [
    ['bloqueo con otro dueño', (s) => { s.bloqueos.set(NOMBRE_BLOQUEO, 999); }],
    ['SELECT DATABASE() en otra base', (s) => { s.base = 'pansys_db'; }],
    ['conexión dedicada perdida', (s, c) => { c.perder(); }],
    ['ejecución abortada', (s, c, ej) => { ej.abortar('detenida por la suite'); }]
  ]) {
    const { servidor, ej, conexion, pan } = await conPanaderia();
    alterar(servidor, conexion, ej);
    const n = INSERTS(conexion).length;
    const error = await falla(() => ej.crearProducto({ etiqueta: 'Tarde', panaderiaId: pan, precio: 1, cantidad: 1, activo: true }));
    igual(`crearProducto con ${descripcion} -> rechazado sin INSERT y ejecución abortada`,
      [error instanceof ErrorAislamiento, INSERTS(conexion).length - n, ej.estado], [true, 0, 'abortada']);
    await ej.cerrar();
  }

  console.log('\n== crearProducto: errores definitivos e inciertos');
  {
    // Error SQL definitivo (clave foránea): nada registrado, se puede seguir
    const { servidor, ej, conexion, pan } = await conPanaderia();
    servidor.antes = (sql) => {
      if (sql === PLANTILLA_PRODUCTO) { servidor.antes = null; throw Object.assign(new Error('fk'), { errno: 1452, code: 'ER_NO_REFERENCED_ROW_2', sqlState: '23000', fatal: false }); }
    };
    const error = await falla(() => ej.crearProducto({ etiqueta: 'Rechazado', panaderiaId: pan, precio: 1, cantidad: 1, activo: true }));
    igual('error SQL definitivo -> nada registrado, sin inciertas, ejecución activa',
      [error instanceof ErrorAislamiento, /rechazó/.test(error?.message), ej.pendientes().productos, ej.escriturasInciertas, ej.estado], [true, true, [], [], 'activa']);
    const otro = await ej.crearProducto({ etiqueta: 'Siguiente', panaderiaId: pan, precio: 1, cantidad: 1, activo: true });
    igual('tras el error definitivo se puede seguir y el nuevo id queda registrado', ej.pendientes().productos, [otro]);
    igual('solo se envió un INSERT de producto que llegó a la base', servidor.db.productos.filter(p => p.panaderia_id === pan).length, 1);
    await ej.cerrar();
  }
  {
    // Incierto con la conexión perdida: abortada, no registrado, anotado y sin limpieza
    const { servidor, ej, conexion, pan } = await conPanaderia();
    servidor.trasInsert = (c, fila) => {
      if (fila.precio_venta !== undefined) { servidor.trasInsert = null; c.perder(); throw Object.assign(new Error('Connection lost'), { code: 'PROTOCOL_CONNECTION_LOST', fatal: true }); }
    };
    const error = await falla(() => ej.crearProducto({ etiqueta: 'Perdido', panaderiaId: pan, precio: 1, cantidad: 1, activo: true }));
    igual('producto incierto con conexión perdida -> abortada, no registrado y anotado como incierto',
      [error instanceof ErrorAislamiento, ej.estado, ej.pendientes().productos, ej.escriturasInciertas],
      [true, 'abortada', [], [{ tabla: 'productos', marca: `PRUEBA ${ej.runId} Perdido` }]]);
    const n = conexion.registro.length;
    const limpieza = await ej.limpiar();
    igual('sin limpieza y con el producto incierto en pendientes', [limpieza.resultado, conexion.registro.length - n, limpieza.pendientes.escriturasInciertas.length], ['no_iniciada', 0, 1]);
    igual('describirPendientes muestra el producto incierto con su tabla y marca',
      describirPendientes(limpieza).some(l => l === `  productos: PRUEBA ${ej.runId} Perdido`), true);
    await ej.cerrar();
  }
  {
    // Incierto con la conexión viva: escrituras detenidas; la limpieza borra lo registrado y, por
    // estar en la panadería propia, también el producto incierto; el resultado NO es correcto
    const { servidor, ej, conexion, pan, admin } = await conPanaderia();
    const primero = await ej.crearProducto({ etiqueta: 'Primero', panaderiaId: pan, precio: 1, cantidad: 1, activo: true });
    servidor.trasInsert = () => { servidor.trasInsert = null; throw new Error('respuesta no válida'); };
    await falla(() => ej.crearProducto({ etiqueta: 'Dudoso', panaderiaId: pan, precio: 1, cantidad: 1, activo: true }));
    igual('incierto con conexión viva -> escrituras detenidas y ejecución activa', [Boolean(ej.escriturasDetenidas), ej.estado, ej.pendientes().productos], [true, 'activa', [primero]]);
    igual('no se admiten más escrituras ni bloques de pruebas',
      [(await falla(() => ej.crearProducto({ etiqueta: 'Despues', panaderiaId: pan, precio: 1, cantidad: 1, activo: true }))) instanceof ErrorAislamiento,
        (await falla(() => ej.exigirBloqueo())) instanceof ErrorAislamiento, INSERTS(conexion).length], [true, true, 4]);
    const limpieza = await ej.limpiar();
    igual('la limpieza borra la panadería con sus dos productos y la cuenta, pero no es correcta',
      [limpieza.resultado, limpieza.ok, limpiezaCorrecta(limpieza), limpieza.borrados.productos,
        servidor.db.panaderias.some(p => p.id === pan), servidor.db.usuarios.some(u => u.id === admin)],
      ['limpia', false, false, 2, false, false]);
    igual('el motivo explica que el producto incierto de una panadería propia se borra con ella', /producto incierto de una panadería propia se borra con ella/.test(limpieza.motivo), true);
    await ej.cerrar();
  }
  {
    // Respuesta sin id válido
    const { servidor, ej, pan } = await conPanaderia();
    servidor.respuestaInsert = { insertId: 0, affectedRows: 1 };
    const error = await falla(() => ej.crearProducto({ etiqueta: 'SinId', panaderiaId: pan, precio: 1, cantidad: 1, activo: true }));
    servidor.respuestaInsert = undefined;
    igual('INSERT de producto sin id válido -> incierto, no registrado y escrituras detenidas',
      [error instanceof ErrorAislamiento, ej.pendientes().productos, ej.escriturasInciertas.map(e => e.tabla), Boolean(ej.escriturasDetenidas)], [true, [], ['productos'], true]);
    await ej.cerrar();
  }
  {
    // Un producto registrado que ya no está en una panadería propia: la limpieza no borra nada
    const { servidor, ej, pan } = await conPanaderia();
    const prod = await ej.crearProducto({ etiqueta: 'Movido', panaderiaId: pan, precio: 1, cantidad: 1, activo: true });
    servidor.db.productos.find(p => p.id === prod).panaderia_id = 1; // simulación: aparece en la panadería semilla
    const antes = copiar(servidor.db);
    const limpieza = await ej.limpiar();
    igual('producto registrado fuera de una panadería propia -> revertida y sin borrar nada',
      [limpieza.resultado, /no está en una panadería propia/.test(limpieza.motivo), JSON.stringify(servidor.db) === JSON.stringify(antes), limpieza.pendientes.productos],
      ['revertida', true, true, [prod]]);
    igual('describirPendientes lista el producto registrado', describirPendientes(limpieza).includes(`Productos registrados (id): ${prod}`), true);
    await ej.cerrar();
  }
  {
    // Un producto registrado cuyo nombre perdió la marca (modificado por otro proceso)
    const { servidor, ej, pan } = await conPanaderia();
    const prod = await ej.crearProducto({ etiqueta: 'Renombrado', panaderiaId: pan, precio: 1, cantidad: 1, activo: true });
    servidor.db.productos.find(p => p.id === prod).nombre = 'Producto de la demo';
    const antes = copiar(servidor.db);
    const limpieza = await ej.limpiar();
    igual('producto registrado sin la marca -> revertida y sin borrar nada',
      [limpieza.resultado, JSON.stringify(servidor.db) === JSON.stringify(antes)], ['revertida', true]);
    await ej.cerrar();
  }

  // ---------- Resultado del COMMIT ----------
  console.log('\n== Fallo durante el COMMIT: resultado desconocido');
  {
    // El COMMIT se aplica, pero la conexión cae antes de la respuesta
    const { servidor, ej, ajenos } = await preparar();
    servidor.perderTrasCommit = true;
    const limpieza = await ej.limpiar();
    igual('COMMIT aplicado y conexión perdida -> resultado "desconocido", sin éxito',
      [limpieza.ok, limpieza.resultado], [false, 'desconocido']);
    igual('el motivo pide verificación y no afirma que se conservaran ni se revirtieran',
      [/desconocido/.test(limpieza.motivo), /verificación/.test(limpieza.motivo), /conservad|revertid|ROLLBACK/i.test(limpieza.motivo)], [true, true, false]);
    igual('en este caso las filas propias sí se borraron (por eso no se puede afirmar nada)',
      JSON.stringify(servidor.db) === JSON.stringify(ajenos), true);
    igual('se listan los registros a comprobar y la ejecución queda abortada', [limpieza.pendientes?.usuarios, ej.estado], [[10, 11, 12], 'abortada']);
    const otra = await ej.limpiar();
    igual('tras un COMMIT desconocido no se reintenta la limpieza', [otra.ok, otra.resultado], [false, 'no_iniciada']);
    await ej.cerrar();
  }
  {
    // La conexión cae al enviar el COMMIT, sin que llegue a aplicarse
    const { servidor, ej } = await preparar();
    const antes = copiar(servidor.db);
    servidor.antes = (sql, c) => { if (sql === 'COMMIT') { servidor.antes = null; c.perder(); } };
    const limpieza = await ej.limpiar();
    igual('COMMIT no aplicado y conexión perdida -> también "desconocido" (el cliente no puede distinguirlo)',
      [limpieza.ok, limpieza.resultado, /conservad|revertid|ROLLBACK/i.test(limpieza.motivo)], [false, 'desconocido', false]);
    igual('en este caso los datos siguen intactos', JSON.stringify(servidor.db) === JSON.stringify(antes), true);
    await ej.cerrar();
  }
  {
    const { servidor, ej } = await preparar();
    servidor.db.usuarios.push({ id: 6, email: 'otra.demo@pansys.test', panaderia_id: 20 });
    const limpieza = await ej.limpiar();
    igual('fallo antes del COMMIT -> resultado "revertida" y motivo con ROLLBACK', [limpieza.resultado, /ROLLBACK/.test(limpieza.motivo)], ['revertida', true]);
    await ej.cerrar();
  }
  {
    const { ej, conexion } = await preparar();
    conexion.perder();
    const limpieza = await ej.limpiar();
    igual('limpieza no iniciada -> resultado "no_iniciada"', limpieza.resultado, 'no_iniciada');
    await ej.cerrar();
  }
  {
    const { ej } = await preparar();
    const limpieza = await ej.limpiar();
    igual('limpieza correcta -> resultado "limpia"', [limpieza.ok, limpieza.resultado], [true, 'limpia']);
    await ej.cerrar();
  }

  // ---------- Dos limpiezas simultáneas ----------
  console.log('\n== Dos llamadas simultáneas a limpiar()');
  {
    // Bloqueo falso con una verificación que no termina hasta que se libera: la primera limpieza
    // queda en curso y la segunda se llama mientras tanto.
    let continuar;
    const pausa = new Promise(resolve => { continuar = resolve; });
    const llamadas = [];
    const bloqueo = {
      perdido: false, liberado: false, motivoPerdida: null,
      verificar: async () => { llamadas.push('verificar'); await pausa; throw new ErrorAislamiento('Bloqueo de suite perdido: fin de la prueba'); },
      consultar: async (sql) => { llamadas.push(sql); return []; },
      deshacer: async () => { llamadas.push('ROLLBACK'); },
      liberar: async () => {}
    };
    const ej = ejecucionFalsa(bloqueo);
    const primera = ej.limpiar();
    // Con tiempo límite: si la segunda esperase a la primera, la prueba falla en vez de colgarse
    const segunda = await Promise.race([
      ej.limpiar(),
      new Promise(resolve => setTimeout(() => resolve({ ok: null, resultado: 'esperó a la primera', motivo: '' }), 2000))
    ]);
    igual('la segunda llamada, con la primera en curso, se rechaza como "en curso"',
      [segunda.ok, segunda.resultado, /en curso/.test(segunda.motivo)], [false, 'no_iniciada', true]);
    igual('la segunda llamada no hizo ninguna verificación ni consulta', llamadas, ['verificar']);
    continuar();
    await primera;
  }
  {
    // Con el doble de MySQL: la segunda llamada llega en medio de los DELETE de la primera
    const { servidor, ej, conexion, ajenos } = await preparar();
    let segunda = null;
    servidor.antes = (sql) => {
      if (sql.startsWith('DELETE FROM pansys_test.ventas')) { servidor.antes = null; segunda = ej.limpiar(); }
    };
    const primera = await ej.limpiar();
    const resultadoSegunda = await segunda;
    igual('limpieza simultánea con el doble: la primera termina bien y la segunda se rechaza',
      [primera.ok, resultadoSegunda?.ok, /en curso/.test(resultadoSegunda?.motivo)], [true, false, true]);
    igual('solo hubo una transacción, un COMMIT y los 10 DELETE de una sola limpieza',
      [sentencias(conexion, 'START TRANSACTION').length, sentencias(conexion, 'COMMIT').length, sentencias(conexion, 'DELETE').length], [1, 1, 10]);
    igual('los datos ajenos quedan intactos', JSON.stringify(servidor.db) === JSON.stringify(ajenos), true);
    await ej.cerrar();
  }

  // ---------- Guardián de P1 en producción y cuentas ----------
  console.log('\n== Suites de producción y cuentas deshabilitadas');
  // Cada suite se ejecuta en un proceso hijo donde toda carga de módulos y toda conexión de red
  // quedan bloqueadas y registradas: aunque el guardián faltara, no podría conectar con nada.
  const ARNES = `
    const fs = require('fs');
    const path = require('path');
    const Module = require('module');
    const net = require('net');
    const tls = require('tls');
    const marca = (texto) => process.stderr.write('\\n<<' + texto + '>>\\n');
    const bloquear = (nombre) => function () { marca('RED:' + nombre); throw new Error('red bloqueada'); };
    net.connect = net.createConnection = bloquear('net.connect');
    net.Socket.prototype.connect = bloquear('Socket.connect');
    tls.connect = bloquear('tls.connect');
    const archivo = process.argv[1];
    let codigo = fs.readFileSync(archivo, 'utf8');
    if (process.env.SIN_GUARDIAN === '1') codigo = codigo.replace(/^process\\.exit\\(1\\);\\r?$/m, '');
    const modulo = new Module(archivo, null);
    modulo.filename = archivo;
    modulo.paths = Module._nodeModulePaths(path.dirname(archivo));
    Module.prototype.require = function (id) { marca('REQUIRE:' + id); throw new Error('carga bloqueada: ' + id); };
    modulo._compile(codigo, archivo);
  `;
  const ejecutarSuite = (archivo, sinGuardian = false, envExtra = {}) => spawnSync(process.execPath, ['-e', ARNES, archivo], {
    encoding: 'utf8',
    timeout: 15000,
    // Entorno mínimo: sin credenciales y con un host inexistente
    env: {
      PATH: process.env.PATH, SystemRoot: process.env.SystemRoot,
      DB_HOST: 'base-inexistente.invalid', DB_NAME: 'sin_base_pruebas_unitarias',
      ...(sinGuardian ? { SIN_GUARDIAN: '1' } : {}),
      ...envExtra
    }
  });
  // Ventas ya está adaptada al aislamiento (ver más abajo); Producción y Cuentas siguen deshabilitadas
  for (const [nombre, archivo] of [['Producción', 'produccion.pruebas.js'], ['Cuentas', 'usuarios.pruebas.js']]) {
    const ruta = path.join(__dirname, archivo);
    const r = ejecutarSuite(ruta);
    igual(`${archivo}: termina con código 1 y el aviso de suite deshabilitada`,
      [r.status, r.stderr.includes(`Suite de ${nombre} DESHABILITADA temporalmente por seguridad`)], [1, true]);
    igual(`${archivo}: no intenta cargar ningún módulo (ni dotenv, ni modelos, ni servidor)`, (r.stderr.match(/<<REQUIRE:[^>]*>>/g) ?? []), []);
    igual(`${archivo}: no intenta ninguna conexión de red`, /<<RED:/.test(r.stderr), false);
    igual(`${archivo}: no escribe nada en la salida estándar (ninguna prueba llegó a ejecutarse)`, r.stdout, '');
    // Control: el arnés detecta de verdad una suite sin guardián
    const control = ejecutarSuite(ruta, true);
    igual(`${archivo} sin guardián (control): el arnés detecta y bloquea la carga de dotenv`,
      [/<<REQUIRE:dotenv>>/.test(control.stderr), /<<RED:/.test(control.stderr), control.status !== 0], [true, false, true]);

    // Revisión estática: la salida es la segunda instrucción, en el nivel superior del archivo
    const lineas = fs.readFileSync(ruta, 'utf8').split(/\r?\n/);
    const codigo = lineas.map((l, i) => ({ l, n: i + 1 })).filter(x => x.l.trim() && !x.l.trim().startsWith('//'));
    // El aviso ocupa dos líneas (texto partido); la tercera línea de código es la salida
    igual(`${archivo}: las dos primeras instrucciones son el aviso y process.exit(1) sin sangría`,
      [codigo[0].l.startsWith('console.error('), codigo[1].l.startsWith("  '"), codigo[2].l], [true, true, 'process.exit(1);']);
    const nSalida = lineas.indexOf('process.exit(1);') + 1;
    const primera = (re) => lineas.findIndex(l => re.test(l)) + 1;
    igual(`${archivo}: require, process.env y sequelize aparecen solo después de la salida`,
      [nSalida > 0, primera(/require\(/) > nSalida, primera(/process\.env\./) > nSalida, primera(/sequelize/) > nSalida], [true, true, true, true]);
    igual(`${archivo}: no queda ningún DELETE FROM ni TRUNCATE`, lineas.some(l => /DELETE FROM|TRUNCATE/i.test(l)), false);
  }

  // Cuentas: la limpieza global (borrado de id > 4, reinicio de la semilla y borrado por patrón)
  // queda bloqueada también como segunda barrera, por si se quitara el guardián
  console.log('\n== usuarios.pruebas.js: limpieza global bloqueada (revisión estática)');
  {
    const textoCuentas = fs.readFileSync(path.join(__dirname, 'usuarios.pruebas.js'), 'utf8').replace(/\r/g, '');
    const codigoCuentas = textoCuentas.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    igual('restaurarSemilla solo lanza un error (sin ninguna consulta)',
      /const restaurarSemilla = async \(\) => \{\s*throw new Error\('Suite deshabilitada: [^']*'\);\s*\};/.test(codigoCuentas), true);
    igual('sin el borrado de cuentas con id > 4 ni el reinicio de contraseñas de la semilla',
      [/DELETE FROM usuarios/i.test(textoCuentas), /id\s*>\s*4/.test(codigoCuentas), /contrasena = '!'/.test(codigoCuentas)], [false, false, false]);
    igual('sin el borrado de insumos por patrón (LIKE) en ningún sitio', /\bLIKE\b/.test(codigoCuentas), false);
    igual('ninguna consulta SQL de escritura en el archivo (solo lecturas con sequelize.query)',
      [...codigoCuentas.matchAll(/sequelize\.query\(\s*(['"`])([\s\S]*?)\1/g)].map(m => m[2].trim().split(/\s+/)[0].toUpperCase()).every(s => s === 'SELECT'), true);
    igual('el finally ya no restaura la semilla ni borra datos',
      (() => { const f = codigoCuentas.slice(codigoCuentas.lastIndexOf('.finally(')); return [/restaurarSemilla\(/.test(f), /sequelize\.query\(/.test(f), /destroy\(/.test(f)]; })(),
      [false, false, false]);
    igual('en main, la primera operación tras verificar la base es la barrera restaurarSemilla()',
      /baseVerificada = true;\s*await restaurarSemilla\(\);/.test(codigoCuentas), true);
  }

  // ---------- Ventas adaptada: barreras y revisión estática ----------
  console.log('\n== ventas.pruebas.js adaptada: barreras (proceso aislado, sin módulos ni red)');
  {
    const ruta = path.join(__dirname, 'ventas.pruebas.js');
    for (const variable of ['PANSYS_MODO_DEMO', 'PANSYS_SERVIR_FRONTEND']) {
      for (const valor of ['1', '']) {
        const r = ejecutarSuite(ruta, false, { [variable]: valor });
        igual(`ventas.pruebas.js con ${variable}=${JSON.stringify(valor)}: cancelada con código 1, sin cargar módulos ni usar la red`,
          [r.status, /Suite de Ventas cancelada/.test(r.stderr), r.stderr.includes(variable), (r.stderr.match(/<<REQUIRE:[^>]*>>/g) ?? []), /<<RED:/.test(r.stderr), r.stdout],
          [1, true, true, [], false, '']);
      }
    }
    const control = ejecutarSuite(ruta);
    igual('ventas.pruebas.js sin opciones prohibidas (control): pasa la barrera y el arnés bloquea la primera carga (dotenv), sin red',
      [/<<REQUIRE:dotenv>>/.test(control.stderr), /<<RED:/.test(control.stderr), control.status !== 0, /Suite de Ventas cancelada/.test(control.stderr)],
      [true, false, true, false]);

    console.log('\n== ventas.pruebas.js adaptada: revisión estática');
    const lineas = fs.readFileSync(ruta, 'utf8').split(/\r?\n/);
    const codigoVentas = lineas.filter(l => !l.trim().startsWith('//')).join('\n');
    const instrucciones = lineas.map((l, i) => ({ l, n: i + 1 })).filter(x => x.l.trim() && !x.l.trim().startsWith('//'));
    igual('la primera instrucción es la barrera de opciones prohibidas', instrucciones[0].l.startsWith('const opcionesProhibidas = '), true);
    const nDbName = lineas.findIndex(l => l.startsWith("process.env.DB_NAME = 'pansys_test';")) + 1;
    const primera = (re) => lineas.findIndex(l => re.test(l)) + 1;
    igual('DB_NAME = pansys_test se fija antes del primer require (dotenv y modelos)',
      [nDbName > 0, primera(/require\(/) > nDbName, primera(/require\('\.\.\/src\/models\/index'\)/) > nDbName], [true, true, true]);
    igual('sin borrados ni escrituras SQL propias (DELETE, TRUNCATE, INSERT, UPDATE, REPLACE, LIKE)',
      /\b(DELETE|TRUNCATE|INSERT|UPDATE|REPLACE|LIKE)\b/.test(codigoVentas), false);
    igual('sin el UPDATE productos SET estado = 0 original', /estado\s*=\s*0/.test(codigoVentas), false);
    igual('el producto inactivo se crea con crearProducto en una panadería temporal',
      /ejecucion\.crearProducto\(\{ etiqueta: 'Inactivo', panaderiaId: panaderiaA,[^}]*activo: false \}\)/.test(codigoVentas), true);
    igual('usa iniciarEjecucion, no construye Ejecucion ni usa la conexión dedicada',
      [/iniciarEjecucion\(\{ suite: 'ventas', sequelize \}\)/.test(codigoVentas), /new Ejecucion/.test(codigoVentas), /bloqueo\.(consultar|verificar|deshacer|liberar)/.test(codigoVentas)],
      [true, false, false]);
    igual('una sola llamada a limpiar() y uso de limpiezaCorrecta y describirPendientes',
      [(codigoVentas.match(/await ejecucion\.limpiar\(\)/g) ?? []).length, /limpiezaCorrecta\(limpieza\)/.test(codigoVentas), /describirPendientes\(limpieza\)/.test(codigoVentas)], [1, true, true]);
    igual('el código de salida exige cero FALLAS y limpiezaCorrecta',
      /const codigo = fallidas === 0 && limpiezaCorrecta\(limpieza\) \? 0 : 1;/.test(codigoVentas), true);
    igual('sin tokens ni cuentas semilla (ni correos de la semilla ni id 1-4 en los tokens)',
      [/(admin|panadero1|panadero2|gerente1)@pansys\.test/.test(codigoVentas), /firmar\(\{ id: [1-4],/.test(codigoVentas), /TOKENS\s*=\s*\{\s*[A-Za-z]/.test(codigoVentas)], [false, false, false]);
    igual('los tokens llevan version_sesion 0 y se firman para cuentas temporales',
      [/version_sesion: 0/.test(codigoVentas), (codigoVentas.match(/TOKENS\.\w+ = firmar\(cuentas\.\w+,/g) ?? []).length], [true, 4]);
    igual('todas las tablas de las consultas llevan pansys_test. o son information_schema',
      [...codigoVentas.matchAll(/\b(?:FROM|JOIN)\s+([A-Za-z_][\w.]*)/g)].map(m => m[1]).every(t => t.startsWith('pansys_test.') || t.startsWith('information_schema.')), true);
    igual('los recuentos e invariantes se limitan a las panaderías temporales (panaderia_id IN (?) con propias())',
      [(codigoVentas.match(/panaderia_id (NOT )?IN \(\?\)/g) ?? []).length >= 6, /replacements: \[propias\(\)\]/.test(codigoVentas)], [true, true]);
    igual('DetalleVenta.bulkCreate se restaura dentro de un finally',
      /finally \{\s*DetalleVenta\.bulkCreate = bulkCreateOriginal;\s*console\.error = errorOriginal;/.test(codigoVentas.replace(/\r/g, '')), true);
    igual('no envía peticiones hasta confirmar la identidad (URL nula hasta el runId) y exige token temporal',
      [/if \(!URL \|\| !TOKENS\[usuario\]\) throw/.test(codigoVentas), /URL = base;/.test(codigoVentas), /identidad\?\.runId !== ejecucion\.runId/.test(codigoVentas)], [true, true, true]);
    igual('cierre en orden: servidor, limpiar, cerrar y Sequelize',
      (() => { const i = ['await cerrarServidor()', 'await ejecucion.limpiar()', 'await ejecucion.cerrar()', 'await sequelize.close()'].map(t => codigoVentas.indexOf(t)); return i.every(x => x > 0) && i.every((x, k) => k === 0 || x > i[k - 1]); })(),
      true);
    igual('exigirBloqueo antes de cada bloque (al menos 9 llamadas)', (codigoVentas.match(/await ejecucion\.exigirBloqueo\(\);/g) ?? []).length >= 9, true);
    igual('sin PORT_PRUEBAS ni el guardián de P1 (process.exit solo en las barreras y al final)',
      [/PORT_PRUEBAS/.test(codigoVentas), /DESHABILITADA/.test(codigoVentas), (codigoVentas.match(/process\.exit\(/g) ?? []).length], [false, false, 3]);
  }

  // ---------- limpiezaCorrecta y describirPendientes ----------
  console.log('\n== Evaluación del resultado de limpiar()');
  {
    // Resultados reales de limpiar() en cada situación
    const reales = {};
    { const { ej } = await preparar(); reales.limpia = await ej.limpiar(); await ej.cerrar(); }
    {
      const { servidor, ej } = await preparar();
      servidor.db.usuarios.push({ id: 6, email: 'otra.demo@pansys.test', panaderia_id: 20 });
      reales.revertida = await ej.limpiar(); await ej.cerrar();
    }
    { const { ej, conexion } = await preparar(); conexion.perder(); reales.no_iniciada = await ej.limpiar(); await ej.cerrar(); }
    { const { servidor, ej } = await preparar(); servidor.perderTrasCommit = true; reales.desconocido = await ej.limpiar(); await ej.cerrar(); }
    {
      const { servidor, ej } = await preparar({ propios: false });
      await ej.crearCuenta({ etiqueta: 'admin', rol: 'administrador', activa: false });
      servidor.trasInsert = () => { servidor.trasInsert = null; throw new Error('respuesta no válida'); };
      await falla(() => ej.crearCuenta({ etiqueta: 'admin2', rol: 'administrador', activa: false }));
      reales.limpiaConInciertas = await ej.limpiar(); await ej.cerrar();
    }
    igual('resultados reales obtenidos', Object.fromEntries(Object.entries(reales).map(([k, r]) => [k, [r.resultado, r.ok]])), {
      limpia: ['limpia', true], revertida: ['revertida', false], no_iniciada: ['no_iniciada', false],
      desconocido: ['desconocido', false], limpiaConInciertas: ['limpia', false]
    });
    igual('limpiezaCorrecta: solo la limpieza completa sin pendientes es correcta',
      Object.fromEntries(Object.entries(reales).map(([k, r]) => [k, limpiezaCorrecta(r)])),
      { limpia: true, revertida: false, no_iniciada: false, desconocido: false, limpiaConInciertas: false });

    const correcto = { ok: true, resultado: 'limpia', motivo: null, borrados: {}, pendientes: null };
    const malFormados = [
      ['null', null], ['undefined', undefined], ['objeto vacío', {}], ['lista', [correcto]], ['número', 1], ['texto', 'limpia'],
      ['ok como texto', { ...correcto, ok: 'true' }], ['ok ausente', { resultado: 'limpia', pendientes: null }],
      ['resultado en mayúscula', { ...correcto, resultado: 'Limpia' }], ['resultado ausente', { ok: true, pendientes: null }],
      ['pendientes ausentes', { ok: true, resultado: 'limpia' }], ['pendientes vacíos', { ...correcto, pendientes: {} }],
      ['pendientes con inciertas vacías', { ...correcto, pendientes: { escriturasInciertas: [] } }],
      ['ok verdadero pero revertida', { ...correcto, resultado: 'revertida' }]
    ];
    for (const [descripcion, valor] of malFormados) {
      igual(`limpiezaCorrecta(${descripcion}) -> false`, limpiezaCorrecta(valor), false);
    }
    igual('limpiezaCorrecta(resultado correcto) -> true', limpiezaCorrecta(correcto), true);

    // describirPendientes
    igual('describirPendientes con una limpieza correcta: una sola línea', describirPendientes(reales.limpia), ['Limpieza correcta: no queda ninguna fila pendiente.']);
    const revertida = describirPendientes(reales.revertida).join('\n');
    igual('revertida: runId, id de cuentas y panaderías registradas, y sin reintento',
      [revertida.includes(reales.revertida.pendientes.runId), revertida.includes('Cuentas registradas (id): 10, 11, 12'),
        revertida.includes('Panaderías registradas (id): 20, 21'), /No se reintenta/.test(revertida), /solo lectura/.test(revertida)],
      [true, true, true, true, true]);
    const desconocido = describirPendientes(reales.desconocido).join('\n');
    igual('desconocido: avisa de que no se sabe si se borraron', /Falló el COMMIT: no se sabe/.test(desconocido), true);
    const inciertas = describirPendientes(reales.limpiaConInciertas).join('\n');
    const marca = reales.limpiaConInciertas.pendientes.escriturasInciertas[0].marca;
    igual('limpia con inciertas: NO correcta, con la tabla y la marca de cada escritura incierta',
      [/Limpieza NO correcta \(resultado: limpia\)/.test(inciertas), inciertas.includes(`usuarios: ${marca}`), /nunca se borran automáticamente/.test(inciertas)],
      [true, true, true]);
    const noIniciada = describirPendientes(reales.no_iniciada).join('\n');
    igual('no_iniciada: lista lo registrado', noIniciada.includes('Cuentas registradas (id): 10, 11, 12'), true);

    const sensible = {
      ok: false, resultado: 'revertida',
      motivo: `Access denied for user 'root'@'localhost' con hash $2b$10$${'a'.repeat(53)} ${'x'.repeat(400)}`,
      pendientes: { runId: 'aaaabbbbccccdddd', usuarios: [10], panaderias: [], escriturasInciertas: [{ tabla: 'usuarios', marca: "'root'@'localhost'" }] }
    };
    const textoSensible = describirPendientes(sensible).join('\n');
    igual('oculta pares usuario@host y hashes, y marca el recorte',
      [textoSensible.includes("'root'@'localhost'"), textoSensible.includes('$2b$'), /<oculto>/.test(textoSensible), /<hash oculto>/.test(textoSensible), /\[RECORTADO: se omiten \d+ caracteres\]/.test(textoSensible)],
      [false, false, true, true, true]);
    const copia = copiar(sensible);
    describirPendientes(sensible);
    igual('describirPendientes no modifica su entrada', JSON.stringify(sensible) === JSON.stringify(copia), true);
    const malas = [null, undefined, {}, { pendientes: 'x' }, { resultado: 7, pendientes: { runId: 'NO-VALIDO', usuarios: ['a'], panaderias: [1.5], escriturasInciertas: [{ tabla: 'ventas', marca: 'x' }, {}, null] } }];
    const salidas = malas.map(m => { try { return describirPendientes(m); } catch (error) { return error; } });
    igual('entradas ausentes o mal formadas: nunca lanza y devuelve solo líneas de texto',
      salidas.every(s => Array.isArray(s) && s.every(l => typeof l === 'string')), true);
    const ultima = salidas.at(-1).join('\n');
    igual('mal formada: runId e id "no disponibles" y entradas inciertas no válidas señaladas',
      [ultima.includes('runId: (no disponible)'), (ultima.match(/no disponible o mal formado/g) ?? []).length, (ultima.match(/entrada mal formada/g) ?? []).length],
      [true, 2, 3]);
    igual('sin pendientes legibles: indica que las inciertas no están disponibles', describirPendientes({}).some(l => /Escrituras de resultado incierto: \(no disponible\)/.test(l)), true);
  }

  // ---------- Revisión del código ----------
  console.log('\n== Revisión del código');
  const codigo = fs.readFileSync(path.join(__dirname, 'aislamiento.js'), 'utf8');
  igual('la conexión dedicada fija database: BASE (no usa DB_NAME)', /database: BASE/.test(codigo) && !/database: env\.DB_NAME/.test(codigo), true);
  igual('el módulo no contiene LIKE, TRUNCATE ni comparaciones de rango sobre id',
    /LIKE|TRUNCATE|\bid\s*[<>]=?\s*\?/i.test(codigo.replace(/^\s*\/\/.*$/gm, '')), false);
  // Escrituras permitidas: exactamente las dos plantillas, con este texto, y el DELETE de la limpieza
  const sinComentarios = codigo.split(/\r?\n/).filter(l => !l.trim().startsWith('//')).join('\n');
  igual('plantilla de cuenta exacta', PLANTILLA_CUENTA,
    "INSERT INTO pansys_test.usuarios (email, contrasena, rol_id, panaderia_id, estado, version_sesion, createdAt, updatedAt) VALUES (?, '!', ?, ?, ?, 0, NOW(), NOW())");
  igual('plantilla de panadería exacta', PLANTILLA_PANADERIA,
    "INSERT INTO pansys_test.panaderias (nombre, direccion, telefono, en_red, usuario_id, createdAt, updatedAt) VALUES (?, 'Dirección temporal de pruebas', NULL, 0, ?, NOW(), NOW())");
  igual('el código solo contiene tres INSERT: pansys_test.usuarios, pansys_test.panaderias y pansys_test.productos',
    (sinComentarios.match(/INSERT INTO\s+\S+/g) ?? []), ['INSERT INTO pansys_test.usuarios', 'INSERT INTO pansys_test.panaderias', 'INSERT INTO pansys_test.productos']);
  igual('plantilla de producto exacta', PLANTILLA_PRODUCTO,
    'INSERT INTO pansys_test.productos (nombre, precio_compra, precio_venta, cantidad_disponible, panaderia_id, estado, createdAt, updatedAt) VALUES (?, 0, ?, ?, ?, ?, NOW(), NOW())');
  igual('el código solo contiene un DELETE (el de la limpieza) y ningún UPDATE, REPLACE, DROP ni ALTER en SQL',
    [(sinComentarios.match(/DELETE FROM/g) ?? []).length, /['"`]\s*(UPDATE|REPLACE|DROP|ALTER)\s/i.test(sinComentarios)], [1, false]);
  igual('los métodos que escriben son privados (#) y solo crearCuenta, crearPanaderia y crearProducto los invocan',
    [/#insertar\(/.test(sinComentarios), (sinComentarios.match(/this\.#insertar\(/g) ?? []).length, /^\s+(async\s+)?insertar\(/m.test(sinComentarios)], [true, 3, false]);
};

// Si main() no llega a terminar (una promesa que nunca se resuelve vacía el bucle de eventos),
// Node saldría con código 0 sin resumen: se trata como fallo.
let completada = false;
process.on('exit', (codigo) => {
  if (!completada) {
    console.log('\nFALLA la ejecución terminó sin completar todas las pruebas');
    process.exitCode = 1;
  } else if (codigo !== 0) {
    process.exitCode = codigo;
  }
});

main()
  .catch(error => { resultados.push(false); console.log('FALLA ejecución abortada ->', error.stack); })
  .finally(() => {
    completada = true;
    const fallidas = resultados.filter(ok => !ok).length;
    console.log(`\n${resultados.length - fallidas}/${resultados.length} pruebas correctas`);
    process.exit(fallidas ? 1 : 0);
  });
