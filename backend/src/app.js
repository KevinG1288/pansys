const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { sequelize } = require('./models/index');
const authRoutes = require('./modules/auth/auth.routes');
const inventarioRoutes = require('./modules/inventario/inventario.routes');
const ventasRoutes = require('./modules/ventas/ventas.routes');

const app = express();

app.use(cors({ origin: 'http://localhost:3001', credentials: true }));
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/inventario', inventarioRoutes);
app.use('/api/ventas', ventasRoutes);

app.get('/', (req, res) => {
  res.json({ mensaje: 'Pansys API funcionando ✅' });
});

sequelize.sync({ alter: false })
  .then(() => {
    console.log('Base de datos sincronizada ✅');
    app.listen(process.env.PORT, () => {
      console.log(`Servidor corriendo en puerto ${process.env.PORT} ✅`);
    });
  })
  .catch(err => console.error('Error:', err));

module.exports = app;