// app/app/forgot-password.tsx
// Handles two cases:
//   1. /forgot-password           → request reset link
//   2. /forgot-password?token=…   → enter new password (deep-link landing)
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useT } from '../src/store/langStore';
import { Button, Input, Notice } from '../src/components/ui';
import { colors, spacing, radius, fonts } from '../src/theme';
import { authApi } from '../src/services/api';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const t = useT();
  const { token } = useLocalSearchParams<{ token?: string }>();

  // Request-reset state
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  // New-password state
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [resetDone, setResetDone] = useState(false);

  async function handleSend() {
    if (!email.trim()) { setError(t('auth.enter_email')); return; }
    setLoading(true);
    setError('');
    try {
      await authApi.forgotPassword(email.toLowerCase().trim());
    } catch {
      // Always show success to avoid enumeration
    } finally {
      setSent(true);
      setLoading(false);
    }
  }

  async function handleReset() {
    if (password.length < 8) { setError(t('auth.password_too_short')); return; }
    if (password !== confirm) { setError(t('auth.passwords_mismatch')); return; }
    setLoading(true);
    setError('');
    try {
      await authApi.resetPassword(token!, password);
      setResetDone(true);
    } catch (e: any) {
      setError(e?.response?.data?.error || t('auth.reset_link_invalid'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={insets.top}
    >
      <ScrollView
        contentContainerStyle={[
          styles.container,
          { paddingTop: Math.max(insets.top, 20), paddingBottom: Math.max(insets.bottom, 24) },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.backText}>{t('common.back')}</Text>
        </TouchableOpacity>

        {token ? (
          resetDone ? (
            <>
              <View style={styles.titleBlock}>
                <Text style={styles.title}>{t('auth.password_updated')}</Text>
                <Text style={styles.sub}>{t('auth.password_updated_sub')}</Text>
              </View>
              <Button label={t('auth.sign_in')} onPress={() => router.replace('/(auth)/login')} />
            </>
          ) : (
            <>
              <View style={styles.titleBlock}>
                <Text style={styles.title}>Nouveau mot de passe</Text>
                <Text style={styles.sub}>Choisis un mot de passe d'au moins 8 caractères.</Text>
              </View>
              <Input label={t('auth.new_password')} placeholder="••••••••" value={password}
                onChangeText={v => { setPassword(v); setError(''); }} secureTextEntry autoFocus />
              <Input label={t('auth.confirm_short')} placeholder="••••••••" value={confirm}
                onChangeText={v => { setConfirm(v); setError(''); }} secureTextEntry />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <Button label={t('auth.save_password')} onPress={handleReset} loading={loading} />
            </>
          )
        ) : (
          <>
            <View style={styles.titleBlock}>
              <Text style={styles.title}>{t('auth.forgot_title')}</Text>
              <Text style={styles.sub}>
                {t('auth.forgot_sub_long')}
              </Text>
            </View>
            {sent ? (
              <>
                <Notice variant="green"
                  text={t('auth.link_sent_long')} />
                <Button label={t('auth.back_to_login')} onPress={() => router.replace('/(auth)/login')} />
              </>
            ) : (
              <>
                <Input label={t('auth.email')} placeholder={t('auth.email_ph')} value={email}
                  onChangeText={t => { setEmail(t); setError(''); }}
                  keyboardType="email-address" autoCapitalize="none" autoFocus />
                {error ? <Text style={styles.error}>{error}</Text> : null}
                <Button label={t('auth.send_link')} onPress={handleSend} loading={loading} />
              </>
            )}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  container: { flexGrow: 1, paddingHorizontal: spacing.xl },
  backBtn: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface2, borderWidth: 0.5, borderColor: colors.border,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.full, marginBottom: 32,
  },
  backText: { color: colors.text2, fontFamily: fonts.medium, fontSize: 12, fontWeight: '500' },
  titleBlock: { marginBottom: 28 },
  title: { fontFamily: fonts.semibold, fontSize: 26, fontWeight: '700', color: colors.text, marginBottom: 8 },
  sub: { fontFamily: fonts.regular, fontSize: 14, color: colors.text3, lineHeight: 20 },
  error: { color: colors.red, fontFamily: fonts.regular, fontSize: 13, marginBottom: 8 },
});
