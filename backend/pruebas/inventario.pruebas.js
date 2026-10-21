// Pruebas de integración de Inventario con materia_prima en DECIMAL(12,4) (SQL 003):
// formato, rango y precisión de cantidades y precio, valores inválidos y stock bajo.
// Se ejecutan SOLO contra la base pansys_test: crean y borran materias primas, así que
// abortan si la base conectada es otra o si su esquema no coincide con el de pansys_db.
//
// Uso (desde backend/):  node pruebas/inventario.pruebas.js

process.env.DB_NAME = 'pansys_test';
process.env.PORT = process.env.PORT_PRUEBAS || '3106';
require('dotenv').config({ quiet: true });

const jwt = require('jsonwebtoken');
const { sequelize } = require('../src/models/index');

const URL = `http://localhost:${process.env.PORT}`;
const PREFIJO = 'PRUEBA-INV-';
const MAXIMO = '99999999.9999';

// Usuarios creados por crear_pansys_test.sql
const firmar = (datos) => jwt.sign(datos, process.env.JWT_SECRET, { expiresIn: '10m' });
const TOKENS = {
  admin: firmar({ id: 1, email: 'admin@pansys.test', rol: 'administrador', rol_id: 1, panaderia_id: null }),
  panadero1: firmar({ id: 2, email: 'panadero1@pansys.test', rol: 'panadero', rol_id: 2, panaderia_id: 1 })
};

const resultados = [];
const registrar = (ok, descripcion, detalle = '') => {
  resultados.push({ ok, descripcion });
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${descripcion}${!ok && detalle ? ` -> ${detalle}` : ''}`);
};

const pedir = async (metodo, ruta, usuario, body) => {
  const r = await fetch(URL + ruta, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKENS[usuario]}` },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let datos = null;
  try { datos = await r.json(); } catch { /* sin cuerpo */ }
  return { status: r.status, datos };
};

const esperar = async (descripcion, status, metodo, ruta, usuario, body) => {
  const r = await pedir(metodo, ruta, usuario, body);
  registrar(r.status === status, descripcion, `HTTP ${r.status}: ${JSON.stringify(r.datos)}`);
  return r.datos;
};

const igual = (descripcion, real, esperado) =>
  registrar(JSON.stringify(real) === JSON.stringify(esperado), descripcion,
    `obtenido ${JSON.stringify(real)}, esperado ${JSON.stringify(esperado)}`);

// Valores exactos guardados en la base, como texto (sin pasar por números de JavaScript)
const enBase = async (id) => (await sequelize.query(
  `SELECT CAST(cantidad_disponible AS CHAR) AS disponible, CAST(stock_minimo AS CHAR) AS minimo,
          CAST(precio_unitario AS CHAR) AS precio FROM materia_prima WHERE id = ?`,
  { replacements: [id] }))[0][0];

const contar = async () => (await sequelize.query(
  'SELECT COUNT(*) AS n FROM materia_prima WHERE nombre LIKE ?', { replacements: [`${PREFIJO}%`] }))[0][0].n;

const insumo = (nombre, extra = {}) => ({ nombre: PREFIJO + nombre, unidad_medida: 'kg', ...extra });

const limpiar = () => sequelize.query('DELETE FROM materia_prima WHERE nombre LIKE ?', { replacements: [`${PREFIJO}%`] });

const esperarServidor = async () => {
  for (let i = 0; i < 40; i++) {
    try { await fetch(URL); return; } catch { await new Promise(r => setTimeout(r, 250)); }
  }
  throw new Error('El servidor de pruebas no arrancó');
};

let baseVerificada = false;

const main = async () => {
  // ---------- Protección: solo pansys_test y con el esquema de producción ----------
  await sequelize.authenticate();
  const [[{ base }]] = await sequelize.query('SELECT DATABASE() AS base');
  if (base !== 'pansys_test') {
    throw new Error(`Base conectada "${base}": las pruebas solo se ejecutan sobre pansys_test`);
  }
  // El backend requiere usuarios.version_sesion (SQL 004): sin ella, toda petición autenticada falla
  const [versionSesion] = await sequelize.query(`
    SELECT COUNT(*) AS n FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = 'pansys_test' AND TABLE_NAME = 'usuarios' AND COLUMN_NAME = 'version_sesion'`);
  if (Number(versionSesion[0].n) !== 1) {
    throw new Error('pansys_test no tiene usuarios.version_sesion: aplique database/pruebas/004_version_sesion_pansys_test.sql');
  }
  const [tipos] = await sequelize.query(`
    SELECT COLUMN_NAME AS c, COLUMN_TYPE AS t, IS_NULLABLE AS n, COLUMN_DEFAULT AS d FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = 'pansys_test' AND TABLE_NAME = 'materia_prima'
      AND COLUMN_NAME IN ('cantidad_disponible', 'stock_minimo', 'precio_unitario')`);
  if (tipos.length !== 3 || !tipos.every(f => f.t === 'decimal(12,4)' && f.n === 'NO' && f.d === '0.0000')) {
    throw new Error(`materia_prima de pansys_test no es DECIMAL(12,4) NOT NULL DEFAULT 0.0000: ${JSON.stringify(tipos)}`);
  }
  baseVerificada = true;
  await limpiar();

  require('../src/app');
  await esperarServidor();

  // ---------- Cantidades fraccionarias y precios con decimales ----------
  console.log('\n== Precisión: ida y vuelta exacta');
  const fino = await esperar('crear con 4 decimales en las tres columnas -> 201', 201, 'POST', '/api/inventario', 'panadero1',
    insumo('Fino', { cantidad_disponible: 0.0001, stock_minimo: 0.125, precio_unitario: 12.3456 }));
  igual('la respuesta devuelve números con sus 4 decimales',
    [fino?.cantidad_disponible, fino?.stock_minimo, fino?.precio_unitario], [0.0001, 0.125, 12.3456]);
  igual('en la base quedan exactos', await enBase(fino?.id), { disponible: '0.0001', minimo: '0.1250', precio: '12.3456' });
  const leido = (await pedir('GET', `/api/inventario/${fino?.id}`, 'panadero1')).datos;
  igual('GET devuelve los mismos números', [leido?.cantidad_disponible, leido?.stock_minimo, leido?.precio_unitario], [0.0001, 0.125, 12.3456]);

  const texto = await esperar('valores como texto con punto decimal -> 201', 201, 'POST', '/api/inventario', 'panadero1',
    insumo('Texto', { cantidad_disponible: '25000.125', stock_minimo: ' 2.5 ', precio_unitario: '0.0125' }));
  igual('el texto se convierte en número', [texto?.cantidad_disponible, texto?.stock_minimo, texto?.precio_unitario], [25000.125, 2.5, 0.0125]);
  igual('en la base: 25000.1250 / 2.5000 / 0.0125', await enBase(texto?.id), { disponible: '25000.1250', minimo: '2.5000', precio: '0.0125' });

  const porDefecto = await esperar('sin cantidades ni precio -> 201 con 0', 201, 'POST', '/api/inventario', 'panadero1', insumo('PorDefecto'));
  igual('valores por defecto 0', await enBase(porDefecto?.id), { disponible: '0.0000', minimo: '0.0000', precio: '0.0000' });
  await esperar('cero explícito -> 201', 201, 'POST', '/api/inventario', 'panadero1',
    insumo('Cero', { cantidad_disponible: 0, stock_minimo: '0', precio_unitario: '0.0000' }));

  // ---------- Valores límite ----------
  console.log('\n== Valores límite de DECIMAL(12,4)');
  const maximo = await esperar('máximo 99.999.999,9999 en las tres columnas -> 201', 201, 'POST', '/api/inventario', 'panadero1',
    insumo('Maximo', { cantidad_disponible: MAXIMO, stock_minimo: MAXIMO, precio_unitario: MAXIMO }));
  igual('el máximo se guarda exacto', await enBase(maximo?.id), { disponible: MAXIMO, minimo: MAXIMO, precio: MAXIMO });
  igual('y se devuelve exacto', maximo?.cantidad_disponible, 99999999.9999);

  const antes = await contar();
  for (const [campo, valor] of [
    ['cantidad_disponible', '100000000'], ['stock_minimo', 100000000], ['precio_unitario', '100000000.0000'],
    ['precio_unitario', '99999999.99999']
  ]) {
    const r = await pedir('POST', '/api/inventario', 'panadero1', insumo('Fuera', { [campo]: valor }));
    registrar(r.status === 400 && !/out of range|sql/i.test(r.datos?.error ?? ''), `${campo} = ${valor} -> 400 sin detalles internos`,
      `HTTP ${r.status}: ${JSON.stringify(r.datos)}`);
  }
  igual('ningún valor fuera de rango creó filas', await contar(), antes);

  // ---------- Valores inválidos ----------
  console.log('\n== Valores inválidos');
  const invalidos = [
    ['más de 4 decimales (número)', 1.23456],
    ['más de 4 decimales (texto)', '1.23456'],
    ['negativo', -1],
    ['negativo como texto', '-0.5'],
    ['null', null],
    ['texto vacío', ''],
    ['texto no numérico', 'abc'],
    ['coma decimal', '1,5'],
    ['notación científica', '1e3'],
    ['número muy pequeño (1e-7)', 0.0000001],
    ['booleano', true],
    ['lista', [1]],
    ['objeto', { valor: 1 }]
  ];
  for (const campo of ['cantidad_disponible', 'precio_unitario']) {
    for (const [descripcion, valor] of invalidos) {
      const r = await pedir('POST', '/api/inventario', 'panadero1', insumo('Invalido', { [campo]: valor }));
      registrar(r.status === 400 && (r.datos?.error ?? '').includes(campo), `${campo}: ${descripcion} -> 400 que nombra el campo`,
        `HTTP ${r.status}: ${JSON.stringify(r.datos)}`);
    }
  }
  igual('ningún valor inválido creó filas', await contar(), antes);

  // ---------- Edición ----------
  console.log('\n== Edición (PUT)');
  const editado = await esperar('editar solo el precio con 4 decimales -> 200', 200, 'PUT', `/api/inventario/${fino?.id}`, 'panadero1',
    { precio_unitario: '7.0005' });
  igual('el precio cambia y lo demás se conserva', await enBase(fino?.id), { disponible: '0.0001', minimo: '0.1250', precio: '7.0005' });
  igual('la respuesta devuelve el precio exacto', editado?.precio_unitario, 7.0005);
  await esperar('editar con valor inválido -> 400', 400, 'PUT', `/api/inventario/${fino?.id}`, 'panadero1', { cantidad_disponible: '5.12345' });
  await esperar('editar fuera de rango -> 400', 400, 'PUT', `/api/inventario/${fino?.id}`, 'panadero1', { stock_minimo: '100000000' });
  igual('las ediciones rechazadas no cambian nada', await enBase(fino?.id), { disponible: '0.0001', minimo: '0.1250', precio: '7.0005' });

  // ---------- Stock bajo en el límite ----------
  console.log('\n== Stock bajo en el límite');
  const igualMinimo = (await pedir('POST', '/api/inventario', 'panadero1', insumo('IgualMinimo', { cantidad_disponible: '2.5', stock_minimo: '2.5' }))).datos;
  const porEncima = (await pedir('POST', '/api/inventario', 'panadero1', insumo('PorEncima', { cantidad_disponible: '2.5001', stock_minimo: '2.5' }))).datos;
  const porDebajo = (await pedir('POST', '/api/inventario', 'panadero1', insumo('PorDebajo', { cantidad_disponible: '2.4999', stock_minimo: '2.5' }))).datos;
  const bajos = ((await pedir('GET', '/api/inventario/stock-bajo', 'panadero1')).datos ?? []).map(i => i.id);
  igual('disponible = mínimo aparece en stock bajo', bajos.includes(igualMinimo?.id), true);
  igual('0,0001 por debajo aparece en stock bajo', bajos.includes(porDebajo?.id), true);
  igual('0,0001 por encima NO aparece', bajos.includes(porEncima?.id), false);

  // ---------- Invariantes ----------
  console.log('\n== Invariantes');
  const [[negativos]] = await sequelize.query(
    'SELECT COUNT(*) AS n FROM materia_prima WHERE nombre LIKE ? AND (cantidad_disponible < 0 OR stock_minimo < 0 OR precio_unitario < 0)',
    { replacements: [`${PREFIJO}%`] });
  igual('ninguna materia prima de la prueba con valores negativos', negativos.n, 0);
};

main()
  .catch(error => registrar(false, 'Ejecución abortada', error.message))
  .finally(async () => {
    if (baseVerificada) await limpiar().catch(e => registrar(false, 'Limpieza', e.message));
    const fallidas = resultados.filter(r => !r.ok).length;
    console.log(`\n${resultados.length - fallidas}/${resultados.length} pruebas correctas`);
    await sequelize.close().catch(() => {});
    process.exit(fallidas > 0 ? 1 : 0);
  });
