const jwt = require('jsonwebtoken');

const DURACION_SESION = '8h';

// Datos públicos de la sesión: los que devuelve /login en `usuario` y viajan en el JWT.
// Nunca incluyen la contraseña, su hash ni la versión de sesión.
const datosSesion = (usuario, nombreRol) => ({
  id: usuario.id,
  email: usuario.email,
  rol: nombreRol ?? null,
  rol_id: usuario.rol_id,
  panaderia_id: usuario.panaderia_id ?? null
});

// Firma un JWT con la versión de sesión actual de la cuenta (usuarios.version_sesion)
const firmarSesion = (usuario, nombreRol) => {
  const datos = datosSesion(usuario, nombreRol);
  const token = jwt.sign({ ...datos, version_sesion: usuario.version_sesion }, process.env.JWT_SECRET, {
    expiresIn: DURACION_SESION
  });
  return { token, usuario: datos };
};

// Versión de sesión de un token ya verificado. Los tokens emitidos antes de version_sesion no
// tienen la propiedad y cuentan como versión 0. Cualquier otro valor que no sea un entero >= 0
// (texto, decimal, negativo, null) hace inválido el token: devuelve null.
const versionDelToken = (decoded) => {
  if (!Object.prototype.hasOwnProperty.call(decoded, 'version_sesion')) return 0;
  const version = decoded.version_sesion;
  return Number.isInteger(version) && version >= 0 ? version : null;
};

module.exports = { firmarSesion, versionDelToken };
