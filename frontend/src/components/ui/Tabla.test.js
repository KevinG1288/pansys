import { fireEvent, render, screen, within } from '@testing-library/react';
import { Tabla, TablaEncabezado, TablaCuerpo, TablaFila, TablaColumna, TablaCelda } from './Tabla';

test('la presentación adaptable conserva encabezados, datos y acciones sin duplicarlos', () => {
  const editar = jest.fn();
  render(<Tabla aria-label="Insumos"><TablaEncabezado><tr><TablaColumna>Nombre</TablaColumna><TablaColumna>Cantidad</TablaColumna><TablaColumna>Acciones</TablaColumna></tr></TablaEncabezado>
    <TablaCuerpo><TablaFila><TablaCelda>Harina</TablaCelda><TablaCelda>1,25 kg</TablaCelda><TablaCelda><button onClick={editar}>Editar harina</button></TablaCelda></TablaFila></TablaCuerpo></Tabla>);
  const tabla = within(screen.getByRole('table', { name: 'Insumos' }));
  expect(tabla.getAllByRole('columnheader').map(h => h.textContent)).toEqual(['Nombre', 'Cantidad', 'Acciones']);
  expect(tabla.getAllByRole('cell').map(c => [c.dataset.label, c.textContent])).toEqual([['Nombre', 'Harina'], ['Cantidad', '1,25 kg'], ['Acciones', 'Editar harina']]);
  fireEvent.click(tabla.getByRole('button', { name: 'Editar harina' })); expect(editar).toHaveBeenCalledTimes(1);
  expect(tabla.getAllByText('Harina')).toHaveLength(1);
});
test('las columnas condicionales y el detalle expandido no reciben etiquetas incorrectas', () => {
  render(<Tabla><TablaEncabezado><TablaFila><TablaColumna>Venta</TablaColumna>{false && <TablaColumna>Oculta</TablaColumna>}<TablaColumna>Total</TablaColumna></TablaFila></TablaEncabezado>
    <TablaCuerpo><TablaFila><TablaCelda>#10</TablaCelda>{false && <TablaCelda>Oculta</TablaCelda>}<TablaCelda>$ 500</TablaCelda></TablaFila><TablaFila><TablaCelda colSpan={2}>Detalle de la venta</TablaCelda></TablaFila></TablaCuerpo></Tabla>);
  expect(screen.getByRole('cell', { name: '$ 500' })).toHaveAttribute('data-label', 'Total');
  expect(screen.getByRole('cell', { name: 'Detalle de la venta' })).toHaveAttribute('data-label', '');
});
