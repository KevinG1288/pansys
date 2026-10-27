// Observador de solapamiento para pruebas de concurrencia con bloqueos FOR UPDATE de MySQL.
//
// Problema: si dos peticiones "simultáneas" llegan en realidad una detrás de otra, el resultado
// final puede ser el mismo con o sin bloqueo, y la prueba no demuestra la serialización.
//
// Solución: envolver, solo durante la prueba, el método que toma el bloqueo (envolverBloqueo) y el
// siguiente método que la transacción usa después (envolverSiguiente). La primera transacción que
// OBTIENE el bloqueo (la retenedora) se detiene en su siguiente paso hasta que la otra transacción
// lo ha PEDIDO, y entonces espera pausaMs más. Si el bloqueo funciona, la otra sigue esperando en
// MySQL durante toda la pausa (otraEsperabaTrasPausa = true); si no, ya lo habría obtenido.
//
// Sin bloqueos indefinidos: la espera a la otra transacción tiene límite (limiteMs) y la pausa es
// fija; después la retenedora continúa siempre, confirma y libera el bloqueo. La otra transacción
// espera como mucho limiteMs + pausaMs, menos que innodb_lock_wait_timeout (50 s por defecto).
// Las transacciones se identifican por el objeto `transaction` de las opciones de Sequelize: las
// llamadas sin transacción (p. ej., las del middleware) y las que no son el bloqueo pasan intactas.

const esperarPorDefecto = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const crearObservadorSolapamiento = ({ esBloqueo, pausaMs = 500, limiteMs = 5000, esperar = esperarPorDefecto, ahora = Date.now } = {}) => {
  if (typeof esBloqueo !== 'function') throw new Error('crearObservadorSolapamiento: falta esBloqueo(opciones)');
  if (!(pausaMs > 0) || !(limiteMs > 0)) throw new Error('crearObservadorSolapamiento: pausaMs y limiteMs deben ser positivos');

  let secuencia = 0;
  const marca = () => ++secuencia;
  const transacciones = new Map(); // transaction -> { solicitado, obtenido }
  let retenedora = null;
  let pausaHecha = false;
  const estado = { tiempoAgotado: false, otraEsperabaTrasPausa: null };

  const otra = () => [...transacciones.entries()].find(([t]) => t !== retenedora)?.[1] ?? null;

  // Envuelve el método que toma el bloqueo (p. ej., Usuario.findAll con lock: UPDATE)
  const envolverBloqueo = (original) => async function (...args) {
    const opciones = args[0];
    const t = opciones?.transaction;
    if (!t || !esBloqueo(opciones)) return original.apply(this, args);
    const registro = { solicitado: marca(), obtenido: null };
    transacciones.set(t, registro);
    const resultado = await original.apply(this, args);
    registro.obtenido = marca();
    if (!retenedora) retenedora = t;
    return resultado;
  };

  // Envuelve el siguiente método de la transacción (p. ej., Usuario.findByPk(id, { transaction }))
  const envolverSiguiente = (original) => async function (...args) {
    const t = args[1]?.transaction;
    if (t && t === retenedora && !pausaHecha) {
      pausaHecha = true;
      const inicio = ahora();
      while (!otra() && ahora() - inicio < limiteMs) await esperar(10);
      if (!otra()) {
        estado.tiempoAgotado = true;
      } else {
        await esperar(pausaMs);
        estado.otraEsperabaTrasPausa = otra().obtenido === null;
      }
    }
    return original.apply(this, args);
  };

  const resultado = () => {
    const r = retenedora ? transacciones.get(retenedora) : null;
    const o = otra();
    return {
      transacciones: transacciones.size,
      pausaHecha,
      tiempoAgotado: estado.tiempoAgotado,
      // La otra pidió el bloqueo antes de que la retenedora lo liberara (solapamiento real)
      solapadas: Boolean(r && o && pausaHecha && !estado.tiempoAgotado),
      otraEsperabaTrasPausa: estado.otraEsperabaTrasPausa,
      // La otra llegó a obtenerlo (después de la retenedora, que por definición lo obtuvo antes).
      // No es la prueba de la serialización: esa es otraEsperabaTrasPausa.
      otraObtuvoDespues: Boolean(r && o && o.obtenido !== null && o.obtenido > r.obtenido)
    };
  };

  return { envolverBloqueo, envolverSiguiente, resultado };
};

module.exports = { crearObservadorSolapamiento };
