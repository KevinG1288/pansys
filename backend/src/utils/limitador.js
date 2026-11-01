// Limitador de intentos en memoria, sin dependencias. Es LOCAL AL PROCESO: cada instancia del
// backend tiene sus propios contadores, que se pierden al reiniciar. No sirve para limitar entre
// varias instancias; los límites que deben sobrevivir a un reinicio se cuentan en la base.
//
// Ventana deslizante: por cada clave se guardan las marcas de tiempo de sus últimos intentos
// (como mucho `maximo`). Un intento cuenta mientras no hayan pasado `ventanaMs` desde que se hizo.
//
// Sin temporizadores: la limpieza de entradas vencidas se hace de forma perezosa, al usar el
// limitador (como mucho una vez cada `intervaloLimpiezaMs` según el reloj), o llamando a
// limpiar(). Nada mantiene vivo el proceso de Node.
//
// Capacidad: como mucho `maxClaves` claves. Si está lleno y llega una clave nueva, primero se
// eliminan las entradas vencidas; si sigue lleno, la clave nueva se RECHAZA (motivo 'capacidad').
// Nunca se descarta una clave con intentos vigentes para hacer sitio: eso reiniciaría su contador
// y permitiría intentos ilimitados (fallo abierto). El precio es que, con la memoria llena,
// las claves nuevas esperan hasta que venza alguna entrada (fallo cerrado).

const LONGITUD_MAXIMA_CLAVE = 200;

const exigirEntero = (valor, nombre, minimo) => {
  if (!Number.isSafeInteger(valor) || valor < minimo) {
    throw new TypeError(`${nombre} debe ser un entero mayor o igual que ${minimo}`);
  }
};

const crearLimitador = ({ maximo, ventanaMs, maxClaves = 10000, reloj = Date.now, intervaloLimpiezaMs } = {}) => {
  exigirEntero(maximo, 'maximo', 1);
  exigirEntero(ventanaMs, 'ventanaMs', 1);
  exigirEntero(maxClaves, 'maxClaves', 1);
  if (typeof reloj !== 'function') throw new TypeError('reloj debe ser una función que devuelva milisegundos');
  const intervalo = intervaloLimpiezaMs ?? ventanaMs;
  exigirEntero(intervalo, 'intervaloLimpiezaMs', 1);

  const entradas = new Map(); // clave -> marcas de tiempo vigentes, en orden de llegada
  let ultimaLimpieza = null;

  const ahora = () => {
    const t = reloj();
    if (!Number.isFinite(t)) throw new TypeError('El reloj devolvió un valor no válido');
    return t;
  };

  const exigirClave = (clave) => {
    if (typeof clave !== 'string' || clave === '' || clave.length > LONGITUD_MAXIMA_CLAVE) {
      throw new TypeError(`La clave debe ser un texto de 1 a ${LONGITUD_MAXIMA_CLAVE} caracteres`);
    }
  };

  // Marcas que siguen dentro de la ventana
  const vigentes = (marcas, t) => marcas.filter(m => t - m < ventanaMs);

  const limpiarVencidas = (t) => {
    for (const [clave, marcas] of entradas) {
      const quedan = vigentes(marcas, t);
      if (quedan.length === 0) entradas.delete(clave);
      else if (quedan.length !== marcas.length) entradas.set(clave, quedan);
    }
    ultimaLimpieza = t;
  };

  const limpiezaPerezosa = (t) => {
    if (ultimaLimpieza === null || t - ultimaLimpieza >= intervalo || t < ultimaLimpieza) limpiarVencidas(t);
  };

  const esperaHastaLiberar = (marcas, t) => Math.max(ventanaMs - (t - marcas[0]), 1);

  const estado = (marcas, t, motivo = null) => {
    const bloqueado = marcas.length >= maximo;
    const retryAfterMs = bloqueado ? esperaHastaLiberar(marcas, t) : 0;
    return {
      permitido: !bloqueado,
      restantes: Math.max(maximo - marcas.length, 0),
      retryAfterMs,
      retryAfterS: bloqueado ? Math.ceil(retryAfterMs / 1000) : 0,
      motivo: bloqueado ? (motivo ?? 'limite') : null
    };
  };

  // Rechazo por capacidad: hasta que venza la entrada que antes lo hará
  const rechazoPorCapacidad = (t) => {
    let espera = ventanaMs;
    for (const marcas of entradas.values()) espera = Math.min(espera, esperaHastaLiberar(marcas, t));
    return { permitido: false, restantes: 0, retryAfterMs: espera, retryAfterS: Math.ceil(espera / 1000), motivo: 'capacidad' };
  };

  // Devuelve las marcas vigentes de la clave, o null si es nueva y no cabe
  const prepararClave = (clave, t) => {
    const marcas = entradas.get(clave);
    if (marcas) {
      const quedan = vigentes(marcas, t);
      if (quedan.length) {
        entradas.set(clave, quedan);
        return quedan;
      }
      entradas.delete(clave);
    }
    if (entradas.size >= maxClaves) limpiarVencidas(t);
    if (entradas.size >= maxClaves) return null;
    return [];
  };

  const anotar = (clave, marcas, t) => {
    marcas.push(t);
    if (marcas.length > maximo) marcas.splice(0, marcas.length - maximo);
    entradas.set(clave, marcas);
  };

  return {
    // Estado de la clave sin anotar ningún intento
    consultar(clave) {
      exigirClave(clave);
      const t = ahora();
      limpiezaPerezosa(t);
      const marcas = entradas.get(clave);
      const quedan = marcas ? vigentes(marcas, t) : [];
      if (!marcas && entradas.size >= maxClaves) {
        limpiarVencidas(t);
        if (entradas.size >= maxClaves) return rechazoPorCapacidad(t);
      }
      return estado(quedan, t);
    },

    // Comprueba y, solo si está permitido, anota el intento (operación atómica en el proceso).
    // Si no está permitido no se anota nada.
    intentar(clave) {
      exigirClave(clave);
      const t = ahora();
      limpiezaPerezosa(t);
      const marcas = prepararClave(clave, t);
      if (marcas === null) return rechazoPorCapacidad(t);
      if (marcas.length >= maximo) return estado(marcas, t);
      anotar(clave, marcas, t);
      return { ...estado(marcas, t), permitido: true, motivo: null, retryAfterMs: 0, retryAfterS: 0 };
    },

    // Anota un intento ya ocurrido (p. ej. un fallo) aunque supere el máximo, y devuelve el estado
    // resultante. Si la clave es nueva y no cabe, no se anota y se informa de rechazo por capacidad.
    registrar(clave) {
      exigirClave(clave);
      const t = ahora();
      limpiezaPerezosa(t);
      const marcas = prepararClave(clave, t);
      if (marcas === null) return rechazoPorCapacidad(t);
      anotar(clave, marcas, t);
      return estado(marcas, t);
    },

    // Olvida los intentos de una clave (p. ej. tras un éxito)
    reiniciar(clave) {
      exigirClave(clave);
      entradas.delete(clave);
    },

    // Elimina todas las entradas vencidas
    limpiar() {
      limpiarVencidas(ahora());
    },

    // Número de claves guardadas (para pruebas y diagnóstico)
    tamano() {
      return entradas.size;
    }
  };
};

module.exports = { crearLimitador, LONGITUD_MAXIMA_CLAVE };
