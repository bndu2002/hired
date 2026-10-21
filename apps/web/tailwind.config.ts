import type { Config } from 'tailwindcss';

/**
 * Tailwind config. Content globs cover every file where a className might
 * appear so the JIT compiler can tree-shake unused utilities. Design.md calls
 * for Happy Agent's density — compact spacing, small text, utility-first.
 */
const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};

export default config;
