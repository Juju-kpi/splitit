// app/src/components/ui.tsx
import React, { useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ViewStyle,
  ActivityIndicator, Platform, Animated,
} from 'react-native';
import { colors, radius, spacing, shadows } from '../theme';

// ── Button ─────────────────────────────────────────────────────────────────
interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'ghost' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
  icon?: string;
}
export function Button({ label, onPress, variant = 'primary', loading, disabled, style, icon }: ButtonProps) {
  const scale = useRef(new Animated.Value(1)).current;

  const onPressIn = () => {
    Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, speed: 50 }).start();
  };
  const onPressOut = () => {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 50 }).start();
  };

  const isPrimary = variant === 'primary';
  const isDanger = variant === 'danger';
  const isGhost = variant === 'ghost';

  return (
    <Animated.View style={[{ transform: [{ scale }] }, style]}>
      <TouchableOpacity
        style={[
          styles.btn,
          isPrimary && styles.btnPrimary,
          isDanger && styles.btnDanger,
          isGhost && styles.btnGhost,
          (disabled || loading) && styles.btnDisabled,
        ]}
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        disabled={disabled || loading}
        activeOpacity={1}
      >
        {loading ? (
          <ActivityIndicator color={isGhost ? colors.text2 : colors.white} size="small" />
        ) : (
          <View style={styles.btnInner}>
            {icon && <Text style={styles.btnIcon}>{icon}</Text>}
            <Text style={[styles.btnText, isGhost && styles.btnTextGhost, isDanger && styles.btnTextDanger]}>
              {label}
            </Text>
          </View>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

// ── Input ───────────────────────────────────────────────────────────────────
interface InputProps {
  label?: string;
  placeholder?: string;
  value: string;
  onChangeText: (v: string) => void;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'email-address' | 'decimal-pad' | 'numeric';
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  autoComplete?: string;
  style?: ViewStyle;
  mono?: boolean;
  error?: string;
  autoFocus?: boolean;
}
export function Input({
  label, placeholder, value, onChangeText, secureTextEntry,
  keyboardType = 'default', autoCapitalize = 'sentences',
  autoComplete, style, mono, error, autoFocus,
}: InputProps) {
  const [hidden, setHidden] = useState(secureTextEntry ?? false);
  const [focused, setFocused] = useState(false);

  return (
    <View style={[styles.inputWrap, style]}>
      {label && <Text style={styles.inputLabel}>{label}</Text>}
      <View style={[
        styles.inputRow,
        focused && styles.inputRowFocused,
        error ? styles.inputRowError : null,
      ]}>
        <TextInput
          style={[styles.input, mono && styles.inputMono, { flex: 1 }]}
          placeholder={placeholder}
          placeholderTextColor={colors.text3}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={hidden}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoComplete={autoComplete as any}
          autoFocus={autoFocus}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        {secureTextEntry && (
          <TouchableOpacity onPress={() => setHidden(h => !h)} style={styles.eyeBtn}>
            <Text style={styles.eyeIcon}>{hidden ? '👁' : '🙈'}</Text>
          </TouchableOpacity>
        )}
      </View>
      {error ? <Text style={styles.inputError}>{error}</Text> : null}
    </View>
  );
}

// ── Avatar ──────────────────────────────────────────────────────────────────
interface AvatarProps { initials: string; color: string; fgColor?: string; size?: number; ring?: boolean; }
export function Avatar({ initials, color, fgColor = '#fff', size = 36, ring = false }: AvatarProps) {
  return (
    <View style={[
      styles.avatarRing,
      ring && { borderColor: color + '60', borderWidth: 2 },
      { width: size + (ring ? 4 : 0), height: size + (ring ? 4 : 0), borderRadius: (size + 4) / 2 },
    ]}>
      <View style={[styles.avatar, { backgroundColor: color, width: size, height: size, borderRadius: size / 2 }]}>
        <Text style={[styles.avatarText, { color: fgColor, fontSize: size * 0.36 }]}>{initials}</Text>
      </View>
    </View>
  );
}

// ── Pill ────────────────────────────────────────────────────────────────────
interface PillProps { label: string; variant?: 'accent' | 'green' | 'amber' | 'red'; }
export function Pill({ label, variant = 'accent' }: PillProps) {
  const map = {
    accent: { bg: colors.accentBg, text: colors.accent2, border: 'rgba(124,110,250,0.2)' },
    green:  { bg: colors.greenBg,  text: colors.green,   border: 'rgba(52,211,153,0.2)' },
    amber:  { bg: colors.amberBg,  text: colors.amber,   border: 'rgba(251,191,36,0.2)' },
    red:    { bg: colors.redBg,    text: colors.red,      border: 'rgba(248,113,113,0.2)' },
  };
  const c = map[variant];
  return (
    <View style={[styles.pill, { backgroundColor: c.bg, borderColor: c.border }]}>
      <Text style={[styles.pillText, { color: c.text }]}>{label}</Text>
    </View>
  );
}

// ── Card ────────────────────────────────────────────────────────────────────
export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

// ── SectionLabel ────────────────────────────────────────────────────────────
export function SectionLabel({ label }: { label: string }) {
  return (
    <View style={styles.sectionLabelRow}>
      <View style={styles.sectionLabelLine} />
      <Text style={styles.sectionLabel}>{label}</Text>
      <View style={styles.sectionLabelLine} />
    </View>
  );
}

// ── Divider ─────────────────────────────────────────────────────────────────
export function Divider({ style }: { style?: ViewStyle }) {
  return <View style={[styles.divider, style]} />;
}

// ── Notice ──────────────────────────────────────────────────────────────────
interface NoticeProps { text: string; variant?: 'accent' | 'amber' | 'green'; }
export function Notice({ text, variant = 'accent' }: NoticeProps) {
  const map = {
    accent: { bg: colors.accentBg, border: 'rgba(124,110,250,0.25)', text: colors.accent2, dot: colors.accent },
    amber:  { bg: colors.amberBg,  border: 'rgba(251,191,36,0.25)',  text: colors.amber,   dot: colors.amber },
    green:  { bg: colors.greenBg,  border: 'rgba(52,211,153,0.25)',  text: colors.green,   dot: colors.green },
  };
  const c = map[variant];
  return (
    <View style={[styles.notice, { backgroundColor: c.bg, borderColor: c.border }]}>
      <View style={[styles.noticeDot, { backgroundColor: c.dot }]} />
      <Text style={[styles.noticeText, { color: c.text }]}>{text}</Text>
    </View>
  );
}

// ── AvatarRow ───────────────────────────────────────────────────────────────
interface AvatarRowProps { members: Array<{ avatarInitials: string; avatarColor: string }>; max?: number; }
export function AvatarRow({ members, max = 5 }: AvatarRowProps) {
  const shown = members.slice(0, max);
  const extra = members.length - max;
  return (
    <View style={styles.avatarRow}>
      {shown.map((m, i) => (
        <View key={i} style={[styles.avatarRowItem, { zIndex: shown.length - i }]}>
          <Avatar initials={m.avatarInitials} color={m.avatarColor} size={28} ring />
        </View>
      ))}
      {extra > 0 && (
        <View style={[styles.avatarRowItem, styles.avatarExtra]}>
          <Text style={styles.avatarExtraText}>+{extra}</Text>
        </View>
      )}
    </View>
  );
}

// ── Chip ────────────────────────────────────────────────────────────────────
interface ChipProps {
  label: string;
  selected: boolean;
  onPress: () => void;
  avatar?: { initials: string; color: string };
}
export function Chip({ label, selected, onPress, avatar }: ChipProps) {
  return (
    <TouchableOpacity
      style={[styles.chip, selected && styles.chipSelected]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      {avatar && <Avatar initials={avatar.initials} color={avatar.color} size={20} />}
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ── AmountInput ──────────────────────────────────────────────────────────────
interface AmountInputProps {
  value: string;
  onChangeText: (v: string) => void;
  currency?: string;
}
export function AmountInput({ value, onChangeText, currency = 'CHF' }: AmountInputProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.amountWrap, focused && styles.amountWrapFocused]}>
      <Text style={styles.amountSymbol}>—</Text>
      <TextInput
        style={styles.amountInput}
        placeholder="0.00"
        placeholderTextColor={colors.text3}
        value={value}
        onChangeText={onChangeText}
        keyboardType="decimal-pad"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
      />
      <Text style={styles.amountCurrency}>{currency}</Text>
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  // Button
  btn: {
    paddingVertical: 15,
    paddingHorizontal: 24,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    marginVertical: 4,
  },
  btnPrimary: {
    backgroundColor: colors.accent,
    ...shadows.accent,
  },
  btnDanger: {
    backgroundColor: 'rgba(248,113,113,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.3)',
  },
  btnGhost: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.glassBorder,
  },
  btnDisabled: { opacity: 0.45 },
  btnInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  btnIcon: { fontSize: 16 },
  btnText: { fontSize: 15, fontWeight: '600', color: colors.white, letterSpacing: 0.2 },
  btnTextGhost: { color: colors.text2 },
  btnTextDanger: { color: colors.red },

  // Input
  inputWrap: { marginBottom: 14 },
  inputLabel: {
    fontSize: 11, fontWeight: '600', color: colors.text3,
    textTransform: 'uppercase', letterSpacing: 1.2, marginBottom: 7,
  },
  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface2,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: 14,
  },
  inputRowFocused: {
    borderColor: colors.accent,
    backgroundColor: 'rgba(124,110,250,0.06)',
  },
  inputRowError: { borderColor: colors.red },
  input: {
    paddingVertical: Platform.OS === 'ios' ? 14 : 12,
    fontSize: 15, color: colors.text,
  },
  inputMono: { fontFamily: 'monospace', fontSize: 20, fontWeight: '300' },
  inputError: { fontSize: 11, color: colors.red, marginTop: 5, marginLeft: 2 },
  eyeBtn: { padding: 8 },
  eyeIcon: { fontSize: 16 },

  // Avatar
  avatarRing: { alignItems: 'center', justifyContent: 'center' },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontWeight: '700' },

  // Pill
  pill: {
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: radius.full, alignSelf: 'flex-start',
    borderWidth: 1,
  },
  pillText: { fontSize: 11, fontWeight: '600' },

  // Card
  card: {
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginBottom: 12,
    ...shadows.card,
  },

  // Section label
  sectionLabelRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginTop: 20, marginBottom: 10,
  },
  sectionLabelLine: { flex: 1, height: 0.5, backgroundColor: colors.glassBorder },
  sectionLabel: {
    fontSize: 10, fontWeight: '700', color: colors.text3,
    textTransform: 'uppercase', letterSpacing: 1.5,
  },

  // Divider
  divider: { height: 0.5, backgroundColor: colors.glassBorder, marginVertical: 10 },

  // Notice
  notice: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    borderWidth: 1, borderRadius: radius.sm, padding: 12, marginVertical: 6,
  },
  noticeDot: { width: 6, height: 6, borderRadius: 3, marginTop: 4 },
  noticeText: { fontSize: 13, lineHeight: 19, flex: 1 },

  // AvatarRow
  avatarRow: { flexDirection: 'row', marginTop: 12 },
  avatarRowItem: { marginLeft: -8 },
  avatarExtra: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: colors.surface3,
    borderWidth: 1, borderColor: colors.glassBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarExtraText: { fontSize: 9, color: colors.text3, fontWeight: '700' },

  // Chip
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.border,
    marginRight: 6, marginBottom: 6,
    backgroundColor: colors.surface2,
  },
  chipSelected: { borderColor: colors.accent, backgroundColor: colors.accentBg },
  chipText: { fontSize: 13, fontWeight: '500', color: colors.text2 },
  chipTextSelected: { color: colors.accent2, fontWeight: '600' },

  // AmountInput
  amountWrap: {
    flexDirection: 'row', alignItems: 'baseline', gap: 10,
    backgroundColor: colors.surface2,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: 18, paddingVertical: 14,
    marginBottom: 14,
  },
  amountWrapFocused: {
    borderColor: colors.accent,
    backgroundColor: 'rgba(124,110,250,0.06)',
  },
  amountSymbol: { fontSize: 24, color: colors.text3, fontWeight: '300' },
  amountInput: { flex: 1, fontSize: 36, fontWeight: '200', fontFamily: 'monospace', color: colors.text },
  amountCurrency: { fontSize: 15, color: colors.accent2, fontWeight: '700', letterSpacing: 0.5 },
});