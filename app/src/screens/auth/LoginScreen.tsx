// app/src/screens/auth/LoginScreen.tsx
import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import { useAuthStore } from '../../store/authStore';
import { useT } from '../../store/langStore';
import { Button, Input } from '../../components/ui';
import { colors, spacing, radius, shadows, fonts } from '../../theme';

const LAST_EMAIL_KEY = 'splitit_last_email';

export default function LoginScreen() {
  const router = useRouter();
  const login = useAuthStore(s => s.login);
  const insets = useSafeAreaInsets();
  const t = useT();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [rememberMe, setRememberMe] = useState(true);

  useEffect(() => {
    SecureStore.getItemAsync(LAST_EMAIL_KEY).then(v => { if (v) setEmail(v); });
  }, []);

  async function handleLogin() {
    if (!email.trim() || !password) { setError(t('auth.fill_all')); return; }
    setLoading(true); setError('');
    try {
      await login(email.toLowerCase().trim(), password);
      if (rememberMe) {
        await SecureStore.setItemAsync(LAST_EMAIL_KEY, email.toLowerCase().trim());
      }
      router.replace('/(tabs)');
    } catch (e: any) {
      const msg = e?.response?.data?.error;
      if (msg === 'Invalid email or password') setError(t('auth.invalid_credentials'));
      else setError(msg || t('auth.login_failed'));
    } finally { setLoading(false); }
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[
          styles.container,
          { paddingTop: Math.max(insets.top + 20, 60), paddingBottom: Math.max(insets.bottom + 20, 40) },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {/* Logo area */}
        <View style={styles.header}>
          <View style={styles.logoMark}>
            <Text style={styles.logoMarkText}>S</Text>
          </View>
          <Text style={styles.logo}>
            Split<Text style={{ color: colors.accent }}>it</Text>
          </Text>
          <Text style={styles.tagline}>{t('auth.tagline')}</Text>
        </View>

        {/* Form card */}
        <View style={styles.formCard}>
          <Text style={styles.formTitle}>{t('auth.login')}</Text>

          <Input
            label={t('auth.email')}
            placeholder={t('auth.email_ph')}
            value={email}
            onChangeText={t => { setEmail(t); setError(''); }}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
          />
          <Input
            label={t('auth.password')}
            placeholder="••••••••"
            value={password}
            onChangeText={t => { setPassword(t); setError(''); }}
            secureTextEntry
            autoComplete="password"
          />

          <View style={styles.optionsRow}>
            <TouchableOpacity
              style={styles.rememberRow}
              onPress={() => setRememberMe(r => !r)}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <View style={[styles.checkbox, rememberMe && styles.checkboxOn]}>
                {rememberMe && <Text style={styles.checkmark}>✓</Text>}
              </View>
              <Text style={styles.rememberText}>{t('auth.remember_me')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => router.push('/forgot-password')}
              activeOpacity={0.7}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={styles.forgotText}>{t('auth.forgot_password')}</Text>
            </TouchableOpacity>
          </View>

          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorDot}>⚠</Text>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <Button label={t('auth.sign_in')} onPress={handleLogin} loading={loading} />
        </View>

        {/* Switch */}
        <View style={styles.switchWrap}>
          <View style={styles.switchLine} />
          <Text style={styles.switchOr}>{t('auth.or')}</Text>
          <View style={styles.switchLine} />
        </View>

        <TouchableOpacity
          onPress={() => router.push('/(auth)/register')}
          style={styles.registerBtn}
          activeOpacity={0.8}
        >
          <Text style={styles.registerBtnText}>{t('auth.register')}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  container: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: spacing.xl },

  // Header
  header: { alignItems: 'center', marginBottom: 36 },
  logoMark: {
    width: 60, height: 60, borderRadius: 18,
    backgroundColor: colors.accentBg,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 16,
    ...shadows.accent,
  },
  logoMarkText: { fontFamily: fonts.semibold, fontSize: 28, fontWeight: '800', color: colors.accent },
  logo: { fontFamily: fonts.semibold, fontSize: 36, fontWeight: '800', letterSpacing: -1.5, color: colors.text },
  tagline: { fontFamily: fonts.medium, fontSize: 13, color: colors.text3, marginTop: 6, fontWeight: '500', letterSpacing: 0.2 },

  // Form card
  formCard: {
    backgroundColor: colors.glass,
    borderWidth: 1, borderColor: colors.glassBorder,
    borderRadius: radius.lg,
    padding: spacing.xl,
    marginBottom: 20,
  },
  formTitle: {
    fontFamily: fonts.semibold, fontSize: 20, fontWeight: '700', color: colors.text,
    marginBottom: 20, letterSpacing: -0.3,
  },

  // Options
  optionsRow: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4, marginBottom: 16,
  },
  rememberRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, justifyContent: 'center' },
  checkbox: {
    width: 22, height: 22, borderRadius: 6,
    borderWidth: 1.5, borderColor: colors.border2,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkmark: { color: colors.white, fontFamily: fonts.semibold, fontSize: 12, fontWeight: '800' },
  rememberText: { fontFamily: fonts.medium, fontSize: 13, color: colors.text2, fontWeight: '500' },
  forgotText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.accent2, fontWeight: '600', minHeight: 44, textAlignVertical: 'center', lineHeight: 44 },

  // Error
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.redBg,
    borderWidth: 1, borderColor: 'rgba(236,93,98,0.2)',
    borderRadius: radius.sm, padding: 12, marginBottom: 12,
  },
  errorDot: { fontFamily: fonts.regular, fontSize: 14, color: colors.red },
  errorText: { fontFamily: fonts.regular, fontSize: 13, color: colors.red, flex: 1, lineHeight: 18 },

  // Switch
  switchWrap: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  switchLine: { flex: 1, height: 0.5, backgroundColor: colors.glassBorder },
  switchOr: { fontFamily: fonts.medium, fontSize: 12, color: colors.text3, fontWeight: '500' },

  // Register
  registerBtn: {
    backgroundColor: colors.surface2,
    borderWidth: 1, borderColor: colors.glassBorder,
    borderRadius: radius.md, paddingVertical: 15,
    alignItems: 'center', minHeight: 52, justifyContent: 'center',
  },
  registerBtnText: { fontFamily: fonts.semibold, fontSize: 15, fontWeight: '600', color: colors.text2 },
});