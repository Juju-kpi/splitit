// app/app/group/members.tsx
// Two uses:
// 1. Group creator/member adds guest names (no account needed)
// 2. Someone who just joined identifies themselves among existing names OR adds their own
import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { groupsApi } from '../../src/services/api';
import { Button, Input, Avatar, Card, Notice } from '../../src/components/ui';
import { colors, spacing, radius } from '../../src/theme';

export default function GroupMembersScreen() {
  const { groupId, mode } = useLocalSearchParams<{ groupId: string; mode?: string }>();
  // mode='identify' → user picking who they are among existing names
  const isIdentify = mode === 'identify';

  const router = useRouter();
  const qc = useQueryClient();

  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);

  const { data: group, isLoading } = useQuery({
    queryKey: ['group', groupId],
    queryFn: () => groupsApi.get(groupId),
    enabled: !!groupId,
  });

  const addMutation = useMutation({
    mutationFn: (displayName: string) => groupsApi.addMember(groupId, displayName),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['group', groupId] });
      qc.invalidateQueries({ queryKey: ['groups'] });
      setNewName('');
      setAdding(false);
      if (!isIdentify) {
        Alert.alert('Membre ajouté', `${newName} a été ajouté au groupe.`);
      }
    },
    onError: (e: any) => Alert.alert('Erreur', e?.response?.data?.error || 'Impossible d\'ajouter le membre'),
  });

  function handleAdd() {
    if (!newName.trim()) { Alert.alert('Prénom manquant'); return; }
    addMutation.mutate(newName.trim());
  }

  if (isLoading || !group) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  const members = group.members || [];

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Retour</Text>
        </TouchableOpacity>
        <Text style={styles.title}>
          {isIdentify ? 'Qui es-tu ?' : 'Membres du groupe'}
        </Text>
        <View style={{ width: 70 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

        {isIdentify ? (
          /* Identify mode: pick your name or add new */
          <>
            <Notice
              text="Sélectionne ton prénom dans la liste ou entre le tien si tu n'es pas encore là."
              variant="accent"
            />
            <Text style={styles.sectionLabel}>MEMBRES EXISTANTS</Text>
            {members.map((m: any) => (
              <TouchableOpacity
                key={m.id}
                style={styles.memberRow}
                onPress={() => {
                  // In real app: link this account to the guest member
                  // For now: navigate back and set preference
                  Alert.alert(
                    `Tu es ${m.displayName} ?`,
                    'Cette fonctionnalité de liaison de compte sera disponible prochainement.',
                    [{ text: 'OK' }]
                  );
                }}
                activeOpacity={0.75}
              >
                <Avatar initials={m.avatarInitials} color={m.avatarColor} size={36} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.memberName}>{m.displayName}</Text>
                  {m.userId && <Text style={styles.memberSub}>Compte lié</Text>}
                </View>
                <Text style={styles.selectArrow}>→</Text>
              </TouchableOpacity>
            ))}

            <Text style={styles.sectionLabel}>MON PRÉNOM N'EST PAS DANS LA LISTE</Text>
            <Card>
              <Input
                label="Ton prénom"
                placeholder="Entre ton prénom"
                value={newName}
                onChangeText={setNewName}
                autoCapitalize="words"
              />
              <Button
                label="Ajouter et rejoindre →"
                onPress={handleAdd}
                loading={addMutation.isPending}
              />
            </Card>
          </>
        ) : (
          /* Manage mode: see members + add guests */
          <>
            <Notice
              text="Ajoute les personnes du groupe même si elles n'ont pas de compte. Elles pourront se lier plus tard."
              variant="accent"
            />

            <Text style={styles.sectionLabel}>MEMBRES ACTUELS ({members.length})</Text>
            {members.map((m: any) => (
              <View key={m.id} style={styles.memberRow}>
                <Avatar initials={m.avatarInitials} color={m.avatarColor} size={36} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.memberName}>{m.displayName}</Text>
                  {m.userId
                    ? <Text style={styles.memberSub}>✓ Compte lié</Text>
                    : <Text style={[styles.memberSub, { color: colors.amber }]}>Sans compte</Text>
                  }
                </View>
              </View>
            ))}

            {/* Add new member */}
            <Text style={styles.sectionLabel}>AJOUTER UN MEMBRE</Text>
            {!adding ? (
              <TouchableOpacity style={styles.addBtn} onPress={() => setAdding(true)}>
                <Text style={styles.addBtnText}>+ Ajouter une personne</Text>
              </TouchableOpacity>
            ) : (
              <Card>
                <Input
                  label="Prénom"
                  placeholder="Ex: Michel"
                  value={newName}
                  onChangeText={setNewName}
                  autoCapitalize="words"
                  autoFocus
                />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Button
                    label="Annuler"
                    onPress={() => { setAdding(false); setNewName(''); }}
                    variant="ghost"
                    style={{ flex: 1 }}
                  />
                  <Button
                    label="Ajouter →"
                    onPress={handleAdd}
                    loading={addMutation.isPending}
                    style={{ flex: 1 }}
                  />
                </View>
              </Card>
            )}

            <Notice
              variant="amber"
              text="Pour inviter quelqu'un avec un compte, partage le code du groupe depuis l'écran principal."
            />
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingTop: 16, paddingBottom: 8,
  },
  backBtn: {
    backgroundColor: colors.surface2, borderWidth: 0.5, borderColor: colors.border,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.full,
  },
  backText: { color: colors.text2, fontSize: 12, fontWeight: '500' },
  title: { fontSize: 15, fontWeight: '600', color: colors.text },
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: 80 },
  sectionLabel: {
    fontSize: 11, fontWeight: '500', color: colors.text3, textTransform: 'uppercase',
    letterSpacing: 0.8, marginTop: 20, marginBottom: 10,
  },
  memberRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.surface, borderWidth: 0.5, borderColor: colors.border,
    borderRadius: radius.md, padding: 14, marginBottom: 8,
  },
  memberName: { fontSize: 14, fontWeight: '500', color: colors.text },
  memberSub: { fontSize: 11, color: colors.green, marginTop: 2 },
  selectArrow: { fontSize: 18, color: colors.text3 },
  addBtn: {
    borderWidth: 1.5, borderColor: colors.border2, borderStyle: 'dashed',
    borderRadius: radius.md, padding: 16, alignItems: 'center',
  },
  addBtnText: { fontSize: 14, color: colors.accent2, fontWeight: '500' },
});
