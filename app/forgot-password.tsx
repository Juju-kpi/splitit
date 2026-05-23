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
import { Button, Input, Notice } from '../src/components/ui';
import { colors, spacing, radius } from '../src/theme';
import { authApi } from '../src/services/api';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
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
    if (!email.trim()) { setError('Entre ton adresse email.'); return; }
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
    if (password.length < 8) { setError('Le mot de passe doit faire au moins 8 caractères.'); return; }
    if (password !== confirm) { setError('Les mots de passe ne correspondent pas.'); return; }
    setLoading(true);
    setError('');
    try {
      await authApi.resetPassword(token!, password);
      setResetDone(true);
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Lien invalide ou expiré. Refais une demande.');
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
          <Text style={styles.backText}>← Retour</Text>
        </TouchableOpacity>

        {token ? (
          resetDone ? (
            <>
              <View style={styles.titleBlock}>
                <Text style={styles.title}>Mot de passe mis à jour ✓</Text>
                <Text style={styles.sub}>Tu peux maintenant te connecter avec ton nouveau mot de passe.</Text>
              </View>
              <Button label="Se connecter" onPress={() => router.replace('/(auth)/login')} />
            </>
          ) : (
            <>
              <View style={styles.titleBlock}>
                <Text style={styles.title}>Nouveau mot de passe</Text>
                <Text style={styles.sub}>Choisis un mot de passe d'au moins 8 caractères.</Text>
              </View>
              <Input label="Nouveau mot de passe" placeholder="••••••••" value={password}
                onChangeText={v => { setPassword(v); setError(''); }} secureTextEntry autoFocus />
              <Input label="Confirmer" placeholder="••••••••" value={confirm}
                onChangeText={v => { setConfirm(v); setError(''); }} secureTextEntry />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <Button label="Enregistrer" onPress={handleReset} loading={loading} />
            </>
          )
        ) : (
          <>
            <View style={styles.titleBlock}>
              <Text style={styles.title}>Mot de passe oublié</Text>
              <Text style={styles.sub}>
                Entre ton adresse email. Si un compte existe, tu recevras un lien de réinitialisation.
              </Text>
            </View>
            {sent ? (
              <>
                <Notice variant="green"
                  text="Si un compte existe pour cet email, un lien a été envoyé. Vérifie ta boîte mail (et tes spams)." />
                <Button label="Retour à la connexion" onPress={() => router.replace('/(auth)/login')} />
              </>
            ) : (
              <>
                <Input label="Email" placeholder="toi@exemple.com" value={email}
                  onChangeText={t => { setEmail(t); setError(''); }}
                  keyboardType="email-address" autoCapitalize="none" autoFocus />
                {error ? <Text style={styles.error}>{error}</Text> : null}
                <Button label="Envoyer le lien" onPress={handleSend} loading={loading} />
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
  backText: { color: colors.text2, fontSize: 12, fontWeight: '500' },
  titleBlock: { marginBottom: 28 },
  title: { fontSize: 26, fontWeight: '700', color: colors.text, marginBottom: 8 },
  sub: { fontSize: 14, color: colors.text3, lineHeight: 20 },
  error: { color: colors.red, fontSize: 13, marginBottom: 8 },
});
