// app/src/screens/groups/GroupsListScreen.tsx
import React, { useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { groupsApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { AvatarRow, Pill, SectionLabel, Card, ScreenHeader, ActionPill } from '../../components/ui';
import { colors, spacing, radius, shadows } from '../../theme';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Group } from '../../../../shared/types';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function GroupsListScreen() {
  const router = useRouter();
  const user = useAuthStore(s => s.user);
  const insets = useSafeAreaInsets();

  const { data: groups, isLoading, refetch } = useQuery({
    queryKey: ['groups'],
    queryFn: groupsApi.list,
  });

  const renderGroup = useCallback(({ item }: { item: Group & { expenseCount: number } }) => (
    <TouchableOpacity activeOpacity={0.72} onPress={() => router.push(`/group/${item.id}`)}>
      <View style={styles.groupCard}>
        {/* Left accent bar */}
        <View style={styles.accentBar} />
        {/* Glass inner */}
        <View style={styles.groupCardInner}>
          <View style={styles.groupCardTop}>
            <Text style={styles.groupName}>{item.emoji} {item.name}</Text>
            <Pill
              label={`${item.expenseCount} dépense${item.expenseCount !== 1 ? 's' : ''}`}
              variant={item.expenseCount > 5 ? 'green' : 'accent'}
            />
          </View>
          <AvatarRow members={item.members} />
          <View style={styles.groupCardFooter}>
            <Text style={styles.groupDate}>
              {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true, locale: fr })}
            </Text>
            <Text style={styles.groupArrow}>›</Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  ), [router]);

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Splitit"
        accentWord="it"
        subtitle={`Bonjour, ${user?.username} 👋`}
        rightContent={
          <>
            <ActionPill label="Rejoindre" icon="🔗" onPress={() => router.push('/group/join')} />
            <ActionPill label="+ Nouveau" primary onPress={() => router.push('/group/new')} />
          </>
        }
      />

      <FlatList
        data={groups || []}
        keyExtractor={g => g.id}
        renderItem={renderGroup}
        contentContainerStyle={[styles.list, { paddingBottom: 100 + insets.bottom }]}
        refreshControl={
          <RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={colors.accent} />
        }
        ListHeaderComponent={<SectionLabel label="Groupes actifs" />}
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.empty}>
              <View style={styles.emptyIconWrap}>
                <Text style={styles.emptyEmoji}>💸</Text>
              </View>
              <Text style={styles.emptyTitle}>Aucun groupe encore</Text>
              <Text style={styles.emptySubtitle}>Crée ou rejoins un groupe pour commencer à partager</Text>
              <View style={styles.emptyActions}>
                <TouchableOpacity style={styles.emptyBtn} onPress={() => router.push('/group/new')} activeOpacity={0.8}>
                  <Text style={styles.emptyBtnText}>✦ Créer un groupe</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.emptyBtnGhost} onPress={() => router.push('/group/join')} activeOpacity={0.8}>
                  <Text style={styles.emptyBtnGhostText}>Rejoindre avec un code</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  list: { paddingHorizontal: spacing.xl },

  // Group card
  groupCard: {
    flexDirection: 'row',
    marginBottom: 10,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.glass,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    ...shadows.card,
  },
  accentBar: {
    width: 3,
    backgroundColor: colors.accent,
    opacity: 0.7,
  },
  groupCardInner: { flex: 1, padding: spacing.lg },
  groupCardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  groupName: { fontSize: 16, fontWeight: '600', color: colors.text, flex: 1, marginRight: 8 },
  groupCardFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  groupDate: { fontSize: 11, color: colors.text3 },
  groupArrow: { fontSize: 20, color: colors.text3, fontWeight: '200' },

  // Empty state
  empty: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 20 },
  emptyIconWrap: {
    width: 80, height: 80, borderRadius: 24,
    backgroundColor: colors.accentBg,
    borderWidth: 1, borderColor: 'rgba(124,110,250,0.2)',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 20,
  },
  emptyEmoji: { fontSize: 36 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: colors.text, marginBottom: 8, letterSpacing: -0.3 },
  emptySubtitle: { fontSize: 13, color: colors.text3, textAlign: 'center', lineHeight: 19, marginBottom: 32 },
  emptyActions: { gap: 10, width: '100%' },
  emptyBtn: {
    backgroundColor: colors.accent, paddingVertical: 15,
    borderRadius: radius.md, alignItems: 'center', minHeight: 52, ...shadows.accent,
  },
  emptyBtnText: { color: colors.white, fontSize: 15, fontWeight: '700', letterSpacing: 0.2 },
  emptyBtnGhost: {
    backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.glassBorder,
    paddingVertical: 15, borderRadius: radius.md, alignItems: 'center', minHeight: 52,
  },
  emptyBtnGhostText: { color: colors.text2, fontSize: 15, fontWeight: '600' },
});