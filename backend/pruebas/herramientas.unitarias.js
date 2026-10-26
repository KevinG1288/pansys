// Pruebas unitarias de las herramientas de verificación: pruebas/foto_pansys_test.js y
// pruebas/aislamiento.mysql.js. No usan MySQL: las conexiones son dobles en memoria, y las
// barreras de entrada se prueban en procesos hijo donde toda carga de módulos no nativos y toda
// conexión de red están bloqueadas. Estas pruebas NO validan las hipótesis V1-V10: solo la lógica
// de los scripts frente a dobles que reproducen lo que se espera de MySQL.
//
// Uso (desde backend/):  node pruebas/herramientas.unitarias.js
//
// Este mismo archivo, cargado con --require y PANSYS_ARNES_PRECARGA=1, hace de arnés en los
// procesos hijo: registra cada require, bloquea los módulos no nativos y bloquea la red.

if (process.env.PANSYS_ARNES_PRECARGA === '1') {
  const Module = require('module');
  const net = require('net');
  const tls = require('tls');
  const marca = (texto) => process.stderr.write(`\n<<${texto}>>\n`);
  const bloquear = (nombre) => function () { marca(`RED:${nombre}`); throw new Error('red bloqueada'); };
  net.connect = net.createConnection = bloquear('net.connect');
  net.Socket.prototype.connect = bloquear('Socket.connect');
  tls.connect = bloquear('tls.connect');
  const original = Module.prototype.require;
  Module.prototype.require = function (id) {
    const nativo = Module.isBuiltin(id);
    marca(`${nativo ? 'NATIVO' : 'REQUIRE'}:${id}`);
    if (!nativo) throw new Error(`carga bloqueada: ${id}`);
    return original.apply(this, arguments);
  };
} else {
  ejecutarPruebas();
}

function ejecutarPruebas() {
  // Seguridad: si algo escapara a los dobles, apuntaría a un host que no existe
  process.env.DB_HOST = 'base-inexistente.invalid';

  const fs = require('fs');
  const path = require('path');
  const crypto = require('crypto');
  const EventEmitter = require('events');
  const { spawnSync } = require('child_process');
  const foto = require('./foto_pansys_test');
  const herramienta = require('./aislamiento.mysql');
  const { ErrorAislamiento } = require('./aislamiento');

  const RAIZ = path.resolve(__dirname, '..', '..');
  const resultados = [];
  const igual = (descripcion, real, esperado) => {
    const ok = JSON.stringify(real) === JSON.stringify(esperado);
    resultados.push(ok);
    console.log(`${ok ? 'OK   ' : 'FALLA'} ${descripcion}${ok ? '' : ` -> obtenido ${JSON.stringify(real)}, esperado ${JSON.stringify(esperado)}`}`);
  };
  const falla = async (fn) => {
    try { await fn(); return null; } catch (error) { return error; }
  };
  const copiar = (valor) => JSON.parse(JSON.stringify(valor));

  // ---------- Doble de pansys_test para la foto ----------
  const HASH_DEMO = '$2b$10$hashdedemoquenuncadebesalirdelabase0000000000000000000';
  const col = (columna, tipo = 'int', nulable = 'NO') => ({ columna, tipo, nulable });
  const baseDoble = () => {
    const esquema = {
      roles: [col('id'), col('nombre', 'varchar(255)')],
      usuarios: [col('id'), col('email', 'varchar(255)'), col('contrasena', 'varchar(255)'), col('rol_id'),
        col('panaderia_id', 'int', 'YES'), col('estado', 'tinyint(1)', 'YES'), col('version_sesion', 'int unsigned')],
      panaderias: [col('id'), col('nombre', 'varchar(255)'), col('direccion', 'varchar(255)'), col('telefono', 'varchar(255)', 'YES'),
        col('en_red', 'tinyint(1)', 'YES'), col('usuario_id')],
      materia_prima: [col('id'), col('nombre', 'varchar(255)'), col('panaderia_id')],
      productos: [col('id'), col('nombre', 'varchar(255)'), col('precio_venta', 'float'), col('panaderia_id')],
      ventas: [col('id'), col('panaderia_id')],
      detalle_ventas: [col('id'), col('venta_id'), col('producto_id')],
      receta_producto: [col('id'), col('producto_id'), col('materia_prima_id')],
      orden_produccion: [col('id'), col('panaderia_id')],
      insumo_usado: [col('id'), col('orden_id')]
    };
    const tablas = {
      roles: [{ id: 1, nombre: 'administrador' }, { id: 2, nombre: 'panadero' }, { id: 3, nombre: 'gerente' }],
      usuarios: [
        { id: 1, email: 'admin@pansys.test', contrasena: '!', rol_id: 1, panaderia_id: null, estado: 1, version_sesion: 0 },
        { id: 2, email: 'panadero1@pansys.test', contrasena: '!', rol_id: 2, panaderia_id: 1, estado: 1, version_sesion: 0 },
        { id: 3, email: 'panadero2@pansys.test', contrasena: '!', rol_id: 2, panaderia_id: 2, estado: 1, version_sesion: 0 },
        { id: 4, email: 'gerente1@pansys.test', contrasena: HASH_DEMO, rol_id: 3, panaderia_id: 1, estado: 1, version_sesion: 2 }
      ],
      panaderias: [
        { id: 1, nombre: 'Panadería Prueba Uno', direccion: 'Dirección 1', telefono: null, en_red: 1, usuario_id: 1 },
        { id: 2, nombre: 'Panadería Prueba Dos', direccion: 'Dirección 2', telefono: null, en_red: 1, usuario_id: 1 }
      ],
      materia_prima: [{ id: 1, nombre: 'Harina demo', panaderia_id: 1 }],
      productos: [{ id: 1, nombre: 'Pan demo', precio_venta: 500, panaderia_id: 1 }, { id: 2, nombre: 'Torta demo', precio_venta: 2000, panaderia_id: 1 }],
      ventas: [{ id: 1, panaderia_id: 1 }],
      detalle_ventas: [{ id: 1, venta_id: 1, producto_id: 1 }],
      receta_producto: [{ id: 1, producto_id: 1, materia_prima_id: 1 }],
      orden_produccion: [{ id: 1, panaderia_id: 1 }],
      insumo_usado: [{ id: 1, orden_id: 1 }]
    };
    return { esquema, tablas };
  };

  // CRC de cada fila simulado con SHA-256 (el doble no reproduce CRC32 de MySQL; solo la idea)
  const crcFila = (db, t, fila) => parseInt(crypto.createHash('sha256')
    .update(db.esquema[t].map(c => (fila[c.columna] === null || fila[c.columna] === undefined ? '<NULL>' : String(fila[c.columna]))).join('\x1f'))
    .digest('hex').slice(0, 8), 16);

  const conexionFoto = (db, { base = 'pansys_test', fallarEn = null } = {}) => {
    const c = new EventEmitter();
    c.registro = [];
    c.cerrada = false;
    c.end = async () => { c.cerrada = true; };
    c.query = async (sql, params = []) => {
      const s = sql.replace(/\s+/g, ' ').trim();
      c.registro.push(s);
      if (c.cerrada) throw Object.assign(new Error('cerrada'), { code: 'PROTOCOL_ENQUEUE_AFTER_QUIT' });
      if (fallarEn && fallarEn.test(s)) throw Object.assign(new Error('fallo con datos sensibles: usuario raiz'), { code: 'ER_SIMULADO' });
      if (s === 'SET SESSION TRANSACTION READ ONLY' || s === 'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY' || s === 'ROLLBACK') return [{}];
      if (s === 'SELECT DATABASE() AS base') return [[{ base }]];
      if (s === 'SELECT TABLE_NAME AS tabla FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (?)') {
        return [params[1].filter(t => db.tablas[t]).map(tabla => ({ tabla }))];
      }
      if (s.startsWith('SELECT TABLE_NAME AS tabla, COLUMN_NAME AS columna')) {
        return [params[1].flatMap(t => (db.esquema[t] ?? []).map(x => ({ tabla: t, ...x })))];
      }
      let m;
      if ((m = s.match(/^SELECT COUNT\(\*\) AS filas, MIN\(id\) AS id_min, MAX\(id\) AS id_max, BIT_XOR\(CRC32\(.+\)\) AS xor_crc, SUM\(CRC32\(.+\)\) AS suma_crc FROM pansys_test\.`(\w+)`$/))) {
        const filas = db.tablas[m[1]];
        const crcs = filas.map(f => crcFila(db, m[1], f));
        return [[{
          filas: String(filas.length),
          id_min: filas.length ? String(Math.min(...filas.map(f => f.id))) : null,
          id_max: filas.length ? String(Math.max(...filas.map(f => f.id))) : null,
          xor_crc: String(crcs.reduce((a, b) => (a ^ b) >>> 0, 0)),
          suma_crc: filas.length ? String(crcs.reduce((a, b) => a + BigInt(b), 0n)) : null
        }]];
      }
      if (s.startsWith("SELECT id, email, rol_id, panaderia_id, estado, version_sesion, (contrasena = '!') AS contrasena_es_semilla FROM pansys_test.usuarios WHERE id IN (1, 2, 3, 4)")) {
        return [db.tablas.usuarios.filter(u => u.id <= 4).map(({ contrasena, ...u }) => ({ ...u, contrasena_es_semilla: contrasena === '!' ? 1 : 0 }))];
      }
      if (s.startsWith('SELECT id, nombre, direccion, telefono, en_red, usuario_id FROM pansys_test.panaderias WHERE id IN (1, 2)')) {
        return [db.tablas.panaderias.filter(p => p.id <= 2)];
      }
      if ((m = s.match(/^CHECKSUM TABLE (.+)$/))) {
        return [m[1].split(', ').map(x => x.match(/^pansys_test\.`(\w+)`$/)[1]).map(t => ({
          Table: `pansys_test.${t}`,
          Checksum: String(parseInt(crypto.createHash('sha256').update(JSON.stringify(db.tablas[t])).digest('hex').slice(0, 12), 16))
        }))];
      }
      throw new Error(`SQL no previsto por el doble de la foto: ${s}`);
    };
    return c;
  };
  const ENV_FOTO = { DB_NAME: 'pansys_test', DB_HOST: 'base-inexistente.invalid', DB_USER: 'usuario-doble', DB_PASSWORD: 'secreto-doble-123' };
  const fotoDe = async (db, opciones = {}) => {
    const conexion = conexionFoto(db, opciones);
    const resultado = await foto.tomarFoto({ env: ENV_FOTO, crearConexion: async () => conexion });
    return { resultado, conexion };
  };

  // ---------- Arnés de procesos hijo ----------
  const ejecutarAislado = (archivo, args, envExtra = {}) => spawnSync(process.execPath, ['--require', __filename, archivo, ...args], {
    encoding: 'utf8',
    timeout: 15000,
    cwd: path.join(__dirname, '..'),
    // Entorno mínimo: sin credenciales y con un host inexistente
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, PANSYS_ARNES_PRECARGA: '1', DB_HOST: 'base-inexistente.invalid', ...envExtra }
  });
  const marcas = (r, tipo) => (r.stderr.match(new RegExp(`<<${tipo}:[^>]*>>`, 'g')) ?? []);

  const main = async () => {
    // ================= Foto =================
    console.log('\n== Foto: solo lectura y base correcta');
    {
      let llamadas = 0;
      const error = await falla(() => foto.tomarFoto({ env: { ...ENV_FOTO, DB_NAME: 'pansys_db' }, crearConexion: async () => { llamadas++; } }));
      igual('DB_NAME distinto de pansys_test -> ErrorFoto sin abrir conexión', [error instanceof foto.ErrorFoto, llamadas], [true, 0]);
    }
    {
      const conexion = conexionFoto(baseDoble(), { base: 'otra_base' });
      const error = await falla(() => foto.tomarFoto({ env: ENV_FOTO, crearConexion: async () => conexion }));
      igual('SELECT DATABASE() distinto -> ErrorFoto, sin leer datos, con ROLLBACK y conexión cerrada',
        [error instanceof foto.ErrorFoto, conexion.registro, conexion.cerrada],
        [true, ['SET SESSION TRANSACTION READ ONLY', 'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY', 'SELECT DATABASE() AS base', 'ROLLBACK'], true]);
    }
    {
      const error = await falla(() => foto.tomarFoto({ env: ENV_FOTO, crearConexion: async () => { throw Object.assign(new Error("Access denied for user 'usuario-doble'"), { code: 'ER_ACCESS_DENIED_ERROR' }); } }));
      igual('fallo al conectar -> solo el código, sin usuario ni mensaje de mysql2',
        [error instanceof foto.ErrorFoto, /ER_ACCESS_DENIED_ERROR/.test(error?.message), /usuario-doble|Access denied/.test(error?.message)], [true, true, false]);
    }
    {
      const db = baseDoble();
      delete db.tablas.ventas;
      const error = await falla(() => fotoDe(db));
      igual('falta una tabla obligatoria -> ErrorFoto', [error instanceof foto.ErrorFoto, /ventas/.test(error?.message)], [true, true]);
    }
    {
      const conexion = conexionFoto(baseDoble(), { fallarEn: /^CHECKSUM TABLE/ });
      const error = await falla(() => foto.tomarFoto({ env: ENV_FOTO, crearConexion: async () => conexion }));
      igual('fallo a mitad -> ErrorFoto solo con el código, ROLLBACK y conexión cerrada',
        [error instanceof foto.ErrorFoto, /ER_SIMULADO/.test(error?.message), /usuario raiz/.test(error?.message), conexion.registro.at(-1), conexion.cerrada],
        [true, true, false, 'ROLLBACK', true]);
    }
    {
      const { resultado: f, conexion } = await fotoDe(baseDoble());
      const sentencias = conexion.registro;
      const PERMITIDAS = /^(SET SESSION TRANSACTION READ ONLY|START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY|ROLLBACK|SELECT .+|CHECKSUM TABLE .+)$/;
      igual('solo sentencias permitidas (SET/START READ ONLY, SELECT, CHECKSUM TABLE, ROLLBACK)', sentencias.every(s => PERMITIDAS.test(s)), true);
      igual('ninguna sentencia de escritura ni de cambio de configuración',
        sentencias.some(s => /\b(INSERT|UPDATE|DELETE|REPLACE|ALTER|DROP|CREATE|TRUNCATE|GRANT|RENAME|LOCK)\b/.test(s) || (/^SET /.test(s) && s !== 'SET SESSION TRANSACTION READ ONLY')), false);
      igual('primero la sesión y la transacción READ ONLY, al final ROLLBACK',
        [sentencias[0], sentencias[1], sentencias.at(-1)], ['SET SESSION TRANSACTION READ ONLY', 'START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY', 'ROLLBACK']);
      const lecturas = sentencias.filter(s => /\bFROM\b/.test(s));
      igual('toda tabla leída es pansys_test.<tabla> o information_schema',
        lecturas.every(s => [...s.matchAll(/\bFROM\s+([^\s,]+)/g)].every(([, t]) => /^(pansys_test\.|information_schema\.)/.test(t))), true);
      const iChecksum = sentencias.findIndex(s => s.startsWith('CHECKSUM TABLE'));
      const iUltimaLectura = sentencias.reduce((u, s, i) => (/FROM pansys_test\./.test(s) ? i : u), -1);
      igual('CHECKSUM TABLE va después de todas las lecturas de la instantánea', iChecksum > iUltimaLectura, true);
      igual('la contraseña solo se usa dentro de CRC32 o en la comparación con la semilla',
        sentencias.filter(s => s.includes('contrasena')).every(s => /^SELECT COUNT\(\*\) AS filas/.test(s) || s.includes("(contrasena = '!') AS contrasena_es_semilla")), true);
      igual('la foto contiene las 10 tablas, con sus recuentos', Object.fromEntries(Object.entries(f.tablas).map(([t, d]) => [t, d.filas])), {
        roles: 3, usuarios: 4, panaderias: 2, materia_prima: 1, productos: 2, ventas: 1, detalle_ventas: 1, receta_producto: 1, orden_produccion: 1, insumo_usado: 1
      });
      igual('cuentas 1-4: datos no sensibles e indicador de contraseña de la semilla', f.usuarios_semilla.map(u => [u.id, u.version_sesion, u.contrasena_es_semilla]),
        [[1, 0, true], [2, 0, true], [3, 0, true], [4, 2, false]]);
      const json = JSON.stringify(f);
      igual('la foto no contiene hashes, campos de contraseña ni valores del entorno',
        [json.includes('$2b$'), /"contrasena"/.test(json), json.includes(ENV_FOTO.DB_PASSWORD), json.includes(ENV_FOTO.DB_USER)], [false, false, false, false]);
      igual('las tablas opcionales ausentes se registran como ausentes', f.opcionales, { eventos_seguridad: false, restablecimientos_contrasena: false });
    }
    {
      const db = baseDoble();
      db.esquema.eventos_seguridad = [col('id'), col('usuario_id')];
      db.tablas.eventos_seguridad = [{ id: 1, usuario_id: 1 }];
      const { resultado: f } = await fotoDe(db);
      igual('con las tablas del SQL 005 presentes, se incluyen en la foto', [f.opcionales.eventos_seguridad, f.tablas.eventos_seguridad?.filas], [true, 1]);
    }

    console.log('\n== Foto: comparación');
    {
      const { resultado: antes } = await fotoDe(baseDoble());
      const variante = async (cambiar) => {
        const db = baseDoble();
        cambiar(db);
        return (await fotoDe(db)).resultado;
      };
      const despuesIgual = { ...(await variante(() => {})), tomada_en: '2099-01-01T00:00:00.000Z' };
      igual('mismos datos (con otra hora de captura) -> sin diferencias', foto.compararFotos(antes, despuesIgual), { sinDiferencias: true, diferencias: [] });
      const casos = [
        ['cambia el precio de un producto ajeno', (db) => { db.tablas.productos[1].precio_venta = 2100; }, /productos: (xor_crc|suma_crc|checksum)/],
        ['se añade una fila', (db) => { db.tablas.ventas.push({ id: 2, panaderia_id: 1 }); }, /ventas: filas 1 -> 2/],
        ['se borra una fila', (db) => { db.tablas.productos.pop(); }, /productos: filas 2 -> 1/],
        ['cambia un valor a NULL', (db) => { db.tablas.usuarios[1].panaderia_id = null; }, /cuenta 2: panaderia_id cambió/],
        ['cambia el correo de una cuenta semilla', (db) => { db.tablas.usuarios[1].email = 'otro@pansys.test'; }, /cuenta 2: email cambió/],
        ['la contraseña de la semilla deja de ser "!"', (db) => { db.tablas.usuarios[0].contrasena = HASH_DEMO; }, /cuenta 1: contrasena_es_semilla cambió/],
        ['cambia la contraseña de demo (hash por otro hash)', (db) => { db.tablas.usuarios[3].contrasena = `${HASH_DEMO}x`; }, /usuarios: (xor_crc|suma_crc|checksum)/],
        ['cambia la versión de sesión', (db) => { db.tablas.usuarios[3].version_sesion = 3; }, /cuenta 4: version_sesion cambió/],
        ['cambia una panadería semilla', (db) => { db.tablas.panaderias[0].direccion = 'Otra'; }, /panadería 1: direccion cambió/],
        ['cambia el esquema', (db) => { db.esquema.ventas.push(col('nueva')); db.tablas.ventas[0].nueva = 1; }, /ventas: cambió el esquema/],
        ['aparece una tabla del SQL 005', (db) => { db.esquema.eventos_seguridad = [col('id')]; db.tablas.eventos_seguridad = []; }, /SQL 005/]
      ];
      for (const [descripcion, cambiar, patron] of casos) {
        const r = foto.compararFotos(antes, await variante(cambiar));
        igual(`detecta: ${descripcion}`, [r.sinDiferencias, r.diferencias.some(d => patron.test(d))], [false, true]);
      }
      const demo = foto.compararFotos(antes, await variante((db) => { db.tablas.usuarios[3].contrasena = `${HASH_DEMO}x`; }));
      igual('el cambio de contraseña de demo se detecta sin que ningún hash aparezca en las diferencias', demo.diferencias.join(' ').includes('$2b$'), false);
      for (const [descripcion, invalida] of [['nula', null], ['de otra versión', { ...antes, version: 2 }], ['de otra base', { ...antes, base: 'otra' }]]) {
        igual(`una foto ${descripcion} nunca se da por igual`, foto.compararFotos(antes, invalida).sinDiferencias, false);
      }
    }

    console.log('\n== Foto: archivo de salida');
    {
      igual('una ruta dentro del repositorio se rechaza', (await falla(() => foto.validarRutaSalida(path.join(RAIZ, 'backend', 'foto.json')))) instanceof foto.ErrorFoto, true);
      igual('la raíz del repositorio se rechaza', (await falla(() => foto.validarRutaSalida(RAIZ))) instanceof foto.ErrorFoto, true);
      igual('una ruta con ".." que vuelve al repositorio se rechaza',
        (await falla(() => foto.validarRutaSalida(path.join(RAIZ, '..', path.basename(RAIZ), 'x.json')))) instanceof foto.ErrorFoto, true);
      const fuera = path.join(path.dirname(RAIZ), 'foto_prueba_unitaria_no_se_escribe.json');
      igual('una ruta fuera del repositorio se acepta', foto.validarRutaSalida(fuera), fuera);
      // Sin escribir en disco: se sustituye fs.writeFileSync
      const original = fs.writeFileSync;
      const escritos = [];
      try {
        fs.writeFileSync = (ruta, contenido, opciones) => { escritos.push({ ruta, contenido, opciones }); };
        const { resultado: f } = await fotoDe(baseDoble());
        foto.guardarFoto(f, fuera);
        igual('guardar usa la bandera "wx" (nunca sobrescribe) y no escribe hashes',
          [escritos.length, escritos[0]?.opciones?.flag, escritos[0]?.contenido.includes('$2b$')], [1, 'wx', false]);
        fs.writeFileSync = () => { throw Object.assign(new Error('existe'), { code: 'EEXIST' }); };
        const error = await falla(() => foto.guardarFoto(f, fuera));
        igual('si el archivo ya existe -> ErrorFoto "ya existe"', [error instanceof foto.ErrorFoto, /ya existe/.test(error?.message)], [true, true]);
        fs.writeFileSync = (...args) => { escritos.push(args); };
        const dentro = await falla(() => foto.guardarFoto(f, path.join(RAIZ, 'foto.json')));
        igual('guardar dentro del repositorio se rechaza antes de escribir', [dentro instanceof foto.ErrorFoto, escritos.length], [true, 1]);
      } finally {
        fs.writeFileSync = original;
      }
      igual('el archivo de prueba no existe en disco', fs.existsSync(fuera), false);
    }

    console.log('\n== Foto: barreras de la línea de órdenes (proceso aislado, sin módulos externos ni red)');
    {
      const archivo = path.join(__dirname, 'foto_pansys_test.js');
      const fuera = path.join(path.dirname(RAIZ), 'foto_cli_prueba_no_se_escribe.json');
      const sinBase = ejecutarAislado(archivo, ['--guardar', fuera]);
      igual('--guardar sin DB_NAME -> cancelada, sin cargar módulos externos ni usar la red',
        [sinBase.status, /Foto cancelada: DB_NAME/.test(sinBase.stderr), marcas(sinBase, 'REQUIRE'), marcas(sinBase, 'RED')], [1, true, [], []]);
      const otraBase = ejecutarAislado(archivo, ['--guardar', fuera], { DB_NAME: 'pansys_db' });
      igual('--guardar con DB_NAME=pansys_db -> cancelada sin cargar módulos externos', [otraBase.status, marcas(otraBase, 'REQUIRE')], [1, []]);
      const dentro = ejecutarAislado(archivo, ['--guardar', path.join(RAIZ, 'foto.json')], { DB_NAME: 'pansys_test' });
      igual('--guardar dentro del repositorio -> cancelada antes de cargar dotenv',
        [dentro.status, /fuera del repositorio/.test(dentro.stderr), marcas(dentro, 'REQUIRE')], [1, true, []]);
      const uso = ejecutarAislado(archivo, []);
      igual('sin argumentos -> uso (código 2), sin cargar módulos externos', [uso.status, marcas(uso, 'REQUIRE')], [2, []]);
      const control = ejecutarAislado(archivo, ['--guardar', fuera], { DB_NAME: 'pansys_test' });
      igual('control: con DB_NAME correcto pasa las barreras y el arnés bloquea la carga de dotenv',
        [marcas(control, 'REQUIRE').includes('<<REQUIRE:dotenv>>'), marcas(control, 'RED'), control.status !== 0, fs.existsSync(fuera)], [true, [], true, false]);
    }

    // ================= aislamiento.mysql.js =================
    console.log('\n== aislamiento.mysql.js: barreras (proceso aislado, sin módulos ni red)');
    {
      const archivo = path.join(__dirname, 'aislamiento.mysql.js');
      const casos = [
        ['sin --confirmar-pansys-test', [], { DB_NAME: 'pansys_test' }, /falta el argumento --confirmar-pansys-test/],
        ['DB_NAME=pansys_db', ['--confirmar-pansys-test'], { DB_NAME: 'pansys_db' }, /DB_NAME debe fijarse/],
        ['DB_NAME ausente', ['--confirmar-pansys-test'], {}, /DB_NAME debe fijarse/],
        ['DB_NAME con espacios', ['--confirmar-pansys-test'], { DB_NAME: ' pansys_test' }, /DB_NAME debe fijarse/],
        ['DB_NAME en mayúsculas', ['--confirmar-pansys-test'], { DB_NAME: 'PANSYS_TEST' }, /DB_NAME debe fijarse/]
      ];
      for (const [descripcion, args, env, patron] of casos) {
        const r = ejecutarAislado(archivo, args, env);
        igual(`${descripcion} -> cancelada sin cargar ningún módulo (ni nativo) ni usar la red`,
          [r.status, patron.test(r.stderr), marcas(r, 'REQUIRE'), marcas(r, 'NATIVO'), marcas(r, 'RED'), r.stdout], [1, true, [], [], [], '']);
      }
      const control = ejecutarAislado(archivo, ['--confirmar-pansys-test'], { DB_NAME: 'pansys_test' });
      igual('control: con ambas barreras superadas, el arnés bloquea la primera carga externa y no hay red',
        [marcas(control, 'REQUIRE').length > 0, marcas(control, 'RED'), control.status !== 0], [true, [], true]);
    }

    console.log('\n== aislamiento.mysql.js: revisión estática');
    {
      const codigo = fs.readFileSync(path.join(__dirname, 'aislamiento.mysql.js'), 'utf8');
      const lineas = codigo.split(/\r?\n/);
      const instrucciones = lineas.map((l, i) => ({ l, n: i + 1 })).filter(x => x.l.trim() && !x.l.trim().startsWith('//'));
      igual('la primera instrucción es la barrera (if (require.main === module) {)', instrucciones[0].l, 'if (require.main === module) {');
      const finBarrera = lineas.findIndex((l, i) => i > instrucciones[0].n - 1 && l === '}') + 1;
      const primerRequire = lineas.findIndex(l => /require\((?!\.main)/.test(l) && !l.trim().startsWith('//')) + 1;
      igual('ningún require antes de terminar la barrera', primerRequire > finBarrera, true);
      // Las palabras prohibidas se buscan en todo el archivo, comentarios incluidos
      igual('sin DELETE, TRUNCATE, LIKE ni referencias a la base de producción (ni en comentarios)',
        [/\bDELETE\b/i.test(codigo), /\bTRUNCATE\b/i.test(codigo), /\bLIKE\b/i.test(codigo), /pansys_db/i.test(codigo)], [false, false, false, false]);
      // El resto, solo en el código (sin líneas de comentario)
      const sinComentarios = lineas.filter(l => !l.trim().startsWith('//')).join('\n');
      igual('una sola llamada a limpiar() en el código (no hay ruta de reintento)', (sinComentarios.match(/\.limpiar\(/g) ?? []).length, 1);
      igual('la conexión fija database: \'pansys_test\' y ninguna otra base',
        [(sinComentarios.match(/database:\s*'pansys_test'/g) ?? []).length, (sinComentarios.match(/database:/g) ?? []).length], [1, 1]);
      // Solo las cadenas que son sentencias SQL (no los textos descriptivos del informe)
      const cadenas = [...sinComentarios.matchAll(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g)]
        .map(m => m[0].slice(1, -1))
        .filter(c => /^(SELECT|INSERT|UPDATE|DELETE|REPLACE)\b/.test(c));
      const destinos = cadenas.flatMap(c => [...c.matchAll(/\b(?:FROM|INTO|UPDATE|JOIN)\s+([A-Za-z_][\w.]*)/g)].map(m => m[1]));
      igual('hay sentencias SQL que revisar', destinos.length > 10, true);
      igual('toda tabla de las sentencias SQL es pansys_test.<tabla> o information_schema.TABLES (lista de excepciones vacía)',
        destinos.filter(t => !t.startsWith('pansys_test.') && t !== 'information_schema.TABLES'), []);
    }

    console.log('\n== aislamiento.mysql.js: conexiones y escrituras (dobles)');
    const conexionSimple = (base = 'pansys_test') => {
      const c = new EventEmitter();
      c.registro = [];
      c.cerrada = false;
      c.base = base;
      c.end = async () => { c.cerrada = true; };
      c.query = async (sql) => {
        c.registro.push(sql);
        if (sql === 'SELECT DATABASE() AS base') return [[{ base: c.base }]];
        return [{ insertId: 1, affectedRows: 1 }];
      };
      return c;
    };
    {
      const c = conexionSimple('otra_base');
      const error = await falla(() => herramienta.abrirConexion(async () => c, { DB_NAME: 'pansys_test' }, 'datos'));
      igual('abrirConexion con otra base -> error, sin más consultas y conexión cerrada',
        [error instanceof herramienta.ErrorVerificacion, c.registro, c.cerrada], [true, ['SELECT DATABASE() AS base'], true]);
      const sinConexion = await falla(() => herramienta.abrirConexion(async () => { throw Object.assign(new Error("Access denied for user 'x'"), { code: 'ER_ACCESS_DENIED_ERROR' }); }, {}, 'datos'));
      igual('fallo al conectar -> solo el código', [/ER_ACCESS_DENIED_ERROR/.test(sinConexion?.message), /Access denied/.test(sinConexion?.message)], [true, false]);
    }
    for (const [descripcion, sql] of [
      ['tabla sin base explícita', 'INSERT INTO usuarios (email) VALUES (?)'],
      ['otra base', 'INSERT INTO otra_base.usuarios (email) VALUES (?)'],
      ['borrado', 'DELETE FROM pansys_test.usuarios WHERE id = ?'],
      ['cambio de esquema', 'ALTER TABLE pansys_test.usuarios ADD x INT'],
      ['escritura disfrazada', 'SELECT 1; INSERT INTO pansys_test.usuarios (email) VALUES (?)']
    ]) {
      const c = conexionSimple();
      const error = await falla(() => herramienta.escribir(c, 'datos', sql, ['x']));
      igual(`escribir rechaza ${descripcion} sin enviar nada`, [error instanceof herramienta.ErrorVerificacion, c.registro], [true, []]);
    }
    {
      const c = conexionSimple();
      c.base = 'otra_base';
      const error = await falla(() => herramienta.escribir(c, 'datos', 'INSERT INTO pansys_test.usuarios (email) VALUES (?)', ['x']));
      igual('escribir con la base cambiada -> error tras SELECT DATABASE() y sin enviar el INSERT',
        [error instanceof herramienta.ErrorVerificacion, c.registro], [true, ['SELECT DATABASE() AS base']]);
      c.base = 'pansys_test';
      await herramienta.escribir(c, 'datos', 'UPDATE pansys_test.productos SET nombre = ? WHERE id = ?', ['x', 1]);
      igual('escritura permitida: primero SELECT DATABASE() y después la sentencia',
        c.registro.slice(-2), ['SELECT DATABASE() AS base', 'UPDATE pansys_test.productos SET nombre = ? WHERE id = ?']);
    }

    console.log('\n== aislamiento.mysql.js: evaluación de la limpieza');
    {
      const pendientes = { runId: 'aaaabbbbccccdddd', usuarios: [501, 504], panaderias: [502, 503] };
      const desconocido = herramienta.evaluarLimpieza({ ok: false, resultado: 'desconocido', motivo: 'falló el COMMIT', pendientes });
      const texto = desconocido.lineas.join('\n');
      igual('"desconocido" -> se detiene e indica runId, id y que no se reintenta ni se borra',
        [desconocido.detener, /RESULTADO DESCONOCIDO/.test(texto), texto.includes('aaaabbbbccccdddd'), texto.includes('501, 504'), texto.includes('502, 503'),
          /No se reintenta/.test(texto), /No borre estas filas sin autorización/.test(texto), /solo lectura/.test(texto)],
        [true, true, true, true, true, true, true, true]);
      const revertida = herramienta.evaluarLimpieza({ ok: false, resultado: 'revertida', motivo: 'RESTRICT', pendientes });
      igual('"revertida" con pendientes -> se detiene y lista los registros', [revertida.detener, revertida.lineas.join('\n').includes('501, 504')], [true, true]);
      igual('"no_iniciada" -> se detiene', herramienta.evaluarLimpieza({ ok: false, resultado: 'no_iniciada', pendientes }).detener, true);
      igual('sin resultado -> se detiene', herramienta.evaluarLimpieza(undefined).detener, true);
      igual('"limpia" -> continúa', herramienta.evaluarLimpieza({ ok: true, resultado: 'limpia', pendientes: null }), { detener: false, lineas: [] });
    }

    console.log('\n== aislamiento.mysql.js: flujo completo con dobles');
    // Doble de MySQL para el script y ejecución doble del módulo de aislamiento
    const PREVISTOS = {
      insumo_usado: 1, orden_produccion: 1, receta_producto: 1, detalle_ventas: 1, ventas: 1, productos: 2,
      materia_prima: 1, 'usuarios (empleados)': 1, panaderias: 2, 'usuarios (propietarias)': 1
    };
    const crearEscenario = ({ v6Bloquea = true, fallarInsertEn = null, bases = [], resultado = 'limpia', borrados = PREVISTOS, segundaObtiene = false, iniciarFalla = false } = {}) => {
      const estado = { conexiones: [], eventos: [], todas: [], ids: 500, productos: {}, bloqueoPanaderia: false, v3Dueno: null, limpio: false };
      const crearConexion = async () => {
        const c = new EventEmitter();
        c.id = 900 + estado.conexiones.length;
        c.registro = [];
        c.cerrada = false;
        c.base = bases.shift() ?? 'pansys_test';
        estado.conexiones.push(c);
        c.end = async () => { if (!c.cerrada) { c.cerrada = true; estado.eventos.push(`fin:${c.id}`); } };
        c.destroy = () => { c.cerrada = true; if (estado.v3Dueno === c.id) estado.v3Dueno = null; estado.eventos.push(`fin:${c.id}`); c.emit('end'); };
        c.query = async (sql, params = []) => {
          c.registro.push(sql);
          estado.todas.push(sql);
          if (c.cerrada) throw Object.assign(new Error('cerrada'), { code: 'PROTOCOL_ENQUEUE_AFTER_QUIT' });
          let m;
          if (sql === 'SELECT DATABASE() AS base') return [[{ base: c.base }]];
          if (sql === 'SELECT IS_USED_LOCK(?) AS dueno, CONNECTION_ID() AS propio') return [[{ dueno: 77, propio: c.id }]];
          if (sql.startsWith('SELECT TABLE_NAME AS tabla FROM information_schema.TABLES')) return [params[1].map(tabla => ({ tabla }))];
          if ((m = sql.match(/^INSERT INTO pansys_test\.(\w+) /))) {
            if (fallarInsertEn === m[1]) throw Object.assign(new Error('fallo'), { code: 'ER_SIMULADO' });
            if (m[1] === 'productos' && estado.bloqueoPanaderia && c.esperaCorta && v6Bloquea) {
              throw Object.assign(new Error('Lock wait timeout exceeded'), { code: 'ER_LOCK_WAIT_TIMEOUT', errno: 1205 });
            }
            const id = ++estado.ids;
            if (m[1] === 'productos') estado.productos[id] = params[0];
            return [{ insertId: id, affectedRows: 1 }];
          }
          if ((m = sql.match(/^SELECT COUNT\(\*\) AS n FROM pansys_test\.(usuarios|panaderias) WHERE id IN \(\?\)$/))) return [[{ n: estado.limpio ? 0 : params[0].length }]];
          if (sql === 'SELECT COUNT(*) AS n FROM pansys_test.productos WHERE panaderia_id IN (?)') return [[{ n: estado.limpio ? 0 : 2 }]];
          if (sql === 'START TRANSACTION') { c.tx = true; return [{}]; }
          if (sql === 'ROLLBACK') {
            c.tx = false;
            if (c.forUpdate) { estado.bloqueoPanaderia = false; c.forUpdate = false; }
            if (c.pendiente) { estado.productos[c.pendiente.id] = c.pendiente.anterior; c.pendiente = null; }
            return [{}];
          }
          if (sql === 'SELECT id FROM pansys_test.panaderias WHERE id = ? FOR UPDATE') { estado.bloqueoPanaderia = true; c.forUpdate = true; return [[{ id: params[0] }]]; }
          if (sql === 'SET SESSION innodb_lock_wait_timeout = 2') { c.esperaCorta = true; return [{}]; }
          if (sql === 'UPDATE pansys_test.productos SET nombre = ? WHERE id = ?') {
            c.pendiente = { id: params[1], anterior: estado.productos[params[1]] };
            estado.productos[params[1]] = params[0];
            return [{ affectedRows: 1 }];
          }
          if (sql === 'SELECT nombre FROM pansys_test.productos WHERE id = ?') return [[{ nombre: estado.productos[params[0]] }]];
          if (sql === 'SELECT GET_LOCK(?, 0) AS obtenido') { estado.v3Dueno = c.id; return [[{ obtenido: 1 }]]; }
          if (sql === 'SELECT IS_USED_LOCK(?) AS dueno') return [[{ dueno: estado.v3Dueno }]];
          throw new Error(`SQL no previsto por el doble del script: ${sql}`);
        };
        return c;
      };
      const ejecucion = {
        runId: 'aaaabbbbccccdddd', bloqueo: { idConexion: 77 }, propios: { usuarios: [], panaderias: [] },
        llamadas: { limpiar: 0, cerrar: 0, exigirBloqueo: 0 }
      };
      ejecucion.correo = (e) => `prueba.verificacion.${ejecucion.runId}.${e}@pansys.test`;
      ejecucion.nombre = (t) => `PRUEBA ${ejecucion.runId} ${t}`;
      ejecucion.registrar = (tipo, id) => { ejecucion.propios[tipo].push(id); return id; };
      ejecucion.ids = (tipo) => [...ejecucion.propios[tipo]];
      ejecucion.exigirBloqueo = async () => { ejecucion.llamadas.exigirBloqueo++; };
      ejecucion.limpiar = async () => {
        ejecucion.llamadas.limpiar++;
        estado.eventos.push('limpiar');
        estado.limpio = resultado === 'limpia';
        return resultado === 'limpia'
          ? { ok: true, resultado, motivo: null, borrados, pendientes: null }
          : { ok: false, resultado, motivo: 'simulado', borrados: {}, pendientes: { runId: ejecucion.runId, usuarios: ejecucion.ids('usuarios'), panaderias: ejecucion.ids('panaderias') } };
      };
      ejecucion.cerrar = async () => { ejecucion.llamadas.cerrar++; estado.eventos.push('cerrar'); };
      let inicios = 0;
      const iniciar = async () => {
        inicios++;
        if (iniciarFalla) throw new ErrorAislamiento('Otra suite de integración está en curso (bloqueo de suite ocupado): no se escribe nada');
        if (inicios === 1) return ejecucion;
        if (segundaObtiene) return { cerrar: async () => { estado.eventos.push('cerrar-segunda'); } };
        throw new ErrorAislamiento('Otra suite de integración está en curso (bloqueo de suite ocupado): no se escribe nada');
      };
      const salida = [];
      return { estado, ejecucion, crearConexion, iniciar, salida, correr: () => herramienta.ejecutar({ env: { DB_NAME: 'pansys_test' }, crearConexion, iniciar, salida: (l) => salida.push(l) }) };
    };
    const lineasOk = (salida) => salida.filter(l => l.startsWith('OK')).map(l => l.split(' ').filter(Boolean)[1]);
    const todasCerradas = (estado) => estado.conexiones.every(c => c.cerrada);
    {
      const e = crearEscenario();
      const codigo = await e.correr();
      igual('flujo correcto -> código 0 y todas las comprobaciones OK', [codigo, e.salida.filter(l => l.startsWith('FALLA'))], [0, []]);
      igual('se informan V1, V2, V3, V4, V5, V6, V7, V8 y V10',
        [...new Set(lineasOk(e.salida))].filter(c => c !== '--').sort(), ['V1', 'V10', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8']);
      igual('limpiar() y cerrar() se llaman exactamente una vez', [e.ejecucion.llamadas.limpiar, e.ejecucion.llamadas.cerrar], [1, 1]);
      igual('el script no envía ningún DELETE', e.estado.todas.some(s => /\bDELETE\b/i.test(s)), false);
      const datos = e.estado.conexiones[0];
      const escrituras = datos.registro.map((s, i) => [s, i]).filter(([s]) => /^(INSERT|UPDATE) /.test(s));
      igual('cada escritura va precedida de SELECT DATABASE() en la misma conexión',
        escrituras.length > 0 && escrituras.every(([, i]) => datos.registro[i - 1] === 'SELECT DATABASE() AS base'), true);
      const iLimpiar = e.estado.eventos.indexOf('limpiar');
      igual('las conexiones auxiliares se cierran antes de limpiar y todas terminan cerradas',
        [e.estado.eventos.slice(0, iLimpiar).filter(x => x.startsWith('fin:')).length >= 3, todasCerradas(e.estado)], [true, true]);
      igual('los datos se crean solo con el bloqueo exigido', e.ejecucion.llamadas.exigirBloqueo >= 1, true);
      igual('se crean exactamente dos cuentas temporales, ambas registradas como propias',
        [e.estado.todas.filter(s => s.startsWith('INSERT INTO pansys_test.usuarios')).length, e.ejecucion.propios.usuarios.length, e.ejecucion.propios.panaderias.length], [2, 2, 2]);
    }
    {
      const e = crearEscenario({ resultado: 'desconocido' });
      const codigo = await e.correr();
      const texto = e.salida.join('\n');
      igual('limpieza "desconocido" -> código 1, sin reintento y con instrucciones de verificación manual',
        [codigo, e.ejecucion.llamadas.limpiar, /RESULTADO DESCONOCIDO/.test(texto), texto.includes('aaaabbbbccccdddd'), /No borre/.test(texto)], [1, 1, true, true, true]);
      igual('tras "desconocido" no se abre la conexión de comprobación ni se consulta nada más',
        [e.estado.conexiones.length, e.estado.todas.slice(e.estado.todas.indexOf('SELECT IS_USED_LOCK(?) AS dueno') + 1).length], [3, 0]);
      igual('tras "desconocido" se cierra el bloqueo y todas las conexiones', [e.ejecucion.llamadas.cerrar, todasCerradas(e.estado)], [1, true]);
    }
    {
      const e = crearEscenario({ resultado: 'revertida' });
      const codigo = await e.correr();
      igual('limpieza "revertida" -> código 1 y una sola llamada a limpiar', [codigo, e.ejecucion.llamadas.limpiar], [1, 1]);
    }
    {
      const e = crearEscenario({ v6Bloquea: false, borrados: { ...PREVISTOS, productos: 3 } });
      const codigo = await e.correr();
      igual('si la hipótesis V6 resulta falsa -> FALLA V6, código 1, y la fila extra se cuenta en la limpieza',
        [codigo, e.salida.some(l => l.startsWith('FALLA V6')), e.salida.some(l => l.startsWith('OK    V5 limpiar() borra'))], [1, true, true]);
    }
    {
      const e = crearEscenario({ fallarInsertEn: 'materia_prima' });
      const codigo = await e.correr();
      igual('fallo a mitad de la creación de datos -> código 1, limpiar una sola vez y conexiones cerradas antes',
        [codigo, e.ejecucion.llamadas.limpiar, e.estado.eventos.indexOf('limpiar') > e.estado.eventos.indexOf('fin:900'), todasCerradas(e.estado)], [1, 1, true, true]);
    }
    {
      const e = crearEscenario({ iniciarFalla: true });
      const codigo = await e.correr();
      igual('bloqueo ocupado -> código 1, sin conexiones auxiliares, sin escrituras ni limpieza',
        [codigo, e.estado.conexiones.length, e.ejecucion.llamadas.limpiar], [1, 0, 0]);
    }
    {
      const e = crearEscenario({ bases: ['otra_base'] });
      const codigo = await e.correr();
      igual('conexión de datos en otra base -> código 1 sin ninguna escritura; limpieza única de lo (nada) registrado',
        [codigo, e.estado.todas.some(s => /^(INSERT|UPDATE) /.test(s)), e.ejecucion.llamadas.limpiar, e.ejecucion.propios], [1, false, 1, { usuarios: [], panaderias: [] }]);
    }
    {
      const e = crearEscenario({ segundaObtiene: true });
      const codigo = await e.correr();
      igual('si una segunda ejecución obtuviera el bloqueo -> FALLA V2, se cierra y código 1',
        [codigo, e.salida.some(l => l.startsWith('FALLA V2')), e.estado.eventos.includes('cerrar-segunda')], [1, true, true]);
    }
    {
      const salida = [];
      let inicios = 0;
      const codigo = await herramienta.ejecutar({ env: { DB_NAME: 'otra_base' }, iniciar: async () => { inicios++; }, crearConexion: async () => { throw new Error('no'); }, salida: (l) => salida.push(l) });
      igual('ejecutar con DB_NAME distinto -> código 1 sin iniciar nada', [codigo, inicios], [1, 0]);
    }
  };

  // Si main() no llega a terminar, Node saldría con código 0 sin resumen: se trata como fallo
  let completada = false;
  process.on('exit', () => {
    if (!completada) {
      console.log('\nFALLA la ejecución terminó sin completar todas las pruebas');
      process.exitCode = 1;
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
}
