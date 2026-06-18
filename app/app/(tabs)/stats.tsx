// app/app/(tabs)/stats.tsx
// Ajouts vs original :
//   - Section "Mes dépenses perso" : top mois, dépense moyenne, plus grand payeur
//   - Section "Par groupe" enrichie : dépenses incomplètes, taux de complétion
//   - Section "Activité" : timeline des 5 dernières dépenses tous groupes
//   - Section "Qui me doit / à qui je dois" : vue globale consolidée

import React, { useMemo } from 'react';
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

function isExpenseIncomplete(exp: any): boolean {
  if (typeof exp.isComplete === 'boolean') return !exp.isComplete;
  const items: any[] = exp.items || [];
  if (items.length > 0 && items.some((i: any) => !i.assignedTo || i.assignedTo.length === 0)) return true;
  const splits: any[] = exp.splits || [];
  const splitTotal = splits.reduce((s: number, sp: any) => s + sp.amount, 0);
  if (splits.length > 0 && Math.abs(splitTotal - exp.totalAmount) > 0.02) return true;
  return false;
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
    if (!full) return { group: g, myShare: null, total: null, memberCount: g.members?.length || 0, paid: null, incomplete: 0, completionRate: null };
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
    const incompleteExps = (full.expenses || []).filter(isExpenseIncomplete);
    const incomplete = incompleteExps.length;
    const expCount = full.expenses?.length || 0;
    const completionRate = expCount > 0 ? ((expCount - incomplete) / expCount) * 100 : 100;
    return { group: g, myShare, myPaid, myBalance, total, memberCount, full, incomplete, completionRate };
  });

  const myTotalShare = groupStats.reduce((s, gs) => s + (gs.myShare || 0), 0);
  const myTotalPaid = groupStats.reduce((s, gs) => s + (gs.myPaid || 0), 0);
  const netBalance = myTotalPaid - myTotalShare;

  // ── Toutes les dépenses, chronologiques ──────────────────────────────
  const allExpenses = useMemo(() => {
    const exps: any[] = [];
    groupStats.forEach(gs => {
      if (!gs.full) return;
      (gs.full.expenses || []).forEach((exp: any) => {
        exps.push({ ...exp, groupName: gs.group.name, groupEmoji: gs.group.emoji, groupId: gs.group.id });
      });
    });
    return exps.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [groupStats]);

  // ── Dépenses du mois en cours ────────────────────────────────────────
  const now = new Date();
  const thisMonthExps = allExpenses.filter(exp => {
    const d = new Date(exp.createdAt);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const thisMonthTotal = thisMonthExps.reduce((s, exp) => {
    const myMemberInGroup = groupStats.find(gs => gs.group.id === exp.groupId)?.full?.members?.find((m: any) => m.userId === user?.id);
    const mySplit = exp.splits?.find((sp: any) => sp.memberId === myMemberInGroup?.id);
    return s + (mySplit?.amount || 0);
  }, 0);

  // ── Dépense moyenne ──────────────────────────────────────────────────
  const avgExpense = allExpenses.length > 0
    ? allExpenses.reduce((s, e) => s + e.totalAmount, 0) / allExpenses.length
    : 0;

  // ── Membre qui a le plus payé dans mes groupes ───────────────────────
  const topPayerMap: Record<string, { name: string; total: number }> = {};
  groupStats.forEach(gs => {
    if (!gs.full) return;
    (gs.full.expenses || []).forEach((exp: any) => {
      (exp.payments || []).forEach((p: any) => {
        const name = p.member?.displayName || '?';
        if (!topPayerMap[name]) topPayerMap[name] = { name, total: 0 };
        topPayerMap[name].total += p.amount;
      });
    });
  });
  const topPayers = Object.values(topPayerMap).sort((a, b) => b.total - a.total).slice(0, 3);

  // ── Soldes globaux consolidés ────────────────────────────────────────
  const globalDebts: Record<string, { name: string; amount: number; type: 'owe' | 'owed' }> = {};
  groupStats.forEach(gs => {
    if (!gs.full) return;
    const myMember = gs.full.members?.find((m: any) => m.userId === user?.id);
    if (!myMember) return;
    (gs.full.balances || []).forEach((b: any) => {
      if (b.fromMemberId === myMember.id) {
        const key = `owe_${b.toMember?.displayName}`;
        if (!globalDebts[key]) globalDebts[key] = { name: b.toMember?.displayName, amount: 0, type: 'owe' };
        globalDebts[key].amount += b.amount;
      } else if (b.toMemberId === myMember.id) {
        const key = `owed_${b.fromMember?.displayName}`;
        if (!globalDebts[key]) globalDebts[key] = { name: b.fromMember?.displayName, amount: 0, type: 'owed' };
        globalDebts[key].amount += b.amount;
      }
    });
  });
  const oweList = Object.values(globalDebts).filter(d => d.type === 'owe').sort((a, b) => b.amount - a.amount);
  const owedList = Object.values(globalDebts).filter(d => d.type === 'owed').sort((a, b) => b.amount - a.amount);

  const totalIncomplete = groupStats.reduce((s, gs) => s + (gs.incomplete || 0), 0);

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
          {totalIncomplete > 0 && (
            <View style={styles.incompleteAlert}>
              <Text style={styles.incompleteAlertText}>
                ⏳ {totalIncomplete} dépense{totalIncomplete > 1 ? 's' : ''} à compléter dans tes groupes
              </Text>
            </View>
          )}
        </Card>

        {/* Ce mois-ci */}
        {allExpenses.length > 0 && (
          <>
            <SectionLabel label="Ce mois-ci" />
            <Card>
              <View style={styles.statRow}>
                <StatBox
                  value={thisMonthExps.length}
                  label="Dépenses"
                  color={colors.accent2}
                />
                <View style={styles.statDivider} />
                <StatBox
                  value={thisMonthTotal.toFixed(0)}
                  label="Ma part CHF"
                  sub="CHF"
                  color={colors.amber}
                />
                <View style={styles.statDivider} />
                <StatBox
                  value={avgExpense.toFixed(0)}
                  label="Moy. dépense"
                  sub="CHF"
                  color={colors.text2}
                />
              </View>
            </Card>
          </>
        )}

        {/* Soldes globaux */}
        {(oweList.length > 0 || owedList.length > 0) && (
          <>
            <SectionLabel label="Mes soldes globaux" />
            <Card>
              {owedList.length > 0 && (
                <>
                  <Text style={styles.debtHeader}>✓ On me doit</Text>
                  {owedList.map((d, i) => (
                    <View key={i} style={styles.debtRow}>
                      <Text style={styles.debtName}>{d.name}</Text>
                      <Text style={[styles.debtAmt, { color: colors.green }]}>+{d.amount.toFixed(2)} CHF</Text>
                    </View>
                  ))}
                </>
              )}
              {owedList.length > 0 && oweList.length > 0 && <View style={styles.debtSeparator} />}
              {oweList.length > 0 && (
                <>
                  <Text style={styles.debtHeader}>⚡ Je dois</Text>
                  {oweList.map((d, i) => (
                    <View key={i} style={styles.debtRow}>
                      <Text style={styles.debtName}>{d.name}</Text>
                      <Text style={[styles.debtAmt, { color: colors.red }]}>−{d.amount.toFixed(2)} CHF</Text>
                    </View>
                  ))}
                </>
              )}
            </Card>
          </>
        )}

        {/* Top payeurs */}
        {topPayers.length > 0 && (
          <>
            <SectionLabel label="Top payeurs (tous groupes)" />
            <Card>
              {topPayers.map((p, i) => (
                <View key={i} style={styles.topPayerRow}>
                  <Text style={styles.topPayerRank}>{['🥇', '🥈', '🥉'][i]}</Text>
                  <Text style={styles.topPayerName}>{p.name}</Text>
                  <Text style={styles.topPayerAmt}>{p.total.toFixed(2)} CHF</Text>
                </View>
              ))}
              <MiniBar value={topPayers[0]?.total || 0} max={topPayers[0]?.total || 1} color={colors.amber} />
            </Card>
          </>
        )}

        {/* Activité récente */}
        {allExpenses.length > 0 && (
          <>
            <SectionLabel label="Activité récente" />
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              {allExpenses.slice(0, 6).map((exp, i) => (
                <TouchableOpacity
                  key={exp.id}
                  style={[styles.activityRow, i > 0 && styles.activityRowBorder]}
                  onPress={() => router.push(`/group/${exp.groupId}`)}
                  activeOpacity={0.7}
                >
                  <View style={styles.activityIcon}>
                    <Text style={{ fontSize: 16 }}>
                      {isExpenseIncomplete(exp) ? '⏳' : exp.receiptImageUrl ? '🧾' : '✏️'}
                    </Text>
                  </View>
                  <View style={styles.activityInfo}>
                    <Text style={styles.activityDesc} numberOfLines={1}>{exp.description}</Text>
                    <Text style={styles.activityGroup}>{exp.groupEmoji} {exp.groupName}</Text>
                  </View>
                  <Text style={styles.activityAmt}>{exp.totalAmount.toFixed(2)} CHF</Text>
                </TouchableOpacity>
              ))}
            </Card>
          </>
        )}

        {/* Per-group breakdown */}
        {totalGroups > 0 && (
          <>
            <SectionLabel label="Par groupe" />
            {groupStats.map(({ group: g, myShare, myPaid, myBalance, total, memberCount, incomplete, completionRate }) => (
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

                    {/* Taux de complétion des dépenses */}
                    {g.expenseCount > 0 && (
                      <View style={{ marginTop: 8 }}>
                        <MiniBar
                          value={completionRate ?? 100}
                          max={100}
                          color={completionRate === 100 ? colors.green : colors.amber}
                        />
                        <Text style={styles.barLabel}>
                          {completionRate === 100
                            ? '✓ Toutes les dépenses sont complètes'
                            : `${(completionRate ?? 0).toFixed(0)}% complet — ${incomplete} à remplir`}
                        </Text>
                      </View>
                    )}

                    {myBalance !== null && myBalance !== undefined && Math.abs(myBalance) > 0.01 && (
                      <View style={[styles.balanceBadge, {
                        backgroundColor: myBalance > 0 ? colors.greenBg : colors.redBg,
                        borderColor: myBalance > 0 ? 'rgba(52,211,153,0.2)' : 'rgba(248,113,113,0.2)',
                      }]}>
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

  heroCard: { marginTop: 16 },
  heroLabel: { fontSize: 11, fontWeight: '700', color: colors.text3, textTransform: 'uppercase', letterSpacing: 1.3, marginBottom: 8 },
  heroAmount: { fontSize: 44, fontWeight: '200', fontFamily: 'monospace', letterSpacing: -1 },
  heroCurrency: { fontSize: 18, color: colors.text3 },
  heroSub: { fontSize: 12, color: colors.text3, marginTop: 6, fontWeight: '500' },

  statRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingVertical: 8 },
  statBox: { alignItems: 'center', flex: 1 },
  statValue: { fontSize: 26, fontWeight: '300', fontFamily: 'monospace' },
  statSub: { fontSize: 10, color: colors.text3, marginTop: -2 },
  statLabel: { fontSize: 10, color: colors.text3, marginTop: 4, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8, textAlign: 'center' },
  statDivider: { width: 0.5, height: 44, backgroundColor: colors.glassBorder },
  globalSeparator: { height: 0.5, backgroundColor: colors.glassBorder, marginVertical: 8 },

  // Incomplete alert
  incompleteAlert: { marginTop: 12, backgroundColor: 'rgba(251,191,36,0.08)', borderRadius: radius.sm, padding: 10, borderWidth: 1, borderColor: 'rgba(251,191,36,0.2)' },
  incompleteAlertText: { fontSize: 12, color: colors.amber, fontWeight: '600', textAlign: 'center' },

  // Debts
  debtHeader: { fontSize: 12, fontWeight: '700', color: colors.text3, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 },
  debtRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, borderBottomWidth: 0.5, borderBottomColor: colors.glassBorder },
  debtName: { fontSize: 14, color: colors.text },
  debtAmt: { fontSize: 14, fontFamily: 'monospace', fontWeight: '600' },
  debtSeparator: { height: 0.5, backgroundColor: colors.glassBorder, marginVertical: 12 },

  // Top payers
  topPayerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: colors.glassBorder },
  topPayerRank: { fontSize: 20 },
  topPayerName: { flex: 1, fontSize: 14, color: colors.text, fontWeight: '500' },
  topPayerAmt: { fontSize: 14, fontFamily: 'monospace', color: colors.amber, fontWeight: '500' },

  // Activity feed
  activityRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: spacing.lg, paddingVertical: 12 },
  activityRowBorder: { borderTopWidth: 0.5, borderTopColor: colors.glassBorder },
  activityIcon: { width: 34, height: 34, borderRadius: 8, backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center' },
  activityInfo: { flex: 1 },
  activityDesc: { fontSize: 13, fontWeight: '500', color: colors.text },
  activityGroup: { fontSize: 11, color: colors.text3, marginTop: 2 },
  activityAmt: { fontSize: 13, fontFamily: 'monospace', color: colors.text2 },

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

  barTrack: { height: 4, backgroundColor: colors.surface2, borderRadius: 2, overflow: 'hidden', marginTop: 8 },
  barFill: { height: '100%', borderRadius: 2 },
  barLabel: { fontSize: 10, color: colors.text3, marginTop: 5 },

  ocrHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  ocrTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  ocrVersion: { fontSize: 12, color: colors.accent2, fontFamily: 'monospace' },

  empty: { alignItems: 'center', paddingTop: 80 },
  emptyEmoji: { fontSize: 48, marginBottom: 16 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: 8 },
  emptyText: { fontSize: 13, color: colors.text3, textAlign: 'center', maxWidth: 260, lineHeight: 20 },
});
