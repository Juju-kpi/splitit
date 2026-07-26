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
import { useT } from '../../src/store/langStore';

export default function GroupMembersScreen() {
  const { groupId, mode } = useLocalSearchParams<{ groupId: string; mode?: string }>();
  // mode='identify' → user picking who they are among existing names
  const isIdentify = mode === 'identify';

  const router = useRouter();
  const qc = useQueryClient();
  const t = useT();

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
        Alert.alert(t('groups.member_added_title'), t('groups.member_added_msg', { name: newName }));
      }
    },
    onError: (e: any) => Alert.alert(t('common.error'), e?.response?.data?.error || t('groups.add_member_error')),
  });

  function handleAdd() {
    if (!newName.trim()) { Alert.alert(t('groups.name_missing_title')); return; }
    addMutation.mutate(newName.trim());
  }

  if (isLoading || !group) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  const members = group.members || [];

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>{t('common.back')}</Text>
        </TouchableOpacity>
        <Text style={styles.title}>
          {isIdentify ? t('groups.who_are_you') : t('groups.group_members')}
        </Text>
        <View style={{ width: 70 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

        {isIdentify ? (
          /* Identify mode: pick your name or add new */
          <>
            <Notice
              text={t('groups.identify_notice')}
              variant="accent"
            />
            <Text style={styles.sectionLabel}>{t('groups.existing_members')}</Text>
            {members.map((m: any) => (
              <TouchableOpacity
                key={m.id}
                style={styles.memberRow}
                onPress={() => {
                  // In real app: link this account to the guest member
                  // For now: navigate back and set preference
                  Alert.alert(
                    t('groups.are_you', { name: m.displayName }),
                    t('groups.linking_soon'),
                    [{ text: t('common.ok') }]
                  );
                }}
                activeOpacity={0.75}
              >
                <Avatar initials={m.avatarInitials} color={m.avatarColor} size={36} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.memberName}>{m.displayName}</Text>
                  {m.userId && <Text style={styles.memberSub}>{t('groups.account_linked')}</Text>}
                </View>
                <Text style={styles.selectArrow}>→</Text>
              </TouchableOpacity>
            ))}

            <Text style={styles.sectionLabel}>{t('groups.name_not_in_list')}</Text>
            <Card>
              <Input
                label={t('groups.your_first_name')}
                placeholder={t('groups.your_first_name_ph')}
                value={newName}
                onChangeText={setNewName}
                autoCapitalize="words"
              />
              <Button
                label={`${t('groups.add_and_join')} →`}
                onPress={handleAdd}
                loading={addMutation.isPending}
              />
            </Card>
          </>
        ) : (
          /* Manage mode: see members + add guests */
          <>
            <Notice
              text={t('groups.manage_notice')}
              variant="accent"
            />

            <Text style={styles.sectionLabel}>{t('groups.current_members', { n: members.length })}</Text>
            {members.map((m: any) => (
              <View key={m.id} style={styles.memberRow}>
                <Avatar initials={m.avatarInitials} color={m.avatarColor} size={36} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.memberName}>{m.displayName}</Text>
                  {m.userId
                    ? <Text style={styles.memberSub}>{t('groups.account_linked')}</Text>
                    : <Text style={[styles.memberSub, { color: colors.amber }]}>{t('groups.no_account_short')}</Text>
                  }
                </View>
              </View>
            ))}

            {/* Add new member */}
            <Text style={styles.sectionLabel}>{t('groups.add_member_section')}</Text>
            {!adding ? (
              <TouchableOpacity style={styles.addBtn} onPress={() => setAdding(true)}>
                <Text style={styles.addBtnText}>{t('groups.add_person')}</Text>
              </TouchableOpacity>
            ) : (
              <Card>
                <Input
                  label={t('groups.first_name')}
                  placeholder={t('groups.add_member_ph')}
                  value={newName}
                  onChangeText={setNewName}
                  autoCapitalize="words"
                  autoFocus
                />
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Button
                    label={t('common.cancel')}
                    onPress={() => { setAdding(false); setNewName(''); }}
                    variant="ghost"
                    style={{ flex: 1 }}
                  />
                  <Button
                    label={`${t('groups.add')} →`}
                    onPress={handleAdd}
                    loading={addMutation.isPending}
                    style={{ flex: 1 }}
                  />
                </View>
              </Card>
            )}

            <Notice
              variant="amber"
              text={t('groups.invite_notice')}
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
