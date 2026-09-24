/** Design tokens live in src/index.css as CSS variables (light + navy dark); Tailwind only maps names to them. */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { 50: v('brand-50'), 100: v('brand-100'), 200: v('brand-200'), 500: v('brand-500'), 600: v('brand-600'), 700: v('brand-700'), 800: v('brand-800'), 900: v('brand-900') },
        sky: v('sky'),
        btn: { DEFAULT: v('btn'), hover: v('btn-hover') },
        accent: { 50: v('accent-50'), 100: v('accent-100'), 500: v('accent-500'), 600: v('accent-600'), 700: v('accent-700') },
        gold: { 50: v('gold-50'), 200: v('gold-200'), 500: v('gold-500'), 700: v('gold-700') },
        ink: { 900: v('ink-900'), 700: v('ink-700'), 500: v('ink-500'), 400: v('ink-400'), 300: v('ink-300') },
        line: { DEFAULT: v('line'), strong: v('line-strong') },
        canvas: v('canvas'),
        surface: v('surface'),
        sunken: v('sunken'),
        info: { DEFAULT: v('info'), soft: v('info-soft') },
        progress: { DEFAULT: v('progress'), soft: v('progress-soft') },
        warning: { DEFAULT: v('warning'), soft: v('warning-soft') },
        success: { DEFAULT: v('success'), soft: v('success-soft') },
        danger: { DEFAULT: v('danger'), soft: v('danger-soft') },
        muted: { DEFAULT: v('muted'), soft: v('muted-soft') },
      },
      fontFamily: {
        sans: ['"Nunito Sans"', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      fontWeight: { bold: '700', extrabold: '800', semibold: '700' },
      borderRadius: { lg: '10px', xl: '10px', '2xl': '16px', '3xl': '22px' },
      boxShadow: {
        card: '0 2px 6px rgb(var(--shadow) / 0.05), 0 8px 24px rgb(var(--shadow) / 0.06)',
        raised: '0 4px 10px rgb(var(--shadow) / 0.08), 0 16px 36px rgb(var(--shadow) / 0.12)',
        cta: '0 6px 16px rgb(0 51 161 / 0.28)',
        halo: '0 0 0 4px rgb(var(--brand-100))',
        'halo-gold': '0 0 0 4px rgb(var(--gold-50))',
      },
      keyframes: {
        'fade-up': { from: { opacity: 0, transform: 'translateY(6px)' }, to: { opacity: 1, transform: 'none' } },
        pop: { '0%': { transform: 'scale(.6)', opacity: 0 }, '60%': { transform: 'scale(1.08)', opacity: 1 }, '100%': { transform: 'scale(1)' } },
        draw: { from: { strokeDashoffset: 48 }, to: { strokeDashoffset: 0 } },
        'slide-in': { from: { transform: 'translateX(100%)' }, to: { transform: 'none' } },
        'sheet-up': { from: { transform: 'translateY(100%)' }, to: { transform: 'none' } },
        knob: { '0%': { transform: 'scale(1)' }, '50%': { transform: 'scale(1.18)' }, '100%': { transform: 'scale(1)' } },
      },
      animation: {
        'fade-up': 'fade-up .28s ease-out backwards',
        pop: 'pop .35s cubic-bezier(.2,.8,.3,1.2) both',
        draw: 'draw .45s .15s ease-out both',
        'slide-in': 'slide-in .24s cubic-bezier(.2,.8,.2,1) both',
        'sheet-up': 'sheet-up .26s cubic-bezier(.2,.8,.2,1) both',
        knob: 'knob .3s ease-out',
      },
    },
  },
  plugins: [],
};
