const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter Variable"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', 'ui-monospace', 'monospace'],
      },
      colors: {
        bg: v('bg'),
        surface: v('surface'),
        raised: v('raised'),
        line: v('line'),
        ink: v('ink'),
        muted: v('muted'),
        faint: v('faint'),
        ember: v('ember'),
        amber: v('amber'),
        carb: v('carb'),
        protein: v('protein'),
        fat: v('fat'),
        good: v('good'),
        warn: v('warn'),
        bad: v('bad'),
        i: {
          recovery: v('i-recovery'),
          endurance: v('i-endurance'),
          tempo: v('i-tempo'),
          threshold: v('i-threshold'),
          vo2: v('i-vo2'),
          race: v('i-race'),
        },
      },
      borderRadius: { xl: '14px', '2xl': '20px' },
      boxShadow: {
        card: '0 1px 0 rgb(255 255 255 / 0.03) inset, 0 8px 24px -12px rgb(0 0 0 / 0.35)',
        glow: '0 0 0 1px rgb(var(--ember) / 0.35), 0 8px 30px -8px rgb(var(--ember) / 0.45)',
      },
      keyframes: {
        'fade-up': { from: { opacity: 0, transform: 'translateY(6px)' }, to: { opacity: 1, transform: 'none' } },
        pulse2: { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.4 } },
      },
      animation: { 'fade-up': 'fade-up 280ms ease-out both', pulse2: 'pulse2 1.6s ease-in-out infinite' },
    },
  },
  plugins: [],
};
