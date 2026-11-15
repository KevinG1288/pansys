// Puerto de MySQL (DB_PORT), opcional.
//  - Sin definir o vacío: 3306, el puerto que mysql2 usaba por defecto antes de admitir DB_PORT
//    (el comportamiento no cambia para quien no lo define).
//  - Si se define: entero decimal entre 1 y 65535, sin signos, espacios, decimales ni ceros a la
//    izquierda. Cualquier otro valor detiene el arranque ANTES de conectar (database.js lo valida al
//    cargarse). El mensaje no repite el valor recibido.
const PUERTO_POR_DEFECTO = 3306;

const leerPuertoBase = (valor) => {
  if (valor === undefined || valor === '') return PUERTO_POR_DEFECTO;
  if (typeof valor !== 'string' || !/^[1-9][0-9]{0,4}$/.test(valor) || Number(valor) > 65535) {
    throw new Error('DB_PORT debe ser un entero entre 1 y 65535 (o no definirse para usar 3306). El servidor no arranca.');
  }
  return Number(valor);
};

module.exports = { PUERTO_POR_DEFECTO, leerPuertoBase };
