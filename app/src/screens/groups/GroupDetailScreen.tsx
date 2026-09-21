// app/src/screens/groups/GroupDetailScreen.tsx
// Changements vs original :
//   - Badge "⏳ À compléter" sur les dépenses incomplètes
//     (items non assignés OU somme splits ≠ totalAmount)
//   - Tap sur dépense incomplète → AddExpenseScreen en mode edit
//   - Compteur "X dépense(s) à compléter" dans le résumé du groupe
//   (Tout le reste est identique à l'original)

import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, Share, Alert, Modal, TextInput,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { groupsApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { useFormatMoney, useCurrency, useT } from '../../store/langStore';
import { Avatar, Card, SectionLabel, Divider, Button } from '../../components/ui';
import Feather from '@expo/vector-icons/Feather';
import { colors, spacing, shadows, radius, fonts, money } from '../../theme';
import { Expense, Balance, Settlement } from '../../../../shared/types';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// ── Helper : dépense incomplète ? ─────────────────────────────────────────
// Miroir client-side de computeIsComplete côté backend.
// On ne bloque pas l'affichage — on ajoute juste un badge.
function isExpenseIncomplete(exp: any): boolean {
  // Si le backend a déjà calculé isComplete, on lui fait confiance
  if (typeof exp.isComplete === 'boolean') return !exp.isComplete;

  // Sinon on calcule côté client en fallback
  const items: any[] = exp.items || [];
  if (items.length > 0) {
    const hasUnassigned = items.some((item: any) => !item.assignedTo || item.assignedTo.length === 0);
    if (hasUnassigned) return true;
  }
  const splits: any[] = exp.splits || [];
  const splitTotal = splits.reduce((s: number, sp: any) => s + sp.amount, 0);
  if (splits.length > 0 && Math.abs(splitTotal - exp.totalAmount) > 0.02) return true;

  return false;
}

export default function GroupDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const user = useAuthStore(s => s.user);
  const insets = useSafeAreaInsets();
  const fmt = useFormatMoney();
  const cur = useCurrency();
  const t = useT();

  const { data: group, isLoading, refetch } = useQuery({
    queryKey: ['group', id],
    queryFn: () => groupsApi.get(id),
    enabled: !!id,
    // On revient toujours ici apres avoir touche a une depense : les soldes
    // doivent etre recalcules a l'arrivee, sans dependre des 30 s de cache par
    // defaut ni du fait qu'un ecran ait pense a invalider.
    refetchOnMount: 'always',
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['group', id] });

  if (isLoading || !group) {
    return <View style={styles.screen} />;
  }

  const myMember = group.members.find((m: any) => m.userId === user?.id);

  const totalSpent: number = (group.expenses || []).reduce(
    (sum: number, exp: Expense) => sum + exp.totalAmount, 0
  );
  const myShare: number = (group.expenses || []).reduce((sum: number, exp: Expense) => {
    const mySplit = exp.splits?.find((s: any) => s.memberId === myMember?.id);
    return sum + (mySplit?.amount || 0);
  }, 0);

  // Compte les dépenses incomplètes
  const incompleteCount = (group.expenses || []).filter(isExpenseIncomplete).length;

  // Position nette de chaque membre — calculee par le backend, qui est le seul
  // a voir les remboursements. La recalculer ici a partir des seules depenses
  // laissait les barres figees sur l'etat d'avant remboursement.
  // Le repli local ne sert qu'aux reponses d'un backend anterieur a ce champ.
  const memberNet: Record<string, number> = group.netByMember ?? (() => {
    const net: Record<string, number> = {};
    group.members.forEach((m: any) => { net[m.id] = 0; });
    (group.expenses || []).forEach((exp: any) => {
      const payments = exp.payments?.length > 0
        ? exp.payments
        : [{ memberId: exp.paidByMemberId, amount: exp.totalAmount }];
      payments.forEach((p: any) => { net[p.memberId] = (net[p.memberId] || 0) + p.amount; });
      exp.splits?.forEach((sp: any) => { net[sp.memberId] = (net[sp.memberId] || 0) - sp.amount; });
    });
    return net;
  })();
  const netRows = group.members
    .map((m: any) => ({ member: m, net: Math.round((memberNet[m.id] || 0) * 100) / 100 }))
    .sort((a: any, b: any) => b.net - a.net);
  const maxAbsNet = Math.max(...netRows.map((r: any) => Math.abs(r.net)), 0.01);

  async function handleShare() {
    try {
      await Share.share({
        message: t('groups.share_message', { name: group.name, code: group.inviteCode }),
      });
    } catch {
      Alert.alert(t('common.error'), t('groups.share_error'));
    }
  }

  // Les remboursements vivent sur leur propre ecran ; il ne reste ici que de
  // quoi alimenter la carte de renvoi.
  const settlements: Settlement[] = group.settlements || [];
  const myPendingCount = settlements.filter(st =>
    !st.cancelledAt && !st.confirmed
    && ((st.fromMemberId === myMember?.id && !st.confirmedByFromAt)
      || (st.toMemberId === myMember?.id && !st.confirmedByToAt))
  ).length;

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) + 8 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.iconBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel={t('common.back')}
        >
          <Feather name="chevron-left" size={18} color={colors.text2} />
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{group.emoji} {group.name}</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => router.push(`/group/members?groupId=${id}`)}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel={t('groups.members')}
          >
            <Feather name="users" size={18} color={colors.text2} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={handleShare}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel={t('groups.invite')}
          >
            <Feather name="share-2" size={18} color={colors.text2} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={colors.accent} />}
      >
        {/* Members */}
        <Card>
          <Text style={styles.cardTitle}>{t('groups.members')} ({group.members.length})</Text>
          <View style={styles.memberRow}>
            {group.members.map((m: any) => (
              <View key={m.id} style={styles.memberItem}>
                <Avatar initials={m.avatarInitials} color={m.avatarColor} size={40} />
                <Text style={styles.memberName}>{m.displayName}</Text>
                {m.id === myMember?.id && <Text style={styles.meTag}>{t('groups.me')}</Text>}
              </View>
            ))}
          </View>
        </Card>

        {/* Summary */}
        {group.expenses?.length > 0 && (
          <>
            <SectionLabel label={t('groups.group_summary')} />
            <Card>
              <View style={styles.summaryRow}>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryNum}>{totalSpent.toFixed(2)}</Text>
                  <Text style={styles.summaryCurrency}>{cur}</Text>
                  <Text style={styles.summaryLabel}>{t('groups.group_total')}</Text>
                </View>
                <View style={styles.summaryDivider} />
                <View style={styles.summaryItem}>
                  <Text style={[styles.summaryNum, { color: colors.accent2 }]}>{myShare.toFixed(2)}</Text>
                  <Text style={[styles.summaryCurrency, { color: colors.accent2 }]}>{cur}</Text>
                  <Text style={styles.summaryLabel}>{t('expenses.my_share')}</Text>
                </View>
                <View style={styles.summaryDivider} />
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryNum}>{group.expenses.length}</Text>
                  <Text style={styles.summaryLabel}>{t('expenses.title')}</Text>
                </View>
              </View>

              {/* Badge dépenses à compléter */}
              {incompleteCount > 0 && (
                <View style={styles.incompleteBanner}>
                  <Text style={styles.incompleteBannerText}>{t(incompleteCount > 1 ? 'groups.incomplete_count_other' : 'groups.incomplete_count_one', { n: incompleteCount })}</Text>
                </View>
              )}
            </Card>
          </>
        )}

        {/* Qui a avancé / qui doit — lecture visuelle des soldes */}
        {group.expenses?.length > 0 && (
          <>
            <SectionLabel label={t('balances.who_advanced')} />
            <Card>
              {netRows.map(({ member: m, net }: any) => {
                const isMe = m.userId === user?.id;
                const creditor = net > 0.005;
                const debtor = net < -0.005;
                const ratio = Math.min(Math.abs(net) / maxAbsNet, 1);
                return (
                  <View key={m.id} style={styles.netRow}>
                    <Avatar initials={m.avatarInitials} color={m.avatarColor} size={30} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.netName, isMe && { color: colors.text }]} numberOfLines={1}>
                        {m.displayName}
                      </Text>
                      {/* Une seule direction : la couleur dit le sens, la
                          longueur dit l'ampleur. Plus de legende a lire. */}
                      <View style={styles.netBarTrack}>
                        {(creditor || debtor) && (
                          <View style={[styles.netBarFill, {
                            flex: Math.max(ratio, 0.03),
                            backgroundColor: creditor ? colors.green : colors.amber,
                          }]} />
                        )}
                        <View style={{ flex: Math.max(1 - ratio, 0) }} />
                      </View>
                    </View>
                    <Text style={[
                      styles.netAmount,
                      creditor && { color: colors.green },
                      debtor && { color: colors.amber },
                    ]}>
                      {net > 0 ? '+' : ''}{fmt(net)}
                    </Text>
                  </View>
                );
              })}

              <Text style={styles.netHint}>{t('balances.net_hint')}</Text>
            </Card>
          </>
        )}

        {/* Remboursements — leur propre ecran : ils occupaient la moitie de
            la page et repoussaient les depenses hors de vue. */}
        {(group.balances?.length > 0 || settlements.length > 0) && (
          <>
            <SectionLabel label={t('settlements.section')} />
            <TouchableOpacity
              activeOpacity={0.78}
              onPress={() => router.push(`/group/settlements?groupId=${id}`)}
            >
              <View style={styles.settleEntry}>
                <View style={styles.settleEntryIcon}>
                  <Feather name="file-text" size={17} color={colors.text2} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.settleEntryTitle}>
                    {group.balances?.length > 0
                      ? t('settlements.to_settle', { n: group.balances.length })
                      : t('settlements.all_settled')}
                  </Text>
                  {myPendingCount > 0 && (
                    <Text style={styles.settleEntryPending}>
                      {t('settlements.pending_badge', { n: myPendingCount })}
                    </Text>
                  )}
                </View>
                <Feather name="chevron-right" size={18} color={colors.text3} />
              </View>
            </TouchableOpacity>
          </>
        )}
        {/* Expenses list */}
        <SectionLabel label={t('expenses.title')} />
        {(group.expenses || []).map((exp: any) => {
          const payments = exp.payments || [];
          const payerLabel = payments.length > 1
            ? payments.map((p: any) => `${p.member?.displayName} (${p.amount.toFixed(0)})`).join(', ')
            : payments[0]?.member?.displayName ?? '?';

          const incomplete = isExpenseIncomplete(exp);

          return (
            <TouchableOpacity
              key={exp.id}
              activeOpacity={0.8}
              onPress={() => router.push(`/expense/${exp.id}`)}
            >
              <View style={[styles.expenseItem, incomplete && styles.expenseItemIncomplete]}>
                <View style={[styles.expIcon, { backgroundColor: incomplete ? 'rgba(232,163,61,0.12)' : colors.accentBg }]}>
                  <Text style={{ fontFamily: fonts.regular, fontSize: 18 }}>
                    {incomplete ? '⏳' : exp.receiptImageUrl ? '🧾' : '✏️'}
                  </Text>
                </View>
                <View style={styles.expInfo}>
                  <View style={styles.expNameRow}>
                    <Text style={styles.expName}>{exp.description}</Text>
                    {incomplete && (
                      <View style={styles.incompleteBadge}>
                        <Text style={styles.incompleteBadgeText}>{t('expenses.incomplete_badge')}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.expSub}>{t('expenses.paid_by_lc', { who: payerLabel })}</Text>
                  {incomplete && (
                    <Text style={styles.expCompleteHint}>{t('expenses.complete_hint')}</Text>
                  )}
                </View>
                <View style={styles.expRight}>
                  <Text style={styles.expAmt}>{fmt(exp.totalAmount)}</Text>
                </View>
              </View>
            </TouchableOpacity>
          );
        })}

        {group.expenses?.length === 0 && (
          <View style={styles.emptyExp}>
            <Text style={styles.emptyEmoji}>🧾</Text>
            <Text style={styles.emptyText}>{t('expenses.none_yet')}</Text>
            <Text style={styles.emptySubText}>{t('expenses.add_first')}</Text>
          </View>
        )}
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity
        style={[styles.fab, { bottom: Math.max(insets.bottom, 16) + 16 }]}
        onPress={() => router.push(`/expense/add?groupId=${id}`)}
        activeOpacity={0.85}
      >
        <Text style={styles.fabText}>+</Text>
      </TouchableOpacity>

    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.xl, paddingBottom: 12,
    backgroundColor: colors.bg,
    borderBottomWidth: 0.5, borderBottomColor: colors.border,
  },
  iconBtn: {
    width: 40, height: 40, borderRadius: radius.full,
    backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center',
  },
  title: {
    fontFamily: fonts.semibold, fontSize: 17, color: colors.text,
    flex: 1, textAlign: 'center', marginHorizontal: 8, letterSpacing: -0.2,
  },
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: 120 },

  cardTitle: { fontFamily: fonts.medium, fontSize: 13, fontWeight: '500', color: colors.text2, marginBottom: 14 },
  memberRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  memberItem: { alignItems: 'center', gap: 4 },
  memberName: { fontFamily: fonts.regular, fontSize: 11, color: colors.text3, marginTop: 2 },
  meTag: { fontFamily: fonts.semibold, fontSize: 9, color: colors.accent2, fontWeight: '600', textTransform: 'uppercase' },

  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingVertical: 4 },
  summaryItem: { alignItems: 'center', flex: 1 },
  summaryNum: { fontSize: 22, fontWeight: '300', fontFamily: fonts.mono, color: colors.text },
  summaryCurrency: { fontFamily: fonts.regular, fontSize: 11, color: colors.text3, marginTop: -2 },
  summaryLabel: { fontFamily: fonts.medium, fontSize: 11, color: colors.text3, marginTop: 4, fontWeight: '500' },
  summaryDivider: { width: 0.5, height: 40, backgroundColor: colors.border },

  // Bannière dépenses à compléter dans le résumé
  incompleteBanner: {
    marginTop: 14, backgroundColor: 'rgba(232,163,61,0.08)',
    borderRadius: radius.sm, padding: 10, borderWidth: 1, borderColor: 'rgba(232,163,61,0.2)',
  },
  incompleteBannerText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.amber, fontWeight: '600', textAlign: 'center' },

  balancesHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  logBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border2 },
  logBtnText: { fontFamily: fonts.medium, fontSize: 11, color: colors.text2, fontWeight: '500' },
  netRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 7 },
  netName: { fontFamily: fonts.regular, fontSize: 14, color: colors.text2 },
  netBarTrack: {
    flexDirection: 'row', height: 4, borderRadius: 999,
    backgroundColor: colors.surface2, marginTop: 7, overflow: 'hidden',
  },
  netBarFill: { height: 4, borderRadius: 999 },
  netAmount: { ...money.large, textAlign: 'right', color: colors.text3 },
  netHint: { fontFamily: fonts.regular, fontSize: 13, color: colors.text3, lineHeight: 19, marginTop: 14 },
  balanceHint: { fontFamily: fonts.regular, fontSize: 11, color: colors.text3, marginBottom: 12 },
  balanceRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 10 },
  balanceRowMe: { backgroundColor: colors.accentBg, borderRadius: 8, paddingHorizontal: 8, marginHorizontal: -8 },
  balanceLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  balanceNames: { flex: 1 },
  balanceName: { fontFamily: fonts.medium, fontSize: 13, color: colors.text, fontWeight: '500' },
  balanceNameMe: { color: colors.accent2 },
  balanceArrowLabel: { fontFamily: fonts.regular, fontSize: 11, color: colors.text3, marginTop: 1 },
  balanceAmt: { fontSize: 14, fontFamily: fonts.mono, color: colors.amber, fontWeight: '600' },
  balanceAmtMe: { color: colors.accent2 },
  balanceDetail: { backgroundColor: colors.surface2, borderRadius: radius.sm, padding: 12, marginBottom: 8, gap: 6 },
  detailLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  detailDesc: { fontFamily: fonts.regular, fontSize: 12, color: colors.text2, flex: 1 },
  detailAmt: { fontSize: 12, fontFamily: fonts.mono, color: colors.amber, marginLeft: 8 },
  settleBtn: { marginTop: 8, backgroundColor: colors.primary, borderRadius: radius.sm, padding: 10, alignItems: 'center' },
  settleBtnDone: { backgroundColor: colors.surface3, borderColor: colors.border },
  settleHint: { fontFamily: fonts.regular, fontSize: 11, color: colors.text3, lineHeight: 16, marginTop: 8 },
  settleBtnText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.onPrimary, textAlign: 'center' },

  // ── Remboursements ─────────────────────────────────────────────────────
  pendingBadge: {
    backgroundColor: 'rgba(232,163,61,0.12)', borderWidth: 1, borderColor: 'rgba(232,163,61,0.3)',
    borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 6,
  },
  pendingBadgeText: { fontFamily: fonts.semibold, fontSize: 10, color: colors.amber, fontWeight: '700' },
  allSettled: { fontFamily: fonts.regular, fontSize: 13, color: colors.text2, textAlign: 'center', paddingVertical: 10 },
  // Carte de renvoi vers l'ecran des remboursements.
  settleEntry: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: colors.surface, borderRadius: radius.lg,
    padding: spacing.xl, marginBottom: 12,
  },
  settleEntryIcon: {
    width: 38, height: 38, borderRadius: radius.sm,
    backgroundColor: colors.surface2, alignItems: 'center', justifyContent: 'center',
  },
  settleEntryTitle: { fontFamily: fonts.medium, fontSize: 15, color: colors.text },
  settleEntryPending: { fontFamily: fonts.regular, fontSize: 12, color: colors.amber, marginTop: 2 },
  detailBtn: {
    marginTop: 14, minHeight: 48, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.accentBg, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)',
  },
  detailBtnText: { fontFamily: fonts.semibold, fontSize: 14, color: colors.accent2, fontWeight: '600' },
  pendingCard: {
    marginTop: 8, borderRadius: radius.sm, padding: 10,
    backgroundColor: 'rgba(232,163,61,0.06)', borderWidth: 1, borderColor: 'rgba(232,163,61,0.25)',
  },
  pendingText: { fontFamily: fonts.regular, fontSize: 11, color: colors.amber, lineHeight: 16 },
  pendingActions: { flexDirection: 'row', gap: 8, marginTop: 8 },

  historyLabel: {
    fontFamily: fonts.semibold, fontSize: 11, color: colors.text3, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8,
  },
  historyEmpty: { fontFamily: fonts.regular, fontSize: 12, color: colors.text3, marginBottom: 8 },
  historyCard: { borderRadius: radius.sm, borderWidth: 1, padding: 10, marginBottom: 8 },
  historyConfirmed: { borderColor: 'rgba(62,207,142,0.25)', backgroundColor: 'rgba(62,207,142,0.05)' },
  historyPending: { borderColor: 'rgba(232,163,61,0.25)', backgroundColor: 'rgba(232,163,61,0.05)' },
  historyCancelled: { borderColor: colors.border, backgroundColor: colors.surface2, opacity: 0.6 },
  historyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  historyWho: { fontFamily: fonts.regular, fontSize: 12, color: colors.text2, flex: 1 },
  historyAmt: { fontSize: 12, fontFamily: fonts.mono, color: colors.text },
  historyStatus: { fontFamily: fonts.regular, fontSize: 11, flex: 1 },
  historyNote: { fontFamily: fonts.regular, fontSize: 11, color: colors.text3, marginTop: 4 },

  calcToggle: {
    minHeight: 44, borderRadius: radius.md, marginBottom: 16,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.surface2, borderWidth: 0.5, borderColor: colors.border,
  },
  calcToggleText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.text2, fontWeight: '600' },
  calcCard: { backgroundColor: colors.surface2, borderRadius: radius.sm, padding: 10, marginBottom: 8 },
  calcHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  calcName: { fontFamily: fonts.medium, fontSize: 12, color: colors.text, fontWeight: '500', flex: 1 },
  calcLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  calcLabel: { fontFamily: fonts.regular, fontSize: 11, color: colors.text3, flex: 1 },
  calcValue: { fontSize: 11, fontFamily: fonts.mono, color: colors.text2 },
  calcTotalLine: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingTop: 6, marginTop: 4, borderTopWidth: 0.5, borderTopColor: colors.border,
  },
  calcNetLabel: { fontFamily: fonts.semibold, fontSize: 12, color: colors.text2, fontWeight: '600' },
  calcNetValue: { fontSize: 12, fontFamily: fonts.mono, fontWeight: '700', color: colors.text3 },
  calcHint: { fontFamily: fonts.regular, fontSize: 11, color: colors.text3, lineHeight: 16, marginTop: 8 },

  formDirection: { fontFamily: fonts.regular, fontSize: 12, color: colors.text3, marginBottom: 18 },
  formLabel: {
    fontFamily: fonts.semibold, fontSize: 11, color: colors.text3, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 18, marginBottom: 8,
  },
  formHint: { fontFamily: fonts.regular, fontSize: 11, color: colors.text3, lineHeight: 16, marginTop: 8 },
  amountInput: {
    backgroundColor: colors.surface2, borderWidth: 0.5, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: 16, minHeight: 52,
    fontSize: 20, fontFamily: fonts.mono, color: colors.text,
  },
  noteInput: {
    backgroundColor: colors.surface2, borderWidth: 0.5, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: 16, minHeight: 48,
    fontFamily: fonts.regular, fontSize: 14, color: colors.text,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    backgroundColor: colors.surface2, borderWidth: 0.5, borderColor: colors.border,
    borderRadius: radius.full, paddingHorizontal: 14, minHeight: 40, justifyContent: 'center',
  },
  chipActive: { backgroundColor: colors.accentBg, borderColor: colors.accent },
  chipText: { fontFamily: fonts.medium, fontSize: 12, color: colors.text2, fontWeight: '500' },
  chipTextActive: { color: colors.accent2, fontWeight: '600' },
  submitBtn: {
    marginTop: 24, backgroundColor: colors.primary, borderRadius: radius.md,
    minHeight: 52, alignItems: 'center', justifyContent: 'center',
  },
  submitBtnText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.onPrimary },

  // Expense items
  expenseItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.surface, borderWidth: 0.5, borderColor: colors.border,
    borderRadius: 14, padding: 14, marginBottom: 8,
  },
  expenseItemIncomplete: {
    borderColor: 'rgba(232,163,61,0.35)',
    backgroundColor: 'rgba(232,163,61,0.03)',
  },
  expIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  expInfo: { flex: 1 },
  expNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  expName: { fontFamily: fonts.medium, fontSize: 14, fontWeight: '500', color: colors.text },
  incompleteBadge: {
    backgroundColor: 'rgba(232,163,61,0.15)', borderRadius: radius.full,
    paddingHorizontal: 8, paddingVertical: 2, borderWidth: 1, borderColor: 'rgba(232,163,61,0.3)',
  },
  incompleteBadgeText: { fontFamily: fonts.semibold, fontSize: 10, color: colors.amber, fontWeight: '700' },
  expSub: { fontFamily: fonts.regular, fontSize: 11, color: colors.text3, marginTop: 2 },
  expCompleteHint: { fontFamily: fonts.medium, fontSize: 10, color: colors.amber, marginTop: 3, fontWeight: '500' },
  expRight: { alignItems: 'flex-end' },
  expAmt: { fontSize: 15, fontWeight: '500', fontFamily: fonts.mono, color: colors.text },

  emptyExp: { alignItems: 'center', paddingVertical: 40 },
  emptyEmoji: { fontFamily: fonts.regular, fontSize: 40, marginBottom: 12 },
  emptyText: { fontFamily: fonts.medium, fontSize: 16, fontWeight: '500', color: colors.text, marginBottom: 4 },
  emptySubText: { fontFamily: fonts.regular, fontSize: 13, color: colors.text3 },

  fab: {
    position: 'absolute', right: 20,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
    ...shadows.accent,
  },
  fabText: { color: colors.onPrimary, fontFamily: fonts.regular, fontSize: 28, lineHeight: 32 },

  modalScreen: { flex: 1, backgroundColor: colors.bg },
  // Une fenetre plein ecran sur Android passe sous la barre d'etat :
  // sans ce retrait, le titre lui rentrait dedans.
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: spacing.xl, paddingBottom: spacing.lg, paddingTop: 52,
    borderBottomWidth: 0.5, borderBottomColor: colors.border,
  },
  modalTitle: { fontFamily: fonts.semibold, fontSize: 16, fontWeight: '600', color: colors.text },
  modalClose: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: colors.surface2, borderRadius: radius.full },
  modalCloseText: { fontFamily: fonts.regular, fontSize: 13, color: colors.text2 },
  logEntry: { backgroundColor: colors.surface, borderWidth: 0.5, borderColor: colors.border, borderRadius: radius.md, padding: 14, marginBottom: 10 },
  undoBtn: {
    marginLeft: 8, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.full,
    backgroundColor: 'rgba(232,163,61,0.10)', borderWidth: 1, borderColor: 'rgba(232,163,61,0.25)',
  },
  undoBtnText: { fontFamily: fonts.regular, fontSize: 12, color: colors.amber },
  logEntryMe: { borderColor: colors.accent, backgroundColor: colors.accentBg },
  logEntryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  logEntryTitle: { fontFamily: fonts.semibold, fontSize: 13, fontWeight: '600', color: colors.text, flex: 1 },
  logEntryTotal: { fontSize: 13, fontFamily: fonts.mono, color: colors.amber, fontWeight: '600', textAlign: 'right' },
  logEntrySettled: { fontFamily: fonts.regular, fontSize: 11, color: colors.green, textAlign: 'right', marginTop: 2 },
  logLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  logLineName: { fontFamily: fonts.regular, fontSize: 12, color: colors.text2, flex: 1 },
  logLineAmt: { fontSize: 12, fontFamily: fonts.mono, color: colors.amber },
});
