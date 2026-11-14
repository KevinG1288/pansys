// Límites de intentos FALLIDOS de inicio de sesión (en memoria, sin dependencias).
//
// - Por IP: como mucho `maxIp` fallos en la ventana (frena probar muchas cuentas desde un origen).
// - Por cuenta: como mucho `maxCuenta` fallos en la ventana. La clave es el SHA-256 del correo, se
//   aplica exista o no la cuenta (no revela qué correos están registrados).
// - Solo cuentan los fallos de credenciales: un inicio de sesión correcto no consume intentos.
// - Ventana deslizante finita (`ventanaMs`): un intento rechazado por el límite NO se anota, así que
//   seguir intentando no alarga el bloqueo; se libera, como mucho, `ventanaMs` después del último
//   fallo anotado.
// - Concurrencia: comprobar y reservar es síncrono (atómico dentro del proceso de Node). Cada
//   intento en curso cuenta como un fallo potencial hasta que termina, así que N peticiones
//   simultáneas no pueden superar el límite aunque todas pasen la comprobación antes de que la
//   primera termine. Toda reserva se libera en un finally (liberar es idempotente).
// - Es LOCAL AL PROCESO: se reinicia con el backend y no sirve para varias instancias.
const { crearLimitador } = require('../../utils/limitador');
const { claveIp, claveCorreo } = require('../../utils/limites');

const MINUTO = 60 * 1000;

const crearLimitesLogin = ({ maxIp = 10, maxCuenta = 5, ventanaMs = 15 * MINUTO, maxClaves = 20000, reloj = Date.now } = {}) => {
  const porIp = crearLimitador({ maximo: maxIp, ventanaMs, maxClaves, reloj });
  const porCuenta = crearLimitador({ maximo: maxCuenta, ventanaMs, maxClaves, reloj });
  const enCurso = new Map(); // clave -> intentos sin terminar
  const pendientes = (clave) => enCurso.get(clave) ?? 0;
  const sumar = (clave, delta) => {
    const n = pendientes(clave) + delta;
    if (n > 0) enCurso.set(clave, n); else enCurso.delete(clave);
  };

  // Bloqueado si el límite ya se alcanzó (o no hay capacidad), o si los fallos anotados más los
  // intentos en curso llegan al máximo
  const evaluar = (limitador, clave, maximo) => {
    const estado = limitador.consultar(clave);
    if (!estado.permitido) return { bloqueado: true, retryAfterS: Math.max(1, estado.retryAfterS) };
    const usados = maximo - estado.restantes;
    if (usados + pendientes(clave) >= maximo) return { bloqueado: true, retryAfterS: 1 };
    return { bloqueado: false };
  };

  const reservar = ({ ip, email }) => {
    const kIp = claveIp(ip);
    const kCuenta = claveCorreo(typeof email === 'string' ? email : '');
    // La tabla de intentos en curso también está acotada: si se llenara, se rechaza (fallo cerrado)
    if (enCurso.size >= maxClaves) return { permitido: false, retryAfterS: 1 };
    const bloqueos = [evaluar(porIp, kIp, maxIp), evaluar(porCuenta, kCuenta, maxCuenta)].filter(e => e.bloqueado);
    if (bloqueos.length > 0) return { permitido: false, retryAfterS: Math.max(...bloqueos.map(b => b.retryAfterS)) };
    sumar(kIp, 1);
    sumar(kCuenta, 1);
    let liberada = false;
    return {
      permitido: true,
      // fallo = true solo si las credenciales no eran válidas. Un error interno no cuenta como fallo.
      liberar(fallo) {
        if (liberada) return;
        liberada = true;
        sumar(kIp, -1);
        sumar(kCuenta, -1);
        if (fallo) {
          porIp.registrar(kIp);
          porCuenta.registrar(kCuenta);
        }
      }
    };
  };

  return { reservar, enCurso: () => enCurso.size };
};

module.exports = { crearLimitesLogin };
