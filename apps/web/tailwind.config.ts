import type { Config } from 'tailwindcss';

const config: Config = {
  presets: [require('@fomo/config/tailwind-preset.cjs')],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', '../../packages/ui/src/**/*.{ts,tsx}'],
};

export default config;
