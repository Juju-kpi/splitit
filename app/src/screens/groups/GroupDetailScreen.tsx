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
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { groupsApi, expensesApi, settlementsApi } from '../../services/api';
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

  const [expandedBalance, setExpandedBalance] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [showCalc, setShowCalc] = useState(false);
  // Formulaire de remboursement — ouvert depuis une ligne de solde
  const [settleFor, setSettleFor] = useState<Balance | null>(null);
  const [amountInput, setAmountInput] = useState('');
  const [methodInput, setMethodInput] = useState('');
  const [noteInput, setNoteInput] = useState('');

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

  function failed(e: any) {
    Alert.alert(t('common.error'), e?.response?.data?.error || t('common.error'));
  }

  // Ancien mecanisme, conserve pour annuler un remboursement deja valide sur
  // une part de depense. Rien de nouveau ne passe plus par ici.
  const settleMutation = useMutation({
    mutationFn: ({ expenseId, memberId, undo }: { expenseId: string; memberId: string; undo?: boolean }) =>
      expensesApi.settle(expenseId, memberId, undo),
    onSuccess: () => {
      refresh();
      Alert.alert(t('balances.settled_title'), t('balances.settled_saved'));
    },
    onError: failed,
  });

  const createSettlement = useMutation({
    mutationFn: (payload: {
      groupId: string; fromMemberId: string; toMemberId: string;
      amount: number; currency?: string; method?: string; note?: string;
    }) => settlementsApi.create(payload),
    onSuccess: () => {
      setSettleFor(null);
      refresh();
      Alert.alert(t('balances.settled_title'), t('settlements.saved'));
    },
    onError: failed,
  });
  const confirmSettlement = useMutation({
    mutationFn: ({ sid, undo }: { sid: string; undo?: boolean }) => settlementsApi.confirm(sid, undo),
    onSuccess: refresh,
    onError: failed,
  });
  const cancelSettlement = useMutation({
    mutationFn: ({ sid, undo }: { sid: string; undo?: boolean }) => settlementsApi.cancel(sid, undo),
    onSuccess: refresh,
    onError: failed,
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

  type LogLine = {
    expenseId: string;
    expenseDesc: string;
    debtorName: string;
    debtorId: string;
    creditorName: string;
    creditorId: string;
    amount: number;
    settled: boolean;
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

  // ── Remboursements enregistres ────────────────────────────────────────
  // Un versement de X a Y, valide par les deux, independant des depenses :
  // seule maniere de solder un solde ne d'une compensation en chaine.
  const settlements: Settlement[] = group.settlements || [];
  const liveSettlements = settlements.filter(s => !s.cancelledAt);
  const memberName = (mid: string) =>
    group.members.find((m: any) => m.id === mid)?.displayName ?? '?';
  const isGuest = (mid: string) =>
    !group.members.find((m: any) => m.id === mid)?.userId;

  const pendingBetween = (x: string, y: string) => liveSettlements.filter(s =>
    !s.confirmed
    && ((s.fromMemberId === x && s.toMemberId === y) || (s.fromMemberId === y && s.toMemberId === x))
  );
  const needsMyNod = (s: Settlement) =>
    (s.fromMemberId === myMember?.id && !s.confirmedByFromAt)
    || (s.toMemberId === myMember?.id && !s.confirmedByToAt);

  const myPendingCount = liveSettlements.filter(s => !s.confirmed && needsMyNod(s)).length;

  function openSettleForm(b: Balance) {
    setSettleFor(b);
    setAmountInput(b.amount.toFixed(2));
    setMethodInput('');
    setNoteInput('');
  }

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) }]}>
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

        {/* Remboursements */}
        {(group.balances?.length > 0 || settlements.length > 0) && (
          <>
            <View style={styles.balancesHeader}>
              <SectionLabel label={t('settlements.section')} />
              {myPendingCount > 0 && (
                <View style={styles.pendingBadge}>
                  <Text style={styles.pendingBadgeText}>
                    {t('settlements.pending_badge', { n: myPendingCount })}
                  </Text>
                </View>
              )}
            </View>

            <Card>
              {group.balances?.length === 0 && (
                <Text style={styles.allSettled}>{t('settlements.all_settled')}</Text>
              )}
              {group.balances?.length > 0 && <Text style={styles.balanceHint}>{t('balances.hint')}</Text>}
              {(group.balances || []).map((b: Balance, i: number) => {
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
                        {/* Aucune depense commune : le solde vient d'une
                            compensation en chaine. Sans remboursement a part
                            entiere, il n'y aurait rien a cocher ici. */}
                        {(netLog[key]?.lines || []).length === 0 && (
                          <Text style={styles.settleHint}>{t('settlements.chain_hint')}</Text>
                        )}

                        {(() => {
                          const isMeCreditor = b.toMember?.userId === user?.id;
                          if (!isMeDebtor && !isMeCreditor) return null;

                          const other = isMeDebtor ? b.toMember.displayName : b.fromMember.displayName;
                          const pending = pendingBetween(b.fromMemberId, b.toMemberId);

                          return (
                            <>
                              {pending.map(s => {
                                const mine = needsMyNod(s);
                                const amount = fmt(s.amount);
                                const iAmPayer = s.fromMemberId === myMember?.id;
                                return (
                                  <View key={s.id} style={styles.pendingCard}>
                                    <Text style={styles.pendingText}>
                                      {mine
                                        ? (iAmPayer
                                            ? t('settlements.to_confirm_received', { name: memberName(s.toMemberId), amount })
                                            : t('settlements.to_confirm_paid', { name: memberName(s.fromMemberId), amount }))
                                        : t('settlements.waiting_other', { name: other })}
                                    </Text>
                                    <View style={styles.pendingActions}>
                                      {mine && (
                                        <TouchableOpacity
                                          style={[styles.settleBtn, { flex: 1, marginTop: 0 }]}
                                          onPress={() => Alert.alert(
                                            t('settlements.modal_title'),
                                            t('settlements.confirm_q', { amount }),
                                            [
                                              { text: t('common.cancel'), style: 'cancel' },
                                              { text: t('common.confirm'), onPress: () => confirmSettlement.mutate({ sid: s.id }) },
                                            ],
                                          )}
                                        >
                                          <Text style={styles.settleBtnText}>{t('settlements.confirm_btn')}</Text>
                                        </TouchableOpacity>
                                      )}
                                      <TouchableOpacity
                                        style={[styles.settleBtn, styles.settleBtnDone, { flex: 1, marginTop: 0 }]}
                                        onPress={() => Alert.alert(
                                          t('settlements.cancel_btn'),
                                          t('settlements.cancel_q'),
                                          [
                                            { text: t('common.cancel'), style: 'cancel' },
                                            { text: t('common.confirm'), onPress: () => cancelSettlement.mutate({ sid: s.id }) },
                                          ],
                                        )}
                                      >
                                        <Text style={[styles.settleBtnText, { color: colors.text3 }]}>
                                          {mine ? t('settlements.refuse_btn') : t('settlements.cancel_btn')}
                                        </Text>
                                      </TouchableOpacity>
                                    </View>
                                  </View>
                                );
                              })}

                              {/* Un remboursement deja en attente couvre sans
                                  doute cette dette : on garde le bouton, mais
                                  il cesse d'etre l'action evidente — sinon on
                                  en enregistre deux pour le meme versement. */}
                              <TouchableOpacity
                                style={[styles.settleBtn, pending.length > 0 && styles.settleBtnDone]}
                                onPress={() => openSettleForm(b)}
                              >
                                <Text style={[styles.settleBtnText, pending.length > 0 && { color: colors.text3 }]}>
                                  {pending.length > 0
                                    ? t('settlements.record')
                                    : isMeDebtor
                                      ? t('settlements.i_paid', { amount: fmt(b.amount) })
                                      : t('settlements.i_received', { amount: fmt(b.amount) })}
                                </Text>
                              </TouchableOpacity>
                            </>
                          );
                        })()}
                      </View>
                    )}

                    {i < group.balances.length - 1 && <Divider />}
                  </React.Fragment>
                );
              })}

              {/* Pleine largeur en bas de carte : dans le coin haut-droit la
                  cible etait petite et loin du pouce. */}
              <TouchableOpacity style={styles.detailBtn} onPress={() => setShowLog(true)}>
                <Text style={styles.detailBtnText}>📋 {t('settlements.history_title')}</Text>
              </TouchableOpacity>
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
            {/* Historique des remboursements enregistres — y compris annules,
                pour qu'un geste malheureux reste rattrapable. */}
            <Text style={styles.historyLabel}>{t('settlements.history_title')}</Text>
            {settlements.length === 0 && (
              <Text style={styles.historyEmpty}>{t('settlements.none')}</Text>
            )}
            {settlements.map(s => {
              const cancelled = !!s.cancelledAt;
              const isParty = s.fromMemberId === myMember?.id || s.toMemberId === myMember?.id;
              const status = cancelled
                ? t('settlements.status_cancelled')
                : s.confirmed ? t('settlements.status_confirmed') : t('settlements.status_pending');
              return (
                <View
                  key={s.id}
                  style={[
                    styles.historyCard,
                    cancelled ? styles.historyCancelled
                      : s.confirmed ? styles.historyConfirmed : styles.historyPending,
                  ]}
                >
                  <View style={styles.historyRow}>
                    <Text style={[styles.historyWho, cancelled && { color: colors.text3 }]} numberOfLines={1}>
                      {memberName(s.fromMemberId)} → {memberName(s.toMemberId)}
                    </Text>
                    <Text style={[styles.historyAmt, cancelled && { color: colors.text3 }]}>
                      {fmt(s.amount)}
                    </Text>
                  </View>
                  <View style={styles.historyRow}>
                    <Text style={[
                      styles.historyStatus,
                      cancelled ? { color: colors.text3 }
                        : s.confirmed ? { color: colors.green } : { color: colors.amber },
                    ]}>
                      {status} · {new Date(s.createdAt).toLocaleDateString()}
                      {s.method ? ` · ${s.method}` : ''}
                    </Text>
                    {isParty && (
                      <TouchableOpacity
                        style={styles.undoBtn}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                        onPress={() => {
                          if (cancelled) { cancelSettlement.mutate({ sid: s.id, undo: true }); return; }
                          Alert.alert(t('settlements.cancel_btn'), t('settlements.cancel_q'), [
                            { text: t('common.cancel'), style: 'cancel' },
                            { text: t('common.confirm'), onPress: () => cancelSettlement.mutate({ sid: s.id }) },
                          ]);
                        }}
                      >
                        <Text style={styles.undoBtnText}>
                          {cancelled ? t('settlements.restore_btn') : '↩'}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  {!!s.note && <Text style={styles.historyNote}>{s.note}</Text>}
                </View>
              );
            })}

            {/* Le calcul en clair — replie par defaut : c'est une verification,
                pas une lecture quotidienne. Les chiffres viennent du backend,
                ceux-la memes qui produisent les virements affiches. */}
            <TouchableOpacity style={styles.calcToggle} onPress={() => setShowCalc(v => !v)}>
              <Text style={styles.calcToggleText}>
                {showCalc ? t('settlements.calc_hide') : t('settlements.calc_show')}
              </Text>
            </TouchableOpacity>

            {showCalc && (() => {
              const rows = group.netBreakdown;
              if (!rows) return (
                <Text style={styles.historyEmpty}>
                  Le détail du calcul arrive avec la prochaine mise à jour du serveur.
                </Text>
              );
              const total = Math.round(
                group.members.reduce((s: number, m: any) => s + (rows[m.id]?.net ?? 0), 0) * 100
              ) / 100;
              const ok = Math.abs(total) < 0.005;
              const line = (label: string, value: number, sign: string) =>
                Math.abs(value) < 0.005 ? null : (
                  <View style={styles.calcLine} key={label}>
                    <Text style={styles.calcLabel}>{sign} {label}</Text>
                    <Text style={styles.calcValue}>{fmt(value)}</Text>
                  </View>
                );
              return (
                <View style={{ marginBottom: 18 }}>
                  <Text style={styles.historyLabel}>{t('settlements.calc_title')}</Text>
                  {group.members.map((m: any) => {
                    const r = rows[m.id];
                    if (!r) return null;
                    return (
                      <View key={m.id} style={styles.calcCard}>
                        <View style={styles.calcHead}>
                          <Avatar initials={m.avatarInitials} color={m.avatarColor} size={20} />
                          <Text style={styles.calcName} numberOfLines={1}>{m.displayName}</Text>
                        </View>
                        {line(t('settlements.calc_paid'), r.paid, '+')}
                        {line(t('settlements.calc_share'), r.share, '−')}
                        {line(t('settlements.calc_settled_own'), r.settledOwn, '+')}
                        {line(t('settlements.calc_settled_as_payer'), r.settledAsPayer, '−')}
                        {line(t('settlements.calc_paid_back'), r.settlementsPaid, '+')}
                        {line(t('settlements.calc_received'), r.settlementsReceived, '−')}
                        <View style={styles.calcTotalLine}>
                          <Text style={styles.calcNetLabel}>= {t('settlements.calc_net')}</Text>
                          <Text style={[
                            styles.calcNetValue,
                            r.net > 0.005 && { color: colors.green },
                            r.net < -0.005 && { color: colors.amber },
                          ]}>
                            {r.net > 0 ? '+' : ''}{fmt(r.net)}
                          </Text>
                        </View>
                      </View>
                    );
                  })}

                  {/* La verification : la somme doit tomber a zero au centime. */}
                  <View style={[styles.calcLine, { marginTop: 10, paddingHorizontal: 4 }]}>
                    <Text style={styles.calcNetLabel}>{t('settlements.calc_total')}</Text>
                    <Text style={[styles.calcNetValue, { color: ok ? colors.green : colors.amber }]}>
                      {fmt(total)}
                    </Text>
                  </View>
                  <Text style={[styles.calcHint, { color: ok ? colors.green : colors.amber }]}>
                    {ok
                      ? t('settlements.calc_total_ok')
                      : t('settlements.calc_total_bad', { amount: fmt(total) })}
                  </Text>
                  <Text style={styles.calcHint}>{t('settlements.calc_explain')}</Text>
                </View>
              );
            })()}

            <Text style={[styles.historyLabel, { marginTop: 18 }]}>{t('balances.detail_title')}</Text>
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

      {/* Saisie d'un remboursement — montant modifiable : on peut rembourser
          une partie seulement, ce que le drapeau sur les parts ne savait pas
          exprimer. */}
      <Modal
        visible={!!settleFor}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSettleFor(null)}
      >
        {settleFor && (() => {
          const b = settleFor;
          const parsed = Number(amountInput.replace(',', '.'));
          const valid = Number.isFinite(parsed) && parsed >= 0.01;
          const over = valid && parsed > b.amount + 0.005;
          const other = b.fromMemberId === myMember?.id ? b.toMemberId : b.fromMemberId;
          const methods = [
            t('settlements.method_cash'), t('settlements.method_transfer'),
            t('settlements.method_app'), t('settlements.method_other'),
          ];
          return (
            <View style={styles.modalScreen}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{t('settlements.modal_title')}</Text>
                <TouchableOpacity onPress={() => setSettleFor(null)} style={styles.modalClose}>
                  <Text style={styles.modalCloseText}>{t('common.close')}</Text>
                </TouchableOpacity>
              </View>
              <ScrollView contentContainerStyle={{ padding: spacing.xl, paddingBottom: 60 }}>
                <Text style={styles.formDirection}>
                  {t('settlements.direction', {
                    from: memberName(b.fromMemberId), to: memberName(b.toMemberId),
                  })}
                </Text>

                <Text style={styles.formLabel}>{t('settlements.amount_label')}</Text>
                <TextInput
                  style={styles.amountInput}
                  value={amountInput}
                  onChangeText={setAmountInput}
                  keyboardType="decimal-pad"
                  placeholderTextColor={colors.text3}
                />
                <Text style={[styles.formHint, over && { color: colors.amber }]}>
                  {!valid
                    ? t('settlements.amount_invalid')
                    : over
                      ? t('settlements.amount_over', { amount: fmt(b.amount) })
                      : t('settlements.amount_hint', { amount: fmt(b.amount) })}
                </Text>

                <Text style={styles.formLabel}>{t('settlements.method_label')}</Text>
                <View style={styles.chipRow}>
                  {methods.map(m => (
                    <TouchableOpacity
                      key={m}
                      style={[styles.chip, methodInput === m && styles.chipActive]}
                      onPress={() => setMethodInput(methodInput === m ? '' : m)}
                    >
                      <Text style={[styles.chipText, methodInput === m && styles.chipTextActive]}>{m}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <Text style={styles.formLabel}>{t('settlements.note_label')}</Text>
                <TextInput
                  style={styles.noteInput}
                  value={noteInput}
                  onChangeText={setNoteInput}
                  placeholder={t('settlements.note_placeholder')}
                  placeholderTextColor={colors.text3}
                  maxLength={300}
                />

                {/* Un membre sans compte ne peut rien confirmer : on le dit au
                    lieu de laisser croire a une attente qui n'arrivera jamais. */}
                <Text style={styles.formHint}>
                  {isGuest(other)
                    ? t('settlements.guest_auto', { name: memberName(other) })
                    : t('settlements.waiting_other', { name: memberName(other) })}
                </Text>

                <TouchableOpacity
                  style={[styles.submitBtn, (!valid || createSettlement.isPending) && { opacity: 0.4 }]}
                  disabled={!valid || createSettlement.isPending}
                  onPress={() => createSettlement.mutate({
                    groupId: group.id,
                    fromMemberId: b.fromMemberId,
                    toMemberId: b.toMemberId,
                    amount: Math.round(parsed * 100) / 100,
                    currency: cur,
                    method: methodInput || undefined,
                    note: noteInput.trim() || undefined,
                  })}
                >
                  <Text style={styles.submitBtnText}>
                    {createSettlement.isPending ? '…' : t('settlements.submit')}
                  </Text>
                </TouchableOpacity>
              </ScrollView>
            </View>
          );
        })()}
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
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing.xl, borderBottomWidth: 0.5, borderBottomColor: colors.border },
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
