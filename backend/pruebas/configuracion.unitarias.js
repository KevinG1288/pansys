// Pruebas unitarias de la configuración de la conexión a MySQL (DB_PORT).
//  - leerPuertoBase: valores válidos, ausentes/vacíos (3306) e inválidos (rechazados sin repetir el valor).
//  - database.js real: Sequelize se construye con el puerto validado (sin DB_PORT -> 3306, igual que antes)
//    y un DB_PORT no válido detiene la carga ANTES de construir Sequelize.
// Sin MySQL: DB_HOST apunta a un dominio .invalid y CUALQUIER conexión de red queda bloqueada y contada
// (construir Sequelize no conecta; se comprueba que no hubo ningún intento).
//
// Uso (desde backend/):  node pruebas/configuracion.unitarias.js

const net = require('net');
let intentosDeRed = 0;
net.Socket.prototype.connect = function () { intentosDeRed++; throw new Error('Red bloqueada en las pruebas de configuración'); };
process.env.DB_HOST = 'base-inexistente.invalid';
process.env.DB_NAME = 'sin_base_pruebas_unitarias';
process.env.DB_USER = 'doble';
process.env.DB_PASSWORD = 'doble';
delete process.env.DB_PORT;

const path = require('path');
const { PUERTO_POR_DEFECTO, leerPuertoBase } = require('../src/config/puertoBase');

const resultados = [];
const igual = (descripcion, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  resultados.push(ok);
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${descripcion}${ok ? '' : ` -> obtenido ${JSON.stringify(real)}, esperado ${JSON.stringify(esperado)}`}`);
};
const lanza = (fn) => { try { fn(); return null; } catch (e) { return e; } };

console.log('== leerPuertoBase');
igual('puerto por defecto = 3306', PUERTO_POR_DEFECTO, 3306);
igual('sin definir -> 3306', leerPuertoBase(undefined), 3306);
igual('vacío -> 3306', leerPuertoBase(''), 3306);
for (const [v, n] of [['3306', 3306], ['3317', 3317], ['1', 1], ['65535', 65535], ['80', 80]]) igual(`'${v}' -> ${n}`, leerPuertoBase(v), n);
const invalidos = ['0', '65536', '99999', '100000', '-1', '+3317', ' 3317', '3317 ', '03317', '00', '33.17', '3317.0', '1e3', '0x10', '3317a', 'abc', ' ', 'NaN', 'Infinity'];
for (const v of invalidos) {
  const e = lanza(() => leerPuertoBase(v));
  igual(`rechaza ${JSON.stringify(v)} sin repetir el valor en el mensaje`, [!!e, !!e && /DB_PORT debe ser un entero entre 1 y 65535/.test(e.message), !!e && v.trim() !== '' && e.message.includes(v.trim()) && !'1 65535 3306'.includes(v.trim())], [true, true, false]);
}
for (const v of [3317, null, true, {}, ['3317']]) igual(`rechaza tipos que no son texto (${JSON.stringify(v)})`, !!lanza(() => leerPuertoBase(v)), true);

console.log('\n== database.js real (construye Sequelize sin conectar)');
const RUTA_DB = path.join(__dirname, '../src/config/database.js');
const cargarDatabase = (puerto) => {
  delete require.cache[require.resolve(RUTA_DB)];
  if (puerto === undefined) delete process.env.DB_PORT; else process.env.DB_PORT = puerto;
  try { return { sequelize: require(RUTA_DB) }; } catch (e) { return { error: e }; }
};
{
  const { sequelize } = cargarDatabase(undefined);
  igual('sin DB_PORT: Sequelize con puerto 3306 (comportamiento anterior) y el mismo host', [sequelize.config.port, sequelize.config.host], [3306, 'base-inexistente.invalid']);
  igual('sin DB_PORT: dialecto, logging y decimalNumbers sin cambios', [sequelize.getDialect(), sequelize.options.logging, sequelize.options.dialectOptions], ['mysql', false, { decimalNumbers: true }]);
}
igual('DB_PORT vacío: 3306', cargarDatabase('').sequelize.config.port, 3306);
igual('DB_PORT=3317: Sequelize con puerto 3317', cargarDatabase('3317').sequelize.config.port, 3317);
igual('DB_PORT=3306: Sequelize con puerto 3306', cargarDatabase('3306').sequelize.config.port, 3306);
for (const v of ['abc', '0', '65536', ' 3317']) {
  const r = cargarDatabase(v);
  igual(`DB_PORT=${JSON.stringify(v)}: database.js lanza al cargarse (no construye Sequelize)`, [!!r.error, !r.sequelize, /DB_PORT/.test(r.error?.message ?? '')], [true, true, true]);
}
delete process.env.DB_PORT;
igual('ningún intento de conexión de red en toda la suite', intentosDeRed, 0);

const fallidas = resultados.filter(r => !r).length;
console.log(`\n${resultados.length - fallidas}/${resultados.length} pruebas correctas`);
process.exit(fallidas ? 1 : 0);
