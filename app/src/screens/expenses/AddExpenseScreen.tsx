// app/src/screens/expenses/AddExpenseScreen.tsx
// Flow:
//   1. select  — OCR ou manuel
//   2. ocr     — scan ticket + assignation articles
//   3. manual  — description + montant + répartition (égale OU custom)
//   4. who_paid — qui a sorti la carte/cash en caisse
//   5. summary  — récap + confirmation

import React, { useState, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Alert, Image, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { groupsApi, expensesApi } from '../../services/api';
import { Button, Input, AmountInput, Chip, Notice, Card, Avatar, SectionLabel } from '../../components/ui';
import OcrScanScreen from './OcrScanScreen';
import { colors, spacing, radius } from '../../theme';
import { GroupMember } from '../../../../shared/types';

// ── Types ──────────────────────────────────────────────────────────────────

type Step = 'select' | 'ocr' | 'manual' | 'who_paid' | 'summary';
type SplitMode = 'equal' | 'custom';

interface PayerEntry {
  memberId: string;
  amount: string;
}

interface OcrItemLocal {
  id: string;
  name: string;
  price: number;
  ocrRaw?: string;
  ocrPriceRaw?: string;
  confidence?: number;
  corrected: boolean;
  assignedTo: string[];
  editName: string;
  editPrice: string;
  editing: boolean;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function AddExpenseScreen() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();

  const [step, setStep] = useState<Step>('select');

  // ── Manuel ────────────────────────────────────────────────────────────
  const [description, setDescription] = useState('');
  // IMPORTANT: amount est la source de vérité pour le mode manuel.
  // totalAmount est calculé depuis amount (manuel) ou ocrItems (OCR).
  const [amount, setAmount] = useState('');
  const [splitMode, setSplitMode] = useState<SplitMode>('equal');
  const [splitMemberIds, setSplitMemberIds] = useState<string[]>([]); // vide = tout le monde
  // Montants custom par membre (mode custom)
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({});

  // ── OCR ───────────────────────────────────────────────────────────────
  const [ocrItems, setOcrItems] = useState<OcrItemLocal[]>([]);
  const [ocrImageUrl, setOcrImageUrl] = useState<string | undefined>();
  const [showReceiptImage, setShowReceiptImage] = useState(false);

  // ── Payeurs ───────────────────────────────────────────────────────────
  const [payers, setPayers] = useState<PayerEntry[]>([{ memberId: '', amount: '' }]);

  const { data: group } = useQuery({
    queryKey: ['group', groupId],
    queryFn: () => groupsApi.get(groupId),
    enabled: !!groupId,
  });

  const members: GroupMember[] = group?.members || [];

  const createMutation = useMutation({
    mutationFn: expensesApi.create,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['group', groupId] });
      router.replace(`/group/${groupId}`);
    },
    onError: (e: any) =>
      Alert.alert('Erreur', e?.response?.data?.error || "Impossible d'ajouter la dépense"),
  });

  // ── Montant total ─────────────────────────────────────────────────────
  // BUG FIX: ne dépend PAS de `step` — toujours calculé depuis la bonne source
  const totalAmount = useMemo(() => {
    if (ocrItems.length > 0) {
      return ocrItems.reduce((s, i) => s + i.price, 0);
    }
    return parseFloat(amount.replace(',', '.')) || 0;
  }, [ocrItems, amount]);

  // ── Splits ────────────────────────────────────────────────────────────
  const activeMemberIds = splitMemberIds.length > 0 ? splitMemberIds : members.map(m => m.id);

  const manualSplits = useMemo(() => {
    if (splitMode === 'equal') {
      const share = activeMemberIds.length > 0 ? totalAmount / activeMemberIds.length : 0;
      return activeMemberIds.map(id => ({ memberId: id, amount: share }));
    }
    // custom
    return activeMemberIds.map(id => ({
      memberId: id,
      amount: parseFloat((customAmounts[id] || '0').replace(',', '.')) || 0,
    }));
  }, [splitMode, activeMemberIds, totalAmount, customAmounts]);

  const customTotal = useMemo(() =>
    manualSplits.reduce((s, r) => s + r.amount, 0),
    [manualSplits]
  );

  const isCustomBalanced = splitMode === 'equal' || Math.abs(customTotal - totalAmount) < 0.02;

  // ── OCR split par membre ──────────────────────────────────────────────
  const ocrSplitByMember = useMemo(() => {
    const result: Record<string, number> = {};
    ocrItems.forEach(item => {
      if (!item.assignedTo.length) return;
      const share = item.price / item.assignedTo.length;
      item.assignedTo.forEach(mid => {
        result[mid] = (result[mid] || 0) + share;
      });
    });
    return result;
  }, [ocrItems]);

  // ── Payeurs ───────────────────────────────────────────────────────────
  const resolvedPayments = useMemo(() =>
    payers
      .filter(p => p.memberId && parseFloat(p.amount.replace(',', '.')) > 0)
      .map(p => ({ memberId: p.memberId, amount: parseFloat(p.amount.replace(',', '.')) })),
    [payers]
  );

  const payerTotal = useMemo(() =>
    resolvedPayments.reduce((s, p) => s + p.amount, 0),
    [resolvedPayments]
  );

  const isPayerBalanced = totalAmount > 0 && Math.abs(payerTotal - totalAmount) < 0.02;

  // ── Helpers ───────────────────────────────────────────────────────────
  function memberById(id: string) { return members.find(m => m.id === id); }

  function toggleSplitMember(id: string) {
    setSplitMemberIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  }

  function availableMembers(currentIdx: number): GroupMember[] {
    const usedIds = payers.filter((_, i) => i !== currentIdx).map(p => p.memberId).filter(Boolean);
    return members.filter(m => !usedIds.includes(m.id));
  }

  function setPayerMember(idx: number, memberId: string) {
    setPayers(prev => {
      const next = prev.map((p, i) => i === idx ? { ...p, memberId } : p);
      // Auto-remplir montant si payeur unique
      if (next.length === 1 && totalAmount > 0) {
        next[0].amount = totalAmount.toFixed(2);
      }
      return next;
    });
  }

  function setPayerAmount(idx: number, val: string) {
    setPayers(prev => prev.map((p, i) => i === idx ? { ...p, amount: val } : p));
  }

  function addPayer() {
    if (payers.length >= members.length) return;
    setPayers(prev => [...prev, { memberId: '', amount: '' }]);
  }

  function removePayer(idx: number) {
    if (payers.length <= 1) return;
    setPayers(prev => prev.filter((_, i) => i !== idx));
  }

  // ── Transition vers who_paid ──────────────────────────────────────────
  function goToWhoPaid() {
    if (ocrItems.length > 0) {
      const assigned = ocrItems.some(i => i.assignedTo.length > 0);
      if (!assigned) {
        Alert.alert('Articles non assignés', 'Assigne au moins un article à un membre avant de continuer.');
        return;
      }
    } else {
      if (!description.trim()) { Alert.alert('Description manquante'); return; }
      if (totalAmount <= 0) { Alert.alert('Montant invalide'); return; }
      if (!isCustomBalanced) {
        Alert.alert(
          'Répartition incorrecte',
          `Total des parts (${customTotal.toFixed(2)}) ≠ montant (${totalAmount.toFixed(2)} CHF).`
        );
        return;
      }
    }
    // Auto-remplir le montant si payeur unique pas encore rempli
    setPayers(prev => {
      if (prev.length === 1 && (!prev[0].amount || prev[0].amount === '0') && totalAmount > 0) {
        return [{ ...prev[0], amount: totalAmount.toFixed(2) }];
      }
      return prev;
    });
    setStep('who_paid');
  }

  // ── Submit final ──────────────────────────────────────────────────────
  function handleSubmit() {
    if (resolvedPayments.length === 0) {
      Alert.alert('Qui a payé ?', 'Sélectionne au moins un payeur avec un montant.');
      return;
    }
    if (!isPayerBalanced) {
      Alert.alert(
        'Montant incorrect',
        `Total payeurs (${payerTotal.toFixed(2)}) ≠ total dépense (${totalAmount.toFixed(2)} CHF).`
      );
      return;
    }

    if (ocrItems.length > 0) {
      createMutation.mutate({
        groupId,
        description: description.trim() || 'Ticket scanné',
        totalAmount,
        payments: resolvedPayments,
        splitType: 'ITEMIZED',
        receiptImageUrl: ocrImageUrl,
        items: ocrItems.map(item => ({
          name: item.name,
          price: item.price,
          ocrRaw: item.ocrRaw,
          ocrConfidence: item.confidence,
          corrected: item.corrected,
          assignedToMemberIds: item.assignedTo,
        })),
      });
    } else {
      if (splitMode === 'custom') {
        createMutation.mutate({
          groupId,
          description: description.trim(),
          totalAmount,
          payments: resolvedPayments,
          splitType: 'CUSTOM',
          customSplits: manualSplits,
          items: [],
        });
      } else {
        createMutation.mutate({
          groupId,
          description: description.trim(),
          totalAmount,
          payments: resolvedPayments,
          splitType: 'EQUAL',
          splitMemberIds: activeMemberIds,
          items: [],
        });
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // STEP: select
  // ═══════════════════════════════════════════════════════════════════════
  if (step === 'select') {
    return (
      <View style={styles.screen}>
        <Header title="Ajouter une dépense" onBack={() => router.back()} insets={insets} />
        <ScrollView contentContainerStyle={styles.scroll}>
          <Notice text="Le scan OCR détecte les articles automatiquement. Chacun coche ce qu'il a pris." />
          <View style={styles.modeGrid}>
            <TouchableOpacity style={[styles.modeCard, styles.modeCardFeat]} onPress={() => setStep('ocr')} activeOpacity={0.85}>
              <Text style={styles.modeIcon}>📷</Text>
              <Text style={[styles.modeLabel, { color: colors.white }]}>Scanner</Text>
              <Text style={[styles.modeSub, { color: 'rgba(255,255,255,0.65)' }]}>OCR gratuit</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modeCard} onPress={() => setStep('manual')} activeOpacity={0.85}>
              <Text style={styles.modeIcon}>✏️</Text>
              <Text style={styles.modeLabel}>Manuel</Text>
              <Text style={styles.modeSub}>Montant global</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // STEP: ocr
  // ═══════════════════════════════════════════════════════════════════════
  if (step === 'ocr') {
    return (
      <View style={styles.screen}>
        <Header title="Scanner un ticket" onBack={() => setStep('select')} insets={insets} />
        <OcrScanScreen
          members={members}
          onComplete={(items: any[], imageUrl?: string) => {
            setOcrItems(items);
            setOcrImageUrl(imageUrl);
            goToWhoPaid();
          }}
        />
      </View>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // STEP: manual — description + montant + répartition
  // ═══════════════════════════════════════════════════════════════════════
  if (step === 'manual') {
    return (
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top + 44}
      >
        <Header title="Saisie manuelle" onBack={() => setStep('select')} insets={insets} />
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

          <Input
            label="Description"
            placeholder="Dîner restaurant, courses…"
            value={description}
            onChangeText={setDescription}
          />

          <Text style={styles.fieldLabel}>MONTANT TOTAL</Text>
          <AmountInput value={amount} onChangeText={setAmount} />

          {/* Qui partage */}
          <SectionLabel label="QUI PARTAGE ?" />
          <Text style={styles.hint}>Aucune sélection = tout le monde</Text>
          <View style={styles.chipWrap}>
            {members.map(m => (
              <Chip
                key={m.id}
                label={m.displayName}
                selected={splitMemberIds.includes(m.id) || splitMemberIds.length === 0}
                onPress={() => toggleSplitMember(m.id)}
                avatar={{ initials: m.avatarInitials, color: m.avatarColor }}
              />
            ))}
          </View>

          {/* Mode de répartition */}
          <SectionLabel label="RÉPARTITION" />
          <View style={styles.splitModeRow}>
            <TouchableOpacity
              style={[styles.splitModeBtn, splitMode === 'equal' && styles.splitModeBtnOn]}
              onPress={() => setSplitMode('equal')}
            >
              <Text style={[styles.splitModeBtnText, splitMode === 'equal' && { color: colors.accent2 }]}>
                ⚖️ Équitable
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.splitModeBtn, splitMode === 'custom' && styles.splitModeBtnOn]}
              onPress={() => setSplitMode('custom')}
            >
              <Text style={[styles.splitModeBtnText, splitMode === 'custom' && { color: colors.accent2 }]}>
                ✏️ Personnalisé
              </Text>
            </TouchableOpacity>
          </View>

          {/* Preview répartition équitable */}
          {splitMode === 'equal' && totalAmount > 0 && (
            <Card style={{ marginBottom: 12 }}>
              <Text style={styles.previewTitle}>Chaque personne paie</Text>
              {manualSplits.map(({ memberId, amount: amt }) => {
                const m = memberById(memberId);
                if (!m) return null;
                return (
                  <View key={memberId} style={styles.splitRow}>
                    <Avatar initials={m.avatarInitials} color={m.avatarColor} size={24} />
                    <Text style={styles.splitName}>{m.displayName}</Text>
                    <Text style={styles.splitAmt}>{amt.toFixed(2)} CHF</Text>
                  </View>
                );
              })}
            </Card>
          )}

          {/* Saisie montants personnalisés */}
          {splitMode === 'custom' && (
            <Card style={{ marginBottom: 12 }}>
              <Text style={styles.previewTitle}>Entre le montant pour chacun</Text>
              {activeMemberIds.map(mid => {
                const m = memberById(mid);
                if (!m) return null;
                return (
                  <View key={mid} style={styles.customRow}>
                    <Avatar initials={m.avatarInitials} color={m.avatarColor} size={24} />
                    <Text style={styles.splitName}>{m.displayName}</Text>
                    <TextInput
                      style={styles.customInput}
                      placeholder="0.00"
                      placeholderTextColor={colors.text3}
                      value={customAmounts[mid] || ''}
                      onChangeText={v => setCustomAmounts(prev => ({ ...prev, [mid]: v }))}
                      keyboardType="decimal-pad"
                    />
                    <Text style={styles.customCurrency}>CHF</Text>
                  </View>
                );
              })}
              {/* Indicateur total custom */}
              <View style={styles.customTotalRow}>
                <Text style={styles.customTotalLabel}>Total saisi</Text>
                <Text style={[
                  styles.customTotalAmt,
                  totalAmount > 0 && !isCustomBalanced ? { color: colors.red } : { color: colors.green },
                ]}>
                  {customTotal.toFixed(2)} / {totalAmount.toFixed(2)} CHF
                  {isCustomBalanced && totalAmount > 0 ? ' ✓' : ''}
                </Text>
              </View>
            </Card>
          )}

          <Button
            label="Continuer → Qui a payé ?"
            onPress={goToWhoPaid}
            style={{ marginTop: 8, marginBottom: Math.max(insets.bottom, 16) }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // STEP: who_paid
  // ═══════════════════════════════════════════════════════════════════════
  if (step === 'who_paid') {
    const sourceStep: Step = ocrItems.length > 0 ? 'ocr' : 'manual';

    return (
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top + 44}
      >
        <Header title="Qui a payé en caisse ?" onBack={() => setStep(sourceStep)} insets={insets} />
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

          {/* Rappel contexte */}
          <Card style={{ marginBottom: 12 }}>
            <Text style={styles.contextTitle}>
              {ocrItems.length > 0 ? 'Ticket scanné' : description}
            </Text>
            <Text style={styles.contextTotal}>
              Total : {totalAmount.toFixed(2)} CHF
            </Text>
            {ocrItems.length === 0 && splitMode === 'custom' && (
              <Text style={styles.contextSub}>Répartition personnalisée</Text>
            )}
            {ocrItems.length > 0 && (
              <Text style={styles.contextSub}>
                {ocrItems.length} article{ocrItems.length > 1 ? 's' : ''} —{' '}
                {Object.keys(ocrSplitByMember).length} personne{Object.keys(ocrSplitByMember).length > 1 ? 's' : ''}
              </Text>
            )}
          </Card>

          <Notice text="Indique qui a physiquement payé l'addition et combien. Plusieurs personnes peuvent avoir payé des parts différentes." />

          {/* Payeurs */}
          <View style={styles.payerLabelRow}>
            <Text style={styles.fieldLabel}>PAYEURS</Text>
            {payers.length < members.length && (
              <TouchableOpacity onPress={addPayer} style={styles.addPayerBtn}>
                <Text style={styles.addPayerText}>+ Ajouter payeur</Text>
              </TouchableOpacity>
            )}
          </View>

          {payers.map((payer, idx) => {
            const selected = memberById(payer.memberId);
            // Calcul du "payer le reste" pour ce payeur
            const otherPayersTotal = resolvedPayments
              .filter(p => p.memberId !== payer.memberId)
              .reduce((s, p) => s + p.amount, 0);
            const reste = Math.max(0, totalAmount - otherPayersTotal);

            return (
              <View key={idx} style={styles.payerCard}>
                <Text style={styles.payerCardLabel}>Membre</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
                  <View style={styles.payerChipList}>
                    {availableMembers(idx)
                      .concat(selected ? [selected] : [])
                      .filter((m, i, arr) => arr.findIndex(x => x.id === m.id) === i)
                      .map(m => (
                        <TouchableOpacity
                          key={m.id}
                          style={[styles.payerChip, payer.memberId === m.id && styles.payerChipOn]}
                          onPress={() => setPayerMember(idx, m.id)}
                          activeOpacity={0.75}
                        >
                          <Avatar initials={m.avatarInitials} color={m.avatarColor} size={22} />
                          <Text style={[styles.payerChipText, payer.memberId === m.id && { color: colors.accent2 }]}>
                            {m.displayName}
                          </Text>
                        </TouchableOpacity>
                      ))}
                  </View>
                </ScrollView>

                <Text style={styles.payerCardLabel}>Montant payé</Text>
                <View style={styles.payerAmountRow}>
                  <TextInput
                    style={styles.payerAmountInput}
                    placeholder={totalAmount > 0 ? totalAmount.toFixed(2) : '0.00'}
                    placeholderTextColor={colors.text3}
                    value={payer.amount}
                    onChangeText={v => setPayerAmount(idx, v)}
                    keyboardType="decimal-pad"
                  />
                  <Text style={styles.payerAmountCurrency}>CHF</Text>
                  {payers.length > 1 && (
                    <TouchableOpacity onPress={() => removePayer(idx)} style={styles.removePayerBtn}>
                      <Text style={styles.removePayerText}>✕ Retirer</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {/* Raccourci : payer le reste */}
                {payers.length > 1 && reste > 0.01 && (
                  <TouchableOpacity
                    style={styles.shortcutBtn}
                    onPress={() => setPayerAmount(idx, reste.toFixed(2))}
                  >
                    <Text style={styles.shortcutText}>
                      Payer le reste ({reste.toFixed(2)} CHF)
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })}

          {/* Barre d'équilibre */}
          <View style={[styles.balanceBar, isPayerBalanced ? styles.balanceBarOk : styles.balanceBarWarn]}>
            <Text style={[styles.balanceBarText, { color: isPayerBalanced ? colors.green : colors.amber }]}>
              {isPayerBalanced
                ? `✓ Équilibré — ${payerTotal.toFixed(2)} CHF`
                : `${payerTotal.toFixed(2)} / ${totalAmount.toFixed(2)} CHF`}
            </Text>
          </View>

          <Button
            label="Voir le résumé →"
            onPress={() => {
              if (resolvedPayments.length === 0) {
                Alert.alert('Qui a payé ?', 'Sélectionne au moins un payeur avec un montant.');
                return;
              }
              if (!isPayerBalanced) {
                Alert.alert(
                  'Montant incorrect',
                  `Total payeurs (${payerTotal.toFixed(2)}) ≠ total dépense (${totalAmount.toFixed(2)} CHF).`
                );
                return;
              }
              setStep('summary');
            }}
            style={{ marginTop: 8, marginBottom: Math.max(insets.bottom, 16) }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // STEP: summary
  // ═══════════════════════════════════════════════════════════════════════
  const correctionCount = ocrItems.filter(i => i.corrected).length;

  return (
    <View style={styles.screen}>
      <Header title="Résumé" onBack={() => setStep('who_paid')} insets={insets} />
      <ScrollView contentContainerStyle={styles.scroll}>

        {ocrItems.length > 0 && (
          <Input
            label="Description (optionnel)"
            placeholder="Ticket La Stanza"
            value={description}
            onChangeText={setDescription}
          />
        )}

        {/* Payé en caisse */}
        <Card style={{ marginBottom: 12 }}>
          <Text style={styles.previewTitle}>💳 Payé en caisse</Text>
          {resolvedPayments.map(p => {
            const m = memberById(p.memberId);
            if (!m) return null;
            return (
              <View key={p.memberId} style={styles.splitRow}>
                <Avatar initials={m.avatarInitials} color={m.avatarColor} size={24} />
                <Text style={styles.splitName}>{m.displayName}</Text>
                <Text style={[styles.splitAmt, { color: colors.accent2 }]}>{p.amount.toFixed(2)} CHF</Text>
              </View>
            );
          })}
        </Card>

        {/* Ce que chacun doit — OCR */}
        {ocrItems.length > 0 && (
          <Card style={{ marginBottom: 12 }}>
            <Text style={styles.previewTitle}>🍽 Ce que chacun a pris</Text>
            {Object.entries(ocrSplitByMember).map(([mid, amt]) => {
              const m = memberById(mid);
              if (!m) return null;
              return (
                <View key={mid} style={styles.splitRow}>
                  <Avatar initials={m.avatarInitials} color={m.avatarColor} size={24} />
                  <Text style={styles.splitName}>{m.displayName}</Text>
                  <Text style={styles.splitAmt}>{(amt as number).toFixed(2)} CHF</Text>
                </View>
              );
            })}
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total scanné</Text>
              <Text style={styles.totalAmt}>{totalAmount.toFixed(2)} CHF</Text>
            </View>
          </Card>
        )}

        {/* Ce que chacun doit — manuel */}
        {ocrItems.length === 0 && (
          <Card style={{ marginBottom: 12 }}>
            <Text style={styles.previewTitle}>
              {splitMode === 'equal' ? '⚖️ Parts égales' : '✏️ Répartition personnalisée'}
            </Text>
            {manualSplits.map(({ memberId, amount: amt }) => {
              const m = memberById(memberId);
              if (!m) return null;
              return (
                <View key={memberId} style={styles.splitRow}>
                  <Avatar initials={m.avatarInitials} color={m.avatarColor} size={24} />
                  <Text style={styles.splitName}>{m.displayName}</Text>
                  <Text style={styles.splitAmt}>{amt.toFixed(2)} CHF</Text>
                </View>
              );
            })}
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalAmt}>{totalAmount.toFixed(2)} CHF</Text>
            </View>
          </Card>
        )}

        {/* Image ticket */}
        {ocrImageUrl && (
          <View style={styles.receiptImageBlock}>
            <TouchableOpacity style={styles.receiptImageBtn} onPress={() => setShowReceiptImage(v => !v)}>
              <Text style={styles.receiptImageBtnText}>
                {showReceiptImage ? '🙈 Masquer le ticket' : '🧾 Voir le ticket scanné'}
              </Text>
            </TouchableOpacity>
            {showReceiptImage && (
              <Image source={{ uri: ocrImageUrl }} style={styles.receiptImage} resizeMode="contain" />
            )}
          </View>
        )}

        {correctionCount > 0 && (
          <Notice variant="amber" text={`${correctionCount} correction(s) OCR enregistrée(s). Merci !`} />
        )}
        {ocrItems.length > 0 && Object.keys(ocrSplitByMember).length === 0 && (
          <Notice variant="amber" text="Aucun article assigné — tout le monde partage à égalité." />
        )}

        <Button
          label="Confirmer la dépense →"
          onPress={handleSubmit}
          loading={createMutation.isPending}
          style={{ marginTop: 4, marginBottom: Math.max(insets.bottom, 16) }}
        />
        <Button label="← Modifier les payeurs" onPress={() => setStep('who_paid')} variant="ghost" />
      </ScrollView>
    </View>
  );
}

// ── Header avec safe area ──────────────────────────────────────────────────

function Header({
  title, onBack, insets,
}: {
  title: string;
  onBack: () => void;
  insets: { top: number; bottom: number };
}) {
  return (
    <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) }]}>
      <TouchableOpacity
        onPress={onBack}
        style={styles.backBtn}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
      >
        <Text style={styles.backText}>← Retour</Text>
      </TouchableOpacity>
      <Text style={styles.title} numberOfLines={1}>{title}</Text>
      <View style={{ width: 70 }} />
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingBottom: 10,
    borderBottomWidth: 0.5, borderBottomColor: colors.border,
  },
  backBtn: {
    backgroundColor: colors.surface2, borderWidth: 0.5, borderColor: colors.border,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.full,
    minWidth: 70,
  },
  backText: { color: colors.text2, fontSize: 12, fontWeight: '500' },
  title: {
    fontSize: 15, fontWeight: '600', color: colors.text,
    flex: 1, textAlign: 'center', marginHorizontal: 8,
  },
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: 80, paddingTop: 16 },

  fieldLabel: {
    fontSize: 11, fontWeight: '500', color: colors.text3,
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8, marginTop: 4,
  },
  hint: { fontSize: 11, color: colors.text3, marginBottom: 8, marginTop: -4 },

  // Select
  modeGrid: { flexDirection: 'row', gap: 10, marginTop: 8 },
  modeCard: {
    flex: 1, backgroundColor: colors.surface, borderWidth: 0.5, borderColor: colors.border,
    borderRadius: radius.md, padding: 20, alignItems: 'center',
  },
  modeCardFeat: { backgroundColor: colors.accent, borderColor: colors.accent },
  modeIcon: { fontSize: 28, marginBottom: 8 },
  modeLabel: { fontSize: 13, fontWeight: '600', color: colors.text },
  modeSub: { fontSize: 11, color: colors.text3, marginTop: 2 },

  // Split mode toggle
  splitModeRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  splitModeBtn: {
    flex: 1, paddingVertical: 10, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.border, alignItems: 'center',
    backgroundColor: colors.surface,
  },
  splitModeBtnOn: { borderColor: colors.accent, backgroundColor: colors.accentBg },
  splitModeBtnText: { fontSize: 13, fontWeight: '500', color: colors.text2 },

  // Chips
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 },

  // Split rows
  previewTitle: { fontSize: 12, color: colors.text3, marginBottom: 10, fontWeight: '500' },
  splitRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: colors.border,
  },
  splitName: { flex: 1, fontSize: 13, color: colors.text },
  splitAmt: { fontSize: 13, fontFamily: 'monospace', fontWeight: '500', color: colors.amber },

  // Custom amounts
  customRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  customInput: {
    borderWidth: 0.5, borderColor: colors.accent, borderRadius: radius.sm,
    paddingHorizontal: 10, paddingVertical: 6, color: colors.text,
    fontFamily: 'monospace', fontSize: 14, width: 80, textAlign: 'right',
  },
  customCurrency: { fontSize: 12, color: colors.text3, width: 28 },
  customTotalRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    borderTopWidth: 0.5, borderTopColor: colors.border2, marginTop: 8, paddingTop: 10,
  },
  customTotalLabel: { fontSize: 12, color: colors.text3 },
  customTotalAmt: { fontSize: 13, fontFamily: 'monospace', fontWeight: '600' },

  // Totals
  totalRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    borderTopWidth: 0.5, borderTopColor: colors.border2, marginTop: 6, paddingTop: 8,
  },
  totalLabel: { fontSize: 12, color: colors.text3 },
  totalAmt: { fontSize: 13, fontFamily: 'monospace', fontWeight: '500', color: colors.text },

  // Context card
  contextTitle: { fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 4 },
  contextTotal: { fontSize: 20, fontFamily: 'monospace', fontWeight: '300', color: colors.accent2 },
  contextSub: { fontSize: 11, color: colors.text3, marginTop: 4 },

  // Payer cards
  payerLabelRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 10, marginTop: 4,
  },
  addPayerBtn: {
    paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: radius.full, borderWidth: 1, borderColor: colors.accent,
  },
  addPayerText: { fontSize: 11, color: colors.accent2, fontWeight: '600' },
  payerCard: {
    backgroundColor: colors.surface, borderWidth: 0.5, borderColor: colors.border,
    borderRadius: radius.md, padding: 14, marginBottom: 10,
  },
  payerCardLabel: {
    fontSize: 10, color: colors.text3, fontWeight: '500',
    textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6,
  },
  payerChipList: { flexDirection: 'row', gap: 8, paddingVertical: 2 },
  payerChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: radius.full, borderWidth: 1.5, borderColor: colors.border,
  },
  payerChipOn: { borderColor: colors.accent, backgroundColor: colors.accentBg },
  payerChipText: { fontSize: 12, fontWeight: '500', color: colors.text2 },
  payerAmountRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  payerAmountInput: {
    borderWidth: 0.5, borderColor: colors.accent, borderRadius: radius.sm,
    paddingHorizontal: 12, paddingVertical: 8, color: colors.text,
    fontFamily: 'monospace', fontSize: 18, width: 110, textAlign: 'right',
  },
  payerAmountCurrency: { fontSize: 13, color: colors.text3 },
  removePayerBtn: {
    marginLeft: 'auto', paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: radius.sm, borderWidth: 0.5, borderColor: colors.border2,
  },
  removePayerText: { fontSize: 11, color: colors.text3 },
  shortcutBtn: {
    marginTop: 8, paddingVertical: 6, paddingHorizontal: 10,
    borderRadius: radius.sm, backgroundColor: colors.accentBg, alignSelf: 'flex-start',
  },
  shortcutText: { fontSize: 11, color: colors.accent2, fontWeight: '500' },

  // Balance bar
  balanceBar: { borderRadius: radius.sm, padding: 10, marginBottom: 12, marginTop: 4 },
  balanceBarOk: { backgroundColor: 'rgba(52,211,153,0.08)' },
  balanceBarWarn: { backgroundColor: 'rgba(251,191,36,0.08)' },
  balanceBarText: { fontSize: 13, fontFamily: 'monospace', fontWeight: '500', textAlign: 'center' },

  // Receipt
  receiptImageBlock: { marginBottom: 12 },
  receiptImageBtn: {
    backgroundColor: colors.surface2, borderWidth: 0.5, borderColor: colors.border,
    borderRadius: radius.sm, padding: 12, alignItems: 'center',
  },
  receiptImageBtnText: { fontSize: 13, color: colors.accent2, fontWeight: '500' },
  receiptImage: {
    width: '100%', height: 300, borderRadius: radius.sm,
    marginTop: 8, backgroundColor: colors.surface3,
  },
});