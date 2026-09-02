/** @type {import('tailwindcss').Config} */

// ── Nuit premium ────────────────────────────────────────────────────────────
// Les mêmes jetons que app/src/theme/index.ts, aux mêmes noms : les deux
// applications changent d'identité en changeant ces deux fichiers.
//
//  1. La profondeur vient du remplissage, pas de la bordure. `border` est à
//     peine plus clair que les surfaces : les `border-border` existants
//     s'effacent d'eux-mêmes sans qu'il faille les retirer un par un.
//  2. La couleur ne sert qu'à dire le sens de l'argent. `accent`, employé
//     partout en décoration, devient un gris ardoise neutre — le violet
//     disparaît sans casser un contraste, le blanc restant lisible dessus.
//  3. L'action principale est la seule surface claire de l'écran :
//     `primary` (os) sur `onPrimary` (noir).
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: '#08090C',
        surface: '#0F1116',
        surface2: '#161920',
        surface3: '#1E2530',
        border: '#171B22',
        border2: '#232833',
        text: '#FFFFFF',
        text2: '#9AA1AF',
        text3: '#626977',
        accent: '#2E3340',
        accent2: '#C9CEDA',
        primary: '#EDEAE3',
        onPrimary: '#0B0C10',
        green: '#3ECF8E',
        amber: '#E8A33D',
        red: '#E5484D',
      },
      fontFamily: {
        sans: ['var(--font-geist)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: { xl: '14px', '2xl': '20px', '3xl': '28px' },
    },
  },
  plugins: [],
}
