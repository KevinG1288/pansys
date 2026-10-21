// Pruebas unitarias de utils/sesion.js (firma del JWT y lectura de version_sesion) y del orden
// transacción -> COMMIT -> firma del token en el cambio de contraseña (auth.service).
// No usan la base de datos ni el servidor: los modelos y la transacción se sustituyen por dobles
// en memoria. Se pueden ejecutar en cualquier momento.
//
// Uso (desde backend/):  node pruebas/sesion.unitarias.js

// Seguridad: antes de cargar la configuración, la conexión apunta a un host que no existe
// (dominio .invalid, reservado). Si alguna consulta escapara a los dobles, fallaría al instante
// sin llegar nunca a pansys_db ni a pansys_test (dotenv no sobrescribe variables ya definidas).
process.env.DB_HOST = 'base-inexistente.invalid';
process.env.DB_NAME = 'sin_base_pruebas_unitarias';
require('dotenv').config({ quiet: true });
process.env.JWT_SECRET = process.env.JWT_SECRET || 'clave-solo-para-pruebas-unitarias';

const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { firmarSesion, versionDelToken } = require('../src/utils/sesion');

const resultados = [];
const igual = (descripcion, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  resultados.push(ok);
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${descripcion}${ok ? '' : ` -> obtenido ${JSON.stringify(real)}, esperado ${JSON.stringify(esperado)}`}`);
};

// ---------- versionDelToken ----------
console.log('\n== versionDelToken');
igual('token anterior al 004 (sin la propiedad) -> versión 0', versionDelToken({ id: 1 }), 0);
igual('versión 0', versionDelToken({ id: 1, version_sesion: 0 }), 0);
igual('versión 7', versionDelToken({ id: 1, version_sesion: 7 }), 7);
for (const [descripcion, valor] of [
  ['texto "1"', '1'], ['negativo', -1], ['decimal', 1.5], ['null', null], ['booleano', true],
  ['lista', [1]], ['objeto', { v: 1 }], ['NaN', NaN], ['infinito', Infinity]
]) {
  igual(`versión ${descripcion} -> token inválido (null)`, versionDelToken({ id: 1, version_sesion: valor }), null);
}

// ---------- firmarSesion ----------
console.log('\n== firmarSesion');
const cuenta = {
  id: 9, email: 'cuenta@pansys.test', rol_id: 2, panaderia_id: 1, version_sesion: 3,
  contrasena: '$2b$10$hashquenodebeaparecerennada', estado: true
};
const { token, usuario } = firmarSesion(cuenta, 'panadero');
igual('datos públicos devueltos: los mismos campos de siempre', usuario,
  { id: 9, email: 'cuenta@pansys.test', rol: 'panadero', rol_id: 2, panaderia_id: 1 });
const carga = jwt.verify(token, process.env.JWT_SECRET);
igual('el token incluye la versión de sesión actual', carga.version_sesion, 3);
igual('el token conserva los campos de siempre', [carga.id, carga.email, carga.rol, carga.rol_id, carga.panaderia_id],
  [9, 'cuenta@pansys.test', 'panadero', 2, 1]);
igual('ni el token ni los datos incluyen contraseña, hash ni estado',
  [JSON.stringify(carga).includes('contrasena') || JSON.stringify(carga).includes('$2b$') || 'estado' in carga,
   JSON.stringify(usuario).includes('contrasena') || 'version_sesion' in usuario], [false, false]);
igual('duración de 8 horas', carga.exp - carga.iat, 8 * 60 * 60);
igual('versionDelToken lee la versión del token firmado', versionDelToken(carga), 3);
igual('administrador sin panadería -> panaderia_id null',
  firmarSesion({ ...cuenta, rol_id: 1, panaderia_id: undefined }, 'administrador').usuario.panaderia_id, null);

// ---------- cambiarContrasena: el token se firma solo después del COMMIT ----------
const pruebasCambioContrasena = async () => {
  console.log('\n== cambiarContrasena: orden transacción -> COMMIT -> firma');
  const { sequelize, Usuario, Rol } = require('../src/models/index');
  const authService = require('../src/modules/auth/auth.service');

  const originales = { transaction: sequelize.transaction, findOne: Usuario.findOne, findByPk: Rol.findByPk, sign: jwt.sign };
  const hashActual = await bcrypt.hash('Actual123', 4);

  // Estado simulado de la fila y registro de eventos en orden
  let eventos;
  let enBase;          // lo que está confirmado (COMMIT) en la "base"
  let pendiente;       // lo escrito por el intento en curso (se pierde si no hay COMMIT)
  let planIntentos;    // qué pasa en cada intento: 'ok' | 'deadlock' | 'falla-commit'
  let rolFalla;

  const preparar = ({ version = 0, plan = ['ok'], falloRol = false, existe = true } = {}) => {
    eventos = [];
    enBase = { version_sesion: version, contrasena: hashActual, existe };
    pendiente = null;
    planIntentos = [...plan];
    rolFalla = falloRol;
  };

  // Transacción gestionada falsa: ejecuta el callback y después hace COMMIT, o lo deshace todo
  sequelize.transaction = async (fn) => {
    const paso = planIntentos.shift() ?? 'ok';
    const t = { LOCK: { UPDATE: 'UPDATE' } };
    pendiente = null;
    let resultado;
    try {
      resultado = await fn(t);
    } catch (error) {
      eventos.push('rollback');
      throw error;
    }
    if (paso === 'deadlock') {
      eventos.push('rollback-deadlock');
      // Mientras tanto, otra transacción confirmó un cambio de contraseña (versión + 1)
      enBase = { ...enBase, version_sesion: enBase.version_sesion + 1 };
      throw Object.assign(new Error('Deadlock simulado'), { parent: { errno: 1213 } });
    }
    if (paso === 'falla-commit') {
      eventos.push('commit-fallido');
      throw new Error('Fallo simulado del COMMIT');
    }
    if (pendiente) enBase = { ...enBase, ...pendiente };
    eventos.push('commit');
    return resultado;
  };
  Usuario.findOne = async (opciones) => {
    eventos.push(`lectura:${opciones.lock === 'UPDATE' ? 'FOR UPDATE' : 'sin bloqueo'}`);
    if (!enBase.existe) return null;
    const fila = {
      id: 9, email: 'cuenta@pansys.test', rol_id: 2, panaderia_id: 1,
      contrasena: enBase.contrasena, version_sesion: enBase.version_sesion,
      // Como una instancia de Sequelize: update() también cambia los valores del objeto en memoria
      update: async (cambios, op) => {
        eventos.push(`escritura:v${cambios.version_sesion}${op?.transaction ? '' : ':FUERA DE LA TRANSACCION'}`);
        Object.assign(fila, cambios);
        pendiente = { ...cambios };
      }
    };
    return fila;
  };
  Rol.findByPk = async () => {
    if (rolFalla) throw new Error('Fallo simulado dentro de la transacción');
    return { nombre: 'panadero' };
  };
  jwt.sign = (...args) => {
    eventos.push(`firma:v${args[0].version_sesion}`);
    return originales.sign.apply(jwt, args);
  };

  const cambiar = () => authService.cambiarContrasena(9, 'Actual123', 'Nueva12345').then(
    r => ({ ok: true, r }), e => ({ ok: false, e }));

  try {
    // 1. Éxito: la firma va después del COMMIT y lleva la versión confirmada
    preparar({ version: 0 });
    const exito = await cambiar();
    igual('éxito: lectura con bloqueo, escritura, COMMIT y DESPUÉS la firma',
      eventos, ['lectura:FOR UPDATE', 'escritura:v1', 'commit', 'firma:v1']);
    igual('éxito: la respuesta solo tiene mensaje y token', Object.keys(exito.r ?? {}).sort(), ['mensaje', 'token']);
    igual('éxito: el token lleva la versión confirmada (1)', jwt.verify(exito.r.token, process.env.JWT_SECRET).version_sesion, 1);
    igual('éxito: la versión confirmada en la base es 1 y el hash cambió',
      [enBase.version_sesion, enBase.contrasena !== hashActual && await bcrypt.compare('Nueva12345', enBase.contrasena)], [1, true]);
    igual('éxito: la respuesta no expone hash ni versión',
      [JSON.stringify(exito.r).includes('$2'), 'version_sesion' in exito.r], [false, false]);

    // 2. Falla el COMMIT: no se firma ni se devuelve ningún token
    preparar({ version: 0, plan: ['falla-commit'] });
    const sinCommit = await cambiar();
    igual('COMMIT fallido: la operación falla', sinCommit.ok, false);
    igual('COMMIT fallido: no se firmó ningún token', eventos.filter(e => e.startsWith('firma')), []);
    igual('COMMIT fallido: no hay token en el resultado', sinCommit.r?.token, undefined);
    igual('COMMIT fallido: la versión de la base no cambió', enBase.version_sesion, 0);

    // 3. Deadlock y reintento: un solo token, con la versión del intento confirmado
    preparar({ version: 0, plan: ['deadlock', 'ok'] });
    const reintento = await cambiar();
    igual('deadlock: se reintenta y solo se firma tras el COMMIT del segundo intento',
      eventos, ['lectura:FOR UPDATE', 'escritura:v1', 'rollback-deadlock', 'lectura:FOR UPDATE', 'escritura:v2', 'commit', 'firma:v2']);
    igual('deadlock: exactamente una firma', eventos.filter(e => e.startsWith('firma')).length, 1);
    igual('deadlock: el token lleva la versión confirmada (2), no la del intento deshecho',
      jwt.verify(reintento.r.token, process.env.JWT_SECRET).version_sesion, 2);
    igual('deadlock: la base quedó con la versión 2', enBase.version_sesion, 2);

    // 4. Error dentro de la transacción (después de escribir): rollback y sin token
    preparar({ version: 0, falloRol: true });
    const fallaDentro = await cambiar();
    igual('error dentro de la transacción: escritura deshecha y ninguna firma',
      [fallaDentro.ok, eventos, enBase.version_sesion], [false, ['lectura:FOR UPDATE', 'escritura:v1', 'rollback'], 0]);

    // 5. Contraseña actual incorrecta: 400, sin escritura ni firma
    preparar({ version: 0 });
    const incorrecta = await authService.cambiarContrasena(9, 'Equivocada1', 'Nueva12345').then(r => ({ ok: true, r }), e => ({ ok: false, e }));
    igual('contraseña actual incorrecta: 400, sin escritura ni firma',
      [incorrecta.ok, incorrecta.e?.status, eventos], [false, 400, ['lectura:FOR UPDATE', 'rollback']]);

    // 6. Cuenta inexistente o desactivada: 404, sin firma
    preparar({ version: 0, existe: false });
    const inexistente = await cambiar();
    igual('cuenta inexistente o desactivada: 404, sin firma',
      [inexistente.ok, inexistente.e?.status, eventos], [false, 404, ['lectura:FOR UPDATE', 'rollback']]);

    // 7. Validaciones previas: no abren transacción ni firman
    preparar({ version: 0 });
    const igualALaActual = await authService.cambiarContrasena(9, 'Actual123', 'Actual123').then(r => ({ ok: true, r }), e => ({ ok: false, e }));
    igual('nueva igual a la actual: 400 sin abrir la transacción', [igualALaActual.ok, igualALaActual.e?.status, eventos], [false, 400, []]);
  } finally {
    sequelize.transaction = originales.transaction;
    Usuario.findOne = originales.findOne;
    Rol.findByPk = originales.findByPk;
    jwt.sign = originales.sign;
  }
};

pruebasCambioContrasena()
  .catch(error => { resultados.push(false); console.log('FALLA ejecución abortada ->', error.message); })
  .finally(() => {
    const fallidas = resultados.filter(ok => !ok).length;
    console.log(`\n${resultados.length - fallidas}/${resultados.length} pruebas correctas`);
    process.exit(fallidas ? 1 : 0);
  });
