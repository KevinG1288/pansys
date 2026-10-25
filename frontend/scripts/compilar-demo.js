// Compila el frontend para la demo de un solo origen: el backend sirve frontend/build y la
// interfaz llama a la API con rutas relativas (/api/...), así funciona igual en la red local que
// detrás de un enlace público, sin IP ni dominio fijos en el código.
//
// Uso (desde frontend/):  node scripts/compilar-demo.js
//
// REACT_APP_API_URL='/' tiene prioridad sobre frontend/.env (localhost:3000), que sigue sirviendo
// para el desarrollo con `npm start`. Se fija aquí porque PowerShell no permite definir una
// variable de entorno vacía. axios combina '/' + '/api/x' en '/api/x'.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const RAIZ = path.resolve(__dirname, '..');
const BUILD = path.join(RAIZ, 'build');

const r = spawnSync(process.execPath, [require.resolve('react-scripts/bin/react-scripts.js'), 'build'], {
  cwd: RAIZ,
  stdio: 'inherit',
  env: { ...process.env, REACT_APP_API_URL: '/' }
});
if (r.status !== 0) {
  console.error('La compilación falló.');
  process.exit(r.status || 1);
}

// El resultado no debe apuntar a un servidor fijo: localhost/127.0.0.1 con puerto (como
// http://localhost:3000) o una IP. ('http://localhost' sin puerto aparece a propósito en
// lib/sesion.js como base para analizar rutas y no es una dirección de la API.)
const js = path.join(BUILD, 'static', 'js');
const archivos = fs.existsSync(js) ? fs.readdirSync(js).filter(f => f.endsWith('.js')) : [];
const DIRECCION_FIJA = /https?:\/\/(?:(?:localhost|127\.0\.0\.1):\d+|\d{1,3}(?:\.\d{1,3}){3})/;
const conDireccionFija = archivos.filter(f => DIRECCION_FIJA.test(fs.readFileSync(path.join(js, f), 'utf8')));
if (!fs.existsSync(path.join(BUILD, 'index.html')) || archivos.length === 0) {
  console.error('No se generó build/index.html o build/static/js.');
  process.exit(1);
}
if (conDireccionFija.length > 0) {
  console.error(`El build contiene una dirección fija (localhost o IP) en: ${conDireccionFija.join(', ')}`);
  process.exit(1);
}
console.log('\nBuild de la demo listo: la API se llama con rutas relativas (/api/...).');
