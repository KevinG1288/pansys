// Tailwind 3 para Create React App: CRA lo activa al detectar este archivo.
// El preflight está desactivado para no alterar las pantallas que aún usan estilos en línea;
// los estilos base del diseño nuevo se limitan a .pansys-ui (ver src/index.css).

// Colores del tema definidos como canales RGB en src/index.css (permite opacidad: bg-primary/10)
const color = (variable) => `rgb(var(${variable}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx}'],
  corePlugins: {
    preflight: false
  },
  theme: {
    extend: {
      colors: {
        background: color('--background'),
        foreground: color('--foreground'),
        card: {
          DEFAULT: color('--card'),
          foreground: color('--card-foreground')
        },
        primary: {
          DEFAULT: color('--primary'),
          foreground: color('--primary-foreground')
        },
        secondary: {
          DEFAULT: color('--secondary'),
          foreground: color('--secondary-foreground')
        },
        muted: {
          DEFAULT: color('--muted'),
          foreground: color('--muted-foreground')
        },
        accent: {
          DEFAULT: color('--accent'),
          foreground: color('--accent-foreground')
        },
        destructive: color('--destructive'),
        success: color('--success'),
        warning: { DEFAULT: color('--warning'), foreground: color('--warning-foreground') },
        border: color('--border'),
        input: color('--input'),
        ring: color('--ring'),
        sidebar: {
          DEFAULT: color('--sidebar'),
          foreground: color('--sidebar-foreground'),
          primary: color('--sidebar-primary'),
          'primary-foreground': color('--sidebar-primary-foreground'),
          accent: color('--sidebar-accent'),
          'accent-foreground': color('--sidebar-accent-foreground'),
          border: color('--sidebar-border'),
          ring: color('--sidebar-ring')
        }
      },
      borderRadius: {
        control: 'var(--radius-control)',
        panel: 'var(--radius-panel)',
        sm: 'calc(var(--radius) * 0.6)',
        md: 'calc(var(--radius) * 0.8)',
        lg: 'var(--radius)',
        xl: 'calc(var(--radius) * 1.166667)',
        '2xl': 'calc(var(--radius) * 1.333333)'
      },
      fontFamily: {
        sans: ['"DM Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        serif: ['Fraunces', 'ui-serif', 'Georgia', 'serif']
      },
      boxShadow: {
        panel: '0 1px 3px rgba(40, 37, 33, 0.03), 0 6px 24px -16px rgba(40, 37, 33, 0.12)'
      },
      keyframes: {
        'entrar-izquierda': {
          from: { transform: 'translateX(-100%)' },
          to: { transform: 'translateX(0)' }
        }
      },
      animation: {
        'entrar-izquierda': 'entrar-izquierda 200ms ease-out'
      }
    }
  },
  plugins: []
};
