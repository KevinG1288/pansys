// Aislamiento de las suites de integración que escriben en pansys_test.
//
// 1. Exclusión: cada suite toma GET_LOCK('pansys_test.suite_integracion', 0) en una conexión
//    dedicada de mysql2 que se mantiene abierta durante toda la suite. Si el bloqueo no se
//    obtiene, la suite termina sin escribir nada. Si la conexión o el bloqueo se pierden, la
//    ejecución queda detenida: no se ejecutan más pruebas ni se intenta limpiar.
// 2. Identificación de lo propio: cada ejecución registra los id de las cuentas y panaderías
//    que crea (marcadas con su runId). La limpieza borra solo esas filas y las que dependen de
//    ellas por clave foránea; nunca rangos de id, patrones de nombre ni tablas completas.
// 3. Limpieza transaccional en la conexión dedicada: comprobaciones previas (base, bloqueo,
//    marcas y dependencias ajenas, incluidos los detalles de ventas ajenas que referencien
//    productos propios y que el ON DELETE CASCADE borraría), borrado en orden de claves foráneas
//    con recuento previo y verificación de filas afectadas, y nueva comprobación del bloqueo
//    antes del COMMIT.
//    Ante cualquier duda: ROLLBACK, y los registros temporales quedan para revisión posterior.
//
// El bloqueo no excluye a otros procesos que escriban en pansys_test (demo, npm run dev,
// Workbench): por eso la limpieza solo alcanza filas propias y no se ejecutan suites en la demo.

const crypto = require('crypto');

const BASE = 'pansys_test';
const NOMBRE_BLOQUEO = 'pansys_test.suite_integracion';
const DOMINIO_CORREO = 'pansys.test';
// Filas de crear_pansys_test.sql: nunca se registran ni se borran
const MAX_ID_SEMILLA = { usuarios: 4, panaderias: 2 };
// Tablas del SQL 005 (aún no existen en pansys_test): se limpian solo si existen
const TABLAS_OPCIONALES = ['eventos_seguridad', 'restablecimientos_contrasena'];

// Escrituras protegidas: las ÚNICAS sentencias de escritura del módulo, aparte del DELETE de la
// limpieza. No se acepta SQL de fuera. Contraseña '!' (no es un hash: no permite iniciar sesión).
const PLANTILLA_CUENTA = "INSERT INTO pansys_test.usuarios (email, contrasena, rol_id, panaderia_id, estado, version_sesion, createdAt, updatedAt) VALUES (?, '!', ?, ?, ?, 0, NOW(), NOW())";
const PLANTILLA_PANADERIA = "INSERT INTO pansys_test.panaderias (nombre, direccion, telefono, en_red, usuario_id, createdAt, updatedAt) VALUES (?, 'Dirección temporal de pruebas', NULL, 0, ?, NOW(), NOW())";
// Producto temporal, solo en una panadería propia (precio_compra fijo en 0)
const PLANTILLA_PRODUCTO = 'INSERT INTO pansys_test.productos (nombre, precio_compra, precio_venta, cantidad_disponible, panaderia_id, estado, createdAt, updatedAt) VALUES (?, 0, ?, ?, ?, ?, NOW(), NOW())';
// Comprobación R1 de la limpieza (ver comprobarAntesDeBorrar). Se exportan para que la verificación
// contra MySQL real (aislamiento.mysql.js) use exactamente el mismo texto. Parámetros:
// bloqueo [panaderías propias]; detalles [panaderías propias, panaderías propias].
const SQL_BLOQUEO_PRODUCTOS = 'SELECT id FROM pansys_test.productos WHERE panaderia_id IN (?) FOR UPDATE';
const SQL_DETALLES_AJENOS = 'SELECT COUNT(*) AS n FROM pansys_test.detalle_ventas WHERE producto_id IN (SELECT id FROM pansys_test.productos WHERE panaderia_id IN (?)) AND venta_id NOT IN (SELECT id FROM pansys_test.ventas WHERE panaderia_id IN (?))';
const PRECIO_MAXIMO = 1e9; // productos.precio_venta es FLOAT
const CANTIDAD_MAXIMA = 1000000; // productos.cantidad_disponible es INT
// Roles de la semilla (backend/src/config/roles.js); se comprueban en la base antes de la primera cuenta
const ROLES = Object.freeze({ administrador: 1, panadero: 2, gerente: 3 });
const ETIQUETA_CUENTA = /^[a-z0-9]+$/;
const ETIQUETA_PANADERIA = /^[A-Za-z0-9]+$/;
const ETIQUETA_PRODUCTO = /^[A-Za-z0-9]+$/;

class ErrorAislamiento extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'ErrorAislamiento';
  }
}

const tabla = (nombre) => `${BASE}.${nombre}`;

const verificarConfiguracion = (env = process.env) => {
  if (env.DB_NAME !== BASE) {
    throw new ErrorAislamiento(`DB_NAME es "${env.DB_NAME}": las suites de integración solo se ejecutan sobre ${BASE}`);
  }
};

// Comprueba la base real de una conexión (la dedicada o la de Sequelize de la suite)
const verificarBaseConectada = async (consultar, origen) => {
  const filas = await consultar('SELECT DATABASE() AS base');
  const base = filas?.[0]?.base;
  if (base !== BASE) {
    throw new ErrorAislamiento(`${origen} está conectada a "${base}": se esperaba ${BASE}`);
  }
};

// Conexión real (solo fuera de las pruebas unitarias). La base se fija de forma literal:
// no depende de DB_NAME aunque este ya se haya comprobado.
const crearConexionMysql = (env) => require('mysql2/promise').createConnection({
  host: env.DB_HOST,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: BASE
});

// ---------- Bloqueo de suite ----------

class Bloqueo {
  constructor(conexion, idConexion) {
    this.conexion = conexion;
    this.idConexion = idConexion;
    this.perdido = false;
    this.motivoPerdida = null;
    this.liberado = false;
    // mysql2/promise reenvía los eventos de la conexión subyacente
    conexion.on('error', (error) => this.marcarPerdido(`error de la conexión dedicada (${error?.code ?? 'sin código'})`));
    conexion.on('end', () => this.marcarPerdido('la conexión dedicada se cerró'));
  }

  marcarPerdido(motivo) {
    if (this.liberado || this.perdido) return;
    this.perdido = true;
    this.motivoPerdida = motivo;
  }

  // Con el bloqueo perdido o liberado no se envía ninguna consulta: la conexión puede seguir
  // viva aunque el bloqueo ya no sea nuestro. Solo se permite ROLLBACK (deshacer siempre es seguro).
  async consultar(sql, params, { trasPerdida = false } = {}) {
    if (this.liberado) throw new ErrorAislamiento('El bloqueo de suite ya fue liberado: no se envían más consultas');
    if (this.perdido && !trasPerdida) throw new ErrorAislamiento(`Bloqueo de suite perdido: ${this.motivoPerdida}`);
    const [filas] = await this.conexion.query(sql, params);
    return filas;
  }

  async deshacer() {
    await this.consultar('ROLLBACK', undefined, { trasPerdida: true });
  }

  // Confirma con MySQL que el bloqueo sigue siendo de esta conexión. Nunca lo da por supuesto.
  async verificar() {
    if (this.liberado) throw new ErrorAislamiento('El bloqueo de suite ya fue liberado');
    if (this.perdido) throw new ErrorAislamiento(`Bloqueo de suite perdido: ${this.motivoPerdida}`);
    let dueno;
    try {
      dueno = (await this.consultar('SELECT IS_USED_LOCK(?) AS dueno', [NOMBRE_BLOQUEO]))?.[0]?.dueno;
    } catch (error) {
      this.marcarPerdido(`no se pudo comprobar el bloqueo (${error.code ?? error.message})`);
      throw new ErrorAislamiento(`Bloqueo de suite perdido: ${this.motivoPerdida}`);
    }
    if (dueno === null || dueno === undefined || Number(dueno) !== this.idConexion) {
      this.marcarPerdido(`el bloqueo ya no pertenece a esta conexión (dueño: ${dueno ?? 'ninguno'})`);
      throw new ErrorAislamiento(`Bloqueo de suite perdido: ${this.motivoPerdida}`);
    }
  }

  // Libera el bloqueo y cierra la conexión. Si se perdió, solo cierra (no hay nada que liberar).
  async liberar() {
    if (this.liberado) return;
    const estabaPerdido = this.perdido;
    this.liberado = true;
    try {
      // RELEASE_LOCK solo libera un bloqueo de esta misma sesión de MySQL, nunca uno ajeno.
      // Con el bloqueo perdido ni se envía: cerrar la conexión basta para soltar lo propio.
      if (!estabaPerdido) await this.conexion.query('SELECT RELEASE_LOCK(?) AS liberado', [NOMBRE_BLOQUEO]);
    } finally {
      await this.conexion.end().catch(() => {});
    }
  }
}

// Abre la conexión dedicada, comprueba la base y toma el bloqueo sin esperar (timeout 0).
// Ante cualquier fallo cierra la conexión y lanza ErrorAislamiento: la suite no debe escribir.
const abrirBloqueo = async ({ env = process.env, crearConexion = crearConexionMysql } = {}) => {
  verificarConfiguracion(env);
  let conexion;
  try {
    conexion = await crearConexion(env);
  } catch (error) {
    // Solo el código: el mensaje de mysql2 puede incluir el usuario o el host
    throw new ErrorAislamiento(`No se pudo abrir la conexión dedicada: ${error.code ?? 'error desconocido'}`);
  }
  // Sin un oyente de 'error', un error fatal de la conexión terminaría el proceso
  const errorTemprano = () => {};
  conexion.on('error', errorTemprano);
  try {
    await verificarBaseConectada(async (sql) => (await conexion.query(sql))[0], 'La conexión dedicada');
    const [filas] = await conexion.query('SELECT GET_LOCK(?, 0) AS obtenido, CONNECTION_ID() AS id', [NOMBRE_BLOQUEO]);
    const { obtenido, id } = filas?.[0] ?? {};
    // 1 = obtenido; 0 = ocupado; NULL = error de MySQL
    if (obtenido === null || obtenido === undefined || Number(obtenido) !== 1) {
      throw new ErrorAislamiento('Otra suite de integración está en curso (bloqueo de suite ocupado): no se escribe nada');
    }
    // Sin un CONNECTION_ID válido no se podría comprobar después quién tiene el bloqueo
    if (!esIdValido(Number(id))) {
      await conexion.query('SELECT RELEASE_LOCK(?) AS liberado', [NOMBRE_BLOQUEO]).catch(() => {});
      throw new ErrorAislamiento('MySQL no devolvió un CONNECTION_ID válido para el bloqueo de suite');
    }
    const bloqueo = new Bloqueo(conexion, Number(id));
    conexion.removeListener('error', errorTemprano);
    return bloqueo;
  } catch (error) {
    await conexion.end().catch(() => {});
    if (error instanceof ErrorAislamiento) throw error;
    throw new ErrorAislamiento(`No se pudo preparar el bloqueo de suite: ${error.code ?? error.message}`);
  }
};

// ---------- Registro de lo propio ----------

const esIdValido = (id) => Number.isSafeInteger(id) && id > 0;

class Ejecucion {
  // La conexión dedicada solo se usa desde dentro: desde fuera no se puede enviar ninguna consulta
  #bloqueo;

  constructor({ suite, bloqueo, runId, env = process.env }) {
    this.suite = suite;
    this.#bloqueo = bloqueo;
    this.runId = runId;
    this.env = env; // DB_NAME se vuelve a comprobar antes de cada escritura
    this.propios = { usuarios: new Set(), panaderias: new Set() };
    this.estado = 'activa'; // activa | limpiando | limpia | abortada
    this.motivoAborto = null;
    // Escrituras protegidas: en serie, una detrás de otra
    this.cola = Promise.resolve();
    this.etiquetasUsadas = { usuarios: new Set(), panaderias: new Set(), productos: new Set() };
    // Productos creados con crearProducto. No se registran con registrar(): la limpieza los borra
    // con su panadería; sus id sirven para comprobar, antes de borrar, que siguen en una
    // panadería propia, y para informar de pendientes.
    this.productosPropios = new Set();
    this.rolesVerificados = false;
    // Filas que pueden existir sin estar registradas (resultado del INSERT desconocido): nunca se
    // borran ni se adoptan; se informan para revisarlas a mano
    this.escriturasInciertas = [];
    // Motivo por el que ya no se admiten escrituras, aunque la ejecución siga activa (la limpieza
    // de lo registrado sigue permitida si el bloqueo se confirma)
    this.escriturasDetenidas = null;
  }

  // Vista de solo lectura del estado del bloqueo, sin métodos y congelada. Se calcula en cada
  // lectura: refleja el estado actual, pero un objeto ya leído no cambia después.
  get bloqueo() {
    const b = this.#bloqueo;
    return Object.freeze({ idConexion: b.idConexion, perdido: b.perdido, liberado: b.liberado, motivoPerdida: b.motivoPerdida });
  }

  // Estado final: una ejecución abortada nunca vuelve a ejecutar pruebas, registrar ni limpiar
  abortar(motivo) {
    if (this.estado === 'abortada' || this.estado === 'limpia') return;
    this.estado = 'abortada';
    this.motivoAborto = motivo;
  }

  // Correo único y reconocible para una cuenta temporal de esta ejecución
  correo(etiqueta) {
    if (!/^[a-z0-9]+$/.test(etiqueta)) throw new ErrorAislamiento(`Etiqueta de correo no válida: "${etiqueta}"`);
    return `prueba.${this.suite}.${this.runId}.${etiqueta}@${DOMINIO_CORREO}`;
  }

  // Nombre de panadería u otro registro temporal; siempre contiene el runId
  nombre(texto) {
    return `PRUEBA ${this.runId} ${texto}`;
  }

  // Registra un id creado por esta ejecución. Solo cuentas y panaderías: el resto de filas
  // se alcanza desde ellas por clave foránea.
  registrar(tipo, id) {
    if (this.estado !== 'activa') throw new ErrorAislamiento(`No se puede registrar con la ejecución ${this.estado}`);
    if (!(tipo in this.propios)) throw new ErrorAislamiento(`Tipo no registrable: "${tipo}"`);
    if (!esIdValido(id)) throw new ErrorAislamiento(`id no válido para ${tipo}: ${JSON.stringify(id)}`);
    if (id <= MAX_ID_SEMILLA[tipo]) throw new ErrorAislamiento(`El id ${id} de ${tipo} pertenece a la semilla y no se registra`);
    this.propios[tipo].add(id);
    return id;
  }

  ids(tipo) {
    return [...this.propios[tipo]].sort((a, b) => a - b);
  }

  // ---------- Escrituras protegidas ----------
  // Cuenta temporal con correo marcado y contraseña '!'. Devuelve su id, ya registrado.
  //   rol: 'administrador' (sin panadería) | 'panadero' | 'gerente' (con una panadería propia)
  //   activa: true o false (estricto)
  crearCuenta(opciones) {
    return this.#encolar(() => this.#escribirCuenta(opciones ?? {}));
  }

  // Panadería temporal con nombre marcado, propiedad de una cuenta propia. Devuelve su id, ya registrado.
  crearPanaderia(opciones) {
    return this.#encolar(() => this.#escribirPanaderia(opciones ?? {}));
  }

  // Producto temporal con nombre marcado en una panadería propia. Devuelve su id, ya registrado.
  //   precio: número finito de 0 a 1e9; cantidad: entero de 0 a 1.000.000; activo: true o false
  crearProducto(opciones) {
    return this.#encolar(() => this.#escribirProducto(opciones ?? {}));
  }

  // Las escrituras van en serie: las comprobaciones de una no se intercalan con las de otra
  #encolar(tarea) {
    const resultado = this.cola.then(() => tarea());
    this.cola = resultado.catch(() => {});
    return resultado;
  }

  async #escribirCuenta({ etiqueta, rol, panaderiaId = null, activa }) {
    if (typeof etiqueta !== 'string' || !ETIQUETA_CUENTA.test(etiqueta)) throw new ErrorAislamiento(`Etiqueta de cuenta no válida: ${JSON.stringify(etiqueta)}`);
    if (this.etiquetasUsadas.usuarios.has(etiqueta)) throw new ErrorAislamiento(`La etiqueta de cuenta "${etiqueta}" ya se usó en esta ejecución`);
    if (!Object.prototype.hasOwnProperty.call(ROLES, rol)) throw new ErrorAislamiento(`Rol no válido: ${JSON.stringify(rol)}`);
    if (typeof activa !== 'boolean') throw new ErrorAislamiento('activa debe ser true o false');
    if (rol === 'administrador') {
      if (panaderiaId !== null) throw new ErrorAislamiento('Una cuenta administradora no se asigna a una panadería');
    } else if (!this.propios.panaderias.has(panaderiaId)) {
      throw new ErrorAislamiento(`La panadería ${JSON.stringify(panaderiaId)} no es una panadería registrada por esta ejecución`);
    }
    await this.#comprobarAntesDeEscribir();
    await this.#comprobarRoles();
    const email = this.correo(etiqueta);
    this.etiquetasUsadas.usuarios.add(etiqueta);
    return this.#insertar('usuarios', [email, ROLES[rol], panaderiaId, activa ? 1 : 0], email);
  }

  async #escribirPanaderia({ etiqueta, propietariaId }) {
    if (typeof etiqueta !== 'string' || !ETIQUETA_PANADERIA.test(etiqueta)) throw new ErrorAislamiento(`Etiqueta de panadería no válida: ${JSON.stringify(etiqueta)}`);
    if (this.etiquetasUsadas.panaderias.has(etiqueta)) throw new ErrorAislamiento(`La etiqueta de panadería "${etiqueta}" ya se usó en esta ejecución`);
    if (!this.propios.usuarios.has(propietariaId)) {
      throw new ErrorAislamiento(`La propietaria ${JSON.stringify(propietariaId)} no es una cuenta registrada por esta ejecución`);
    }
    await this.#comprobarAntesDeEscribir();
    const nombre = this.nombre(etiqueta);
    this.etiquetasUsadas.panaderias.add(etiqueta);
    return this.#insertar('panaderias', [nombre, propietariaId], nombre);
  }

  async #escribirProducto({ etiqueta, panaderiaId, precio, cantidad, activo }) {
    if (typeof etiqueta !== 'string' || !ETIQUETA_PRODUCTO.test(etiqueta)) throw new ErrorAislamiento(`Etiqueta de producto no válida: ${JSON.stringify(etiqueta)}`);
    if (this.etiquetasUsadas.productos.has(etiqueta)) throw new ErrorAislamiento(`La etiqueta de producto "${etiqueta}" ya se usó en esta ejecución`);
    if (!this.propios.panaderias.has(panaderiaId)) {
      throw new ErrorAislamiento(`La panadería ${JSON.stringify(panaderiaId)} no es una panadería registrada por esta ejecución`);
    }
    if (typeof precio !== 'number' || !Number.isFinite(precio) || precio < 0 || precio > PRECIO_MAXIMO) {
      throw new ErrorAislamiento(`precio no válido: ${JSON.stringify(precio)} (número de 0 a ${PRECIO_MAXIMO})`);
    }
    if (!Number.isSafeInteger(cantidad) || cantidad < 0 || cantidad > CANTIDAD_MAXIMA) {
      throw new ErrorAislamiento(`cantidad no válida: ${JSON.stringify(cantidad)} (entero de 0 a ${CANTIDAD_MAXIMA})`);
    }
    if (typeof activo !== 'boolean') throw new ErrorAislamiento('activo debe ser true o false');
    await this.#comprobarAntesDeEscribir();
    const nombre = this.nombre(etiqueta);
    this.etiquetasUsadas.productos.add(etiqueta);
    return this.#insertar('productos', [nombre, precio, cantidad, panaderiaId, activo ? 1 : 0], nombre);
  }

  // Antes de CADA escritura, en la conexión dedicada: estado, bloqueo, DB_NAME y base real.
  // Un fallo de bloqueo, configuración o base aborta la ejecución (no se limpiará nada).
  async #comprobarAntesDeEscribir() {
    if (this.estado !== 'activa') throw new ErrorAislamiento(`No se escribe con la ejecución ${this.estado}`);
    if (this.escriturasDetenidas) throw new ErrorAislamiento(`Escrituras detenidas: ${this.escriturasDetenidas}`);
    const fallo = (mensaje) => { this.abortar(mensaje); return new ErrorAislamiento(mensaje); };
    if (this.#bloqueo.perdido || this.#bloqueo.liberado) throw fallo(`Bloqueo de suite no disponible: ${this.#bloqueo.motivoPerdida ?? 'liberado'}`);
    try {
      verificarConfiguracion(this.env);
    } catch (error) {
      throw fallo(error.message);
    }
    try {
      await this.#bloqueo.verificar();
    } catch (error) {
      throw fallo(error.message);
    }
    let base;
    try {
      base = (await this.#bloqueo.consultar('SELECT DATABASE() AS base'))?.[0]?.base;
    } catch (error) {
      throw fallo(`No se pudo comprobar la base antes de escribir (${error.code ?? 'sin código'})`);
    }
    if (base !== BASE) throw fallo(`La conexión dedicada está en "${base}": se esperaba ${BASE}`);
  }

  // Los id de rol de las plantillas deben corresponder a esos nombres en la base. Si no, no se
  // escribe ninguna cuenta (la ejecución sigue activa: no hay nada escrito por esta causa).
  async #comprobarRoles() {
    if (this.rolesVerificados) return;
    let filas;
    try {
      filas = await this.#bloqueo.consultar(`SELECT id, nombre FROM ${tabla('roles')} WHERE id IN (?)`, [Object.values(ROLES)]);
    } catch (error) {
      const mensaje = `No se pudieron comprobar los roles (${error.code ?? 'sin código'})`;
      this.abortar(mensaje);
      throw new ErrorAislamiento(mensaje);
    }
    const leidos = Object.fromEntries((filas ?? []).map(f => [f.nombre, Number(f.id)]));
    if (JSON.stringify(Object.keys(ROLES).map(r => leidos[r])) !== JSON.stringify(Object.values(ROLES))) {
      this.escriturasDetenidas = 'los roles de pansys_test no coinciden con los esperados';
      throw new ErrorAislamiento(`Escrituras detenidas: ${this.escriturasDetenidas}`);
    }
    this.rolesVerificados = true;
  }

  // Envía una plantilla fija y registra el id en cuanto se conoce. Clasifica los fallos:
  //  - rechazado antes de enviarse (bloqueo perdido): ejecución abortada, ninguna fila;
  //  - error SQL definitivo (MySQL respondió con código y la conexión sigue viva): ninguna fila;
  //  - resultado incierto (sin respuesta válida o conexión perdida): la fila puede existir sin
  //    registrar. Se anota en escriturasInciertas; si además se perdió la conexión, se aborta;
  //    si no, se detienen las escrituras. Nunca se reintenta.
  async #insertar(tipo, params, marca) {
    // La plantilla la fija la tabla: no hay forma de enviar otra sentencia por esta vía
    const plantilla = { usuarios: PLANTILLA_CUENTA, panaderias: PLANTILLA_PANADERIA, productos: PLANTILLA_PRODUCTO }[tipo];
    if (!plantilla) throw new ErrorAislamiento(`Tabla no permitida para escribir: ${JSON.stringify(tipo)}`);
    let resultado;
    try {
      resultado = await this.#bloqueo.consultar(plantilla, params);
    } catch (error) {
      if (error instanceof ErrorAislamiento) {
        this.abortar(error.message);
        throw error; // no llegó a enviarse
      }
      const definitivo = Number.isInteger(error?.errno) && typeof error?.sqlState === 'string' && !error?.fatal && !this.#bloqueo.perdido;
      if (definitivo) {
        throw new ErrorAislamiento(`${tipo}: MySQL rechazó la escritura (${error.code ?? error.errno}); no se creó ninguna fila`);
      }
      return this.#registrarIncierta(tipo, marca, `sin respuesta válida (${error?.code ?? 'sin código'})`, Boolean(error?.fatal));
    }
    const id = Number(resultado?.insertId);
    if (resultado?.affectedRows !== 1 || !esIdValido(id) || id <= (MAX_ID_SEMILLA[tipo] ?? 0)) {
      return this.#registrarIncierta(tipo, marca, 'respuesta sin un id válido', false);
    }
    // Registro inmediato, antes de devolver el control (no depende del estado: la escritura ya ocurrió)
    if (tipo === 'productos') this.productosPropios.add(id);
    else this.propios[tipo].add(id);
    return id;
  }

  #registrarIncierta(tipo, marca, detalle, conexionPerdida) {
    this.escriturasInciertas.push({ tabla: tipo, marca });
    const motivo = `escritura de resultado incierto en ${tipo} (${detalle})`;
    if (conexionPerdida || this.#bloqueo.perdido) {
      this.#bloqueo.marcarPerdido('conexión perdida durante una escritura');
      this.abortar(`${motivo} y conexión perdida`);
    } else {
      this.escriturasDetenidas = motivo;
    }
    throw new ErrorAislamiento(`${tipo}: resultado de la escritura incierto (${detalle}). La fila con marca "${marca}" puede existir y NO está registrada: no se reintenta`);
  }

  // Llamar antes de cada bloque de pruebas: detiene la suite si el bloqueo se perdió
  async exigirBloqueo() {
    if (this.estado !== 'activa') throw new ErrorAislamiento(`Ejecución ${this.estado}: no se ejecutan más pruebas`);
    if (this.escriturasDetenidas) throw new ErrorAislamiento(`Escrituras detenidas (${this.escriturasDetenidas}): no se ejecutan más pruebas`);
    try {
      await this.#bloqueo.verificar();
    } catch (error) {
      this.abortar(error.message);
      throw error;
    }
  }

  // Registradas (borrables solo por limpiar()) e inciertas (pueden existir sin registrar: solo
  // revisión manual)
  pendientes() {
    return {
      runId: this.runId,
      usuarios: this.ids('usuarios'),
      panaderias: this.ids('panaderias'),
      productos: [...this.productosPropios].sort((a, b) => a - b),
      escriturasInciertas: this.escriturasInciertas.map(e => ({ ...e }))
    };
  }

  // Limpieza de lo propio. Nunca lanza: devuelve { ok, resultado, motivo, borrados, pendientes }.
  // resultado: 'limpia' | 'no_iniciada' (no se envió ningún DELETE) | 'revertida' (fallo antes
  // del COMMIT: ROLLBACK) | 'desconocido' (fallo durante el COMMIT: hay que comprobar la base).
  // Si no se puede garantizar la seguridad, no empieza o hace ROLLBACK y deja los registros.
  async limpiar() {
    if (this.estado === 'limpiando' || this.estado === 'limpia') {
      return {
        ok: false,
        resultado: 'no_iniciada',
        motivo: `La limpieza ya está ${this.estado === 'limpia' ? 'hecha' : 'en curso'}`,
        borrados: {},
        pendientes: this.pendientes()
      };
    }
    // Barrera 1 (sin consultar a MySQL): una ejecución abortada o con el bloqueo marcado como
    // perdido no limpia, aunque la conexión siga viva o la siguiente verificación respondiera bien.
    // Tampoco se reintenta una limpieza abortada antes: sus registros quedan para revisión.
    if (this.estado === 'abortada' || this.#bloqueo.perdido || this.#bloqueo.liberado) {
      this.abortar(this.#bloqueo.motivoPerdida ?? 'ejecución detenida');
      return {
        ok: false,
        resultado: 'no_iniciada',
        motivo: `Limpieza no iniciada: ${this.motivoAborto ?? this.#bloqueo.motivoPerdida ?? 'ejecución detenida'}. Registros temporales conservados para revisión`,
        borrados: {},
        pendientes: this.pendientes()
      };
    }
    // Desde aquí no se admiten registros ni escrituras nuevas. Se espera a que termine la escritura
    // que estuviera en curso (las que aún no habían empezado se rechazan sin enviarse) y después
    // se toma una copia fija de lo propio.
    this.estado = 'limpiando';
    await this.cola;
    if (this.estado !== 'limpiando' || this.#bloqueo.perdido || this.#bloqueo.liberado) {
      this.abortar(this.motivoAborto ?? this.#bloqueo.motivoPerdida ?? 'ejecución detenida durante una escritura');
      return {
        ok: false,
        resultado: 'no_iniciada',
        motivo: `Limpieza no iniciada: ${this.motivoAborto}. Registros temporales conservados para revisión`,
        borrados: {},
        pendientes: this.pendientes()
      };
    }
    const propios = {
      usuarios: this.ids('usuarios'),
      panaderias: this.ids('panaderias'),
      productos: [...this.productosPropios].sort((a, b) => a - b)
    };
    const borrados = {};
    let transaccionAbierta = false;
    let commitEnviado = false;
    try {
      // Barrera 2: el bloqueo se confirma con MySQL antes de abrir la transacción
      await this.#bloqueo.verificar();
      await this.#bloqueo.consultar('START TRANSACTION');
      transaccionAbierta = true;
      const tablasOpcionales = await this.comprobarAntesDeBorrar(propios);
      for (const paso of this.pasosDeBorrado(tablasOpcionales, propios)) {
        const [{ n }] = await this.#bloqueo.consultar(`SELECT COUNT(*) AS n FROM ${tabla(paso.tabla)} WHERE ${paso.where}`, paso.params);
        const resultado = await this.#bloqueo.consultar(`DELETE FROM ${tabla(paso.tabla)} WHERE ${paso.where}`, paso.params);
        if (resultado.affectedRows !== Number(n)) {
          throw new ErrorAislamiento(`${paso.descripcion}: se esperaban ${n} filas y se borraron ${resultado.affectedRows}`);
        }
        borrados[paso.descripcion] = Number(n);
      }
      // El bloqueo debe seguir siendo nuestro hasta el final
      await this.#bloqueo.verificar();
      commitEnviado = true;
      await this.#bloqueo.consultar('COMMIT');
      transaccionAbierta = false;
      this.estado = 'limpia';
      // Lo registrado está borrado; una escritura incierta puede haber dejado una fila sin
      // registrar: la ejecución NO se da por correcta y la fila se informa para revisarla a mano
      if (this.escriturasInciertas.length) {
        return {
          ok: false,
          resultado: 'limpia',
          motivo: `Se borró todo lo registrado, pero hay ${this.escriturasInciertas.length} escrituras de resultado incierto: ` +
            'sus filas pueden existir sin registrar (las cuentas y panaderías inciertas no se borran; un producto incierto ' +
            'de una panadería propia se borra con ella). Requiere revisión manual (solo lectura)',
          borrados,
          pendientes: { runId: this.runId, usuarios: [], panaderias: [], productos: [], escriturasInciertas: this.escriturasInciertas.map(e => ({ ...e })) }
        };
      }
      return { ok: true, resultado: 'limpia', motivo: null, borrados, pendientes: null };
    } catch (error) {
      if (commitEnviado) {
        // El COMMIT pudo aplicarse o no (p. ej., la conexión cayó antes de la respuesta): no se
        // afirma nada sobre las filas. El ROLLBACK es inocuo en ambos casos y no aclara el resultado.
        await this.#bloqueo.deshacer().catch(() => {});
        this.abortar(`resultado del COMMIT desconocido (${error.message})`);
        return {
          ok: false,
          resultado: 'desconocido',
          motivo: `Resultado de la limpieza desconocido: falló el COMMIT (${error.message}). ` +
            'Requiere verificación: compruebe en pansys_test si las filas de "pendientes" siguen existiendo',
          borrados: {},
          pendientes: this.pendientes()
        };
      }
      // Fallo antes del COMMIT. Si la conexión murió, MySQL deshace la transacción al cerrarla.
      if (transaccionAbierta) await this.#bloqueo.deshacer().catch(() => {});
      this.abortar(error.message);
      return {
        ok: false,
        resultado: transaccionAbierta ? 'revertida' : 'no_iniciada',
        motivo: `${transaccionAbierta ? 'Limpieza abortada con ROLLBACK' : 'Limpieza no iniciada'}: ${error.message}. Registros temporales conservados para revisión`,
        borrados: {},
        pendientes: this.pendientes()
      };
    }
  }

  // Comprobaciones dentro de la transacción, antes del primer DELETE. Devuelve las tablas
  // opcionales que existen. Los FOR UPDATE impiden que, mientras dura la limpieza, otro proceso
  // asocie filas nuevas a nuestras cuentas o panaderías (la clave foránea necesita leer el padre).
  async comprobarAntesDeBorrar({ usuarios, panaderias, productos = [] }) {
    await verificarBaseConectada((sql) => this.#bloqueo.consultar(sql), 'La conexión de limpieza');

    for (const [tipo, ids] of [['usuarios', usuarios], ['panaderias', panaderias]]) {
      if (ids.some(id => !esIdValido(id) || id <= MAX_ID_SEMILLA[tipo])) {
        throw new ErrorAislamiento(`Hay id de la semilla o no válidos entre ${tipo} propios`);
      }
    }

    const marca = `.${this.runId}.`;
    if (usuarios.length) {
      const filas = await this.#bloqueo.consultar(`SELECT id, email FROM ${tabla('usuarios')} WHERE id IN (?) FOR UPDATE`, [usuarios]);
      const ajena = filas.find(f => typeof f.email !== 'string' || !f.email.startsWith(`prueba.${this.suite}${marca}`));
      if (ajena) throw new ErrorAislamiento(`La cuenta ${ajena.id} no tiene la marca de esta ejecución`);
    }
    if (panaderias.length) {
      const filas = await this.#bloqueo.consultar(`SELECT id, nombre, usuario_id FROM ${tabla('panaderias')} WHERE id IN (?) FOR UPDATE`, [panaderias]);
      const ajena = filas.find(f => typeof f.nombre !== 'string' || !f.nombre.startsWith(`PRUEBA ${this.runId} `)
        || !usuarios.includes(f.usuario_id));
      if (ajena) throw new ErrorAislamiento(`La panadería ${ajena.id} no tiene la marca de esta ejecución o su propietaria no es propia`);
    }
    // Productos creados con crearProducto: deben seguir en una panadería propia y con su marca. Se
    // borran con su panadería; si alguno estuviera fuera, no se limpia nada.
    if (productos.length) {
      if (productos.some(id => !esIdValido(id))) throw new ErrorAislamiento('Hay id no válidos entre los productos propios');
      const filas = await this.#bloqueo.consultar(`SELECT id, nombre, panaderia_id FROM ${tabla('productos')} WHERE id IN (?) FOR UPDATE`, [productos]);
      const fuera = filas.find(f => !panaderias.includes(f.panaderia_id) || typeof f.nombre !== 'string' || !f.nombre.startsWith(`PRUEBA ${this.runId} `));
      if (fuera) throw new ErrorAislamiento(`El producto ${fuera.id} no está en una panadería propia o no tiene la marca de esta ejecución`);
    }
    // Se bloquean TODOS los productos de las panaderías propias (también los creados por la API),
    // para que nadie añada detalles de ventas que los referencien durante la limpieza (ver la
    // comprobación de detalles ajenos más abajo). Debe ir ANTES del primer recuento: con REPEATABLE
    // READ, la primera lectura sin bloqueo fija la instantánea de la transacción; si se fijara antes
    // del bloqueo, un detalle confirmado entre ambos no se vería en el recuento y el DELETE (que lee
    // los datos actuales) lo borraría en cascada.
    if (panaderias.length) {
      await this.#bloqueo.consultar(SQL_BLOQUEO_PRODUCTOS, [panaderias]);
    }

    // Dependencias ajenas que la limpieza arrastraría o que la harían fallar a medias. Son lecturas
    // sin bloqueo: la instantánea se fija aquí, con todas las filas propias ya bloqueadas.
    const contar = async (sql, params) => Number((await this.#bloqueo.consultar(sql, params))[0].n);
    if (usuarios.length) {
      // Borrar una cuenta propietaria borra sus panaderías (ON DELETE CASCADE)
      const sql = panaderias.length
        ? `SELECT COUNT(*) AS n FROM ${tabla('panaderias')} WHERE usuario_id IN (?) AND id NOT IN (?)`
        : `SELECT COUNT(*) AS n FROM ${tabla('panaderias')} WHERE usuario_id IN (?)`;
      if (await contar(sql, panaderias.length ? [usuarios, panaderias] : [usuarios])) {
        throw new ErrorAislamiento('Una cuenta propia es propietaria de una panadería ajena');
      }
      const sqlEmpleo = panaderias.length
        ? `SELECT COUNT(*) AS n FROM ${tabla('usuarios')} WHERE id IN (?) AND panaderia_id IS NOT NULL AND panaderia_id NOT IN (?)`
        : `SELECT COUNT(*) AS n FROM ${tabla('usuarios')} WHERE id IN (?) AND panaderia_id IS NOT NULL`;
      if (await contar(sqlEmpleo, panaderias.length ? [usuarios, panaderias] : [usuarios])) {
        throw new ErrorAislamiento('Una cuenta propia está asignada a una panadería ajena');
      }
    }
    if (panaderias.length) {
      const sql = usuarios.length
        ? `SELECT COUNT(*) AS n FROM ${tabla('usuarios')} WHERE panaderia_id IN (?) AND id NOT IN (?)`
        : `SELECT COUNT(*) AS n FROM ${tabla('usuarios')} WHERE panaderia_id IN (?)`;
      if (await contar(sql, usuarios.length ? [panaderias, usuarios] : [panaderias])) {
        throw new ErrorAislamiento('Hay cuentas ajenas asignadas a una panadería propia');
      }
      // detalle_ventas.producto_id es ON DELETE CASCADE: borrar un producto propio borraría en
      // silencio los detalles de ventas ajenas que lo referencien (affectedRows no cuenta la
      // cascada). Con los productos ya bloqueados, se exige que no haya ninguna referencia ajena.
      // venta_id es NOT NULL, así que NOT IN es seguro.
      const detallesAjenos = await contar(SQL_DETALLES_AJENOS, [panaderias, panaderias]);
      if (detallesAjenos) {
        throw new ErrorAislamiento(`Hay ${detallesAjenos} detalles de ventas ajenas que referencian productos propios: el borrado en cascada los eliminaría`);
      }
    }

    const existentes = await this.#bloqueo.consultar(
      'SELECT TABLE_NAME AS tabla FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?)',
      [BASE, TABLAS_OPCIONALES]
    );
    return existentes.map(f => f.tabla ?? f.TABLE_NAME);
  }

  // Orden según las claves foráneas de crear_pansys_test.sql: primero las tablas hijas
  // (RESTRICT), después las cuentas empleadas, las panaderías y por último sus propietarias.
  pasosDeBorrado(tablasOpcionales, { usuarios, panaderias }) {
    const pasos = [];
    const subconsulta = (madre) => `SELECT id FROM ${tabla(madre)} WHERE panaderia_id IN (?)`;
    if (panaderias.length) {
      pasos.push(
        { descripcion: 'insumo_usado', tabla: 'insumo_usado', where: `orden_id IN (${subconsulta('orden_produccion')})`, params: [panaderias] },
        { descripcion: 'orden_produccion', tabla: 'orden_produccion', where: 'panaderia_id IN (?)', params: [panaderias] },
        { descripcion: 'receta_producto', tabla: 'receta_producto', where: `producto_id IN (${subconsulta('productos')})`, params: [panaderias] },
        { descripcion: 'detalle_ventas', tabla: 'detalle_ventas', where: `venta_id IN (${subconsulta('ventas')})`, params: [panaderias] },
        { descripcion: 'ventas', tabla: 'ventas', where: 'panaderia_id IN (?)', params: [panaderias] },
        { descripcion: 'productos', tabla: 'productos', where: 'panaderia_id IN (?)', params: [panaderias] },
        { descripcion: 'materia_prima', tabla: 'materia_prima', where: 'panaderia_id IN (?)', params: [panaderias] }
      );
    }
    if (usuarios.length) {
      if (tablasOpcionales.includes('eventos_seguridad')) {
        pasos.push({ descripcion: 'eventos_seguridad', tabla: 'eventos_seguridad', where: 'usuario_id IN (?) OR actor_id IN (?)', params: [usuarios, usuarios] });
      }
      if (tablasOpcionales.includes('restablecimientos_contrasena')) {
        pasos.push({ descripcion: 'restablecimientos_contrasena', tabla: 'restablecimientos_contrasena', where: 'usuario_id IN (?) OR solicitado_por IN (?)', params: [usuarios, usuarios] });
      }
      pasos.push({ descripcion: 'usuarios (empleados)', tabla: 'usuarios', where: 'id IN (?) AND panaderia_id IS NOT NULL', params: [usuarios] });
    }
    if (panaderias.length) {
      pasos.push({ descripcion: 'panaderias', tabla: 'panaderias', where: 'id IN (?)', params: [panaderias] });
    }
    if (usuarios.length) {
      pasos.push({ descripcion: 'usuarios (propietarias)', tabla: 'usuarios', where: 'id IN (?)', params: [usuarios] });
    }
    return pasos;
  }

  // Libera el bloqueo y cierra la conexión dedicada (al final de la suite, también si falló)
  async cerrar() {
    await this.#bloqueo.liberar();
  }
}

// ---------- Evaluación del resultado de limpiar() ----------

// La única limpieza que permite dar una suite por correcta: todo lo registrado borrado y nada
// pendiente (tampoco escrituras inciertas). Cualquier valor ausente o mal formado es false.
const limpiezaCorrecta = (r) => r !== null && typeof r === 'object' && !Array.isArray(r)
  && r.ok === true && r.resultado === 'limpia' && r.pendientes === null;

// Texto seguro para mostrar: sin pares 'usuario'@'host' ni hashes bcrypt, y con longitud
// limitada (indicada expresamente si se recorta)
const LIMITE_TEXTO = 300;
const textoSeguro = (valor) => {
  const t = String(valor ?? '')
    .replace(/'[^'\n]*'@'[^'\n]*'/g, "'<oculto>'@'<oculto>'")
    .replace(/\$2[aby]\$\d{2}\$[./A-Za-z0-9]{0,53}/g, '<hash oculto>');
  return t.length > LIMITE_TEXTO ? `${t.slice(0, LIMITE_TEXTO)} [RECORTADO: se omiten ${t.length - LIMITE_TEXTO} caracteres]` : t;
};

// Informe para revisión manual (lista de líneas). Es puro: no consulta nada ni modifica r.
const describirPendientes = (r) => {
  if (limpiezaCorrecta(r)) return ['Limpieza correcta: no queda ninguna fila pendiente.'];
  const objeto = r !== null && typeof r === 'object' && !Array.isArray(r);
  const p = objeto && r.pendientes !== null && typeof r.pendientes === 'object' ? r.pendientes : {};
  const resultado = objeto && typeof r.resultado === 'string' ? r.resultado : 'sin resultado';
  const runId = typeof p.runId === 'string' && /^[0-9a-f]{16}$/.test(p.runId) ? p.runId : '(no disponible)';
  const listaIds = (ids) => (Array.isArray(ids) && ids.every(esIdValido)
    ? (ids.length ? ids.join(', ') : 'ninguno')
    : '(no disponible o mal formado: revise también por runId)');
  const inciertas = Array.isArray(p.escriturasInciertas) ? p.escriturasInciertas : [];
  const lineas = [
    `Limpieza NO correcta (resultado: ${textoSeguro(resultado)}).`,
    `Motivo: ${objeto && r.motivo ? textoSeguro(r.motivo) : 'no informado'}`
  ];
  if (resultado === 'desconocido') {
    lineas.push('Falló el COMMIT: no se sabe si las filas registradas se borraron. No se afirma nada sobre ellas.');
  }
  lineas.push(
    `runId: ${runId}`,
    `Cuentas registradas (id): ${listaIds(p.usuarios)}`,
    `Panaderías registradas (id): ${listaIds(p.panaderias)}`
  );
  // Productos de crearProducto (se borran con su panadería); solo si el resultado los incluye
  if (p.productos !== undefined) lineas.push(`Productos registrados (id): ${listaIds(p.productos)}`);
  if (inciertas.length) {
    lineas.push('Escrituras de resultado incierto (pueden existir sin registrar; nunca se borran automáticamente):');
    for (const e of inciertas) {
      const tablaValida = e && (e.tabla === 'usuarios' || e.tabla === 'panaderias' || e.tabla === 'productos');
      lineas.push(tablaValida && typeof e.marca === 'string'
        ? `  ${e.tabla}: ${textoSeguro(e.marca)}`
        : '  (entrada mal formada: revise por runId)');
    }
  } else if (!Array.isArray(p.escriturasInciertas)) {
    lineas.push('Escrituras de resultado incierto: (no disponible)');
  }
  lineas.push('No se reintenta la limpieza ni se borra nada por otra vía. Revisión manual en solo lectura en pansys_test.');
  return lineas;
};

// Punto de entrada para las suites. Comprueba DB_NAME, la conexión dedicada y, si se pasa,
// la conexión de Sequelize de la suite; toma el bloqueo. Lanza ErrorAislamiento si algo falla:
// en ese caso la suite debe terminar sin escribir.
const iniciarEjecucion = async ({ suite, env = process.env, crearConexion, sequelize, generarRunId } = {}) => {
  if (typeof suite !== 'string' || !/^[a-z]+$/.test(suite)) {
    throw new ErrorAislamiento(`Nombre de suite no válido: "${suite}"`);
  }
  verificarConfiguracion(env);
  const bloqueo = await abrirBloqueo({ env, crearConexion });
  try {
    if (sequelize) {
      await verificarBaseConectada(async (sql) => (await sequelize.query(sql))[0], 'La conexión de Sequelize');
    }
    const runId = (generarRunId ?? (() => crypto.randomBytes(8).toString('hex')))();
    if (!/^[0-9a-f]{16}$/.test(runId)) throw new ErrorAislamiento('runId no válido');
    return new Ejecucion({ suite, bloqueo, runId, env });
  } catch (error) {
    await bloqueo.liberar().catch(() => {});
    throw error;
  }
};

module.exports = {
  BASE,
  NOMBRE_BLOQUEO,
  MAX_ID_SEMILLA,
  ROLES,
  PLANTILLA_CUENTA,
  PLANTILLA_PANADERIA,
  PLANTILLA_PRODUCTO,
  SQL_BLOQUEO_PRODUCTOS,
  SQL_DETALLES_AJENOS,
  ErrorAislamiento,
  verificarConfiguracion,
  abrirBloqueo,
  iniciarEjecucion,
  Ejecucion,
  limpiezaCorrecta,
  describirPendientes
};
