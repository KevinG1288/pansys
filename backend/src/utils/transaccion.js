const { esDeadlock } = require('./errores');

// Ejecuta fn dentro de una transacción. Si MySQL detecta un deadlock, la transacción
// completa ya fue revertida y se puede repetir con seguridad (hasta `intentos` veces).
// Las opciones son locales a cada intento; omitirlas conserva la llamada histórica transaction(fn).
const enTransaccion = async (sequelize, fn, intentos = 3, opciones) => {
  for (let intento = 1; ; intento++) {
    try {
      return await (opciones ? sequelize.transaction(opciones, fn) : sequelize.transaction(fn));
    } catch (error) {
      if (!esDeadlock(error) || intento >= intentos) throw error;
    }
  }
};

module.exports = { enTransaccion };
