/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: '#0B0C0F',
        surface: '#141519',
        surface2: '#1B1D22',
        surface3: '#23262C',
        border: '#2B2E36',
        border2: '#3A3E48',
        text: '#F4F5F7',
        text2: '#A8AEBC',
        text3: '#79808F',
        accent: '#7C6EFA',
        accent2: '#A899FF',
        green: '#34D399',
        amber: '#FBBF24',
        red: '#F87171',
      },
      fontFamily: { mono: ['JetBrains Mono', 'monospace'] },
    },
  },
  plugins: [],
}
