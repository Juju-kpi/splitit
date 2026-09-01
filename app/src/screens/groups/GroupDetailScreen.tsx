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
  RefreshControl, Share, Alert, Modal,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { groupsApi, expensesApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { useFormatMoney, useCurrency, useT } from '../../store/langStore';
import { Avatar, Card, SectionLabel, Divider, Button } from '../../components/ui';
import { colors, spacing, shadows, radius } from '../../theme';
import { Expense, Balance } from '../../../../shared/types';
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

  const [expandedBalance, setExpandedBalance] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);

  const { data: group, isLoading, refetch } = useQuery({
    queryKey: ['group', id],
    queryFn: () => groupsApi.get(id),
    enabled: !!id,
  });

  const settleMutation = useMutation({
    mutationFn: ({ expenseId, memberId, undo }: { expenseId: string; memberId: string; undo?: boolean }) =>
      expensesApi.settle(expenseId, memberId, undo),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['group', id] });
      Alert.alert(t('balances.settled_title'), t('balances.settled_saved'));
    },
  });

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

  // Solde net : ce qu'il a avancé moins ce qu'il doit. Mêmes données que les
  // remboursements ci-dessous — affichage seul, le calcul n'est pas modifié.
  const memberNet: Record<string, number> = {};
  group.members.forEach((m: any) => { memberNet[m.id] = 0; });
  (group.expenses || []).forEach((exp: any) => {
    const payments = exp.payments?.length > 0
      ? exp.payments
      : [{ memberId: exp.paidByMemberId, amount: exp.totalAmount }];
    payments.forEach((p: any) => { memberNet[p.memberId] = (memberNet[p.memberId] || 0) + p.amount; });
    exp.splits?.forEach((sp: any) => { memberNet[sp.memberId] = (memberNet[sp.memberId] || 0) - sp.amount; });
  });
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

  type LogLine = {
    expenseId: string;
    expenseDesc: string;
    debtorName: string;
    debtorId: string;
    creditorName: string;
    creditorId: string;
    amount: number;
    settled: boolean;
    byDebtor: boolean;
    byCreditor: boolean;
  };

  const reimbursementLog: LogLine[] = [];
  (group.expenses || []).forEach((exp: any) => {
    const payments: { memberId: string; amount: number; member: any }[] = exp.payments || [];
    if (payments.length === 0) return;

    const primaryPayment = payments.reduce(
      (best: any, p: any) => (p.amount > best.amount ? p : best),
      payments[0]
    );

    exp.splits?.forEach((split: any) => {
      if (split.memberId === primaryPayment.memberId) return;
      reimbursementLog.push({
        expenseId: exp.id,
        expenseDesc: exp.description,
        debtorName: split.member?.displayName ?? '?',
        debtorId: split.memberId,
        creditorName: primaryPayment.member?.displayName ?? '?',
        creditorId: primaryPayment.memberId,
        amount: split.amount,
        settled: split.settled,
        byDebtor: !!split.settledByDebtorAt,
        byCreditor: !!split.settledByCreditorAt,
      });
    });
  });

  const netLog: Record<string, { from: string; fromId: string; to: string; toId: string; total: number; settled: number; lines: LogLine[] }> = {};
  reimbursementLog.forEach(line => {
    const key = `${line.debtorId}→${line.creditorId}`;
    if (!netLog[key]) {
      netLog[key] = { from: line.debtorName, fromId: line.debtorId, to: line.creditorName, toId: line.creditorId, total: 0, settled: 0, lines: [] };
    }
    netLog[key].total += line.amount;
    if (line.settled) netLog[key].settled += line.amount;
    netLog[key].lines.push(line);
  });

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.backText}>{t('common.back')}</Text>
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{group.emoji} {group.name}</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity
            style={styles.membersBtn}
            onPress={() => router.push(`/group/members?groupId=${id}`)}
            activeOpacity={0.7}
            hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
          >
            <Text style={styles.membersBtnText}>👥 {t('groups.members')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.shareBtn}
            onPress={handleShare}
            activeOpacity={0.7}
            hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
          >
            <Text style={styles.shareBtnText}>{t('groups.invite')}</Text>
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
              <View style={styles.netLegend}>
                <Text style={[styles.netLegendText, { color: colors.green }]}>← {t('balances.owed_to_them')}</Text>
                <Text style={styles.netLegendMid}>{t('balances.even')}</Text>
                <Text style={[styles.netLegendText, { color: colors.amber }]}>{t('balances.they_owe')} →</Text>
              </View>

              {netRows.map(({ member: m, net }: any) => {
                const isMe = m.userId === user?.id;
                const creditor = net > 0.005;
                const debtor = net < -0.005;
                const ratio = Math.min(Math.abs(net) / maxAbsNet, 1);
                return (
                  <View key={m.id} style={styles.netRow}>
                    <Avatar initials={m.avatarInitials} color={m.avatarColor} size={26} />
                    <Text style={[styles.netName, isMe && { color: colors.accent2, fontWeight: '600' }]} numberOfLines={1}>
                      {m.displayName}
                    </Text>
                    {/* barre divergente : la ligne du milieu = équilibre */}
                    <View style={styles.netBarWrap}>
                      <View style={styles.netBarSide}>
                        {creditor && (
                          <View style={[styles.netBar, styles.netBarLeft, { flex: ratio, backgroundColor: colors.green }]} />
                        )}
                      </View>
                      <View style={styles.netAxis} />
                      <View style={styles.netBarSide}>
                        {debtor && (
                          <View style={[styles.netBar, styles.netBarRight, { flex: ratio, backgroundColor: colors.amber }]} />
                        )}
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

        {/* Remboursements */}
        {group.balances?.length > 0 && (
          <>
            <View style={styles.balancesHeader}>
              <SectionLabel label={t('balances.title')} />
              {Object.keys(netLog).length > 0 && (
                <TouchableOpacity
                  onPress={() => setShowLog(true)}
                  style={styles.logBtn}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                >
                  <Text style={styles.logBtnText}>📋 {t('balances.detail')}</Text>
                </TouchableOpacity>
              )}
            </View>

            <Card>
              <Text style={styles.balanceHint}>{t('balances.hint')}</Text>
              {group.balances.map((b: Balance, i: number) => {
                const isMe = b.fromMember?.userId === user?.id || b.toMember?.userId === user?.id;
                const isMeDebtor = b.fromMember?.userId === user?.id;
                const key = `${b.fromMemberId}→${b.toMemberId}`;
                const isExpanded = expandedBalance === key;

                return (
                  <React.Fragment key={i}>
                    <TouchableOpacity
                      style={[styles.balanceRow, isMe && styles.balanceRowMe]}
                      onPress={() => setExpandedBalance(isExpanded ? null : key)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.balanceLeft}>
                        <Avatar
                          initials={b.fromMember?.avatarInitials ?? '?'}
                          color={b.fromMember?.avatarColor ?? colors.accent}
                          size={28}
                        />
                        <View style={styles.balanceNames}>
                          <Text style={[styles.balanceName, isMe && styles.balanceNameMe]}>
                            {b.fromMember.displayName}
                            {isMeDebtor ? ` (${t('groups.me')})` : ''}
                          </Text>
                          <Text style={styles.balanceArrowLabel}>{t('balances.owes')} → {b.toMember.displayName}</Text>
                        </View>
                      </View>
                      <Text style={[styles.balanceAmt, isMe && styles.balanceAmtMe]}>
                        {fmt(b.amount)}
                      </Text>
                    </TouchableOpacity>

                    {isExpanded && (
                      <View style={styles.balanceDetail}>
                        {(netLog[key]?.lines || []).map((line, li) => (
                          <View key={li} style={styles.detailLine}>
                            <Text style={styles.detailDesc} numberOfLines={1}>
                              {line.settled ? '✓ ' : '• '}{line.expenseDesc}
                            </Text>
                            <Text style={[styles.detailAmt, line.settled && { color: colors.green }]}>
                              {fmt(line.amount)}
                            </Text>
                          </View>
                        ))}
                        {(() => {
                          const lines = (netLog[key]?.lines || []).filter(l => !l.settled);
                          const isMeCreditor = b.toMember?.userId === user?.id;
                          if ((!isMeDebtor && !isMeCreditor) || lines.length === 0) return null;

                          // Un remboursement n'est acquis que si les deux parties
                          // l'ont confirme. On montre donc ce qui manque encore.
                          const mineDone = lines.every(l => isMeDebtor ? l.byDebtor : l.byCreditor);
                          const theirsDone = lines.every(l => isMeDebtor ? l.byCreditor : l.byDebtor);
                          const other = isMeDebtor ? b.toMember.displayName : b.fromMember.displayName;
                          const label = isMeDebtor
                            ? t('balances.i_reimbursed', { amount: fmt(b.amount) })
                            : t('balances.i_was_paid', { amount: fmt(b.amount) });

                          return (
                            <>
                              <TouchableOpacity
                                style={[styles.settleBtn, mineDone && styles.settleBtnDone]}
                                onPress={() => {
                                  const undo = mineDone;
                                  const run = () => lines.forEach(l =>
                                    settleMutation.mutate({ expenseId: l.expenseId, memberId: l.debtorId, undo }));
                                  if (undo) { run(); return; }
                                  Alert.alert(t('balances.mark_settled_q'), label, [
                                    { text: t('common.cancel'), style: 'cancel' },
                                    { text: t('common.confirm'), onPress: run },
                                  ]);
                                }}
                              >
                                <Text style={[styles.settleBtnText, mineDone && { color: colors.text3 }]}>
                                  {mineDone ? t('balances.undo_confirm') : `💸 ${label}`}
                                </Text>
                              </TouchableOpacity>
                              <Text style={[styles.settleHint, (mineDone !== theirsDone) && { color: colors.amber }]}>
                                {mineDone && !theirsDone
                                  ? t('balances.waiting_other', { name: other })
                                  : !mineDone && theirsDone
                                    ? t('balances.other_confirmed', { name: other })
                                    : t('balances.both_needed')}
                              </Text>
                            </>
                          );
                        })()}
                      </View>
                    )}

                    {i < group.balances.length - 1 && <Divider />}
                  </React.Fragment>
                );
              })}
            </Card>
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
                <View style={[styles.expIcon, { backgroundColor: incomplete ? 'rgba(251,191,36,0.12)' : colors.accentBg }]}>
                  <Text style={{ fontSize: 18 }}>
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

      {/* Log Modal */}
      <Modal visible={showLog} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowLog(false)}>
        <View style={styles.modalScreen}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>📋 {t('balances.detail_title')}</Text>
            <TouchableOpacity onPress={() => setShowLog(false)} style={styles.modalClose}>
              <Text style={styles.modalCloseText}>{t('common.close')}</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: spacing.xl, paddingBottom: 60 }}>
            {Object.values(netLog).map((entry, i) => {
              const remaining = entry.total - entry.settled;
              const isMe = entry.fromId === myMember?.id || entry.toId === myMember?.id;
              return (
                <View key={i} style={[styles.logEntry, isMe && styles.logEntryMe]}>
                  <View style={styles.logEntryHeader}>
                    <Text style={styles.logEntryTitle}>
                      {entry.from} → {entry.to}
                    </Text>
                    <View>
                      <Text style={[styles.logEntryTotal, remaining < 0.01 && { color: colors.green }]}>
                        {remaining < 0.01 ? t('balances.settled_title') : t('balances.remaining', { amount: fmt(remaining) })}
                      </Text>
                      {entry.settled > 0 && (
                        <Text style={styles.logEntrySettled}>{t('balances.amount_settled', { amount: fmt(entry.settled) })}</Text>
                      )}
                    </View>
                  </View>
                  {entry.lines.map((line, li) => {
                    // Une fois les deux d'accord, la ligne quitte les soldes :
                    // c'est ici que l'on revient sur un clic malheureux.
                    const canUndo = line.settled
                      && (line.debtorId === myMember?.id || line.creditorId === myMember?.id);
                    return (
                      <View key={li} style={styles.logLine}>
                        <Text style={[styles.logLineName, line.settled && { color: colors.text3 }]} numberOfLines={1}>
                          {line.settled ? '✓' : '•'} {line.expenseDesc}
                        </Text>
                        <Text style={[styles.logLineAmt, line.settled && { color: colors.text3 }]}>
                          {fmt(line.amount)}
                        </Text>
                        {canUndo && (
                          <TouchableOpacity
                            style={styles.undoBtn}
                            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                            onPress={() => Alert.alert(
                              t('balances.undo_confirm'),
                              t('balances.undo_warning'),
                              [
                                { text: t('common.cancel'), style: 'cancel' },
                                {
                                  text: t('common.confirm'),
                                  onPress: () => settleMutation.mutate({
                                    expenseId: line.expenseId, memberId: line.debtorId, undo: true,
                                  }),
                                },
                              ],
                            )}
                          >
                            <Text style={styles.undoBtnText}>↩</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  })}
                </View>
              );
            })}
            {Object.keys(netLog).length === 0 && (
              <Text style={{ color: colors.text3, textAlign: 'center', marginTop: 40 }}>{t('balances.none_calculated')}</Text>
            )}
          </ScrollView>
        </View>
      </Modal>
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
  backBtn: {
    backgroundColor: colors.surface2, borderWidth: 0.5, borderColor: colors.border,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, minHeight: 36, justifyContent: 'center',
  },
  backText: { color: colors.text2, fontSize: 12, fontWeight: '500' },
  title: { fontSize: 15, fontWeight: '600', color: colors.text, flex: 1, textAlign: 'center', marginHorizontal: 8 },
  membersBtn: {
    backgroundColor: colors.surface2, borderWidth: 0.5, borderColor: colors.border2,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, minHeight: 36, justifyContent: 'center',
  },
  membersBtnText: { color: colors.text2, fontSize: 11, fontWeight: '600' },
  shareBtn: {
    backgroundColor: colors.accentBg, borderWidth: 0.5, borderColor: 'rgba(124,110,250,0.3)',
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, minHeight: 36, justifyContent: 'center',
  },
  shareBtnText: { color: colors.accent2, fontSize: 12, fontWeight: '600' },
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: 120 },

  cardTitle: { fontSize: 13, fontWeight: '500', color: colors.text2, marginBottom: 14 },
  memberRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  memberItem: { alignItems: 'center', gap: 4 },
  memberName: { fontSize: 11, color: colors.text3, marginTop: 2 },
  meTag: { fontSize: 9, color: colors.accent2, fontWeight: '600', textTransform: 'uppercase' },

  summaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingVertical: 4 },
  summaryItem: { alignItems: 'center', flex: 1 },
  summaryNum: { fontSize: 22, fontWeight: '300', fontFamily: 'monospace', color: colors.text },
  summaryCurrency: { fontSize: 11, color: colors.text3, marginTop: -2 },
  summaryLabel: { fontSize: 11, color: colors.text3, marginTop: 4, fontWeight: '500' },
  summaryDivider: { width: 0.5, height: 40, backgroundColor: colors.border },

  // Bannière dépenses à compléter dans le résumé
  incompleteBanner: {
    marginTop: 14, backgroundColor: 'rgba(251,191,36,0.08)',
    borderRadius: radius.sm, padding: 10, borderWidth: 1, borderColor: 'rgba(251,191,36,0.2)',
  },
  incompleteBannerText: { fontSize: 13, color: colors.amber, fontWeight: '600', textAlign: 'center' },

  balancesHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  logBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.full, borderWidth: 1, borderColor: colors.border2 },
  logBtnText: { fontSize: 11, color: colors.text2, fontWeight: '500' },
  netLegend: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  netLegendText: { fontSize: 10, fontWeight: '600' },
  netLegendMid: { fontSize: 10, color: colors.text3 },
  netRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5 },
  netName: { width: 66, fontSize: 11, color: colors.text2 },
  netBarWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', height: 18 },
  netBarSide: { flex: 1, flexDirection: 'row', height: 10 },
  netBar: { height: 10 },
  netBarLeft: { borderTopLeftRadius: 5, borderBottomLeftRadius: 5, marginLeft: 'auto' },
  netBarRight: { borderTopRightRadius: 5, borderBottomRightRadius: 5 },
  netAxis: { width: 1, height: 14, backgroundColor: 'rgba(255,255,255,0.15)' },
  netAmount: { width: 76, textAlign: 'right', fontSize: 11, fontFamily: 'monospace', fontWeight: '600', color: colors.text3 },
  netHint: { fontSize: 11, color: colors.text3, lineHeight: 16, marginTop: 10 },
  balanceHint: { fontSize: 11, color: colors.text3, marginBottom: 12 },
  balanceRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 10 },
  balanceRowMe: { backgroundColor: colors.accentBg, borderRadius: 8, paddingHorizontal: 8, marginHorizontal: -8 },
  balanceLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  balanceNames: { flex: 1 },
  balanceName: { fontSize: 13, color: colors.text, fontWeight: '500' },
  balanceNameMe: { color: colors.accent2 },
  balanceArrowLabel: { fontSize: 11, color: colors.text3, marginTop: 1 },
  balanceAmt: { fontSize: 14, fontFamily: 'monospace', color: colors.amber, fontWeight: '600' },
  balanceAmtMe: { color: colors.accent2 },
  balanceDetail: { backgroundColor: colors.surface2, borderRadius: radius.sm, padding: 12, marginBottom: 8, gap: 6 },
  detailLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  detailDesc: { fontSize: 12, color: colors.text2, flex: 1 },
  detailAmt: { fontSize: 12, fontFamily: 'monospace', color: colors.amber, marginLeft: 8 },
  settleBtn: { marginTop: 8, backgroundColor: colors.accent, borderRadius: radius.sm, padding: 10, alignItems: 'center' },
  settleBtnDone: { backgroundColor: colors.surface3, borderColor: colors.border },
  settleHint: { fontSize: 11, color: colors.text3, lineHeight: 16, marginTop: 8 },
  settleBtnText: { fontSize: 13, color: colors.white, fontWeight: '600' },

  // Expense items
  expenseItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.surface, borderWidth: 0.5, borderColor: colors.border,
    borderRadius: 14, padding: 14, marginBottom: 8,
  },
  expenseItemIncomplete: {
    borderColor: 'rgba(251,191,36,0.35)',
    backgroundColor: 'rgba(251,191,36,0.03)',
  },
  expIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  expInfo: { flex: 1 },
  expNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  expName: { fontSize: 14, fontWeight: '500', color: colors.text },
  incompleteBadge: {
    backgroundColor: 'rgba(251,191,36,0.15)', borderRadius: radius.full,
    paddingHorizontal: 8, paddingVertical: 2, borderWidth: 1, borderColor: 'rgba(251,191,36,0.3)',
  },
  incompleteBadgeText: { fontSize: 10, color: colors.amber, fontWeight: '700' },
  expSub: { fontSize: 11, color: colors.text3, marginTop: 2 },
  expCompleteHint: { fontSize: 10, color: colors.amber, marginTop: 3, fontWeight: '500' },
  expRight: { alignItems: 'flex-end' },
  expAmt: { fontSize: 15, fontWeight: '500', fontFamily: 'monospace', color: colors.text },

  emptyExp: { alignItems: 'center', paddingVertical: 40 },
  emptyEmoji: { fontSize: 40, marginBottom: 12 },
  emptyText: { fontSize: 16, fontWeight: '500', color: colors.text, marginBottom: 4 },
  emptySubText: { fontSize: 13, color: colors.text3 },

  fab: {
    position: 'absolute', right: 20,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
    ...shadows.accent,
  },
  fabText: { color: colors.white, fontSize: 28, lineHeight: 32 },

  modalScreen: { flex: 1, backgroundColor: colors.bg },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.xl, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  modalTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
  modalClose: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: colors.surface2, borderRadius: radius.full },
  modalCloseText: { fontSize: 13, color: colors.text2 },
  logEntry: { backgroundColor: colors.surface, borderWidth: 0.5, borderColor: colors.border, borderRadius: radius.md, padding: 14, marginBottom: 10 },
  undoBtn: {
    marginLeft: 8, paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.full,
    backgroundColor: 'rgba(251,191,36,0.10)', borderWidth: 1, borderColor: 'rgba(251,191,36,0.25)',
  },
  undoBtnText: { fontSize: 12, color: colors.amber },
  logEntryMe: { borderColor: colors.accent, backgroundColor: colors.accentBg },
  logEntryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  logEntryTitle: { fontSize: 13, fontWeight: '600', color: colors.text, flex: 1 },
  logEntryTotal: { fontSize: 13, fontFamily: 'monospace', color: colors.amber, fontWeight: '600', textAlign: 'right' },
  logEntrySettled: { fontSize: 11, color: colors.green, textAlign: 'right', marginTop: 2 },
  logLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  logLineName: { fontSize: 12, color: colors.text2, flex: 1 },
  logLineAmt: { fontSize: 12, fontFamily: 'monospace', color: colors.amber },
});
