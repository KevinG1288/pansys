import { leerNumero, MAXIMO_DECIMAL_12_4 } from './validacion';

export const ESTADOS_RED = { pendiente: 'Pendiente', aceptada: 'Aceptada', rechazada: 'Rechazada', cancelada: 'Cancelada' };
export const validarSolicitud = (proveedora, nota, lineas, materias) => {
  if (!proveedora) throw new Error('Selecciona una panadería proveedora.');
  if (nota.trim().length > 255) throw new Error('La nota admite máximo 255 caracteres.');
  if (!lineas.length || lineas.length > 20) throw new Error('La solicitud debe tener entre 1 y 20 líneas.');
  const vistos = new Set();
  return { proveedora_id: Number(proveedora), nota: nota.trim() || null, lineas: lineas.map((l, i) => {
    const id = Number(l.destino);
    if (!materias.some(m => m.id === id)) throw new Error(`Selecciona el insumo de destino de la línea ${i + 1}.`);
    if (vistos.has(id)) throw new Error('Cada insumo de destino solo puede aparecer una vez.');
    vistos.add(id);
    const cantidad = leerNumero(l.cantidad, { maximo: MAXIMO_DECIMAL_12_4 });
    if (cantidad.error || !cantidad.valor) throw new Error(`Cantidad de la línea ${i + 1}: ${cantidad.error || 'debe ser mayor que cero'}.`);
    return { materia_prima_destino_id: id, cantidad: cantidad.valor };
  }) };
};
export const validarOrigenes = (solicitud, seleccion, materias) => {
  const totales = new Map();
  const lineas = solicitud.lineas.map(l => {
    const id = Number(seleccion[l.id]);
    const m = materias.find(m => m.id === id);
    if (!m || m.unidad_medida !== l.unidad_medida) throw new Error(`Selecciona un origen con unidad ${l.unidad_medida} para «${l.nombre}».`);
    totales.set(id, (totales.get(id) || 0) + Math.round(Number(l.cantidad) * 10000));
    return { detalle_id: l.id, materia_prima_origen_id: id };
  });
  for (const [id, cantidad] of totales) {
    const m = materias.find(m => m.id === id);
    if (cantidad > Math.round(Number(m.cantidad_disponible) * 10000)) throw new Error(`No hay stock suficiente de «${m.nombre}» para la suma de las líneas.`);
  }
  return { lineas };
};
