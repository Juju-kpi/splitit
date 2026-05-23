// app/app/group/new.tsx
import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { groupsApi } from '../../src/services/api';
import { Button, Input, Card } from '../../src/components/ui';
import { colors, spacing } from '../../src/theme';

const EMOJIS = ['💰','🍽️','🏔️','🏠','✈️','🎉','🏖️','🚗','🎮','🛒'];

export default function NewGroupScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('💰');
  const [displayName, setDisplayName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [tab, setTab] = useState<'create' | 'join'>('create');

  const createMutation = useMutation({
    mutationFn: () => groupsApi.create(name.trim(), emoji, displayName.trim()),
    onSuccess: (group) => {
      qc.invalidateQueries({ queryKey: ['groups'] });
      router.replace(`/group/${group.id}`);
    },
    onError: (e: any) => Alert.alert('Erreur', e?.response?.data?.error || 'Impossible de créer le groupe'),
  });

  const joinMutation = useMutation({
    mutationFn: () => groupsApi.join(joinCode.trim(), displayName.trim()),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['groups'] });
      router.replace(`/group/${data.group.id}`);
    },
    onError: (e: any) => Alert.alert('Erreur', e?.response?.data?.error || 'Code invalide'),
  });

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>✕</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Nouveau groupe</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Tab toggle */}
      <View style={styles.tabRow}>
        <TouchableOpacity style={[styles.tabBtn, tab === 'create' && styles.tabBtnOn]} onPress={() => setTab('create')}>
          <Text style={[styles.tabBtnText, tab === 'create' && styles.tabBtnTextOn]}>Créer</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabBtn, tab === 'join' && styles.tabBtnOn]} onPress={() => setTab('join')}>
          <Text style={[styles.tabBtnText, tab === 'join' && styles.tabBtnTextOn]}>Rejoindre</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Input label="Ton prénom dans ce groupe" placeholder="Ex: Alicia" value={displayName} onChangeText={setDisplayName} />

        {tab === 'create' ? (
          <Card>
            <Input label="Nom du groupe" placeholder="Dîner Zurich, Coloc, Week-end..." value={name} onChangeText={setName} />
            <Text style={styles.emojiLabel}>EMOJI</Text>
            <View style={styles.emojiRow}>
              {EMOJIS.map(e => (
                <TouchableOpacity
                  key={e}
                  onPress={() => setEmoji(e)}
                  style={[styles.emojiBtn, emoji === e && styles.emojiBtnOn]}
                >
                  <Text style={{ fontSize: 22 }}>{e}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Button
              label="Créer le groupe →"
              onPress={() => createMutation.mutate()}
              loading={createMutation.isPending}
              style={{ marginTop: 8 }}
            />
          </Card>
        ) : (
          <Card>
            <Input label="Code d'invitation" placeholder="Colle le code ici" value={joinCode} onChangeText={setJoinCode} autoCapitalize="none" />
            <Button label="Rejoindre →" onPress={() => joinMutation.mutate()} loading={joinMutation.isPending} style={{ marginTop: 8 }} />
          </Card>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.xl, paddingTop: 16, paddingBottom: 12 },
  backBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  backText: { color: colors.text2, fontSize: 16 },
  title: { fontSize: 17, fontWeight: '600', color: colors.text },
  tabRow: { flexDirection: 'row', marginHorizontal: spacing.xl, backgroundColor: colors.surface2, borderRadius: 10, padding: 3, marginBottom: 16 },
  tabBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  tabBtnOn: { backgroundColor: colors.surface3 },
  tabBtnText: { fontSize: 13, fontWeight: '500', color: colors.text3 },
  tabBtnTextOn: { color: colors.text },
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: 60 },
  emojiLabel: { fontSize: 11, fontWeight: '500', color: colors.text3, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 },
  emojiRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  emojiBtn: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2, borderWidth: 0.5, borderColor: colors.border },
  emojiBtnOn: { borderColor: colors.accent, backgroundColor: colors.accentBg },
});
