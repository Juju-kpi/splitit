// app/app/group/join.tsx
// Changements vs original :
//   - Après avoir entré le code, on appelle GET /join-preview/:code
//     pour récupérer les membres sans compte du groupe
//   - Si des membres sans compte existent → on affiche la liste
//     "Es-tu l'un de ces membres ?" avec possibilité de se réclamer
//   - Si l'utilisateur se réclame d'un membre → on passe claimMemberId au join
//   - Si aucun membre sans compte ou si l'utilisateur choisit "Rejoindre avec mon nom"
//     → comportement original

import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, KeyboardAvoidingView,
  Platform, ScrollView, Alert,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { groupsApi } from '../../src/services/api';
import { Button, Input, Avatar, Card } from '../../src/components/ui';
import { colors, spacing, radius } from '../../src/theme';

type GuestMember = {
  id: string;
  displayName: string;
  avatarColor: string;
  avatarInitials: string;
};

type Step = 'code' | 'claim' | 'name';

export default function JoinGroupScreen() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const [inviteCode, setInviteCode] = useState(code || '');
  const [displayName, setDisplayName] = useState('');
  const [step, setStep] = useState<Step>(code ? 'claim' : 'code');
  const [groupPreview, setGroupPreview] = useState<{ groupName: string; groupEmoji: string } | null>(null);
  const [guestMembers, setGuestMembers] = useState<GuestMember[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const router = useRouter();
  const qc = useQueryClient();

  // Étape 1 : récupère le preview du groupe après saisie du code
  async function handleCodeSubmit() {
    if (!inviteCode.trim()) {
      Alert.alert('Code manquant', "Entre le code d'invitation.");
      return;
    }
    setLoadingPreview(true);
    try {
      const data = await groupsApi.joinPreview(inviteCode.trim());
      setGroupPreview({ groupName: data.groupName, groupEmoji: data.groupEmoji });
      setGuestMembers(data.guestMembers || []);
      // S'il y a des membres sans compte → étape claim
      // Sinon → aller directement à l'étape name
      setStep(data.guestMembers?.length > 0 ? 'claim' : 'name');
    } catch (e: any) {
      const msg = e?.response?.data?.error;
      if (msg === 'Invalid invite code') {
        Alert.alert('Code invalide', 'Vérifie le code et réessaie.');
      } else {
        Alert.alert('Erreur', msg || 'Impossible de récupérer le groupe.');
      }
    } finally {
      setLoadingPreview(false);
    }
  }

  // Étape finale : rejoindre
  const joinMutation = useMutation({
    mutationFn: () => groupsApi.join(
      inviteCode.trim(),
      selectedMemberId
        ? (guestMembers.find(m => m.id === selectedMemberId)?.displayName || displayName.trim())
        : displayName.trim(),
      selectedMemberId || undefined,
    ),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['groups'] });
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
    if (selectedMemberId) {
      // Claim mode — pas besoin de displayName
      joinMutation.mutate();
      return;
    }
    if (!displayName.trim()) {
      Alert.alert('Prénom manquant', 'Entre ton prénom pour ce groupe.');
      return;
    }
    joinMutation.mutate();
  }

  // ── STEP: code ──────────────────────────────────────────────────────────
  if (step === 'code') {
    return (
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backText}>← Retour</Text>
          </TouchableOpacity>
          <View style={styles.titleBlock}>
            <Text style={styles.title}>Rejoindre un groupe</Text>
            <Text style={styles.sub}>Entre le code d'invitation reçu.</Text>
          </View>
          <Input
            label="Code d'invitation"
            placeholder="Ex : clpx8f2a0000..."
            value={inviteCode}
            onChangeText={setInviteCode}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Button
            label="Continuer →"
            onPress={handleCodeSubmit}
            loading={loadingPreview}
            style={{ marginTop: 8 }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── STEP: claim ─────────────────────────────────────────────────────────
  if (step === 'claim') {
    return (
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <TouchableOpacity onPress={() => setStep('code')} style={styles.backBtn}>
            <Text style={styles.backText}>← Retour</Text>
          </TouchableOpacity>

          {groupPreview && (
            <View style={styles.groupBadge}>
              <Text style={styles.groupBadgeEmoji}>{groupPreview.groupEmoji}</Text>
              <Text style={styles.groupBadgeName}>{groupPreview.groupName}</Text>
            </View>
          )}

          <Text style={styles.title}>Es-tu déjà dans ce groupe ?</Text>
          <Text style={styles.sub}>
            Ces membres ont été ajoutés sans compte. Si tu es l'un d'eux, sélectionne ton nom
            pour récupérer ton historique de dépenses.
          </Text>

          <View style={styles.memberList}>
            {guestMembers.map(m => (
              <TouchableOpacity
                key={m.id}
                style={[styles.memberRow, selectedMemberId === m.id && styles.memberRowSelected]}
                onPress={() => setSelectedMemberId(prev => prev === m.id ? null : m.id)}
                activeOpacity={0.75}
              >
                <Avatar initials={m.avatarInitials} color={m.avatarColor} size={38} />
                <Text style={[styles.memberName, selectedMemberId === m.id && { color: colors.accent2 }]}>
                  {m.displayName}
                </Text>
                <View style={[styles.radio, selectedMemberId === m.id && styles.radioSelected]}>
                  {selectedMemberId === m.id && <View style={styles.radioDot} />}
                </View>
              </TouchableOpacity>
            ))}
          </View>

          {selectedMemberId && (
            <View style={styles.claimNotice}>
              <Text style={styles.claimNoticeText}>
                ✓ Ton compte sera lié à ce membre. Toutes tes dépenses passées seront rattachées à toi.
              </Text>
            </View>
          )}

          <Button
            label={selectedMemberId ? `Je suis ${guestMembers.find(m => m.id === selectedMemberId)?.displayName}` : 'Confirmer'}
            onPress={selectedMemberId ? handleJoin : undefined}
            loading={joinMutation.isPending}
            style={{ marginTop: 16 }}
            disabled={!selectedMemberId}
          />

          <TouchableOpacity
            style={styles.skipBtn}
            onPress={() => { setSelectedMemberId(null); setStep('name'); }}
          >
            <Text style={styles.skipText}>
              Je ne suis aucun de ces membres → Rejoindre avec mon nom
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── STEP: name ──────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <TouchableOpacity onPress={() => setStep(guestMembers.length > 0 ? 'claim' : 'code')} style={styles.backBtn}>
          <Text style={styles.backText}>← Retour</Text>
        </TouchableOpacity>

        {groupPreview && (
          <View style={styles.groupBadge}>
            <Text style={styles.groupBadgeEmoji}>{groupPreview.groupEmoji}</Text>
            <Text style={styles.groupBadgeName}>{groupPreview.groupName}</Text>
          </View>
        )}

        <Text style={styles.title}>Ton prénom dans ce groupe</Text>
        <Text style={styles.sub}>Ce prénom sera visible par tous les membres.</Text>

        <Input
          label="Prénom"
          placeholder="Ex : Sophie"
          value={displayName}
          onChangeText={setDisplayName}
          autoCapitalize="words"
          autoFocus
        />

        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            💡 Tu peux utiliser un prénom différent de ton nom d'utilisateur.
          </Text>
        </View>

        <Button
          label="Rejoindre le groupe"
          onPress={handleJoin}
          loading={joinMutation.isPending}
          style={{ marginTop: 8 }}
        />
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
    borderWidth: 0.5, borderColor: colors.border,
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 20, marginBottom: 24,
  },
  backText: { color: colors.text2, fontSize: 12, fontWeight: '500' },
  groupBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.accentBg,
    borderWidth: 1, borderColor: 'rgba(124,110,250,0.2)',
    borderRadius: radius.md, padding: 12, marginBottom: 20,
  },
  groupBadgeEmoji: { fontSize: 24 },
  groupBadgeName: { fontSize: 15, fontWeight: '600', color: colors.text },
  titleBlock: { marginBottom: 24 },
  title: { fontSize: 22, fontWeight: '700', color: colors.text, marginBottom: 8 },
  sub: { fontSize: 13, color: colors.text3, lineHeight: 19 },
  memberList: { gap: 8, marginTop: 16, marginBottom: 8 },
  memberRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, padding: 14,
  },
  memberRowSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accentBg,
  },
  memberName: { flex: 1, fontSize: 15, fontWeight: '500', color: colors.text },
  radio: {
    width: 22, height: 22, borderRadius: 11,
    borderWidth: 2, borderColor: colors.border2,
    alignItems: 'center', justifyContent: 'center',
  },
  radioSelected: { borderColor: colors.accent },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent },
  claimNotice: {
    backgroundColor: 'rgba(52,211,153,0.08)',
    borderWidth: 1, borderColor: 'rgba(52,211,153,0.2)',
    borderRadius: radius.sm, padding: 12, marginTop: 12,
  },
  claimNoticeText: { fontSize: 12, color: colors.green, lineHeight: 18 },
  skipBtn: { alignItems: 'center', paddingVertical: 16 },
  skipText: { fontSize: 13, color: colors.accent2, fontWeight: '500', textAlign: 'center' },
  notice: {
    backgroundColor: colors.accentBg,
    borderWidth: 0.5, borderColor: 'rgba(124,110,250,0.2)',
    borderRadius: 10, padding: 12, marginVertical: 8,
  },
  noticeText: { fontSize: 12, color: colors.accent2, lineHeight: 18 },
});
