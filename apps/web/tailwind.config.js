/** Design tokens live in src/index.css as CSS variables; Tailwind only maps names to them. */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { 50: v('brand-50'), 100: v('brand-100'), 200: v('brand-200'), 500: v('brand-500'), 600: v('brand-600'), 700: v('brand-700'), 800: v('brand-800'), 900: v('brand-900') },
        accent: { 50: v('accent-50'), 100: v('accent-100'), 500: v('accent-500'), 600: v('accent-600'), 700: v('accent-700') },
        ink: { 900: v('ink-900'), 700: v('ink-700'), 500: v('ink-500'), 400: v('ink-400'), 300: v('ink-300') },
        line: v('line'),
        canvas: v('canvas'),
        surface: v('surface'),
        info: { DEFAULT: v('info'), soft: v('info-soft') },
        progress: { DEFAULT: v('progress'), soft: v('progress-soft') },
        warning: { DEFAULT: v('warning'), soft: v('warning-soft') },
        success: { DEFAULT: v('success'), soft: v('success-soft') },
        danger: { DEFAULT: v('danger'), soft: v('danger-soft') },
        muted: { DEFAULT: v('muted'), soft: v('muted-soft') },
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', '"Segoe UI"', 'Roboto', '"Helvetica Neue"', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      borderRadius: { xl: '14px', '2xl': '18px', '3xl': '24px' },
      boxShadow: {
        card: '0 1px 2px rgb(28 27 25 / 0.05), 0 2px 8px rgb(28 27 25 / 0.04)',
        raised: '0 2px 4px rgb(28 27 25 / 0.06), 0 10px 24px rgb(28 27 25 / 0.08)',
        cta: '0 1px 0 rgb(255 255 255 / 0.25) inset, 0 6px 16px rgb(15 94 91 / 0.28)',
      },
      keyframes: {
        'fade-up': { from: { opacity: 0, transform: 'translateY(6px)' }, to: { opacity: 1, transform: 'none' } },
        pop: { '0%': { transform: 'scale(.6)', opacity: 0 }, '60%': { transform: 'scale(1.08)', opacity: 1 }, '100%': { transform: 'scale(1)' } },
        draw: { from: { strokeDashoffset: 48 }, to: { strokeDashoffset: 0 } },
      },
      animation: {
        'fade-up': 'fade-up .2s ease-out both',
        pop: 'pop .35s cubic-bezier(.2,.8,.3,1.2) both',
        draw: 'draw .45s .15s ease-out both',
      },
    },
  },
  plugins: [],
};
