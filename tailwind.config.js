/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        mf: {
          bg:       '#070A12',
          card:     '#0B111C',
          panel:    '#111827',
          border:   '#1E2A3B',
          hover:    '#1a2540',
          gold:     '#F59E0B',
          'gold-lt': '#FCD34D',
          'gold-dk': '#B45309',
          teal:     '#14B8A6',
          'teal-lt': '#2DD4BF',
          'teal-dk': '#0F766E',
          txt:      '#DCE3EE',
          txt2:     '#B8C3D3',
          txt3:     '#7F8DA3',
          txt4:     '#56657A',
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
