import { StrictMode, useRef, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import useCapaModal from './useCapaModal';
import DialogoConfirmacion from './DialogoConfirmacion';

// Capa mínima con tres botones para probar el hook
const Capa = ({ onCerrar }) => {
  const ref = useRef(null);
  useCapaModal({ refCapa: ref, onCerrar });
  return (
    <div ref={ref} tabIndex={-1} role="dialog" aria-label="Capa de prueba">
      <button type="button">Primero</button>
      <button type="button">Medio</button>
      <button type="button">Último</button>
    </div>
  );
};

const Prueba = ({ onCerrar = () => {} }) => {
  const [abierta, setAbierta] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setAbierta(true)}>Abrir</button>
      <button type="button">Fuera</button>
      {abierta && (
        <Capa
          onCerrar={() => {
            onCerrar();
            setAbierta(false);
          }}
        />
      )}
    </>
  );
};

const abrir = () => userEvent.click(screen.getByRole('button', { name: 'Abrir' }));

beforeEach(() => {
  document.body.style.overflow = '';
});

describe('useCapaModal', () => {
  test('al abrir mueve el foco a la capa y bloquea el desplazamiento', () => {
    render(<Prueba />);
    abrir();

    expect(screen.getByRole('dialog')).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');
  });

  test('Escape llama a onCerrar, restaura el desplazamiento anterior y devuelve el foco', () => {
    const onCerrar = jest.fn();
    document.body.style.overflow = 'auto';
    render(<Prueba onCerrar={onCerrar} />);
    abrir();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onCerrar).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('auto');
    expect(screen.getByRole('button', { name: 'Abrir' })).toHaveFocus();
  });

  test('Tab da la vuelta dentro de la capa', () => {
    render(<Prueba />);
    abrir();

    userEvent.tab();
    expect(screen.getByRole('button', { name: 'Primero' })).toHaveFocus();
    userEvent.tab();
    expect(screen.getByRole('button', { name: 'Medio' })).toHaveFocus();
    userEvent.tab();
    expect(screen.getByRole('button', { name: 'Último' })).toHaveFocus();
    userEvent.tab();
    expect(screen.getByRole('button', { name: 'Primero' })).toHaveFocus();
  });

  test('Mayús+Tab da la vuelta hacia atrás y nunca sale de la capa', () => {
    render(<Prueba />);
    abrir();

    userEvent.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Último' })).toHaveFocus();
    userEvent.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Medio' })).toHaveFocus();
    userEvent.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Primero' })).toHaveFocus();
    userEvent.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'Último' })).toHaveFocus();
  });

  test('al desmontarse quita sus oyentes', () => {
    const onCerrar = jest.fn();
    render(<Prueba onCerrar={onCerrar} />);
    abrir();
    fireEvent.keyDown(document, { key: 'Escape' });

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onCerrar).toHaveBeenCalledTimes(1);
  });

  test('con React.StrictMode (efectos dobles) restaura bien el desplazamiento y el foco', () => {
    document.body.style.overflow = 'auto';
    render(
      <StrictMode>
        <Prueba />
      </StrictMode>
    );
    abrir();
    expect(document.body.style.overflow).toBe('hidden');
    expect(screen.getByRole('dialog')).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(document.body.style.overflow).toBe('auto');
    expect(screen.getByRole('button', { name: 'Abrir' })).toHaveFocus();
  });
});

describe('DialogoConfirmacion', () => {
  const renderizarDialogo = (props = {}) => {
    const onConfirmar = jest.fn();
    const onCancelar = jest.fn();
    render(
      <DialogoConfirmacion
        titulo="¿Eliminar «Harina»?"
        descripcion="Dejará de aparecer en el inventario."
        textoConfirmar="Eliminar"
        onConfirmar={onConfirmar}
        onCancelar={onCancelar}
        {...props}
      />
    );
    return { onConfirmar, onCancelar };
  };

  test('es un alertdialog con nombre y descripción, y el foco empieza en Cancelar', () => {
    renderizarDialogo();

    const dialogo = screen.getByRole('alertdialog', { name: '¿Eliminar «Harina»?' });
    expect(dialogo).toHaveAccessibleDescription('Dejará de aparecer en el inventario.');
    expect(dialogo).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus();
  });

  test('Cancelar, Escape y el fondo cancelan; Eliminar confirma', () => {
    const { onConfirmar, onCancelar } = renderizarDialogo();

    userEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    userEvent.click(screen.getByTestId('fondo-dialogo'));
    expect(onCancelar).toHaveBeenCalledTimes(3);
    expect(onConfirmar).not.toHaveBeenCalled();

    userEvent.click(screen.getByRole('button', { name: 'Eliminar' }));
    expect(onConfirmar).toHaveBeenCalledTimes(1);
  });

  test('mientras confirma, ningún botón responde y Escape no cancela', () => {
    const { onConfirmar, onCancelar } = renderizarDialogo({ confirmando: true });

    const eliminar = screen.getByRole('button', { name: 'Eliminar' });
    expect(eliminar).toBeDisabled();
    expect(eliminar).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled();

    fireEvent.keyDown(document, { key: 'Escape' });
    userEvent.click(screen.getByTestId('fondo-dialogo'));
    userEvent.click(eliminar);

    expect(onCancelar).not.toHaveBeenCalled();
    expect(onConfirmar).not.toHaveBeenCalled();
  });

  test('muestra el error dentro del diálogo', () => {
    renderizarDialogo({ error: 'Materia prima no encontrada' });

    expect(screen.getByRole('alert')).toHaveTextContent('Materia prima no encontrada');
  });
});
