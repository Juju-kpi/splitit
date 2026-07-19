// app/src/screens/auth/RegisterScreen.tsx
import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../store/authStore';
import { useT } from '../../store/langStore';
import { Button, Input } from '../../components/ui';
import { colors, spacing, radius, shadows } from '../../theme';

export default function RegisterScreen() {
  const router = useRouter();
  const register = useAuthStore(s => s.register);
  const insets = useSafeAreaInsets();
  const t = useT();

  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleRegister() {
    if (!email || !username || !password) { setError(t('auth.fill_all')); return; }
    if (password.length < 8) { setError(t('auth.password_too_short')); return; }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) { setError(t('auth.username_rule')); return; }
    setLoading(true); setError('');
    try {
      await register(email.toLowerCase().trim(), username.trim(), password);
      router.replace('/(tabs)');
    } catch (e: any) {
      setError(e?.response?.data?.error || t('auth.register_impossible'));
    } finally { setLoading(false); }
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[
          styles.container,
          { paddingTop: Math.max(insets.top + 20, 60), paddingBottom: Math.max(insets.bottom + 20, 40) },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <View style={styles.logoMark}>
            <Text style={styles.logoMarkText}>S</Text>
          </View>
          <Text style={styles.logo}>Split<Text style={{ color: colors.accent }}>it</Text></Text>
          <Text style={styles.tagline}>{t('auth.register')}</Text>
        </View>

        <View style={styles.formCard}>
          <Text style={styles.formTitle}>{t('auth.register_screen_title')}</Text>
          <Input
            label={t('auth.email')}
            placeholder={t('auth.email_ph')}
            value={email}
            onChangeText={t => { setEmail(t); setError(''); }}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <Input
            label={t('auth.username')}
            placeholder={t('auth.username_ph')}
            value={username}
            onChangeText={t => { setUsername(t); setError(''); }}
            autoCapitalize="none"
          />
          <Input
            label={t('auth.password')}
            placeholder={t('auth.password_min')}
            value={password}
            onChangeText={t => { setPassword(t); setError(''); }}
            secureTextEntry
          />
          {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorDot}>⚠</Text>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
          <Button label={t('auth.create_account_btn')} onPress={handleRegister} loading={loading} />
        </View>

        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          activeOpacity={0.8}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.backBtnText}>
            {t('auth.already_account')} <Text style={{ color: colors.accent2 }}>{t('auth.sign_in')}</Text>
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  container: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: spacing.xl },
  header: { alignItems: 'center', marginBottom: 32 },
  logoMark: {
    width: 60, height: 60, borderRadius: 18,
    backgroundColor: colors.accentBg,
    borderWidth: 1, borderColor: 'rgba(124,110,250,0.3)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 14, ...shadows.accent,
  },
  logoMarkText: { fontSize: 28, fontWeight: '800', color: colors.accent },
  logo: { fontSize: 34, fontWeight: '800', letterSpacing: -1.2, color: colors.text },
  tagline: { fontSize: 13, color: colors.text3, marginTop: 6, fontWeight: '500' },
  formCard: {
    backgroundColor: colors.glass,
    borderWidth: 1, borderColor: colors.glassBorder,
    borderRadius: radius.lg, padding: spacing.xl, marginBottom: 20,
  },
  formTitle: { fontSize: 20, fontWeight: '700', color: colors.text, marginBottom: 20, letterSpacing: -0.3 },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.redBg, borderWidth: 1, borderColor: 'rgba(248,113,113,0.2)',
    borderRadius: radius.sm, padding: 12, marginBottom: 12,
  },
  errorDot: { fontSize: 14, color: colors.red },
  errorText: { fontSize: 13, color: colors.red, flex: 1 },
  backBtn: { alignItems: 'center', paddingVertical: 16, minHeight: 52, justifyContent: 'center' },
  backBtnText: { fontSize: 14, color: colors.text3, fontWeight: '500' },
});