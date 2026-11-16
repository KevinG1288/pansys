// Ajustes de seguridad de Express que se aplican antes de cualquier ruta (B2 e I3).
//
// trust proxy = 'loopback': Express solo confía en X-Forwarded-For cuando la conexión llega desde
// el propio equipo (127.0.0.0/8 o ::1), donde se ejecutará Caddy. En ese caso req.ip es la dirección
// más a la derecha de la cabecera que no sea de confianza, es decir, la que añade el proxy local; un
// valor que el cliente escriba a la izquierda no se usa. Una conexión que no venga del propio
// equipo nunca usa la cabecera: req.ip es su dirección real.
//
// REQUISITOS DEL DESPLIEGUE (no se pueden comprobar desde el código):
//  - El puerto del backend (PORT) NO debe quedar expuesto públicamente: solo Caddy (80/443) en el
//    cortafuegos del servidor. Cualquier otro proceso local podría enviar X-Forwarded-For.
//  - Caddy debe añadir la dirección real del cliente en X-Forwarded-For (lo hace reverse_proxy).
//    Que además descarte la cabecera que envía el cliente depende de su configuración
//    (trusted_proxies, header_up): debe verificarse en el Caddyfile del servidor antes de publicar.
//    Con 'loopback' Express ya toma la dirección añadida por el proxy local, no la del cliente.
const configurarSeguridad = (app) => {
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  return app;
};

module.exports = { configurarSeguridad };
