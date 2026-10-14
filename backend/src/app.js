const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { sequelize } = require('./models/index');
const authRoutes = require('./modules/auth/auth.routes');
const inventarioRoutes = require('./modules/inventario/inventario.routes');
const ventasRoutes = require('./modules/ventas/ventas.routes');
const produccionRoutes = require('./modules/produccion/produccion.routes');
const usuariosRoutes = require('./modules/usuarios/usuarios.routes');
const panaderiasRoutes = require('./modules/panaderias/panaderias.routes');

const app = express();

app.use(cors({ origin: 'http://localhost:3001', credentials: true }));
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/inventario', inventarioRoutes);
app.use('/api/ventas', ventasRoutes);
app.use('/api/produccion', produccionRoutes);
app.use('/api/usuarios', usuariosRoutes);
app.use('/api/panaderias', panaderiasRoutes);

app.get('/', (req, res) => {
  res.json({ mensaje: 'Pansys API funcionando ✅' });
});

// Solo se verifica la conexión: el esquema lo definen los scripts de backend/database
// (sync() crearía tablas sin los CHECK ni las claves foráneas de esos scripts)
sequelize.authenticate()
  .then(() => {
    console.log('Conexión a la base de datos verificada ✅');
    app.listen(process.env.PORT, () => {
      console.log(`Servidor corriendo en puerto ${process.env.PORT} ✅`);
    });
  })
  .catch(err => console.error('Error:', err));

module.exports = app;