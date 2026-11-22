/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['selector', '[data-theme="dark"]'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'var(--bg-canvas)',
        sidebar: 'var(--bg-sidebar)',
        surface: 'var(--bg-surface)',
        elevated: 'var(--bg-elevated)',
        ink: {
          DEFAULT: 'var(--accent-ink)',
          fg: 'var(--accent-ink-fg)',
          primary: 'var(--text-primary)',
          secondary: 'var(--text-secondary)',
        },
        subtle: 'var(--border-subtle)',
        brand: {
          50: '#f4f4f5',
          100: '#e4e4e7',
          600: '#27272a',
          700: '#18181b',
          900: '#09090b',
        },
      },
    },
  },
  plugins: [],
};
