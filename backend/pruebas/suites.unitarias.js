// Pruebas unitarias de comportamiento de las suites de integración y del observador de solapamiento.
// No usan MySQL ni la red:
//  1. pruebas/solapamiento.js con un cerrojo simulado: detecta el solapamiento real, la falta de
//     bloqueo y las peticiones que no se solapan, y nunca espera sin límite.
//  2. Cada suite de integración (inventario, ventas, produccion, usuarios) se carga en un proceso
//     hijo con pruebas/arnes.suites.js, donde la base, el aislamiento, el servidor y fetch son dobles
//     y la red está bloqueada. Se comprueba lo que la suite INTENTA hacer cuando la base no es
//     pansys_test, cuando el bloqueo de suite está ocupado y cuando el servidor no confirma su
//     identidad: qué consulta, qué escribe, qué peticiones envía y en qué orden cierra.
//
// Uso (desde backend/):  node pruebas/suites.unitarias.js

const path = require('path');
const { spawnSync } = require('child_process');
const { crearObservadorSolapamiento } = require('./solapamiento');

const resultados = [];
const igual = (descripcion, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  resultados.push(ok);
  console.log(`${ok ? 'OK   ' : 'FALLA'} ${descripcion}${ok ? '' : ` -> obtenido ${JSON.stringify(real)}, esperado ${JSON.stringify(esperado)}`}`);
};
const dormir = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ---------- 1. Observador de solapamiento ----------
// Cerrojo como un FOR UPDATE: el segundo que lo pide espera hasta que el primero lo suelta
const crearCerrojo = () => {
  let ocupado = false;
  const cola = [];
  return {
    tomar: () => new Promise(resolve => { if (!ocupado) { ocupado = true; resolve(); } else cola.push(resolve); }),
    soltar: () => { const siguiente = cola.shift(); if (siguiente) siguiente(); else ocupado = false; }
  };
};
const BLOQUEO = { lock: 'UPDATE', where: { rol_id: 1, estado: true } };
const esBloqueo = (op) => Boolean(op?.lock) && op?.where?.rol_id === 1 && op?.where?.estado === true;

// Modelo simulado: findAll toma el cerrojo (si conCerrojo) y findByPk lee; la "transacción" suelta
// el cerrojo al confirmar
const escenarioModelo = ({ conCerrojo }) => {
  const cerrojo = crearCerrojo();
  const modelo = {
    nombre: 'Usuario',
    async findAll(op) { if (conCerrojo && op?.lock) await cerrojo.tomar(); return [{ id: 1, de: this.nombre }]; },
    async findByPk(id) { return { id, de: this.nombre }; }
  };
  const transaccion = async (t) => {
    await modelo.findAll({ ...BLOQUEO, transaction: t });
    await modelo.findByPk(10, { transaction: t, lock: 'UPDATE' });
    await dormir(5);
    if (conCerrojo) cerrojo.soltar(); // COMMIT
  };
  return { modelo, transaccion };
};
const instalar = (modelo, observador) => {
  modelo.findAll = observador.envolverBloqueo(modelo.findAll);
  modelo.findByPk = observador.envolverSiguiente(modelo.findByPk);
};

const pruebasSolapamiento = async () => {
  console.log('\n== solapamiento.js: observador con un cerrojo simulado');
  {
    const { modelo, transaccion } = escenarioModelo({ conCerrojo: true });
    const observador = crearObservadorSolapamiento({ esBloqueo, pausaMs: 60, limiteMs: 1000 });
    instalar(modelo, observador);
    await Promise.all([transaccion({ id: 'T1' }), transaccion({ id: 'T2' })]);
    igual('con bloqueo real y peticiones simultáneas: solapadas, la segunda esperó durante la pausa y después lo obtuvo',
      observador.resultado(), { transacciones: 2, pausaHecha: true, tiempoAgotado: false, solapadas: true, otraEsperabaTrasPausa: true, otraObtuvoDespues: true });
  }
  {
    const { modelo, transaccion } = escenarioModelo({ conCerrojo: false });
    const observador = crearObservadorSolapamiento({ esBloqueo, pausaMs: 60, limiteMs: 1000 });
    instalar(modelo, observador);
    await Promise.all([transaccion({ id: 'T1' }), transaccion({ id: 'T2' })]);
    igual('sin bloqueo: la segunda NO esperó (otraEsperabaTrasPausa = false)', observador.resultado().otraEsperabaTrasPausa, false);
  }
  {
    const { modelo, transaccion } = escenarioModelo({ conCerrojo: true });
    const observador = crearObservadorSolapamiento({ esBloqueo, pausaMs: 60, limiteMs: 150 });
    instalar(modelo, observador);
    const inicio = Date.now();
    await transaccion({ id: 'T1' });
    await transaccion({ id: 'T2' });
    const duracion = Date.now() - inicio;
    const r = observador.resultado();
    igual('peticiones una detrás de otra: no se solapan, se agota la espera y se detecta', [r.solapadas, r.tiempoAgotado, r.otraEsperabaTrasPausa], [false, true, null]);
    igual('la espera tiene límite: termina en menos de límite + 1 s', duracion < 150 + 1000, true);
  }
  {
    const { modelo, transaccion } = escenarioModelo({ conCerrojo: true });
    const observador = crearObservadorSolapamiento({ esBloqueo, pausaMs: 60, limiteMs: 150 });
    instalar(modelo, observador);
    await transaccion({ id: 'sola' });
    igual('una sola transacción: no hay solapamiento y la espera se agota sin bloquearse',
      [observador.resultado().transacciones, observador.resultado().solapadas, observador.resultado().tiempoAgotado], [1, false, true]);
  }
  {
    const { modelo } = escenarioModelo({ conCerrojo: true });
    const observador = crearObservadorSolapamiento({ esBloqueo, pausaMs: 60, limiteMs: 150 });
    instalar(modelo, observador);
    const sinTransaccion = await modelo.findAll({ ...BLOQUEO });
    const otraLectura = await modelo.findAll({ where: { id: 3 }, transaction: { id: 'T' } });
    const lecturaSinT = await modelo.findByPk(4);
    igual('las llamadas sin transacción o que no son el bloqueo pasan intactas (mismo this) y no cuentan',
      [sinTransaccion[0].de, otraLectura[0].de, lecturaSinT.de, observador.resultado().transacciones], ['Usuario', 'Usuario', 'Usuario', 0]);
  }
  {
    let error = null;
    try { crearObservadorSolapamiento({ pausaMs: 1 }); } catch (e) { error = e.message; }
    igual('sin esBloqueo -> error de configuración', /falta esBloqueo/.test(error ?? ''), true);
  }
};

// ---------- 2. Suites de integración cargadas en el arnés ----------
const ARNES = path.join(__dirname, 'arnes.suites.js');
const enArnes = (archivo, escenario) => {
  const r = spawnSync(process.execPath, [ARNES, path.join(__dirname, archivo), JSON.stringify(escenario)], {
    encoding: 'utf8',
    timeout: 30000,
    // Entorno mínimo: sin credenciales, sin variables del demo y con un host inexistente
    env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, DB_HOST: 'base-inexistente.invalid', DB_NAME: 'sin_base_pruebas_unitarias' }
  });
  const m = (r.stderr ?? '').match(/<<REGISTRO:(.*)>>/);
  return { status: r.status, senal: r.signal, registro: m ? JSON.parse(m[1]) : null, salida: r.stdout ?? '' };
};
const contar = (orden, evento) => orden.filter(e => e === evento).length;
const soloLecturas = (consultas) => consultas.every(c => /^\s*SELECT\s/i.test(c));

// Motivo del aborto: las suites informan "FALLA Ejecución abortada -> <mensaje>". Un escenario solo
// es correcto si hay EXACTAMENTE una línea de aborto y su mensaje empieza por el motivo esperado; un
// código 1 por cualquier otro error (p. ej., un TypeError antes de la condición) no vale.
const MOTIVOS = {
  base: 'Base conectada "pansys_db": las pruebas solo se ejecutan sobre pansys_test',
  ocupado: 'Otra suite de integración está en curso',
  identidad: 'El servidor no confirmó el runId de esta ejecución'
};
const lineasDeAborto = (salida) => salida.split(/\r?\n/).filter(l => l.startsWith('FALLA Ejecución abortada -> '));
const abortadaPor = (salida, motivo) => {
  const lineas = lineasDeAborto(salida);
  return lineas.length === 1 && lineas[0].slice('FALLA Ejecución abortada -> '.length).startsWith(motivo);
};

const SUITES = [
  ['inventario.pruebas.js', 'inventario'],
  ['ventas.pruebas.js', 'ventas'],
  ['produccion.pruebas.js', 'produccion'],
  ['usuarios.pruebas.js', 'usuarios']
];

const pruebasSuites = () => {
  for (const [archivo, suite] of SUITES) {
    console.log(`\n== ${archivo} en el arnés (dobles de base, aislamiento, servidor y fetch; sin red)`);

    // a) La base conectada no es pansys_test: no toma el bloqueo, no arranca el servidor, no escribe
    {
      const { status, registro: g, salida } = enArnes(archivo, { base: 'pansys_db' });
      igual(`${archivo}, base pansys_db: se consultó la base conectada y aborta exactamente por base incorrecta`,
        [g?.consultas?.includes('SELECT DATABASE() AS base'), abortadaPor(salida, MOTIVOS.base)], [true, true]);
      igual(`${archivo}, base pansys_db: código 1, sin iniciarEjecucion, sin servidor, sin peticiones, sin escrituras`,
        [status, g && g.orden.filter(e => e.startsWith('ejecucion:') || e.startsWith('app:')), g?.peticiones, g?.modelos, g && soloLecturas(g.consultas)],
        [1, [], [], [], true]);
      igual(`${archivo}, base pansys_db: cierra Sequelize, sin red ni cargas bloqueadas`,
        [g && contar(g.orden, 'sequelize:close'), g?.red, g?.cargasBloqueadas], [1, [], []]);
    }

    // b) El bloqueo de suite está ocupado: nada escrito, sin servidor ni limpieza
    {
      const { status, registro: g, salida } = enArnes(archivo, { base: 'pansys_test', bloqueoOcupado: true });
      igual(`${archivo}, bloqueo ocupado: aborta exactamente porque otra suite de integración está en curso`,
        abortadaPor(salida, MOTIVOS.ocupado), true);
      igual(`${archivo}, bloqueo ocupado: código 1, solo el intento de iniciarEjecucion('${suite}'), sin servidor, peticiones ni escrituras`,
        [status, g && g.orden.filter(e => e.startsWith('ejecucion:') || e.startsWith('app:')), g?.peticiones, g?.modelos, g && soloLecturas(g.consultas)],
        [1, [`ejecucion:iniciarEjecucion:${suite}`], [], [], true]);
      igual(`${archivo}, bloqueo ocupado: cierra Sequelize, sin red ni cargas bloqueadas`,
        [g && contar(g.orden, 'sequelize:close'), g?.red, g?.cargasBloqueadas], [1, [], []]);
    }

    // c) El servidor no confirma su identidad (sin red / otro runId): ningún token sale del proceso
    for (const identidad of ['falla', 'otroRunId']) {
      const { status, registro: g, salida } = enArnes(archivo, { base: 'pansys_test', identidad });
      const orden = g?.orden ?? [];
      igual(`${archivo}, identidad ${identidad}: aborta exactamente porque el servidor no confirmó el runId`,
        abortadaPor(salida, MOTIVOS.identidad), true);
      igual(`${archivo}, identidad ${identidad}: código 1 y una única petición, a la ruta de identidad y SIN token`,
        [status, g?.peticiones?.length, g?.peticiones?.[0]?.url?.endsWith('/api/__aislamiento/0123456789abcdef'), g?.peticiones?.some(p => p.conToken)],
        [1, 1, true, false]);
      igual(`${archivo}, identidad ${identidad}: escrituras solo con las del módulo de aislamiento (ningún modelo, solo SELECT)`,
        [g?.modelos, g && soloLecturas(g.consultas), orden.filter(e => e.startsWith('ejecucion:')).every(e => /^ejecucion:(iniciarEjecucion:|crearCuenta$|crearPanaderia$|crearProducto$|registrar$|exigirBloqueo$|limpiar$|cerrar$)/.test(e))],
        [[], true, true]);
      const i = ['app:close', 'ejecucion:limpiar', 'ejecucion:cerrar', 'sequelize:close'].map(e => orden.indexOf(e));
      igual(`${archivo}, identidad ${identidad}: limpiar() y cerrar() exactamente una vez, en orden servidor -> limpiar -> cerrar -> Sequelize`,
        [contar(orden, 'ejecucion:limpiar'), contar(orden, 'ejecucion:cerrar'), contar(orden, 'sequelize:close'), i.every(x => x >= 0) && i.every((x, k) => k === 0 || x > i[k - 1])],
        [1, 1, 1, true]);
      igual(`${archivo}, identidad ${identidad}: sin red ni cargas bloqueadas`, [g?.red, g?.cargasBloqueadas], [[], []]);
    }

    // d) Controles negativos: un error inesperado (TypeError) justo antes de cada condición también
    // termina con código 1, pero la comprobación del motivo NO debe darlo por bueno
    for (const [descripcion, escenario, motivo, verificar] of [
      ['TypeError antes de comprobar la base', { base: 'pansys_db', errorEn: 'authenticate' }, MOTIVOS.base,
        (g) => g?.consultas?.includes('SELECT DATABASE() AS base') === false],
      ['TypeError en lugar del bloqueo ocupado', { base: 'pansys_test', bloqueoOcupado: true, errorEn: 'iniciarEjecucion' }, MOTIVOS.ocupado,
        () => true],
      ['TypeError antes de confirmar la identidad', { base: 'pansys_test', identidad: 'falla', errorEn: 'crearCuenta' }, MOTIVOS.identidad,
        (g) => (g?.peticiones?.length ?? -1) === 0]
    ]) {
      const { status, registro: g, salida } = enArnes(archivo, escenario);
      const lineas = lineasDeAborto(salida);
      igual(`${archivo}, control (${descripcion}): código 1 por el error simulado, y el motivo esperado NO se acepta`,
        [status, lineas.length === 1 && lineas[0].includes('Error inesperado simulado'), abortadaPor(salida, motivo), verificar(g)],
        [1, true, false, true]);
    }
  }
};

pruebasSolapamiento()
  .then(pruebasSuites)
  .catch(error => { resultados.push(false); console.log('FALLA ejecución abortada ->', error.message); })
  .finally(() => {
    const fallidas = resultados.filter(ok => !ok).length;
    console.log(`\n${resultados.length - fallidas}/${resultados.length} pruebas correctas`);
    process.exit(fallidas ? 1 : 0);
  });
