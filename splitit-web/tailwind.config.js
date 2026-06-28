/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: '#0C0C0F',
        surface: '#16161A',
        surface2: '#1E1E24',
        surface3: '#26262E',
        border: '#2A2A35',
        border2: '#363644',
        text: '#F2F2F5',
        text2: '#9090A8',
        text3: '#5A5A72',
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
