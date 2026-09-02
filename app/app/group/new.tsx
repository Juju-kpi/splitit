// app/app/group/new.tsx
import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { groupsApi } from '../../src/services/api';
import { Button, Input, Card } from '../../src/components/ui';
import { colors, spacing, fonts } from '../../src/theme';
import { useT } from '../../src/store/langStore';

const EMOJIS = ['💰','🍽️','🏔️','🏠','✈️','🎉','🏖️','🚗','🎮','🛒'];

export default function NewGroupScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const t = useT();
  const insets = useSafeAreaInsets();
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
    onError: (e: any) => Alert.alert(t('common.error'), e?.response?.data?.error || t('groups.create_error')),
  });

  const joinMutation = useMutation({
    mutationFn: () => groupsApi.join(joinCode.trim(), displayName.trim()),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['groups'] });
      router.replace(`/group/${data.group.id}`);
    },
    onError: (e: any) => Alert.alert(t('common.error'), e?.response?.data?.error || t('groups.invalid_code_title')),
  });

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Text style={styles.backText}>✕</Text>
        </TouchableOpacity>
        <Text style={styles.title}>{t('groups.new_title')}</Text>
        <View style={{ width: 40 }} />
      </View>

      {/* Tab toggle */}
      <View style={styles.tabRow}>
        <TouchableOpacity style={[styles.tabBtn, tab === 'create' && styles.tabBtnOn]} onPress={() => setTab('create')}>
          <Text style={[styles.tabBtnText, tab === 'create' && styles.tabBtnTextOn]}>{t('groups.create_tab')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.tabBtn, tab === 'join' && styles.tabBtnOn]} onPress={() => setTab('join')}>
          <Text style={[styles.tabBtnText, tab === 'join' && styles.tabBtnTextOn]}>{t('common.join')}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: 60 + insets.bottom }]}>
        <Input label={t('groups.your_name_in_group')} placeholder={t('groups.your_name_ph')} value={displayName} onChangeText={setDisplayName} />

        {tab === 'create' ? (
          <Card>
            <Input label={t('groups.group_name')} placeholder={t('groups.group_name_ph')} value={name} onChangeText={setName} />
            <Text style={styles.emojiLabel}>{t('groups.emoji_label')}</Text>
            <View style={styles.emojiRow}>
              {EMOJIS.map(e => (
                <TouchableOpacity
                  key={e}
                  onPress={() => setEmoji(e)}
                  style={[styles.emojiBtn, emoji === e && styles.emojiBtnOn]}
                >
                  <Text style={{ fontFamily: fonts.regular, fontSize: 22 }}>{e}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Button
              label={`${t('groups.create_group_btn')} →`}
              onPress={() => createMutation.mutate()}
              loading={createMutation.isPending}
              style={{ marginTop: 8 }}
            />
          </Card>
        ) : (
          <Card>
            <Input label={t('groups.invite_code')} placeholder={t('groups.code_ph')} value={joinCode} onChangeText={setJoinCode} autoCapitalize="none" autoCorrect={false} />
            <Button label={`${t('common.join')} →`} onPress={() => joinMutation.mutate()} loading={joinMutation.isPending} style={{ marginTop: 8 }} />
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
  backText: { color: colors.text2, fontFamily: fonts.regular, fontSize: 16 },
  title: { fontFamily: fonts.semibold, fontSize: 17, fontWeight: '600', color: colors.text },
  tabRow: { flexDirection: 'row', marginHorizontal: spacing.xl, backgroundColor: colors.surface2, borderRadius: 10, padding: 3, marginBottom: 16 },
  tabBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  tabBtnOn: { backgroundColor: colors.surface3 },
  tabBtnText: { fontFamily: fonts.medium, fontSize: 13, fontWeight: '500', color: colors.text3 },
  tabBtnTextOn: { color: colors.text },
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: 60 },
  emojiLabel: { fontFamily: fonts.medium, fontSize: 11, fontWeight: '500', color: colors.text3, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8 },
  emojiRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  emojiBtn: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface2, borderWidth: 0.5, borderColor: colors.border },
  emojiBtnOn: { borderColor: colors.accent, backgroundColor: colors.accentBg },
});
