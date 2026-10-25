const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { sequelize } = require('./models/index');
const { leerOpciones, montarFrontend, iniciarServidor, ErrorArranque } = require('./config/arranque');
const authRoutes = require('./modules/auth/auth.routes');
const inventarioRoutes = require('./modules/inventario/inventario.routes');
const ventasRoutes = require('./modules/ventas/ventas.routes');
const produccionRoutes = require('./modules/produccion/produccion.routes');
const usuariosRoutes = require('./modules/usuarios/usuarios.routes');
const panaderiasRoutes = require('./modules/panaderias/panaderias.routes');

// PANSYS_MODO_DEMO y PANSYS_SERVIR_FRONTEND (ver config/arranque.js y DEMO.md)
const opciones = leerOpciones();

const app = express();

app.use(cors({ origin: 'http://localhost:3001', credentials: true }));
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/inventario', inventarioRoutes);
app.use('/api/ventas', ventasRoutes);
app.use('/api/produccion', produccionRoutes);
app.use('/api/usuarios', usuariosRoutes);
app.use('/api/panaderias', panaderiasRoutes);

if (opciones.servirFrontend) {
  // Un solo origen: la interfaz compilada y la API en el mismo puerto (sin CORS de por medio)
  montarFrontend(app, opciones.dirFrontend);
} else {
  app.get('/', (req, res) => {
    res.json({ mensaje: 'Pansys API funcionando ✅' });
  });
}

// Solo se verifica la conexión: el esquema lo definen los scripts de backend/database
// (sync() crearía tablas sin los CHECK ni las claves foráneas de esos scripts).
// En modo demo, además, se comprueba que la base sea pansys_test antes de aceptar peticiones.
iniciarServidor({ app, sequelize, opciones })
  .then(() => {
    console.log('Conexión a la base de datos verificada ✅');
    if (opciones.modoDemo) console.log('Modo demo: base pansys_test verificada ✅');
    if (opciones.servirFrontend) console.log(`Sirviendo el frontend compilado desde ${opciones.dirFrontend} ✅`);
    console.log(`Servidor corriendo en puerto ${process.env.PORT} ✅`);
  })
  .catch(err => {
    if (err instanceof ErrorArranque) console.error(`Arranque cancelado: ${err.message}`);
    else console.error('Error:', err);
    process.exitCode = 1;
    sequelize.close().catch(() => {});
  });

module.exports = app;
