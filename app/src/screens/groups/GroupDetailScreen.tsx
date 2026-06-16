// app/src/screens/groups/GroupDetailScreen.tsx
import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  RefreshControl, Share, Alert, Modal,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { groupsApi, expensesApi } from '../../services/api';
import { useAuthStore } from '../../store/authStore';
import { Avatar, Card, SectionLabel, Divider, Button } from '../../components/ui';
import { colors, spacing, shadows, radius } from '../../theme';
import { Expense, Balance } from '../../../../shared/types';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function GroupDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const user = useAuthStore(s => s.user);
  const insets = useSafeAreaInsets();

  const [expandedBalance, setExpandedBalance] = useState<string | null>(null);
  const [showLog, setShowLog] = useState(false);

  const { data: group, isLoading, refetch } = useQuery({
    queryKey: ['group', id],
    queryFn: () => groupsApi.get(id),
    enabled: !!id,
  });

  const settleMutation = useMutation({
    mutationFn: ({ expenseId, memberId }: { expenseId: string; memberId: string }) =>
      expensesApi.settle(expenseId, memberId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['group', id] });
      Alert.alert('✓ Réglé', 'Le remboursement a été enregistré.');
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

  async function handleShare() {
    try {
      await Share.share({
        message: `Rejoins le groupe "${group.name}" sur Splitit !\nCode : ${group.inviteCode}`,
      });
    } catch {
      Alert.alert('Erreur', 'Impossible de partager.');
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

  return (
    <View style={styles.screen}>
      {/* Header — safe area gérée ici */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.backText}>← Retour</Text>
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{group.emoji} {group.name}</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity
            style={styles.membersBtn}
            onPress={() => router.push(`/group/members?groupId=${id}`)}
            activeOpacity={0.7}
            hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
          >
            <Text style={styles.membersBtnText}>👥 Membres</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.shareBtn}
            onPress={handleShare}
            activeOpacity={0.7}
            hitSlop={{ top: 12, bottom: 12, left: 8, right: 8 }}
          >
            <Text style={styles.shareBtnText}>Inviter</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refetch} tintColor={colors.accent} />}
      >
        {/* Members */}
        <Card>
          <Text style={styles.cardTitle}>Membres ({group.members.length})</Text>
          <View style={styles.memberRow}>
            {group.members.map((m: any) => (
              <View key={m.id} style={styles.memberItem}>
                <Avatar initials={m.avatarInitials} color={m.avatarColor} size={40} />
                <Text style={styles.memberName}>{m.displayName}</Text>
                {m.id === myMember?.id && <Text style={styles.meTag}>moi</Text>}
              </View>
            ))}
          </View>
        </Card>

        {/* Summary */}
        {group.expenses?.length > 0 && (
          <>
            <SectionLabel label="Résumé du groupe" />
            <Card>
              <View style={styles.summaryRow}>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryNum}>{totalSpent.toFixed(2)}</Text>
                  <Text style={styles.summaryCurrency}>CHF</Text>
                  <Text style={styles.summaryLabel}>Total groupe</Text>
                </View>
                <View style={styles.summaryDivider} />
                <View style={styles.summaryItem}>
                  <Text style={[styles.summaryNum, { color: colors.accent2 }]}>{myShare.toFixed(2)}</Text>
                  <Text style={[styles.summaryCurrency, { color: colors.accent2 }]}>CHF</Text>
                  <Text style={styles.summaryLabel}>Ma part</Text>
                </View>
                <View style={styles.summaryDivider} />
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryNum}>{group.expenses.length}</Text>
                  <Text style={styles.summaryLabel}>Dépenses</Text>
                </View>
              </View>
            </Card>
          </>
        )}

        {/* Remboursements */}
        {group.balances?.length > 0 && (
          <>
            <View style={styles.balancesHeader}>
              <SectionLabel label="Remboursements" />
              {Object.keys(netLog).length > 0 && (
                <TouchableOpacity onPress={() => setShowLog(true)} style={styles.logBtn}>
                  <Text style={styles.logBtnText}>📋 Détail</Text>
                </TouchableOpacity>
              )}
            </View>

            <Card>
              <Text style={styles.balanceHint}>
                Montants nets simplifiés — appuie pour marquer comme réglé
              </Text>
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
                            {isMeDebtor ? ' (moi)' : ''}
                          </Text>
                          <Text style={styles.balanceArrowLabel}>
                            doit rembourser → {b.toMember.displayName}
                          </Text>
                        </View>
                      </View>
                      <Text style={[styles.balanceAmt, isMe && styles.balanceAmtMe]}>
                        {b.amount.toFixed(2)} CHF
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
                              {line.amount.toFixed(2)} CHF
                            </Text>
                          </View>
                        ))}
                        {isMeDebtor && (
                          <TouchableOpacity
                            style={styles.settleBtn}
                            onPress={() => {
                              Alert.alert(
                                'Marquer comme réglé ?',
                                `Confirmer le remboursement de ${b.amount.toFixed(2)} CHF à ${b.toMember.displayName} ?`,
                                [
                                  { text: 'Annuler', style: 'cancel' },
                                  {
                                    text: 'Confirmer',
                                    onPress: () => {
                                      (netLog[key]?.lines || [])
                                        .filter(l => !l.settled)
                                        .forEach(l => {
                                          settleMutation.mutate({ expenseId: l.expenseId, memberId: l.debtorId });
                                        });
                                      setExpandedBalance(null);
                                    },
                                  },
                                ]
                              );
                            }}
                          >
                            <Text style={styles.settleBtnText}>
                              💸 J'ai remboursé {b.amount.toFixed(2)} CHF
                            </Text>
                          </TouchableOpacity>
                        )}
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
        <SectionLabel label="Dépenses" />
        {(group.expenses || []).map((exp: Expense) => {
          const payments = (exp as any).payments || [];
          const payerLabel = payments.length > 1
            ? payments.map((p: any) => `${p.member?.displayName} (${p.amount.toFixed(0)})`).join(', ')
            : payments[0]?.member?.displayName ?? '?';

          return (
            <TouchableOpacity
              key={exp.id}
              activeOpacity={0.8}
              onPress={() => router.push(`/expense/${exp.id}`)}
            >
              <View style={styles.expenseItem}>
                <View style={[styles.expIcon, { backgroundColor: colors.accentBg }]}>
                  <Text style={{ fontSize: 18 }}>{exp.receiptImageUrl ? '🧾' : '✏️'}</Text>
                </View>
                <View style={styles.expInfo}>
                  <Text style={styles.expName}>{exp.description}</Text>
                  <Text style={styles.expSub}>payé par {payerLabel}</Text>
                </View>
                <View style={styles.expRight}>
                  <Text style={styles.expAmt}>{exp.totalAmount.toFixed(2)} CHF</Text>
                </View>
              </View>
            </TouchableOpacity>
          );
        })}

        {group.expenses?.length === 0 && (
          <View style={styles.emptyExp}>
            <Text style={styles.emptyEmoji}>🧾</Text>
            <Text style={styles.emptyText}>Aucune dépense encore</Text>
            <Text style={styles.emptySubText}>Appuie sur + pour ajouter la première !</Text>
          </View>
        )}
      </ScrollView>

      {/* FAB — safe area en bas */}
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
            <Text style={styles.modalTitle}>📋 Détail des remboursements</Text>
            <TouchableOpacity onPress={() => setShowLog(false)} style={styles.modalClose}>
              <Text style={styles.modalCloseText}>Fermer</Text>
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
                        {remaining < 0.01 ? '✓ Réglé' : `${remaining.toFixed(2)} CHF restant`}
                      </Text>
                      {entry.settled > 0 && (
                        <Text style={styles.logEntrySettled}>{entry.settled.toFixed(2)} CHF réglé</Text>
                      )}
                    </View>
                  </View>
                  {entry.lines.map((line, li) => (
                    <View key={li} style={styles.logLine}>
                      <Text style={[styles.logLineName, line.settled && { color: colors.text3 }]} numberOfLines={1}>
                        {line.settled ? '✓' : '•'} {line.expenseDesc}
                      </Text>
                      <Text style={[styles.logLineAmt, line.settled && { color: colors.text3 }]}>
                        {line.amount.toFixed(2)} CHF
                      </Text>
                    </View>
                  ))}
                </View>
              );
            })}
            {Object.keys(netLog).length === 0 && (
              <Text style={{ color: colors.text3, textAlign: 'center', marginTop: 40 }}>
                Aucun remboursement calculé
              </Text>
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
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, minHeight: 36,
    justifyContent: 'center',
  },
  backText: { color: colors.text2, fontSize: 12, fontWeight: '500' },
  title: { fontSize: 15, fontWeight: '600', color: colors.text, flex: 1, textAlign: 'center', marginHorizontal: 8 },
  membersBtn: {
    backgroundColor: colors.surface2, borderWidth: 0.5, borderColor: colors.border2,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, minHeight: 36,
    justifyContent: 'center',
  },
  membersBtnText: { color: colors.text2, fontSize: 11, fontWeight: '600' },
  shareBtn: {
    backgroundColor: colors.accentBg, borderWidth: 0.5, borderColor: 'rgba(124,110,250,0.3)',
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, minHeight: 36,
    justifyContent: 'center',
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

  balancesHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  logBtn: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full,
    borderWidth: 1, borderColor: colors.border2, marginBottom: 4,
  },
  logBtnText: { fontSize: 11, color: colors.text2, fontWeight: '500' },
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

  balanceDetail: {
    backgroundColor: colors.surface2, borderRadius: radius.sm,
    padding: 12, marginBottom: 8, gap: 6,
  },
  detailLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  detailDesc: { fontSize: 12, color: colors.text2, flex: 1 },
  detailAmt: { fontSize: 12, fontFamily: 'monospace', color: colors.amber, marginLeft: 8 },
  settleBtn: {
    marginTop: 8, backgroundColor: colors.accent, borderRadius: radius.sm,
    padding: 10, alignItems: 'center',
  },
  settleBtnText: { fontSize: 13, color: colors.white, fontWeight: '600' },

  expenseItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.surface, borderWidth: 0.5, borderColor: colors.border,
    borderRadius: 14, padding: 14, marginBottom: 8,
  },
  expIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  expInfo: { flex: 1 },
  expName: { fontSize: 14, fontWeight: '500', color: colors.text },
  expSub: { fontSize: 11, color: colors.text3, marginTop: 2 },
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
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: spacing.xl, borderBottomWidth: 0.5, borderBottomColor: colors.border,
  },
  modalTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
  modalClose: {
    paddingHorizontal: 12, paddingVertical: 6,
    backgroundColor: colors.surface2, borderRadius: radius.full,
  },
  modalCloseText: { fontSize: 13, color: colors.text2 },
  logEntry: {
    backgroundColor: colors.surface, borderWidth: 0.5, borderColor: colors.border,
    borderRadius: radius.md, padding: 14, marginBottom: 10,
  },
  logEntryMe: { borderColor: colors.accent, backgroundColor: colors.accentBg },
  logEntryHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  logEntryTitle: { fontSize: 13, fontWeight: '600', color: colors.text, flex: 1 },
  logEntryTotal: { fontSize: 13, fontFamily: 'monospace', color: colors.amber, fontWeight: '600', textAlign: 'right' },
  logEntrySettled: { fontSize: 11, color: colors.green, textAlign: 'right', marginTop: 2 },
  logLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  logLineName: { fontSize: 12, color: colors.text2, flex: 1 },
  logLineAmt: { fontSize: 12, fontFamily: 'monospace', color: colors.amber },
});