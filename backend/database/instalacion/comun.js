'use strict';
// =====================================================================================
// Pansys - INSTALACIÓN LIMPIA: piezas comunes de las herramientas Node de instalación
// =====================================================================================
//  - Parámetros: un único JSON FUERA del repositorio, sin secretos (validarParametros).
//  - Identidad POSITIVA del servidor: puerto, server_uuid y datadir esperados vienen de los
//    parámetros (nunca fijos en el código) y se comprueban en cada conexión (comprobarIdentidad).
//  - Lectura oculta desde una terminal (leerOculto), sin eco y descartando secuencias de teclas.
//  - Archivos de credenciales: se crean en exclusiva, se restringen ANTES de escribir el secreto,
//    se verifican al leerlos y nunca se muestran (crearArchivosReales, leerCredenciales).
//  - Errores: solo el código de MySQL, nunca su mensaje (podría contener valores).
// =====================================================================================
const path = require('path');
const dotenv = require('dotenv');
const { parsearEmail } = require('../../src/utils/email');

class ErrorInstalacion extends Error {
  constructor(mensaje, { incierto = false } = {}) {
    super(mensaje);
    this.name = 'ErrorInstalacion';
    if (incierto) this.incierto = true;
  }
}

const DIR_REPOSITORIO = path.resolve(__dirname, '../../..');
const NUMERO_PANADERIAS = 2;
const PATRON_BASE = /^[a-z][a-z0-9_]{0,63}$/;
const PATRON_CUENTA = /^[a-z][a-z0-9_]{0,31}$/;
const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PATRON_SHA256 = /^[0-9a-f]{64}$/;
const HOSTS_CUENTA = Object.freeze(['127.0.0.1', 'localhost', '::1']);
// Nombres que nunca son destino: la base de pruebas y las del sistema
const BASES_PROHIBIDAS = Object.freeze(['pansys_test', 'mysql', 'sys', 'performance_schema', 'information_schema']);
const CUENTAS_PROHIBIDAS = /^(root|mysql\..*|pansys_test.*|pansys_ensayo)$/;
const SCRIPTS_SQL = Object.freeze(['01_esquema.sql', '04_verificar.sql']);
const CLAVE_SENSIBLE = /contras|passw|pwd|clave|secret|hash|token/i;
const MARCA_EJEMPLO = /cambiar|ejemplo|example|\.invalid$|\.test$|pansys\.test/i;
// Errores de conexión: el estado de la última sentencia enviada es INCIERTO
const CODIGOS_CONEXION = Object.freeze(['PROTOCOL_CONNECTION_LOST', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT', 'PROTOCOL_SEQUENCE_TIMEOUT', 'ER_SERVER_SHUTDOWN', 'ECONNREFUSED']);

const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const esConexionPerdida = (e) => !!e && (e.fatal === true || CODIGOS_CONEXION.includes(e.code));

// Errores de MySQL o de E/S: solo el código. Conserva la marca de estado incierto.
const errorSeguro = (e, contexto) => {
  if (e instanceof ErrorInstalacion) return e;
  const codigo = e && typeof e.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(e.code) ? e.code : 'desconocido';
  return new ErrorInstalacion(`${contexto} (código ${codigo}).`, { incierto: esConexionPerdida(e) });
};

const dentroDe = (padre, ruta) => {
  const rel = path.relative(padre.toLowerCase(), ruta.toLowerCase());
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

const buscarClavesSensibles = (valor, ruta = '') => {
  if (Array.isArray(valor)) return valor.flatMap((v, i) => buscarClavesSensibles(v, `${ruta}[${i}]`));
  if (!esObjeto(valor)) return [];
  return Object.entries(valor).flatMap(([k, v]) => {
    const r = `${ruta}${ruta ? '.' : ''}${k}`;
    return [...(CLAVE_SENSIBLE.test(k) ? [r] : []), ...buscarClavesSensibles(v, r)];
  });
};

const soloClaves = (obj, permitidas, donde, obligatorias = permitidas) => {
  const sobrantes = Object.keys(obj).filter(k => !permitidas.includes(k));
  if (sobrantes.length) throw new ErrorInstalacion(`${donde}: claves no admitidas (${sobrantes.join(', ')}).`);
  const faltan = obligatorias.filter(k => !(k in obj));
  if (faltan.length) throw new ErrorInstalacion(`${donde}: faltan claves (${faltan.join(', ')}).`);
};

const texto = (valor, campo, { max, opcional = false }) => {
  if (valor === null || valor === undefined) {
    if (opcional) return null;
    throw new ErrorInstalacion(`${campo} es obligatorio.`);
  }
  if (typeof valor !== 'string') throw new ErrorInstalacion(`${campo} debe ser texto.`);
  const limpio = valor.trim();
  if (!limpio) {
    if (opcional) return null;
    throw new ErrorInstalacion(`${campo} no puede estar vacío.`);
  }
  if (limpio.length > max) throw new ErrorInstalacion(`${campo} supera ${max} caracteres.`);
  if (MARCA_EJEMPLO.test(limpio)) throw new ErrorInstalacion(`${campo} conserva un valor de ejemplo; sustitúyalo por el real.`);
  return limpio;
};

const validarNombreBase = (nombre, campo = 'conexion.base') => {
  if (typeof nombre !== 'string' || !PATRON_BASE.test(nombre)) {
    throw new ErrorInstalacion(`${campo} debe ser un nombre en minúsculas (letras, números y _; empieza por letra; máximo 64).`);
  }
  if (BASES_PROHIBIDAS.includes(nombre)) throw new ErrorInstalacion(`${campo}: ${nombre} nunca es destino de una instalación.`);
  if (MARCA_EJEMPLO.test(nombre)) throw new ErrorInstalacion(`${campo} conserva un valor de ejemplo; indique el nombre real.`);
  return nombre;
};

// Correo de administrador. Solo ASCII: así la igualdad de MySQL (utf8mb4_0900_ai_ci, que no
// distingue mayúsculas NI acentos: «admín@» = «admin@») coincide exactamente con comparar en
// minúsculas, y dos correos que MySQL consideraría iguales se rechazan ANTES de tocar la base.
const validarEmail = (valor, campo) => {
  let email;
  try {
    email = parsearEmail(valor);
  } catch {
    throw new ErrorInstalacion(`${campo} no es válido.`);
  }
  if (!/^[\x21-\x7e]+$/.test(email)) throw new ErrorInstalacion(`${campo} solo admite caracteres ASCII (MySQL no distingue acentos en el correo).`);
  if (MARCA_EJEMPLO.test(email)) throw new ErrorInstalacion(`${campo} conserva un valor de ejemplo.`);
  return email;
};
const claveEmail = (email) => email.toLowerCase();

const rutaExterna = (valor, campo, repositorio) => {
  if (typeof valor !== 'string' || !path.isAbsolute(valor) || /[\0\r\n]/.test(valor)) throw new ErrorInstalacion(`${campo} debe ser una ruta absoluta.`);
  if (MARCA_EJEMPLO.test(valor)) throw new ErrorInstalacion(`${campo} conserva un valor de ejemplo.`);
  const ruta = path.resolve(valor);
  if (dentroDe(repositorio, ruta)) throw new ErrorInstalacion(`${campo} debe estar FUERA del repositorio.`);
  return ruta;
};

const validarIdentidad = (id) => {
  if (!esObjeto(id)) throw new ErrorInstalacion('Falta el objeto identidad (puerto, server_uuid y datadir esperados).');
  soloClaves(id, ['puerto', 'server_uuid', 'datadir'], 'identidad');
  if (!Number.isInteger(id.puerto) || id.puerto < 1 || id.puerto > 65535) throw new ErrorInstalacion('identidad.puerto debe ser un entero entre 1 y 65535.');
  if (typeof id.server_uuid !== 'string' || !PATRON_UUID.test(id.server_uuid)) throw new ErrorInstalacion('identidad.server_uuid no es un UUID en minúsculas.');
  if (typeof id.datadir !== 'string' || !id.datadir || id.datadir.length > 512 || /[\0-\x1f]/.test(id.datadir) || MARCA_EJEMPLO.test(id.datadir)) {
    throw new ErrorInstalacion('identidad.datadir debe ser el valor exacto de @@datadir del servidor esperado.');
  }
  return { puerto: id.puerto, server_uuid: id.server_uuid, datadir: id.datadir };
};

const validarCuenta = (c, tipo, repositorio) => {
  const donde = `cuentas.${tipo}`;
  if (!esObjeto(c)) throw new ErrorInstalacion(`Falta ${donde}.`);
  soloClaves(c, ['usuario', 'host', 'credenciales'], donde);
  if (typeof c.usuario !== 'string' || !PATRON_CUENTA.test(c.usuario) || CUENTAS_PROHIBIDAS.test(c.usuario) || MARCA_EJEMPLO.test(c.usuario)) {
    throw new ErrorInstalacion(`${donde}.usuario no es válido o está reservado.`);
  }
  if (!HOSTS_CUENTA.includes(c.host)) throw new ErrorInstalacion(`${donde}.host debe ser 127.0.0.1, localhost o ::1.`);
  const credenciales = rutaExterna(c.credenciales, `${donde}.credenciales`, repositorio);
  if (path.extname(credenciales).toLowerCase() !== '.env') throw new ErrorInstalacion(`${donde}.credenciales debe terminar en .env.`);
  return { usuario: c.usuario, host: c.host, credenciales };
};

const validarPanaderias = (lista) => {
  if (!Array.isArray(lista) || lista.length !== NUMERO_PANADERIAS) {
    throw new ErrorInstalacion(`panaderias debe contener exactamente ${NUMERO_PANADERIAS} panaderías.`);
  }
  const panaderias = lista.map((p, i) => {
    const donde = `panaderias[${i}]`;
    if (!esObjeto(p)) throw new ErrorInstalacion(`${donde} debe ser un objeto.`);
    soloClaves(p, ['nombre', 'direccion', 'localidad', 'telefono', 'en_red', 'administrador'], donde, ['nombre', 'direccion', 'localidad', 'en_red', 'administrador']);
    if (typeof p.en_red !== 'boolean') throw new ErrorInstalacion(`${donde}.en_red debe ser true o false.`);
    if (!esObjeto(p.administrador)) throw new ErrorInstalacion(`${donde}.administrador debe ser un objeto con email.`);
    soloClaves(p.administrador, ['email'], `${donde}.administrador`);
    return {
      nombre: texto(p.nombre, `${donde}.nombre`, { max: 255 }),
      direccion: texto(p.direccion, `${donde}.direccion`, { max: 255 }),
      localidad: texto(p.localidad, `${donde}.localidad`, { max: 100 }),
      telefono: texto(p.telefono, `${donde}.telefono`, { max: 255, opcional: true }),
      en_red: p.en_red,
      email: validarEmail(p.administrador.email, `${donde}.administrador.email`)
    };
  });
  const [a, b] = panaderias;
  if (claveEmail(a.email) === claveEmail(b.email)) throw new ErrorInstalacion('Los dos administradores deben tener correos distintos (MySQL no distingue mayúsculas).');
  if (a.nombre.toLowerCase() === b.nombre.toLowerCase()) throw new ErrorInstalacion('Las dos panaderías deben tener nombres distintos.');
  return panaderias;
};

// Desmontaje: SOLO objetos del ensayo (patrones de nombre) y bases protegidas que deben seguir intactas
const PATRON_BASE_ENSAYO = /^pansys[_x]inst[_x][a-z0-9_]+$/;
const PATRON_CUENTA_ENSAYO = /^pansys_(instalador|[a-z0-9]+_ensayo)$/;
const validarDesmontaje = (d) => {
  if (d === undefined) return null;
  if (!esObjeto(d)) throw new ErrorInstalacion('desmontaje debe ser un objeto.');
  soloClaves(d, ['bases', 'cuentas', 'protegidas'], 'desmontaje');
  const lista = (v, campo) => {
    if (!Array.isArray(v)) throw new ErrorInstalacion(`desmontaje.${campo} debe ser una lista.`);
    return v;
  };
  const bases = lista(d.bases, 'bases').map((b, i) => {
    const n = validarNombreBase(b, `desmontaje.bases[${i}]`);
    if (!PATRON_BASE_ENSAYO.test(n)) throw new ErrorInstalacion(`desmontaje.bases[${i}] no es un objeto del ensayo (pansys_inst_*).`);
    return n;
  });
  const cuentas = lista(d.cuentas, 'cuentas').map((c, i) => {
    if (!esObjeto(c)) throw new ErrorInstalacion(`desmontaje.cuentas[${i}] debe ser un objeto.`);
    soloClaves(c, ['usuario', 'host'], `desmontaje.cuentas[${i}]`);
    if (typeof c.usuario !== 'string' || !PATRON_CUENTA_ENSAYO.test(c.usuario)) throw new ErrorInstalacion(`desmontaje.cuentas[${i}] no es una cuenta del ensayo.`);
    if (!HOSTS_CUENTA.includes(c.host)) throw new ErrorInstalacion(`desmontaje.cuentas[${i}].host no es válido.`);
    return { usuario: c.usuario, host: c.host };
  });
  const protegidas = lista(d.protegidas, 'protegidas').map((b, i) => {
    if (typeof b !== 'string' || !PATRON_BASE.test(b)) throw new ErrorInstalacion(`desmontaje.protegidas[${i}] no es válido.`);
    if (PATRON_BASE_ENSAYO.test(b) || bases.includes(b)) throw new ErrorInstalacion(`desmontaje.protegidas[${i}] coincide con un objeto a desmontar.`);
    return b;
  });
  if (!protegidas.length) throw new ErrorInstalacion('desmontaje.protegidas debe nombrar al menos una base que tiene que seguir intacta.');
  if (!bases.length && !cuentas.length) throw new ErrorInstalacion('desmontaje no contiene ningún objeto.');
  if (new Set(bases).size !== bases.length) throw new ErrorInstalacion('desmontaje.bases tiene repetidos.');
  return { bases, cuentas, protegidas };
};

// Parámetros completos de la instalación (sin secretos). Un solo archivo para todas las herramientas.
const validarParametros = (datos, { repositorio = DIR_REPOSITORIO } = {}) => {
  if (!esObjeto(datos)) throw new ErrorInstalacion('El archivo de parámetros debe contener un objeto JSON.');
  const sensibles = buscarClavesSensibles(datos);
  if (sensibles.length) {
    throw new ErrorInstalacion(`El archivo de parámetros no puede contener contraseñas ni secretos (${sensibles.join(', ')}).`);
  }
  soloClaves(datos, ['identidad', 'conexion', 'administrador_mysql', 'cuentas', 'sha256', 'panaderias', 'desmontaje'], 'Parámetros',
    ['identidad', 'conexion', 'administrador_mysql', 'cuentas', 'sha256', 'panaderias']);
  const identidad = validarIdentidad(datos.identidad);
  const c = datos.conexion;
  if (!esObjeto(c)) throw new ErrorInstalacion('Falta el objeto conexion.');
  soloClaves(c, ['host', 'base'], 'conexion');
  if (typeof c.host !== 'string' || !/^[A-Za-z0-9.:-]{1,255}$/.test(c.host)) throw new ErrorInstalacion('conexion.host no es válido.');
  const conexion = { host: c.host, puerto: identidad.puerto, base: validarNombreBase(c.base) };
  if (typeof datos.administrador_mysql !== 'string' || !/^[A-Za-z0-9_.-]{1,32}$/.test(datos.administrador_mysql)) {
    throw new ErrorInstalacion('administrador_mysql no es válido.');
  }
  if (!esObjeto(datos.cuentas)) throw new ErrorInstalacion('Falta el objeto cuentas.');
  soloClaves(datos.cuentas, ['instalador', 'aplicacion'], 'cuentas');
  const cuentas = {
    instalador: validarCuenta(datos.cuentas.instalador, 'instalador', repositorio),
    aplicacion: validarCuenta(datos.cuentas.aplicacion, 'aplicacion', repositorio)
  };
  if (cuentas.instalador.usuario === cuentas.aplicacion.usuario) throw new ErrorInstalacion('Las cuentas de instalación y de aplicación deben ser distintas.');
  if (claveEmail(cuentas.instalador.credenciales) === claveEmail(cuentas.aplicacion.credenciales)) throw new ErrorInstalacion('Cada cuenta necesita su propio archivo de credenciales.');
  if (!esObjeto(datos.sha256)) throw new ErrorInstalacion('Falta el objeto sha256 (manifiesto aprobado de los scripts SQL).');
  soloClaves(datos.sha256, SCRIPTS_SQL, 'sha256');
  for (const s of SCRIPTS_SQL) if (!PATRON_SHA256.test(datos.sha256[s])) throw new ErrorInstalacion(`sha256.${s} debe ser un SHA-256 en hexadecimal minúscula.`);
  return {
    identidad, conexion, administrador: datos.administrador_mysql, cuentas, sha256: { ...datos.sha256 },
    panaderias: validarPanaderias(datos.panaderias), desmontaje: validarDesmontaje(datos.desmontaje)
  };
};

const cargarParametros = (rutaRecibida, leerArchivo, repositorio = DIR_REPOSITORIO) => {
  const ruta = path.resolve(rutaRecibida);
  if (dentroDe(repositorio, ruta)) throw new ErrorInstalacion('El archivo de parámetros debe estar FUERA del repositorio (contiene datos reales). No se ha modificado nada.');
  let datos;
  try {
    datos = JSON.parse(leerArchivo(ruta));
  } catch {
    throw new ErrorInstalacion('No se pudo leer el archivo de parámetros como JSON. No se ha modificado nada.');
  }
  return validarParametros(datos, { repositorio });
};

// Argumentos: solo las opciones declaradas, con forma --clave=valor o --bandera. Nunca secretos.
const leerArgumentos = (argv, { valores = [], banderas = [] }, ayuda) => {
  const r = {};
  for (const a of argv) {
    const m = /^--([a-z-]+)(?:=(.+))?$/.exec(a);
    const clave = m && m[1];
    if (m && m[2] !== undefined && valores.includes(clave) && !(clave in r)) r[clave] = m[2];
    else if (m && m[2] === undefined && banderas.includes(clave) && !(clave in r)) r[clave] = true;
    else throw new ErrorInstalacion(`Argumentos no admitidos (las contraseñas nunca se pasan como argumento).\n${ayuda}`);
  }
  return r;
};

// Identidad positiva: el servidor de la conexión es EXACTAMENTE el esperado
const comprobarIdentidad = async (con, identidad, base) => {
  const [filas] = await con.execute('SELECT @@port AS puerto, @@server_uuid AS uuid, @@datadir AS datadir, DATABASE() AS base');
  const f = filas[0] || {};
  if (Number(f.puerto) !== identidad.puerto || f.uuid !== identidad.server_uuid || f.datadir !== identidad.datadir) {
    throw new ErrorInstalacion('La identidad del servidor (puerto, server_uuid o datadir) NO coincide con la esperada. No se ha modificado nada.');
  }
  if (base !== undefined && f.base !== base) throw new ErrorInstalacion('La conexión no apunta a la base indicada en los parámetros. No se ha modificado nada.');
  return f;
};

// Lectura sin eco desde una terminal. Rechaza entradas que no sean TTY (tuberías, archivos).
// Descarta las secuencias de teclas especiales (flechas, Supr, Inicio, F1...: ESC [ ... final,
// ESC O x, ESC x) para que no se cuelen en la contraseña.
const leerOculto = ({ entrada, salida, pregunta }) => new Promise((resolve, reject) => {
  if (!entrada || !entrada.isTTY || typeof entrada.setRawMode !== 'function') {
    reject(new ErrorInstalacion('Las contraseñas solo se leen desde una terminal interactiva (no se admiten tuberías ni archivos). No se ha modificado nada.'));
    return;
  }
  let valor = '';
  let estado = 'normal';
  salida.write(pregunta);
  const terminar = (error) => {
    entrada.removeListener('data', alRecibir);
    entrada.setRawMode(false);
    entrada.pause();
    salida.write('\n');
    if (error) reject(error); else resolve(valor);
  };
  const alRecibir = (trozo) => {
    for (const c of String(trozo)) {
      if (estado === 'esc') { estado = c === '[' ? 'csi' : c === 'O' ? 'ss3' : 'normal'; continue; }
      if (estado === 'csi') { if (c >= '@' && c <= '~') estado = 'normal'; continue; }
      if (estado === 'ss3') { estado = 'normal'; continue; }
      if (c === '\u001b') { estado = 'esc'; continue; }
      if (c === '\r' || c === '\n') return terminar();
      if (c === '\u0003' || c === '\u0004') return terminar(new ErrorInstalacion('Cancelado por el usuario. No se ha modificado nada.'));
      if (c === '\u007f' || c === '\b') { valor = Array.from(valor).slice(0, -1).join(''); continue; }
      if (c < ' ') continue;
      valor += c;
    }
  };
  entrada.setRawMode(true);
  entrada.setEncoding('utf8');
  entrada.on('data', alRecibir);
  entrada.resume();
});

// ---------------------------------------------------------------- Archivos de credenciales
// Formato .env (DB_USER / DB_PASSWORD), legible con dotenv. El valor se entrecomilla con el primer
// delimitador (' ` ") que no aparezca en él y cuya lectura con dotenv devuelva EXACTAMENTE el mismo
// valor; si ninguno lo consigue, devuelve null (la contraseña se regenera).
const serializarCredenciales = (usuario, contrasena) => {
  if (typeof contrasena !== 'string' || !contrasena || /[\0-\x1f\x7f]/.test(contrasena)) return null;
  for (const q of ["'", '`', '"']) {
    if (contrasena.includes(q)) continue;
    const contenido = `DB_USER=${usuario}\nDB_PASSWORD=${q}${contrasena}${q}\n`;
    const leido = dotenv.parse(contenido);
    if (leido.DB_USER === usuario && leido.DB_PASSWORD === contrasena && Object.keys(leido).length === 2) return contenido;
  }
  return null;
};

// Lee DB_PASSWORD del archivo (comprobando antes su protección y que DB_USER es la cuenta esperada)
const leerCredenciales = (archivos, ruta, usuario) => {
  if (!archivos.existe(ruta)) throw new ErrorInstalacion('No existe el archivo de credenciales de la cuenta. No se ha modificado nada.');
  archivos.verificarProtegido(ruta);
  let leido;
  try {
    leido = dotenv.parse(archivos.leer(ruta));
  } catch {
    throw new ErrorInstalacion('No se pudo leer el archivo de credenciales. No se ha modificado nada.');
  }
  if (leido.DB_USER !== usuario || typeof leido.DB_PASSWORD !== 'string' || !leido.DB_PASSWORD || Object.keys(leido).length !== 2) {
    throw new ErrorInstalacion('El archivo de credenciales no corresponde a la cuenta indicada. No se ha modificado nada.');
  }
  return leido.DB_PASSWORD;
};

// Implementación real. Windows: herencia retirada y un único permiso (control total) para el SID del
// usuario actual (whoami + icacls). Otros sistemas: modo 0600 y propietario actual.
// Nunca recibe el secreto en argumentos de procesos externos.
// Programas de Windows por RUTA ABSOLUTA (System32): nunca por el PATH, que podría resolver a otro
// «whoami» (p. ej. el de Git Bash) o a un programa suplantado.
const DIR_SISTEMA = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
const crearArchivosReales = ({ fs = require('fs'), ejecutar = require('child_process').execFileSync, plataforma = process.platform, dirSistema = DIR_SISTEMA } = {}) => {
  const WHOAMI = path.join(dirSistema, 'whoami.exe');
  const ICACLS = path.join(dirSistema, 'icacls.exe');
  const usuarioWindows = () => {
    const linea = String(ejecutar(WHOAMI, ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', windowsHide: true })).trim();
    const m = /^"([^"]+)","(S-1-[0-9-]+)"$/.exec(linea);
    if (!m) throw new ErrorInstalacion('No se pudo identificar al usuario actual de Windows.');
    return { nombre: m[1], sid: m[2] };
  };
  const proteger = (ruta) => {
    if (plataforma === 'win32') {
      const { sid } = usuarioWindows();
      ejecutar(ICACLS, [ruta, '/inheritance:r', '/grant:r', `*${sid}:F`], { encoding: 'utf8', windowsHide: true });
    } else {
      fs.chmodSync(ruta, 0o600);
    }
  };
  const verificarProtegido = (ruta) => {
    if (plataforma === 'win32') {
      const { nombre } = usuarioWindows();
      const salida = String(ejecutar(ICACLS, [ruta], { encoding: 'utf8', windowsHide: true }));
      const permisos = salida.split(/\r?\n/).filter(l => /:\([A-Z,()]+\)\s*$/.test(l) || /:\(.*\)\s*$/.test(l));
      const ok = permisos.length === 1 && permisos[0].toLowerCase().includes(`${nombre.toLowerCase()}:(f)`) && !/\(I\)/.test(permisos[0]);
      if (!ok) throw new ErrorInstalacion('El archivo de credenciales no está restringido a su usuario (herencia retirada y un único permiso). No se usa.');
    } else {
      const st = fs.statSync(ruta);
      if ((st.mode & 0o077) !== 0 || (typeof process.getuid === 'function' && st.uid !== process.getuid())) {
        throw new ErrorInstalacion('El archivo de credenciales no tiene modo 0600 y propietario actual. No se usa.');
      }
    }
  };
  return {
    existe: (ruta) => fs.existsSync(ruta),
    directorioExiste: (dir) => { try { return fs.statSync(dir).isDirectory(); } catch { return false; } },
    leer: (ruta) => fs.readFileSync(ruta, 'utf8'),
    // Crea el archivo VACÍO en exclusiva (falla si existe) y lo restringe antes de que tenga contenido
    crearProtegido(ruta) {
      fs.closeSync(fs.openSync(ruta, 'wx', 0o600));
      proteger(ruta);
      verificarProtegido(ruta);
    },
    escribirProtegido(ruta, contenido) {
      verificarProtegido(ruta);
      fs.writeFileSync(ruta, contenido, { encoding: 'utf8', flag: 'w' });
      verificarProtegido(ruta);
    },
    verificarProtegido,
    borrar: (ruta) => fs.unlinkSync(ruta)
  };
};

module.exports = {
  ErrorInstalacion, DIR_REPOSITORIO, NUMERO_PANADERIAS, HOSTS_CUENTA, BASES_PROHIBIDAS, SCRIPTS_SQL, MARCA_EJEMPLO,
  PATRON_BASE_ENSAYO, PATRON_CUENTA_ENSAYO,
  errorSeguro, esConexionPerdida, dentroDe, validarNombreBase, validarEmail, claveEmail, validarIdentidad,
  validarPanaderias, validarDesmontaje, validarParametros, cargarParametros, leerArgumentos, comprobarIdentidad,
  leerOculto, serializarCredenciales, leerCredenciales, crearArchivosReales
};
