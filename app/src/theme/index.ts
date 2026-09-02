// app/src/theme/index.ts
import { StyleSheet, Platform } from 'react-native';

// ── Nuit premium ──────────────────────────────────────────────────────────
// Trois principes, et tout le reste en decoule :
//
//  1. La profondeur vient du remplissage, pas de la bordure. `border` est
//     donc a peine plus clair que les surfaces : les bordures existantes
//     s'effacent d'elles-memes sans qu'il faille les retirer une par une.
//  2. La couleur ne sert qu'a dire le sens de l'argent. `accent`, employe
//     un peu partout en decoration, devient un gris ardoise neutre — le
//     violet disparait sans qu'aucun contraste ne se casse, puisque le
//     blanc reste lisible dessus.
//  3. L'action principale est la seule surface claire de l'ecran :
//     `primary` (os) sur `onPrimary` (noir). C'est le contraste qui attire
//     l'oeil, plus une couleur saturee.
export const colors = {
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
  accentBg: 'rgba(255,255,255,0.06)',
  accentGlow: 'rgba(255,255,255,0.10)',
  // Action principale — le seul bloc clair de l'ecran
  primary: '#EDEAE3',
  onPrimary: '#0B0C10',
  // Semantiques : ce sont les seules vraies couleurs
  green: '#3ECF8E',
  greenBg: 'rgba(62,207,142,0.10)',
  amber: '#E8A33D',
  amberBg: 'rgba(232,163,61,0.10)',
  red: '#E5484D',
  redBg: 'rgba(229,72,77,0.10)',
  white: '#FFFFFF',
  // Surfaces pleines : le contenu qui defile ne doit pas transparaitre
  glass: '#0F1116',
  glassBorder: '#171B22',
  glassHighlight: '#161920',
} as const;

// ── Polices ───────────────────────────────────────────────────────────────
// Geist pour le texte, Geist Mono pour les montants. React Native n'herite
// pas d'une police globale : chaque graisse est une famille a part, d'ou ces
// constantes plutot qu'un `fontWeight`. Elles sont chargees dans
// app/_layout.tsx ; tant qu'elles ne le sont pas, l'application affiche la
// police systeme, ce qui reste lisible.
export const fonts = {
  regular: 'Geist_400Regular',
  medium: 'Geist_500Medium',
  semibold: 'Geist_600SemiBold',
  mono: 'GeistMono_400Regular',
  monoMedium: 'GeistMono_500Medium',
} as const;

// Des rayons un cran plus genereux : c'est ce qui separe une carte d'un
// conteneur, et ce qui donne aux blocs un aspect fini plutot que technique.
export const radius = {
  sm: 12,
  md: 16,
  lg: 20,
  xl: 28,
  full: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
  xxxl: 40,
} as const;

// Une echelle fermee plutot que des tailles au jugé. Les montants ont leur
// propre echelle : ce sont eux le sujet de l'application.
//
// `label` n'est plus en capitales espacees : une etiquette de 13 px alignee
// a gauche dit la meme chose et calme l'ecran.
export const typography = {
  h1: { fontFamily: fonts.semibold, fontSize: 30, letterSpacing: -0.9, color: colors.text },
  h2: { fontFamily: fonts.semibold, fontSize: 20, letterSpacing: -0.4, color: colors.text },
  h3: { fontFamily: fonts.semibold, fontSize: 17, letterSpacing: -0.2, color: colors.text },
  body: { fontFamily: fonts.regular, fontSize: 15, color: colors.text },
  bodySmall: { fontFamily: fonts.regular, fontSize: 13, color: colors.text2 },
  label: { fontFamily: fonts.medium, fontSize: 13, color: colors.text3 },
  mono: { fontFamily: fonts.mono, fontSize: 14, color: colors.text },
  monoLarge: { fontFamily: fonts.monoMedium, fontSize: 28, color: colors.text },
} as const;

// Chiffres alignes en colonne — indispensable des qu'on compare des montants.
export const tabular = { fontVariant: ['tabular-nums'] as const };

/** Echelle des montants : le solde qui te concerne, une ligne, un detail. */
export const money = {
  hero: { fontFamily: fonts.monoMedium, fontSize: 40, letterSpacing: -0.8, ...tabular },
  large: { fontFamily: fonts.monoMedium, fontSize: 20, letterSpacing: -0.2, ...tabular },
  row: { fontFamily: fonts.monoMedium, fontSize: 16, ...tabular },
  small: { fontFamily: fonts.mono, fontSize: 13, ...tabular },
} as const;

export const shadows = {
  accent: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.18,
    shadowRadius: 3,
    elevation: 1,
  },
  tabBar: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
};

export const globalStyles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  // Plus de bordure : la carte se detache par son remplissage.
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.full,
    fontSize: 11,
    fontWeight: '600' as const,
  },
  row: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
  },
  separator: {
    height: 0.5,
    backgroundColor: colors.glassBorder,
  },
});

// Des teintes plus sourdes et plus profondes : un avatar doit identifier
// quelqu'un, pas rivaliser avec le montant a cote de lui.
export const AVATAR_COLORS = [
  { bg: '#3A4256', fg: '#D5DAE6' },
  { bg: '#1F4D42', fg: '#B7E4D5' },
  { bg: '#5C4326', fg: '#EBD5B3' },
  { bg: '#523046', fg: '#E6C6DA' },
  { bg: '#2A3A5C', fg: '#C2CFEA' },
  { bg: '#5A3328', fg: '#E9C6B6' },
  { bg: '#26454A', fg: '#BEDCE1' },
];

export function getAvatarColors(index: number) {
  return AVATAR_COLORS[index % AVATAR_COLORS.length];
}