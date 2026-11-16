// Línea base de las tablas del SQL 005 (restablecimientos_contrasena y eventos_seguridad) y validación de
// las sondas de restricciones, para restablecimiento.pruebas.js. Funciones PURAS (sin MySQL, sin red, sin disco).
//
// pansys_test puede contener filas legítimas anteriores en esas tablas (p. ej. un restablecimiento real
// probado a mano). La suite no las toca: las captura ANTES de escribir nada, exige que sean inertes y
// comprueba al final que siguen exactamente iguales (mismos ids y misma huella de TODAS sus columnas).
//
// Huella de fila: SHA-256 de una representación determinista con etiqueta de tipo, columnas en orden
// alfabético. NULL, fechas (ISO-8601; inválidas marcadas), Buffer (hex), bigint, números, booleanos,
// cadenas y objetos JSON (claves ordenadas) se distinguen entre sí: «NULL» y la cadena "null" no coinciden.
// La huella nunca se muestra junto a valores: los mensajes solo contienen ids y estados.

const crypto = require('crypto');

const TABLAS_005 = Object.freeze(['restablecimientos_contrasena', 'eventos_seguridad']);
// Estados en los que ningún proceso de la aplicación vuelve a tocar un enlace
const ESTADOS_TERMINALES = Object.freeze(['usado', 'invalidado', 'envio_fallido']);

const representar = (v) => {
  if (v === null || v === undefined) return { t: 'null' };
  if (Buffer.isBuffer(v)) return { t: 'buffer', v: v.toString('hex') };
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? { t: 'fecha-invalida' } : { t: 'fecha', v: v.toISOString() };
  if (typeof v === 'bigint') return { t: 'bigint', v: v.toString() };
  if (typeof v === 'number') return Number.isFinite(v) ? { t: 'numero', v: Object.is(v, -0) ? '0' : String(v) } : { t: 'numero-no-finito', v: String(v) };
  if (typeof v === 'boolean') return { t: 'booleano', v };
  if (typeof v === 'string') return { t: 'cadena', v };
  if (Array.isArray(v)) return { t: 'lista', v: v.map(representar) };
  if (typeof v === 'object') return { t: 'objeto', v: Object.keys(v).sort().map(k => [k, representar(v[k])]) };
  throw new Error(`tipo de columna no admitido en la línea base: ${typeof v}`);
};
const huellaFila = (fila) => {
  if (!fila || typeof fila !== 'object' || Array.isArray(fila)) throw new Error('fila no válida para la línea base');
  const columnas = Object.keys(fila).sort();
  const canonica = JSON.stringify(columnas.map(c => [c, representar(fila[c])]));
  return crypto.createHash('sha256').update(canonica, 'utf8').digest('hex');
};

// filas: { restablecimientos: [filas completas], eventos: [filas completas] } -> { restablecimientos: {id: huella}, eventos: {...} }
const construirLineaBase = (filas) => {
  const una = (lista, tabla) => {
    if (!Array.isArray(lista)) throw new Error(`${tabla}: lista de filas no válida`);
    const r = {};
    for (const f of lista) {
      const id = Number(f.id);
      if (!Number.isInteger(id) || id <= 0) throw new Error(`${tabla}: fila sin id válido`);
      if (r[id] !== undefined) throw new Error(`${tabla}: id ${id} repetido`);
      r[id] = huellaFila(f);
    }
    return r;
  };
  return Object.freeze({ restablecimientos: Object.freeze(una(filas.restablecimientos, 'restablecimientos_contrasena')),
    eventos: Object.freeze(una(filas.eventos, 'eventos_seguridad')) });
};

// estado: { restablecimientos: [{ id, estado, caducado, cuenta_prueba }], eventos: [{ id, cuenta_prueba }] }
// caducado y cuenta_prueba vienen de SQL (1/0). Una fila previa que no sea inerte o pertenezca a una cuenta
// de prueba impide empezar (no se escribe nada).
const validarLineaBase = (estado) => {
  const e = [];
  for (const r of estado.restablecimientos || []) {
    if (!ESTADOS_TERMINALES.includes(r.estado)) e.push(`enlace ${r.id} en estado ${r.estado} (no terminal)`);
    if (Number(r.caducado) !== 1) e.push(`enlace ${r.id} sin caducar`);
    if (Number(r.cuenta_prueba) !== 0) e.push(`enlace ${r.id} de una cuenta de prueba (residuo)`);
  }
  for (const v of estado.eventos || []) {
    if (Number(v.cuenta_prueba) !== 0) e.push(`evento ${v.id} de una cuenta de prueba (residuo)`);
  }
  return e;
};

// Ids de la línea base para «id NOT IN (?)»; nunca una lista vacía (MySQL la rechaza): [0] no coincide con ninguna fila.
const idsParaSql = (lineaBase, tabla) => {
  const ids = Object.keys(lineaBase[tabla]).map(Number);
  return ids.length ? ids : [0];
};

// Comparación exacta: las tablas deben contener EXACTAMENTE la línea base.
const compararConLineaBase = (lineaBase, filasActuales) => {
  const actual = construirLineaBase(filasActuales);
  const resultado = {};
  for (const tabla of ['restablecimientos', 'eventos']) {
    const antes = lineaBase[tabla], ahora = actual[tabla];
    resultado[tabla] = {
      faltan: Object.keys(antes).filter(id => ahora[id] === undefined).map(Number),
      cambiadas: Object.keys(antes).filter(id => ahora[id] !== undefined && ahora[id] !== antes[id]).map(Number),
      sobran: Object.keys(ahora).filter(id => antes[id] === undefined).map(Number)
    };
  }
  const ok = Object.values(resultado).every(x => !x.faltan.length && !x.cambiadas.length && !x.sobran.length);
  return { ok, ...resultado };
};
const describirDiferencias = (c) => ['restablecimientos', 'eventos'].flatMap(t => [
  ...(c[t].faltan.length ? [`${t}: faltan ${c[t].faltan.join(',')}`] : []),
  ...(c[t].cambiadas.length ? [`${t}: cambiaron ${c[t].cambiadas.join(',')}`] : []),
  ...(c[t].sobran.length ? [`${t}: sobran ${c[t].sobran.join(',')}`] : [])]);

// ---------- Sondas de restricciones (restablecimiento.pruebas.js, grupo 2) ----------
// errnoEsperado: un número (código exacto) o una lista EXPLÍCITA y no vacía de códigos admitidos.
const errnoAceptado = (errno, errnoEsperado) => {
  const lista = Array.isArray(errnoEsperado) ? errnoEsperado : [errnoEsperado];
  if (!lista.length || !lista.every(n => Number.isInteger(n) && n > 0)) throw new Error('errores esperados de la sonda no válidos');
  return Number.isInteger(errno) && lista.includes(errno);
};
// Clave foránea de la sonda FK: MySQL devuelve 1452 (con detalle) o 1216 (genérico, según los privilegios de
// la sesión sobre la tabla padre). Antes de aceptarla se exige que la restricción sea EXACTAMENTE
// pansys_test.eventos_seguridad(usuario_id) -> pansys_test.usuarios(id), leída de information_schema.
// kcu: filas de KEY_COLUMN_USAGE; rc: filas de REFERENTIAL_CONSTRAINTS (ambas filtradas por el nombre).
const ERRNO_FK_EVENTO_USUARIO = Object.freeze([1452, 1216]);
const validarFkEventoUsuario = (kcu, rc) => {
  const e = [];
  const esperadoKcu = { TABLE_SCHEMA: 'pansys_test', TABLE_NAME: 'eventos_seguridad', COLUMN_NAME: 'usuario_id',
    REFERENCED_TABLE_SCHEMA: 'pansys_test', REFERENCED_TABLE_NAME: 'usuarios', REFERENCED_COLUMN_NAME: 'id' };
  if (!Array.isArray(kcu) || kcu.length !== 1) e.push(`fk_evento_usuario: ${Array.isArray(kcu) ? kcu.length : 'sin'} columnas (se espera exactamente 1)`);
  else for (const [k, v] of Object.entries(esperadoKcu)) if (kcu[0][k] !== v) e.push(`fk_evento_usuario: ${k}=${kcu[0][k]} (se espera ${v})`);
  if (!Array.isArray(rc) || rc.length !== 1) e.push(`fk_evento_usuario: ${Array.isArray(rc) ? rc.length : 'sin'} restricciones referenciales (se espera exactamente 1)`);
  else {
    const esperadoRc = { CONSTRAINT_SCHEMA: 'pansys_test', TABLE_NAME: 'eventos_seguridad', REFERENCED_TABLE_NAME: 'usuarios' };
    for (const [k, v] of Object.entries(esperadoRc)) if (rc[0][k] !== v) e.push(`fk_evento_usuario: ${k}=${rc[0][k]} (se espera ${v})`);
  }
  return e;
};

module.exports = { TABLAS_005, ESTADOS_TERMINALES, representar, huellaFila, construirLineaBase, validarLineaBase, idsParaSql, compararConLineaBase, describirDiferencias,
  errnoAceptado, ERRNO_FK_EVENTO_USUARIO, validarFkEventoUsuario };
