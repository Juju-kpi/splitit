// app/app/group/join.tsx
import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, KeyboardAvoidingView,
  Platform, ScrollView, Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { groupsApi } from '../../src/services/api';
import { Button, Input } from '../../src/components/ui';
import { colors, spacing } from '../../src/theme';

export default function JoinGroupScreen() {
  // Pre-fill if opened via deep link: splitit://group/join?code=abc123
  const { code } = useLocalSearchParams<{ code?: string }>();
  const [inviteCode, setInviteCode] = useState(code || '');
  const [displayName, setDisplayName] = useState('');
  const router = useRouter();
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => groupsApi.join(inviteCode.trim(), displayName.trim()),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['groups'] });
      // Go directly to the group
      router.replace(`/group/${data.group.id}`);
    },
    onError: (e: any) => {
      const msg = e?.response?.data?.error;
      if (msg === 'Already a member') {
        Alert.alert('Déjà membre', 'Tu fais déjà partie de ce groupe.');
      } else if (msg === 'Invalid invite code') {
        Alert.alert('Code invalide', 'Vérifie le code et réessaie.');
      } else {
        Alert.alert('Erreur', msg || 'Impossible de rejoindre le groupe.');
      }
    },
  });

  function handleJoin() {
    if (!inviteCode.trim()) {
      Alert.alert('Code manquant', 'Entre le code d\'invitation.');
      return;
    }
    if (!displayName.trim()) {
      Alert.alert('Prénom manquant', 'Entre ton prénom pour ce groupe.');
      return;
    }
    mutation.mutate();
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {/* Header */}
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Retour</Text>
        </TouchableOpacity>

        <View style={styles.titleBlock}>
          <Text style={styles.title}>Rejoindre un groupe</Text>
          <Text style={styles.sub}>
            Demande le code à la personne qui a créé le groupe, ou colle le lien reçu.
          </Text>
        </View>

        {/* Code input */}
        <View style={styles.form}>
          <Input
            label="Code d'invitation"
            placeholder="Ex : clpx8f2a0000..."
            value={inviteCode}
            onChangeText={setInviteCode}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <Input
            label="Ton prénom dans ce groupe"
            placeholder="Ex : Sophie"
            value={displayName}
            onChangeText={setDisplayName}
            autoCapitalize="words"
          />

          <View style={styles.notice}>
            <Text style={styles.noticeText}>
              💡 Ce prénom sera visible par tous les membres du groupe.
              Tu peux en mettre un différent de ton compte.
            </Text>
          </View>

          <Button
            label="Rejoindre le groupe"
            onPress={handleJoin}
            loading={mutation.isPending}
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  container: { flexGrow: 1, padding: spacing.xl, paddingTop: 16 },
  backBtn: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface2,
    borderWidth: 0.5,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 32,
  },
  backText: { color: colors.text2, fontSize: 12, fontWeight: '500' },
  titleBlock: { marginBottom: 32 },
  title: { fontSize: 26, fontWeight: '700', color: colors.text, marginBottom: 8 },
  sub: { fontSize: 14, color: colors.text3, lineHeight: 20 },
  form: { gap: 4 },
  notice: {
    backgroundColor: colors.accentBg,
    borderWidth: 0.5,
    borderColor: 'rgba(124,110,250,0.2)',
    borderRadius: 10,
    padding: 12,
    marginVertical: 8,
  },
  noticeText: { fontSize: 12, color: colors.accent2, lineHeight: 18 },
});
