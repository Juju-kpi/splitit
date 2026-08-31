// app/src/theme/index.ts
import { StyleSheet, Platform } from 'react-native';

export const colors = {
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
  accentBg: 'rgba(124,110,250,0.12)',
  accentGlow: 'rgba(124,110,250,0.25)',
  green: '#34D399',
  greenBg: 'rgba(52,211,153,0.1)',
  amber: '#FBBF24',
  amberBg: 'rgba(251,191,36,0.1)',
  red: '#F87171',
  redBg: 'rgba(248,113,113,0.1)',
  white: '#FFFFFF',
  // Surfaces pleines : le contenu qui defile ne doit pas transparaitre
  glass: '#141519',
  glassBorder: '#2B2E36',
  glassHighlight: '#1B1D22',
} as const;

export const radius = {
  sm: 10,
  md: 16,
  lg: 24,
  xl: 32,
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

export const typography = {
  h1: { fontSize: 28, fontWeight: '700' as const, letterSpacing: -0.8, color: colors.text },
  h2: { fontSize: 22, fontWeight: '600' as const, letterSpacing: -0.3, color: colors.text },
  h3: { fontSize: 18, fontWeight: '600' as const, color: colors.text },
  body: { fontSize: 15, fontWeight: '400' as const, color: colors.text },
  bodySmall: { fontSize: 13, fontWeight: '400' as const, color: colors.text2 },
  label: { fontSize: 11, fontWeight: '600' as const, color: colors.text3, textTransform: 'uppercase' as const, letterSpacing: 1.2 },
  mono: { fontFamily: 'monospace', fontSize: 14, color: colors.text },
  monoLarge: { fontFamily: 'monospace', fontSize: 28, fontWeight: '300' as const, color: colors.text },
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
  card: {
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    borderRadius: radius.md,
    padding: spacing.lg,
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

export const AVATAR_COLORS = [
  { bg: '#4F46E5', fg: '#C7D2FE' },
  { bg: '#065F46', fg: '#A7F3D0' },
  { bg: '#92400E', fg: '#FDE68A' },
  { bg: '#831843', fg: '#FBCFE8' },
  { bg: '#1E40AF', fg: '#BFDBFE' },
  { bg: '#7C2D12', fg: '#FED7AA' },
  { bg: '#134E4A', fg: '#CCFBF1' },
];

export function getAvatarColors(index: number) {
  return AVATAR_COLORS[index % AVATAR_COLORS.length];
}