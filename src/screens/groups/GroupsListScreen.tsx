// app/src/screens/groups/GroupsListScreen.tsx
import React, { useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity, RefreshControl,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { groupsApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { AvatarRow, Pill, SectionLabel, Card } from '../../components/ui';
import { colors, spacing, radius, shadows } from '../../theme';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { Group } from '../../../../shared/types';

export default function GroupsListScreen() {
  const router = useRouter();
  const user = useAuthStore(s => s.user);
  const insets = useSafeAreaInsets();

  const { data: groups, isLoading, refetch } = useQuery({
    queryKey: ['groups'],
    queryFn: groupsApi.list,
  });

  const renderGroup = useCallback(({ item }: { item: Group & { expenseCount: number } }) => (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={() => router.push(`/group/${item.id}`)}
    >
      <Card style={styles.groupCard}>
        {/* Accent stripe */}
        <View style={styles.groupStripe} />
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
      </Card>
    </TouchableOpacity>
  ), [router]);

  return (
    <View style={styles.screen}>
      {/* Header with safe area */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) }]}>
        <View>
          <Text style={styles.logo}>
            Split<Text style={{ color: colors.accent }}>it</Text>
          </Text>
          <Text style={styles.greeting}>Bonjour, {user?.username} 👋</Text>
        </View>
        <View style={styles.headerBtns}>
          <TouchableOpacity
            style={styles.joinBtn}
            onPress={() => router.push('/group/join')}
            activeOpacity={0.75}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.joinBtnText}>Rejoindre</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.newBtn}
            onPress={() => router.push('/group/new')}
            activeOpacity={0.75}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.newBtnText}>+ Nouveau</Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={groups || []}
        keyExtractor={g => g.id}
        renderItem={renderGroup}
        contentContainerStyle={[styles.list, { paddingBottom: 100 + insets.bottom }]}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={refetch}
            tintColor={colors.accent}
          />
        }
        ListHeaderComponent={<SectionLabel label="Groupes actifs" />}
        ListEmptyComponent={
          !isLoading ? (
            <View style={styles.empty}>
              <Text style={styles.emptyEmoji}>💸</Text>
              <Text style={styles.emptyTitle}>Aucun groupe encore</Text>
              <Text style={styles.emptySubtitle}>Crée ou rejoins un groupe pour commencer</Text>
              <View style={styles.emptyActions}>
                <TouchableOpacity
                  style={styles.emptyBtn}
                  onPress={() => router.push('/group/new')}
                  activeOpacity={0.8}
                >
                  <Text style={styles.emptyBtnText}>+ Créer un groupe</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.emptyBtn, styles.emptyBtnGhost]}
                  onPress={() => router.push('/group/join')}
                  activeOpacity={0.8}
                >
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

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.glassBorder,
    backgroundColor: colors.bg,
  },
  logo: { fontSize: 28, fontWeight: '800', letterSpacing: -1, color: colors.text },
  greeting: { fontSize: 12, color: colors.text3, marginTop: 2, fontWeight: '500' },
  headerBtns: { flexDirection: 'row', gap: 8 },
  joinBtn: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.full,
    minHeight: 44,
    justifyContent: 'center',
  },
  joinBtnText: { color: colors.text2, fontSize: 13, fontWeight: '600' },
  newBtn: {
    backgroundColor: colors.accent,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: radius.full,
    minHeight: 44,
    justifyContent: 'center',
    ...shadows.accent,
  },
  newBtnText: { color: colors.white, fontSize: 13, fontWeight: '700' },

  // List
  list: { paddingHorizontal: spacing.xl },

  // Group card
  groupCard: { marginBottom: 10, overflow: 'hidden' },
  groupStripe: {
    position: 'absolute',
    left: 0, top: 0, bottom: 0,
    width: 3,
    backgroundColor: colors.accent,
    borderTopLeftRadius: 16,
    borderBottomLeftRadius: 16,
    opacity: 0.6,
  },
  groupCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingLeft: 8,
  },
  groupName: { fontSize: 16, fontWeight: '600', color: colors.text, flex: 1, marginRight: 8 },
  groupCardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
    paddingLeft: 8,
  },
  groupDate: { fontSize: 11, color: colors.text3 },
  groupArrow: { fontSize: 18, color: colors.text3, fontWeight: '300' },

  // Empty
  empty: { alignItems: 'center', paddingTop: 70 },
  emptyEmoji: { fontSize: 52, marginBottom: 16 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: colors.text, marginBottom: 6 },
  emptySubtitle: { fontSize: 13, color: colors.text3, marginBottom: 32 },
  emptyActions: { gap: 10, width: '100%', paddingHorizontal: 20 },
  emptyBtn: {
    backgroundColor: colors.accent,
    paddingVertical: 15,
    borderRadius: radius.md,
    alignItems: 'center',
    minHeight: 52,
    justifyContent: 'center',
    ...shadows.accent,
  },
  emptyBtnText: { color: colors.white, fontSize: 15, fontWeight: '700' },
  emptyBtnGhost: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.glassBorder,
    shadowOpacity: 0,
    elevation: 0,
  },
  emptyBtnGhostText: { color: colors.text2, fontSize: 15, fontWeight: '600' },
});