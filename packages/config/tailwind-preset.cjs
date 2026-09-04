/**
 * Shared Tailwind preset. Carries the product's design tokens so every app
 * (web today, anything else later) draws from one palette instead of
 * redefining colors locally. Values are provisional — swap them when the
 * product's visual identity is finalized, the token names should not need to change.
 */
module.exports = {
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        bg: 'rgb(var(--fomo-bg) / <alpha-value>)',
        surface: 'rgb(var(--fomo-surface) / <alpha-value>)',
        'surface-raised': 'rgb(var(--fomo-surface-raised) / <alpha-value>)',
        line: 'rgb(var(--fomo-line) / <alpha-value>)',
        ink: {
          900: 'rgb(var(--fomo-ink-900) / <alpha-value>)',
          600: 'rgb(var(--fomo-ink-600) / <alpha-value>)',
          400: 'rgb(var(--fomo-ink-400) / <alpha-value>)',
        },
        accent: 'rgb(var(--fomo-accent) / <alpha-value>)',
        up: 'rgb(var(--fomo-up) / <alpha-value>)',
        down: 'rgb(var(--fomo-down) / <alpha-value>)',
      },
      fontFamily: {
        display: ['var(--font-manrope)', 'system-ui', 'sans-serif'],
        body: ['var(--font-source-serif)', 'Georgia', 'serif'],
        mono: ['var(--font-jetbrains-mono)', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};
