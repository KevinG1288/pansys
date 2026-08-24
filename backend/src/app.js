const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { sequelize } = require('./models/index');
const authRoutes = require('./modules/auth/auth.routes');
const inventarioRoutes = require('./modules/inventario/inventario.routes');

const app = express();

app.use(cors());
app.use(express.json());

// Rutas
app.use('/api/auth', authRoutes);
app.use('/api/inventario', inventarioRoutes);

// Ruta de prueba
app.get('/', (req, res) => {
  res.json({ mensaje: 'Pansys API funcionando ✅' });
});

// Sincronizar modelos y arrancar servidor
sequelize.sync({ alter: true })
  .then(() => {
    console.log('Base de datos sincronizada ✅');
    app.listen(process.env.PORT, () => {
      console.log(`Servidor corriendo en puerto ${process.env.PORT} ✅`);
    });
  })
  .catch(err => console.error('Error:', err));

module.exports = app;