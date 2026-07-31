/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        mf: {
          // Structural surfaces/text are CSS variables so the shell can switch
          // between dark (default) and light themes (see :root rules in index.css).
          // `<alpha-value>` keeps Tailwind opacity utilities (e.g. bg-mf-panel/40) working.
          bg:       'rgb(var(--mf-bg) / <alpha-value>)',
          card:     'rgb(var(--mf-card) / <alpha-value>)',
          panel:    'rgb(var(--mf-panel) / <alpha-value>)',
          border:   'rgb(var(--mf-border) / <alpha-value>)',
          hover:    'rgb(var(--mf-hover) / <alpha-value>)',
          txt:      'rgb(var(--mf-txt) / <alpha-value>)',
          txt2:     'rgb(var(--mf-txt2) / <alpha-value>)',
          txt3:     'rgb(var(--mf-txt3) / <alpha-value>)',
          txt4:     'rgb(var(--mf-txt4) / <alpha-value>)',
          // Accent hues read well on both themes — kept as fixed values.
          gold:     '#F59E0B',
          'gold-lt': '#FCD34D',
          'gold-dk': '#B45309',
          teal:     '#14B8A6',
          'teal-lt': '#2DD4BF',
          'teal-dk': '#0F766E',
          red:      '#F06B6B',
          green:    '#2ECC8A',
          blue:     '#5BA4F5',
          purple:   '#9D78F0',
          orange:   '#F88A44',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', '"JetBrains Mono"', 'monospace'],
      },
      animation: {
        'fade-in':  'fadeIn 0.25s ease-out',
        'slide-up': 'slideUp 0.25s ease-out',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      keyframes: {
        fadeIn:  { from: { opacity: 0 }, to: { opacity: 1 } },
        slideUp: { from: { opacity: 0, transform: 'translateY(8px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
      },
      backgroundImage: {
        'gold-gradient':  'linear-gradient(135deg, #F59E0B, #D97706)',
        'teal-gradient':  'linear-gradient(135deg, #14B8A6, #0F766E)',
        'card-gradient':  'linear-gradient(180deg, #0B111C 0%, #070A12 100%)',
      },
      boxShadow: {
        'gold':  '0 0 20px rgba(245, 158, 11, 0.15)',
        'teal':  '0 0 20px rgba(20, 184, 166, 0.15)',
        'card':  '0 4px 24px rgba(0,0,0,0.4)',
        'glow':  '0 0 40px rgba(245, 158, 11, 0.08)',
      },
    },
  },
  plugins: [],
};
