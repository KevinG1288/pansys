import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Combina clases condicionales y resuelve conflictos entre utilidades de Tailwind
export function cn(...entradas) {
  return twMerge(clsx(entradas));
}
