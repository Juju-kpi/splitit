// app/app/(tabs)/stats.tsx
import React from 'react';
import { useQuery, useQueries } from '@tanstack/react-query';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { groupsApi, ocrApi } from '../../src/services/api';
import { useAuthStore } from '../../src/store/authStore';
import { Card, GlassCard, SectionLabel, ScreenHeader } from '../../src/components/ui';
import { colors, spacing, radius, shadows } from '../../src/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function MiniBar({ value, max, color = colors.accent }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(value / max, 1) : 0;
  return (
    <View style={styles.barTrack}>
      <View style={[styles.barFill, { width: `${pct * 100}%` as any, backgroundColor: color }]} />
    </View>
  );
}

function StatBox({ value, label, color = colors.accent2, sub }: {
  value: string | number; label: string; color?: string; sub?: string;
}) {
  return (
    <View style={styles.statBox}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      {sub && <Text style={styles.statSub}>{sub}</Text>}
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function StatsScreen() {
  const router = useRouter();
  const user = useAuthStore(s => s.user);
  const insets = useSafeAreaInsets();

  const { data: groups, isLoading, refetch } = useQuery({ queryKey: ['groups'], queryFn: groupsApi.list });
  const groupIds: string[] = (groups || []).map((g: any) => g.id);
  const groupQueries = useQueries({
    queries: groupIds.map(id => ({
      queryKey: ['group', id],
      queryFn: () => groupsApi.get(id),
      enabled: groupIds.length > 0,
      staleTime: 60_000,
    })),
  });
  const { data: ocrStats } = useQuery({ queryKey: ['ocrStats'], queryFn: ocrApi.getStats, staleTime: 60_000 });

  const totalGroups = (groups || []).length;
  const totalExpenses = (groups || []).reduce((s: number, g: any) => s + (g.expenseCount || 0), 0);

  const groupStats = (groups || []).map((g: any, i: number) => {
    const full = groupQueries[i]?.data;
    if (!full) return { group: g, myShare: null, total: null, memberCount: g.members?.length || 0, paid: null };
    const myMember = full.members?.find((m: any) => m.userId === user?.id);
    const myShare = full.expenses?.reduce((s: number, exp: any) => {
      const split = exp.splits?.find((sp: any) => sp.memberId === myMember?.id);
      return s + (split?.amount || 0);
    }, 0) ?? 0;
    const myPaid = full.expenses?.reduce((s: number, exp: any) => {
      if (exp.payments && exp.payments.length > 0) {
        const myPayment = exp.payments.find((p: any) => p.memberId === myMember?.id);
        return s + (myPayment?.amount || 0);
      }
      return s + (exp.paidByMemberId === myMember?.id ? exp.totalAmount : 0);
    }, 0) ?? 0;
    const total = full.expenses?.reduce((s: number, exp: any) => s + exp.totalAmount, 0) ?? 0;
    const memberCount = full.members?.length || 0;
    const myBalance = myPaid - myShare;
    return { group: g, myShare, myPaid, myBalance, total, memberCount, full };
  });

  const myTotalShare = groupStats.reduce((s, gs) => s + (gs.myShare || 0), 0);
  const myTotalPaid = groupStats.reduce((s, gs) => s + (gs.myPaid || 0), 0);
  const netBalance = myTotalPaid - myTotalShare;

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Statistiques" subtitle="Vue d'ensemble de tes dépenses" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 100 + insets.bottom }]}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={colors.accent} />}
      >
        {/* Hero balance card */}
        {myTotalPaid > 0 && (
          <GlassCard glow style={styles.heroCard}>
            <Text style={styles.heroLabel}>Solde net total</Text>
            <Text style={[styles.heroAmount, { color: netBalance >= 0 ? colors.green : colors.red }]}>
              {netBalance >= 0 ? '+' : ''}{netBalance.toFixed(2)}
              <Text style={styles.heroCurrency}> CHF</Text>
            </Text>
            <Text style={styles.heroSub}>
              {netBalance >= 0 ? '✓ On te doit de l\'argent' : '⚡ Tu dois de l\'argent'}
            </Text>
          </GlassCard>
        )}

        {/* Global summary */}
        <SectionLabel label="Résumé global" />
        <Card>
          <View style={styles.statRow}>
            <StatBox value={totalGroups} label="Groupes" color={colors.accent2} />
            <View style={styles.statDivider} />
            <StatBox value={totalExpenses} label="Dépenses" color={colors.green} />
            <View style={styles.statDivider} />
            <StatBox value={`${myTotalShare.toFixed(0)}`} label="Ma part totale" sub="CHF" color={colors.amber} />
          </View>
          {myTotalPaid > 0 && (
            <>
              <View style={styles.globalSeparator} />
              <View style={styles.statRow}>
                <StatBox value={`${myTotalPaid.toFixed(0)}`} label="J'ai avancé" sub="CHF" color={colors.text2} />
                <View style={styles.statDivider} />
                <StatBox
                  value={`${netBalance.toFixed(0)}`}
                  label={netBalance >= 0 ? 'On me doit' : 'Je dois'}
                  sub="CHF"
                  color={netBalance >= 0 ? colors.green : colors.red}
                />
                <View style={styles.statDivider} />
                <StatBox value={ocrStats?.totalReceipts ?? 0} label="Tickets OCR" color={colors.text2} />
              </View>
            </>
          )}
        </Card>

        {/* Per-group breakdown */}
        {totalGroups > 0 && (
          <>
            <SectionLabel label="Par groupe" />
            {groupStats.map(({ group: g, myShare, myPaid, myBalance, total, memberCount }) => (
              <TouchableOpacity key={g.id} activeOpacity={0.78} onPress={() => router.push(`/group/${g.id}`)}>
                <View style={styles.groupCard}>
                  <View style={styles.groupAccentBar} />
                  <View style={styles.groupCardInner}>
                    <View style={styles.groupHeader}>
                      <Text style={styles.groupName}>{g.emoji} {g.name}</Text>
                      <Text style={styles.groupMeta}>{memberCount} membres</Text>
                    </View>
                    <View style={styles.groupStatRow}>
                      <View style={styles.groupStat}>
                        <Text style={styles.groupStatNum}>{g.expenseCount}</Text>
                        <Text style={styles.groupStatLabel}>dépenses</Text>
                      </View>
                      <View style={styles.groupStatDivider} />
                      <View style={styles.groupStat}>
                        <Text style={[styles.groupStatNum, { color: colors.text2 }]}>
                          {total !== null ? `${total.toFixed(0)}` : '—'}
                        </Text>
                        <Text style={styles.groupStatLabel}>total CHF</Text>
                      </View>
                      <View style={styles.groupStatDivider} />
                      <View style={styles.groupStat}>
                        <Text style={[styles.groupStatNum, { color: colors.accent2 }]}>
                          {myShare !== null ? `${myShare.toFixed(0)}` : '—'}
                        </Text>
                        <Text style={styles.groupStatLabel}>ma part CHF</Text>
                      </View>
                    </View>
                    {total !== null && total > 0 && myShare !== null && (
                      <View style={{ marginTop: 10 }}>
                        <MiniBar value={myShare} max={total} color={colors.accent} />
                        <Text style={styles.barLabel}>
                          Ma part : {((myShare / total) * 100).toFixed(0)}% du total
                        </Text>
                      </View>
                    )}
                    {myBalance !== null && myBalance !== undefined && Math.abs(myBalance) > 0.01 && (
                      <View style={[styles.balanceBadge, { backgroundColor: myBalance > 0 ? colors.greenBg : colors.redBg, borderColor: myBalance > 0 ? 'rgba(52,211,153,0.2)' : 'rgba(248,113,113,0.2)' }]}>
                        <Text style={[styles.balanceBadgeText, { color: myBalance > 0 ? colors.green : colors.red }]}>
                          {myBalance > 0 ? `✓ On me doit ${myBalance.toFixed(2)} CHF` : `⚡ Je dois ${Math.abs(myBalance).toFixed(2)} CHF`}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>
              </TouchableOpacity>
            ))}
          </>
        )}

        {/* OCR */}
        {ocrStats && (
          <>
            <SectionLabel label="Modèle OCR" />
            <Card>
              <View style={styles.ocrHeader}>
                <Text style={styles.ocrTitle}>🧠 Entraînement</Text>
                <Text style={styles.ocrVersion}>{ocrStats.modelVersion ?? 'v1.0'}</Text>
              </View>
              <View style={styles.statRow}>
                <StatBox value={ocrStats.totalCorrections ?? 0} label="Corrections" />
                <View style={styles.statDivider} />
                <StatBox value={ocrStats.totalReceipts ?? 0} label="Tickets" color={colors.green} />
                <View style={styles.statDivider} />
                <StatBox value={`${Math.round((ocrStats.progressToNextRun ?? 0) * 100)}%`} label="Prochain run" color={colors.amber} />
              </View>
              <MiniBar value={ocrStats.progressToNextRun ?? 0} max={1} color={colors.amber} />
              <Text style={styles.barLabel}>{ocrStats.untrainedCount ?? 0} / 100 corrections avant le prochain affinement</Text>
            </Card>
          </>
        )}

        {totalGroups === 0 && !isLoading && (
          <View style={styles.empty}>
            <Text style={styles.emptyEmoji}>📊</Text>
            <Text style={styles.emptyTitle}>Pas encore de données</Text>
            <Text style={styles.emptyText}>Crée ou rejoins un groupe pour voir tes statistiques ici.</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.xl },

  // Hero
  heroCard: { marginTop: 16 },
  heroLabel: { fontSize: 11, fontWeight: '700', color: colors.text3, textTransform: 'uppercase', letterSpacing: 1.3, marginBottom: 8 },
  heroAmount: { fontSize: 44, fontWeight: '200', fontFamily: 'monospace', letterSpacing: -1 },
  heroCurrency: { fontSize: 18, color: colors.text3 },
  heroSub: { fontSize: 12, color: colors.text3, marginTop: 6, fontWeight: '500' },

  // Stats
  statRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingVertical: 8 },
  statBox: { alignItems: 'center', flex: 1 },
  statValue: { fontSize: 26, fontWeight: '300', fontFamily: 'monospace' },
  statSub: { fontSize: 10, color: colors.text3, marginTop: -2 },
  statLabel: { fontSize: 10, color: colors.text3, marginTop: 4, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8, textAlign: 'center' },
  statDivider: { width: 0.5, height: 44, backgroundColor: colors.glassBorder },
  globalSeparator: { height: 0.5, backgroundColor: colors.glassBorder, marginVertical: 8 },

  // Group cards
  groupCard: {
    flexDirection: 'row', marginBottom: 10, borderRadius: radius.md, overflow: 'hidden',
    backgroundColor: colors.glass, borderWidth: 1, borderColor: colors.glassBorder, ...shadows.card,
  },
  groupAccentBar: { width: 3, backgroundColor: colors.accent, opacity: 0.6 },
  groupCardInner: { flex: 1, padding: spacing.lg },
  groupHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  groupName: { fontSize: 15, fontWeight: '600', color: colors.text, flex: 1 },
  groupMeta: { fontSize: 11, color: colors.text3 },
  groupStatRow: { flexDirection: 'row', alignItems: 'center' },
  groupStat: { flex: 1, alignItems: 'center' },
  groupStatNum: { fontSize: 16, fontWeight: '500', fontFamily: 'monospace', color: colors.text },
  groupStatLabel: { fontSize: 10, color: colors.text3, marginTop: 2, textAlign: 'center' },
  groupStatDivider: { width: 0.5, height: 32, backgroundColor: colors.glassBorder },
  balanceBadge: { borderRadius: radius.sm, padding: 8, marginTop: 10, alignItems: 'center', borderWidth: 1 },
  balanceBadgeText: { fontSize: 12, fontWeight: '700' },

  // Bar
  barTrack: { height: 4, backgroundColor: colors.surface2, borderRadius: 2, overflow: 'hidden', marginTop: 8 },
  barFill: { height: '100%', borderRadius: 2 },
  barLabel: { fontSize: 10, color: colors.text3, marginTop: 5 },

  // OCR
  ocrHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  ocrTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  ocrVersion: { fontSize: 12, color: colors.accent2, fontFamily: 'monospace' },

  // Empty
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyEmoji: { fontSize: 48, marginBottom: 16 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 8 },
  emptyText: { fontSize: 13, color: colors.text3, textAlign: 'center', maxWidth: 260, lineHeight: 20 },
});