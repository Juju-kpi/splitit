// app/src/screens/expenses/AddExpenseScreen.tsx
// Changements vs original :
//   1. FIX: validation "description manquante" déplacée — en mode OCR, la description
//      n'est demandée qu'au step summary (après les payeurs), pas avant.
//   2. EDIT MODE: si les params `expenseId` + `isEdit=true` sont présents,
//      l'écran se pré-remplit avec les données existantes et appelle PUT /expenses/:id/items
//      au lieu de POST /expenses. Accessible à tous les membres.
//   3. Le bouton "Assigner les items restants" apparaît si l'utilisateur est le créateur
//      et qu'il reste des items sans assignation.

import React, { useState, useMemo, useEffect } from 'react';
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
import { colors, spacing, radius, fonts } from '../../theme';
import { GroupMember } from '../../../../shared/types';
import { useAuthStore } from '../../store/authStore';
import { useFormatMoney, useCurrency } from '../../store/langStore';

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
  const { groupId, expenseId, isEdit } = useLocalSearchParams<{
    groupId: string;
    expenseId?: string;
    isEdit?: string;
  }>();
  const editMode = isEdit === 'true' && !!expenseId;

  const router = useRouter();
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const user = useAuthStore(s => s.user);
  const fmt = useFormatMoney();
  const cur = useCurrency();

  const [step, setStep] = useState<Step>(editMode ? 'ocr' : 'select');
  const [initialized, setInitialized] = useState(false);

  // ── Manuel ────────────────────────────────────────────────────────────
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [splitMode, setSplitMode] = useState<SplitMode>('equal');
  const [splitMemberIds, setSplitMemberIds] = useState<string[]>([]);
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({});

  // ── OCR ───────────────────────────────────────────────────────────────
  const [ocrItems, setOcrItems] = useState<OcrItemLocal[]>([]);
  // Total imprimé sur le ticket. Vide = somme des articles.
  // Les lignes sont souvent HT : sans ce champ, les taxes ne sont payées par personne.
  const [receiptTotal, setReceiptTotal] = useState('');
  // Répartition d'un ticket : par articles (défaut), équitable ou personnalisée
  const [ocrSplitMode, setOcrSplitMode] = useState<'items' | 'equal' | 'custom'>('items');
  const [ocrImageUrl, setOcrImageUrl] = useState<string | undefined>();
  const [showReceiptImage, setShowReceiptImage] = useState(false);

  // ── Payeurs ───────────────────────────────────────────────────────────
  const [payers, setPayers] = useState<PayerEntry[]>([{ memberId: '', amount: '' }]);

  const { data: group } = useQuery({
    queryKey: ['group', groupId],
    queryFn: () => groupsApi.get(groupId),
    enabled: !!groupId,
  });

  // En mode edit, charger la dépense existante
  const { data: existingExpense } = useQuery({
    queryKey: ['expense', expenseId],
    queryFn: () => expensesApi.get(expenseId!),
    enabled: editMode && !!expenseId,
  });

  const members: GroupMember[] = group?.members || [];

  // Détermine si l'utilisateur est le créateur de la dépense
  const myMember = members.find((m: any) => m.userId === user?.id);
  const isCreator = editMode && existingExpense
    ? (existingExpense as any).createdByMemberId === myMember?.id || !!(existingExpense as any).createdByMemberId === false
    : false;

  // Pré-remplir depuis la dépense existante (une seule fois)
  useEffect(() => {
    if (!editMode || !existingExpense || !members.length || initialized) return;

    const exp = existingExpense as any;
    setDescription(exp.description || '');
    setOcrImageUrl(exp.receiptImageUrl);

    // Reconstituer les items OCR
    if (exp.items && exp.items.length > 0) {
      const localItems: OcrItemLocal[] = exp.items.map((item: any, i: number) => ({
        id: `existing_${i}`,
        name: item.name,
        price: item.price,
        ocrRaw: item.ocrRaw,
        confidence: item.ocrConfidence,
        corrected: item.corrected,
        assignedTo: (item.assignedTo || []).map((a: any) => a.memberId),
        editName: item.name,
        editPrice: item.price.toFixed(2),
        editing: false,
      }));
      setOcrItems(localItems);
      // Sinon le total retomberait sur la somme des articles, taxes perdues
      setReceiptTotal(exp.totalAmount?.toFixed(2) || '');
      // On restaure le mode de répartition réellement enregistré
      if (exp.splitType === 'EQUAL' || exp.splitType === 'CUSTOM') {
        setOcrSplitMode(exp.splitType === 'EQUAL' ? 'equal' : 'custom');
        if (exp.splits && exp.splits.length > 0) {
          setSplitMemberIds(exp.splits.map((sp: any) => sp.memberId));
          setCustomAmounts(Object.fromEntries(
            exp.splits.map((sp: any) => [sp.memberId, sp.amount.toFixed(2)])
          ));
        }
      }
      setStep('ocr');
    } else {
      // Mode manuel
      setAmount(exp.totalAmount?.toFixed(2) || '');
      setStep('manual');
      // Sans ça, une dépense partagée entre 3 repartirait sur tout le groupe
      if (exp.splits && exp.splits.length > 0) {
        setSplitMemberIds(exp.splits.map((sp: any) => sp.memberId));
        // Amorce toujours la saisie manuelle avec les parts reelles
        setCustomAmounts(Object.fromEntries(
          exp.splits.map((sp: any) => [sp.memberId, sp.amount.toFixed(2)])
        ));
        if (exp.splitType === 'CUSTOM') setSplitMode('custom');
      }
    }

    // Pré-remplir les payeurs
    if (exp.payments && exp.payments.length > 0) {
      setPayers(exp.payments.map((p: any) => ({
        memberId: p.memberId,
        amount: p.amount.toFixed(2),
      })));
    }

    setInitialized(true);
  }, [existingExpense, members, editMode, initialized]);

  // Retirer une ligne (doublon OCR). Le total suit la somme des articles.
  function removeOcrItem(idx: number) {
    const item = ocrItems[idx];
    Alert.alert(
      'Retirer cet article ?',
      `« ${item.name} » — ${item.price.toFixed(2)}`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Retirer',
          style: 'destructive',
          onPress: () => {
            const next = ocrItems.filter((_, i) => i !== idx);
            setOcrItems(next);
            // Un total saisi fait foi ; sinon le payeur unique suit les articles
            if (receiptTotal.trim() === '') {
              const newTotal = next.reduce((sum, it) => sum + it.price, 0);
              setPayers(prev => prev.length === 1
                ? [{ ...prev[0], amount: newTotal.toFixed(2) }]
                : prev);
            }
          },
        },
      ],
    );
  }

  // Ajouter une ligne oubliée par l'OCR (ou absente du ticket)
  function addOcrItem() {
    setOcrItems(prev => [...prev, {
      id: `manual_${Date.now()}`, name: 'Nouvel article', price: 0,
      ocrRaw: '', confidence: 1, corrected: true, assignedTo: [],
      editName: '', editPrice: '', editing: true,
    } as OcrItemLocal]);
  }

  // Corriger le nom ou le prix d'une ligne
  function startEditOcrItem(idx: number) {
    setOcrItems(prev => prev.map((it, i) => i === idx
      ? { ...it, editing: true, editName: it.name, editPrice: it.price.toFixed(2) }
      : it));
  }

  function saveEditOcrItem(idx: number) {
    setOcrItems(prev => prev.map((it, i) => {
      if (i !== idx) return it;
      const newPrice = parseFloat((it.editPrice || '').replace(',', '.'));
      const price = isNaN(newPrice) || newPrice < 0 ? it.price : newPrice;
      const name = (it.editName || '').trim() || it.name;
      return { ...it, name, price, editing: false, corrected: it.corrected || name !== it.name || price !== it.price };
    }));
  }

  // ── Mutations ─────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: expensesApi.create,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['group', groupId] });
      // Le nombre de dépenses affiché dans la liste des groupes change aussi.
      qc.invalidateQueries({ queryKey: ['groups'] });
      router.replace(`/group/${groupId}`);
    },
    onError: (e: any) =>
      Alert.alert('Erreur', e?.response?.data?.error || "Impossible d'ajouter la dépense"),
  });

  // Dépense sans articles : PUT /:id (montant, participants, payeurs).
  // La route /items avec items: [] viderait la répartition.
  const editExpenseMutation = useMutation({
    mutationFn: (payload: any) => expensesApi.update(expenseId!, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['group', groupId] });
      qc.invalidateQueries({ queryKey: ['expense', expenseId] });
      Alert.alert('✓ Dépense mise à jour', '', [{ text: 'OK', onPress: () => router.back() }]);
    },
    onError: (e: any) =>
      Alert.alert('Erreur', e?.response?.data?.error || "Impossible de mettre à jour"),
  });

  const updateMutation = useMutation({
    // totalAmount : le total suit les prix corrigés, sinon les parts sont
    // recalculées sur l'ancien montant et la dépense passe "à compléter"
    mutationFn: ({ items, payments, desc, total, split }: { items: any[]; payments: any[]; desc: string; total: number; split?: any }) =>
      expensesApi.updateItems(expenseId!, { items, payments, description: desc, totalAmount: total, ...(split || {}) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['group', groupId] });
      qc.invalidateQueries({ queryKey: ['expense', expenseId] });
      Alert.alert('✓ Dépense mise à jour', '', [{ text: 'OK', onPress: () => router.back() }]);
    },
    onError: (e: any) =>
      Alert.alert('Erreur', e?.response?.data?.error || "Impossible de mettre à jour"),
  });

  // ── Montant total ─────────────────────────────────────────────────────
  const itemsTotal = useMemo(() => ocrItems.reduce((s, i) => s + i.price, 0), [ocrItems]);

  const totalAmount = useMemo(() => {
    if (ocrItems.length > 0) {
      const override = parseFloat(receiptTotal.replace(',', '.'));
      return receiptTotal.trim() !== '' && !isNaN(override) && override > 0 ? override : itemsTotal;
    }
    return parseFloat(amount.replace(',', '.')) || 0;
  }, [ocrItems, itemsTotal, receiptTotal, amount]);

  // Écart entre le total du ticket et la somme des articles = taxes, service,
  // arrondi de caisse. Il est réparti au prorata de ce que chacun a pris.
  const taxAmount = useMemo(
    () => Math.round(Math.max(0, totalAmount - itemsTotal) * 100) / 100,
    [totalAmount, itemsTotal],
  );

  // ── Splits ────────────────────────────────────────────────────────────
  const activeMemberIds = splitMemberIds.length > 0 ? splitMemberIds : members.map(m => m.id);

  const manualSplits = useMemo(() => {
    if (splitMode === 'equal') {
      const share = activeMemberIds.length > 0 ? totalAmount / activeMemberIds.length : 0;
      return activeMemberIds.map(id => ({ memberId: id, amount: share }));
    }
    return activeMemberIds.map(id => ({
      memberId: id,
      amount: parseFloat((customAmounts[id] || '0').replace(',', '.')) || 0,
    }));
  }, [splitMode, activeMemberIds, totalAmount, customAmounts]);

  const customTotal = useMemo(() =>
    manualSplits.reduce((s, r) => s + r.amount, 0), [manualSplits]);

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
    resolvedPayments.reduce((s, p) => s + p.amount, 0), [resolvedPayments]);

  const isPayerBalanced = totalAmount > 0 && Math.abs(payerTotal - totalAmount) < 0.02;

  // ── Items non assignés ────────────────────────────────────────────────
  const unassignedItems = ocrItems.filter(i => i.assignedTo.length === 0);

  // ── Helpers ───────────────────────────────────────────────────────────
  // Même méthode que le serveur, pour que l'aperçu corresponde au centime
  function distributeCents(totalCents: number, weights: number[]): number[] {
    const n = weights.length;
    if (n === 0) return [];
    const sum = weights.reduce((s, w) => s + w, 0);
    const eff = sum > 0 ? weights : weights.map(() => 1);
    const effSum = sum > 0 ? sum : n;
    const exact = eff.map(w => (totalCents * w) / effSum);
    const out = exact.map(v => Math.floor(v));
    const rest = totalCents - out.reduce((s, v) => s + v, 0);
    const order = exact
      .map((v, i) => ({ i, frac: v - Math.floor(v) }))
      .sort((a, b) => (b.frac - a.frac) || (a.i - b.i));
    for (let k = 0; k < rest; k++) out[order[k % n].i] += 1;
    return out;
  }

  // Parts egales exactes au centime — sert d'amorce a la saisie manuelle
  const equalShares = useMemo(() => {
    const cents = distributeCents(Math.round(totalAmount * 100), activeMemberIds.map(() => 1));
    return activeMemberIds.map((memberId, i) => ({ memberId, amount: cents[i] / 100 }));
  }, [totalAmount, activeMemberIds]);

  // Ce que chacun paiera réellement, taxes comprises
  const ocrShares = useMemo(() => {
    if (ocrItems.length === 0) return [] as { memberId: string; amount: number }[];
    const totalCents = Math.round(totalAmount * 100);

    if (ocrSplitMode === 'equal') {
      const ids = activeMemberIds;
      const cents = distributeCents(totalCents, ids.map(() => 1));
      return ids.map((memberId, i) => ({ memberId, amount: cents[i] / 100 }));
    }
    if (ocrSplitMode === 'custom') return manualSplits;

    const centsByMember: Record<string, number> = {};
    ocrItems.forEach(item => {
      if (item.assignedTo.length === 0) return;
      const parts = distributeCents(Math.round(item.price * 100), item.assignedTo.map(() => 1));
      item.assignedTo.forEach((id, i) => { centsByMember[id] = (centsByMember[id] || 0) + parts[i]; });
    });
    const ids = Object.keys(centsByMember);
    if (ids.length === 0) return [];
    let cents = ids.map(id => centsByMember[id]);
    const assigned = cents.reduce((sum, c) => sum + c, 0);
    const hasUnassigned = ocrItems.some(i => i.assignedTo.length === 0);
    if (!hasUnassigned && assigned !== totalCents) cents = distributeCents(totalCents, cents);
    return ids.map((memberId, i) => ({ memberId, amount: cents[i] / 100 }));
  }, [ocrItems, ocrSplitMode, totalAmount, activeMemberIds, manualSplits]);

  // Bascule vers la saisie manuelle : on part de la repartition affichee,
  // pas de zero.
  function switchSplitMode(mode: SplitMode, shares: { memberId: string; amount: number }[]) {
    if (mode === 'custom') {
      setCustomAmounts(prev => {
        const next = { ...prev };
        shares.forEach(({ memberId, amount }) => {
          if (!next[memberId] || next[memberId] === '0' || next[memberId] === '') {
            next[memberId] = amount.toFixed(2);
          }
        });
        return next;
      });
    }
    setSplitMode(mode);
  }

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

  // ── "Assigner les items restants" — créateur uniquement ───────────────
  function assignRemainingToMe() {
    if (!myMember) return;
    setOcrItems(prev =>
      prev.map(item =>
        item.assignedTo.length === 0
          ? { ...item, assignedTo: [myMember.id] }
          : item
      )
    );
  }

  // ── Transition vers who_paid ──────────────────────────────────────────
  // FIX: en mode OCR, on ne valide PAS la description ici — elle arrive au step summary
  function goToWhoPaid() {
    if (ocrItems.length > 0) {
      const assigned = ocrItems.some(i => i.assignedTo.length > 0);
      if (!assigned && !editMode) {
        Alert.alert('Articles non assignés', 'Assigne au moins un article à un membre avant de continuer.');
        return;
      }
    } else {
      // NOTE: la description n'est plus validée ici (pas ergonomique).
      // Elle est saisie/vérifiée au step "summary", après les payeurs — comme en mode OCR.
      if (totalAmount <= 0) { Alert.alert('Montant invalide'); return; }
      if (!isCustomBalanced) {
        Alert.alert(
          'Répartition incorrecte',
          `Total des parts (${customTotal.toFixed(2)}) ≠ montant (${fmt(totalAmount)}).`
        );
        return;
      }
    }
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
        `Total payeurs (${payerTotal.toFixed(2)}) ≠ total dépense (${fmt(totalAmount)}).`
      );
      return;
    }
    // En mode manuel la description est obligatoire — vérifiée ICI (au résumé),
    // plus au moment de passer aux payeurs.
    if (ocrItems.length === 0 && !description.trim()) {
      Alert.alert('Description manquante', 'Ajoute une courte description avant de confirmer.');
      return;
    }

    // MODE EDIT — dépense manuelle (sans articles)
    if (editMode && ocrItems.length === 0) {
      editExpenseMutation.mutate({
        description: description.trim() || undefined,
        totalAmount,
        payments: resolvedPayments,
        splitType: splitMode === 'custom' ? 'CUSTOM' : 'EQUAL',
        ...(splitMode === 'custom'
          ? { customSplits: manualSplits }
          : { splitMemberIds: activeMemberIds }),
      });
      return;
    }

    // MODE EDIT — ticket scanné
    if (editMode) {
      updateMutation.mutate({
        items: ocrItems.map(item => ({
          name: item.name,
          price: item.price,
          ocrRaw: item.ocrRaw,
          ocrConfidence: item.confidence,
          corrected: item.corrected,
          assignedToMemberIds: item.assignedTo,
        })),
        payments: resolvedPayments,
        desc: description.trim() || (existingExpense as any)?.description || 'Ticket scanné',
        total: totalAmount,
        // Un ticket scanné peut être réparti autrement que par articles
        split: ocrSplitMode === 'equal'
          ? { splitType: 'EQUAL', splitMemberIds: activeMemberIds }
          : ocrSplitMode === 'custom'
            ? { splitType: 'CUSTOM', customSplits: manualSplits }
            : { splitType: 'ITEMIZED' },
      });
      return;
    }

    // MODE CRÉATION
    if (ocrItems.length > 0) {
      createMutation.mutate({
        groupId,
        description: description.trim() || 'Ticket scanné',
        totalAmount,
        payments: resolvedPayments,
        ...(ocrSplitMode === 'equal'
          ? { splitType: 'EQUAL', splitMemberIds: activeMemberIds }
          : ocrSplitMode === 'custom'
            ? { splitType: 'CUSTOM', customSplits: manualSplits }
            : { splitType: 'ITEMIZED' }),
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
  // STEP: select (création seulement)
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
  // STEP: ocr — assignation des articles
  // ═══════════════════════════════════════════════════════════════════════
  if (step === 'ocr') {
    // En mode edit avec des items déjà chargés, on affiche directement l'interface d'assignation
    if (editMode && ocrItems.length > 0) {
      return (
        <View style={styles.screen}>
          <Header
            title={editMode ? 'Compléter la dépense' : 'Scanner un ticket'}
            onBack={() => editMode ? router.back() : setStep('select')}
            insets={insets}
          />
          <ScrollView contentContainerStyle={styles.scroll}>

            {/* Image du ticket si disponible */}
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

            {/* Badge items non assignés */}
            {unassignedItems.length > 0 && (
              <Notice
                variant="amber"
                text={`${unassignedItems.length} article${unassignedItems.length > 1 ? 's' : ''} sans assignation — assigne-les ou utilise le bouton ci-dessous.`}
              />
            )}

            {/* Bouton "Assigner à moi" pour le créateur ou si items non assignés */}
            {unassignedItems.length > 0 && myMember && (
              <TouchableOpacity style={styles.assignBtn} onPress={assignRemainingToMe} activeOpacity={0.8}>
                <Text style={styles.assignBtnText}>
                  📌 Assigner les {unassignedItems.length} articles non assignés à moi
                </Text>
              </TouchableOpacity>
            )}

            {/* Liste des items */}
            {/* Total réellement payé (TTC). Les lignes d'un ticket sont
                souvent HT : l'écart couvre taxes, service, arrondi. */}
            <SectionLabel label="TOTAL PAYÉ SUR LE TICKET" />
            <TextInput
              style={styles.receiptTotalInput}
              value={receiptTotal}
              onChangeText={setReceiptTotal}
              placeholder={itemsTotal.toFixed(2)}
              placeholderTextColor={colors.text3}
              keyboardType="decimal-pad"
              selectionColor={colors.accent}
            />
            <Card>
              <View style={styles.taxRow}>
                <Text style={styles.taxLabel}>Somme des articles</Text>
                <Text style={styles.taxValue}>{fmt(itemsTotal)}</Text>
              </View>
              <View style={styles.taxRow}>
                <Text style={[styles.taxLabel, taxAmount > 0 && { color: colors.amber }]}>Taxes / service</Text>
                <Text style={[styles.taxValue, taxAmount > 0 && { color: colors.amber }]}>
                  {taxAmount > 0 ? `+${taxAmount.toFixed(2)}` : '0.00'}
                </Text>
              </View>
              <View style={[styles.taxRow, styles.taxTotalRow]}>
                <Text style={styles.taxTotalLabel}>Total réparti</Text>
                <Text style={styles.taxTotalValue}>{fmt(totalAmount)}</Text>
              </View>
              {taxAmount > 0 && (
                <Text style={styles.taxHint}>
                  Les {taxAmount.toFixed(2)} de taxes et service sont répartis au prorata de ce que chacun a pris.
                </Text>
              )}
              {totalAmount < itemsTotal - 0.01 && (
                <Text style={[styles.taxHint, { color: colors.amber }]}>
                  ⚠ Le total saisi est inférieur à la somme des articles — vérifie le montant.
                </Text>
              )}
            </Card>

            <SectionLabel label="RÉPARTITION" />
            <View style={styles.modeRow}>
              {([['items', '🧾 Articles'], ['equal', '⚖️ Équitable'], ['custom', '✏️ Perso']] as const).map(([mode, label]) => (
                <TouchableOpacity
                  key={mode}
                  style={[styles.modeBtn, ocrSplitMode === mode && styles.modeBtnOn]}
                  onPress={() => {
                    // ocrShares tient encore la repartition du mode courant
                    if (mode === 'custom') switchSplitMode('custom', ocrShares);
                    setOcrSplitMode(mode);
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.modeBtnText, ocrSplitMode === mode && styles.modeBtnTextOn]}>{label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {ocrSplitMode === 'equal' && (
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
            )}

            {ocrSplitMode === 'custom' && (
              <Card>
                <Text style={styles.taxLabel}>Entre le montant pour chacun</Text>
                {activeMemberIds.map(id => {
                  const m = memberById(id);
                  if (!m) return null;
                  return (
                    <View key={id} style={styles.shareRow}>
                      <Avatar initials={m.avatarInitials} color={m.avatarColor} size={26} />
                      <Text style={styles.shareName}>{m.displayName}</Text>
                      <TextInput
                        style={styles.shareInput}
                        value={customAmounts[id] || ''}
                        onChangeText={v => setCustomAmounts(prev => ({ ...prev, [id]: v }))}
                        placeholder="0.00"
                        placeholderTextColor={colors.text3}
                        keyboardType="decimal-pad"
                        selectionColor={colors.accent}
                      />
                    </View>
                  );
                })}
                <Text style={[styles.taxHint, { textAlign: 'right', color: isCustomBalanced ? colors.green : colors.amber }]}>
                  {customTotal.toFixed(2)} / {totalAmount.toFixed(2)}{isCustomBalanced ? ' ✓' : ''}
                </Text>
              </Card>
            )}

            {/* Ce que chacun paiera réellement — taxes comprises */}
            {ocrShares.length > 0 && (
              <Card>
                <Text style={styles.taxLabel}>Chaque personne paie</Text>
                {ocrShares.map(({ memberId, amount }) => {
                  const m = memberById(memberId);
                  if (!m) return null;
                  return (
                    <View key={memberId} style={styles.shareRow}>
                      <Avatar initials={m.avatarInitials} color={m.avatarColor} size={26} />
                      <Text style={styles.shareName}>{m.displayName}</Text>
                      <Text style={styles.shareAmount}>{fmt(amount)}</Text>
                    </View>
                  );
                })}
                {ocrSplitMode === 'items' && unassignedItems.length > 0 && (
                  <Text style={[styles.taxHint, { color: colors.amber }]}>
                    {unassignedItems.length} article(s) non assigné(s) : leur montant n'est encore attribué à personne.
                  </Text>
                )}
              </Card>
            )}

            <SectionLabel label="ARTICLES" />
            {ocrItems.map((item, idx) => (
              <View key={item.id} style={styles.itemCard}>
                <View style={styles.itemHeader}>
                  {item.editing ? (
                    <>
                      <TextInput
                        style={styles.itemEditName}
                        value={item.editName}
                        onChangeText={v => setOcrItems(prev => prev.map((it, i) => i === idx ? { ...it, editName: v } : it))}
                        placeholder="Nom de l'article"
                        placeholderTextColor={colors.text3}
                        autoFocus
                        selectionColor={colors.accent}
                      />
                      <TextInput
                        style={styles.itemEditPrice}
                        value={item.editPrice}
                        onChangeText={v => setOcrItems(prev => prev.map((it, i) => i === idx ? { ...it, editPrice: v } : it))}
                        placeholder="0.00"
                        placeholderTextColor={colors.text3}
                        keyboardType="decimal-pad"
                        selectionColor={colors.accent}
                      />
                      <TouchableOpacity onPress={() => saveEditOcrItem(idx)} style={styles.itemOkBtn}>
                        <Text style={styles.itemOkText}>OK</Text>
                      </TouchableOpacity>
                    </>
                  ) : (
                    <>
                      <Text style={styles.itemName}>{item.name}</Text>
                      {/* Qui a coché cet article — visible d'un coup d'œil */}
                      {item.assignedTo.length > 0 && (
                        <View style={styles.itemAvatars}>
                          {item.assignedTo.slice(0, 4).map(id => {
                            const m = memberById(id);
                            return m ? (
                              <View key={id} style={styles.itemAvatar}>
                                <Avatar initials={m.avatarInitials} color={m.avatarColor} size={20} />
                              </View>
                            ) : null;
                          })}
                        </View>
                      )}
                      <Text style={styles.itemPrice}>{fmt(item.price)}</Text>
                      <TouchableOpacity
                        onPress={() => startEditOcrItem(idx)}
                        style={styles.itemEditBtn}
                        hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
                      >
                        <Text style={styles.itemRemoveText}>✏️</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => removeOcrItem(idx)}
                        style={styles.itemRemoveBtn}
                        hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }}
                      >
                        <Text style={styles.itemRemoveText}>🗑</Text>
                      </TouchableOpacity>
                    </>
                  )}
                </View>
                <Text style={styles.itemLabel}>Qui a pris cet article ?</Text>
                <View style={styles.chipWrap}>
                  {members.map(m => (
                    <Chip
                      key={m.id}
                      label={m.displayName}
                      selected={item.assignedTo.includes(m.id)}
                      onPress={() => {
                        setOcrItems(prev => prev.map((it, i) => {
                          if (i !== idx) return it;
                          const already = it.assignedTo.includes(m.id);
                          return {
                            ...it,
                            assignedTo: already
                              ? it.assignedTo.filter(id => id !== m.id)
                              : [...it.assignedTo, m.id],
                          };
                        }));
                      }}
                      avatar={{ initials: m.avatarInitials, color: m.avatarColor }}
                    />
                  ))}
                </View>
                {item.assignedTo.length === 0 && (
                  <Text style={styles.itemUnassigned}>⚠ Non assigné</Text>
                )}
                {item.assignedTo.length > 0 && (
                  <Text style={styles.itemAssigned}>
                    ✓ {item.assignedTo.map(id => memberById(id)?.displayName).filter(Boolean).join(', ')}
                  </Text>
                )}
              </View>
            ))}

            <TouchableOpacity onPress={addOcrItem} style={styles.addItemBtn} activeOpacity={0.8}>
              <Text style={styles.addItemText}>+ Ajouter un article</Text>
            </TouchableOpacity>

            <Button
              label="Continuer → Qui a payé ?"
              onPress={goToWhoPaid}
              style={{ marginTop: 8, marginBottom: Math.max(insets.bottom, 16) }}
            />
          </ScrollView>
        </View>
      );
    }

    // Mode création : scanner un nouveau ticket
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
        <Header title="Saisie manuelle" onBack={() => editMode ? router.back() : setStep('select')} insets={insets} />
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
              onPress={() => switchSplitMode('custom', equalShares)}
            >
              <Text style={[styles.splitModeBtnText, splitMode === 'custom' && { color: colors.accent2 }]}>
                ✏️ Personnalisé
              </Text>
            </TouchableOpacity>
          </View>

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
                    <Text style={styles.splitAmt}>{fmt(amt)}</Text>
                  </View>
                );
              })}
            </Card>
          )}

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
                    <Text style={styles.customCurrency}>{cur}</Text>
                  </View>
                );
              })}
              <View style={styles.customTotalRow}>
                <Text style={styles.customTotalLabel}>Total saisi</Text>
                <Text style={[
                  styles.customTotalAmt,
                  totalAmount > 0 && !isCustomBalanced ? { color: colors.red } : { color: colors.green },
                ]}>
                  {fmt(customTotal)} / {fmt(totalAmount)}
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

          <Card style={{ marginBottom: 12 }}>
            <Text style={styles.contextTitle}>
              {ocrItems.length > 0 ? 'Ticket scanné' : description}
            </Text>
            <Text style={styles.contextTotal}>
              Total : {fmt(totalAmount)}
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
                  <Text style={styles.payerAmountCurrency}>{cur}</Text>
                  {payers.length > 1 && (
                    <TouchableOpacity onPress={() => removePayer(idx)} style={styles.removePayerBtn}>
                      <Text style={styles.removePayerText}>✕ Retirer</Text>
                    </TouchableOpacity>
                  )}
                </View>

                {payers.length > 1 && reste > 0.01 && (
                  <TouchableOpacity
                    style={styles.shortcutBtn}
                    onPress={() => setPayerAmount(idx, reste.toFixed(2))}
                  >
                    <Text style={styles.shortcutText}>
                      Payer le reste ({fmt(reste)})
                    </Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })}

          <View style={[styles.balanceBar, isPayerBalanced ? styles.balanceBarOk : styles.balanceBarWarn]}>
            <Text style={[styles.balanceBarText, { color: isPayerBalanced ? colors.green : colors.amber }]}>
              {isPayerBalanced
                ? `✓ Équilibré — ${fmt(payerTotal)}`
                : `${fmt(payerTotal)} / ${fmt(totalAmount)}`}
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
                  `Total payeurs (${payerTotal.toFixed(2)}) ≠ total dépense (${fmt(totalAmount)}).`
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

        {/* Description — toujours visible au summary, OCR ou manuel */}
        <Input
          label={ocrItems.length > 0 ? 'Description (optionnel)' : 'Description'}
          placeholder="Ticket La Stanza, dîner, courses…"
          value={description}
          onChangeText={setDescription}
        />

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
                <Text style={[styles.splitAmt, { color: colors.accent2 }]}>{fmt(p.amount)}</Text>
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
                  <Text style={styles.splitAmt}>{fmt(amt as number)}</Text>
                </View>
              );
            })}
            {unassignedItems.length > 0 && (
              <View style={styles.unassignedBanner}>
                <Text style={styles.unassignedBannerText}>
                  ⏳ {unassignedItems.length} article{unassignedItems.length > 1 ? 's' : ''} non assigné{unassignedItems.length > 1 ? 's' : ''} — la dépense sera marquée "à compléter"
                </Text>
              </View>
            )}
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total scanné</Text>
              <Text style={styles.totalAmt}>{fmt(totalAmount)}</Text>
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
                  <Text style={styles.splitAmt}>{fmt(amt)}</Text>
                </View>
              );
            })}
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Total</Text>
              <Text style={styles.totalAmt}>{fmt(totalAmount)}</Text>
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

        <Button
          label={editMode ? '✓ Mettre à jour la dépense' : 'Confirmer la dépense →'}
          onPress={handleSubmit}
          loading={createMutation.isPending || updateMutation.isPending || editExpenseMutation.isPending}
          style={{ marginTop: 4, marginBottom: Math.max(insets.bottom, 16) }}
        />
        <Button label="← Modifier les payeurs" onPress={() => setStep('who_paid')} variant="ghost" />
      </ScrollView>
    </View>
  );
}

// ── Header ─────────────────────────────────────────────────────────────────

function Header({ title, onBack, insets }: {
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

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingBottom: 10,
    borderBottomWidth: 0.5, borderBottomColor: colors.border,
  },
  backBtn: {
    backgroundColor: colors.surface2, borderWidth: 0.5, borderColor: colors.border,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.full, minWidth: 70,
  },
  backText: { color: colors.text2, fontFamily: fonts.medium, fontSize: 12, fontWeight: '500' },
  title: { fontFamily: fonts.semibold, fontSize: 15, fontWeight: '600', color: colors.text, flex: 1, textAlign: 'center', marginHorizontal: 8 },
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: 80, paddingTop: 16 },

  fieldLabel: { fontFamily: fonts.medium, fontSize: 11, fontWeight: '500', color: colors.text3, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8, marginTop: 4 },
  hint: { fontFamily: fonts.regular, fontSize: 11, color: colors.text3, marginBottom: 8, marginTop: -4 },

  modeGrid: { flexDirection: 'row', gap: 10, marginTop: 8 },
  modeCard: { flex: 1, backgroundColor: colors.surface, borderWidth: 0.5, borderColor: colors.border, borderRadius: radius.md, padding: 20, alignItems: 'center' },
  modeCardFeat: { backgroundColor: colors.accent, borderColor: colors.accent },
  modeIcon: { fontFamily: fonts.regular, fontSize: 28, marginBottom: 8 },
  modeLabel: { fontFamily: fonts.semibold, fontSize: 13, fontWeight: '600', color: colors.text },
  modeSub: { fontFamily: fonts.regular, fontSize: 11, color: colors.text3, marginTop: 2 },

  // Items OCR
  itemCard: { backgroundColor: colors.surface, borderWidth: 0.5, borderColor: colors.border, borderRadius: radius.md, padding: 14, marginBottom: 10 },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  itemName: { fontFamily: fonts.semibold, fontSize: 14, fontWeight: '600', color: colors.text, flex: 1 },
  itemPrice: { fontSize: 14, fontFamily: fonts.mono, color: colors.accent2, fontWeight: '600' },
  itemAvatars: { flexDirection: 'row', marginRight: 8 },
  itemAvatar: { marginLeft: -6, borderWidth: 2, borderColor: colors.surface, borderRadius: 12 },
  itemRemoveBtn: {
    marginLeft: 10,
    backgroundColor: 'rgba(248,113,113,0.10)',
    borderWidth: 1, borderColor: 'rgba(248,113,113,0.25)',
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
  },
  itemRemoveText: { fontFamily: fonts.regular, fontSize: 12 },
  itemEditBtn: { marginLeft: 8, paddingHorizontal: 6, paddingVertical: 4 },
  itemEditName: {
    flex: 1, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.accent,
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, color: colors.text, fontFamily: fonts.regular, fontSize: 13,
  },
  itemEditPrice: {
    width: 74, marginLeft: 6, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.accent,
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6, color: colors.text,
    fontSize: 13, fontFamily: fonts.mono, textAlign: 'right',
  },
  itemOkBtn: {
    marginLeft: 6, backgroundColor: colors.accentBg, borderWidth: 1,
    borderColor: 'rgba(124,110,250,0.3)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
  },
  itemOkText: { fontFamily: fonts.semibold, fontSize: 12, fontWeight: '600', color: colors.accent2 },
  addItemBtn: {
    borderWidth: 1.5, borderColor: colors.border2, borderStyle: 'dashed',
    borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', marginTop: 4,
  },
  addItemText: { fontFamily: fonts.semibold, fontSize: 14, fontWeight: '600', color: colors.accent2 },
  receiptTotalInput: {
    backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12,
    color: colors.text, fontSize: 18, fontFamily: fonts.mono, marginBottom: 10,
  },
  taxRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 3 },
  taxLabel: { fontFamily: fonts.regular, fontSize: 12, color: colors.text3 },
  taxValue: { fontSize: 12, fontFamily: fonts.mono, color: colors.text2 },
  taxTotalRow: { borderTopWidth: 0.5, borderTopColor: colors.border, marginTop: 4, paddingTop: 7 },
  taxTotalLabel: { fontFamily: fonts.semibold, fontSize: 13, fontWeight: '600', color: colors.text },
  taxTotalValue: { fontSize: 13, fontWeight: '600', fontFamily: fonts.mono, color: colors.accent2 },
  taxHint: { fontFamily: fonts.regular, fontSize: 11, color: colors.text3, lineHeight: 16, marginTop: 8 },
  modeRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  modeBtn: {
    flex: 1, paddingVertical: 10, borderRadius: radius.md, alignItems: 'center',
    backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border,
  },
  modeBtnOn: { borderColor: colors.accent, backgroundColor: colors.accentBg },
  modeBtnText: { fontFamily: fonts.semibold, fontSize: 12, fontWeight: '600', color: colors.text3 },
  modeBtnTextOn: { color: colors.accent2 },
  shareRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  shareName: { flex: 1, fontFamily: fonts.regular, fontSize: 13, color: colors.text },
  shareAmount: { fontSize: 13, fontFamily: fonts.mono, color: colors.accent2 },
  shareInput: {
    width: 92, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border,
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 6,
    color: colors.text, fontSize: 13, fontFamily: fonts.mono, textAlign: 'right',
  },
  itemLabel: { fontFamily: fonts.regular, fontSize: 11, color: colors.text3, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  itemUnassigned: { fontFamily: fonts.regular, fontSize: 11, color: colors.amber, marginTop: 6 },
  itemAssigned: { fontFamily: fonts.regular, fontSize: 11, color: colors.green, marginTop: 6 },

  // Assign button
  assignBtn: {
    backgroundColor: colors.accentBg, borderWidth: 1, borderColor: 'rgba(124,110,250,0.3)',
    borderRadius: radius.sm, padding: 12, marginBottom: 12, alignItems: 'center',
  },
  assignBtnText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.accent2, fontWeight: '600' },

  // Unassigned banner in summary
  unassignedBanner: { backgroundColor: 'rgba(251,191,36,0.08)', borderRadius: radius.sm, padding: 10, marginTop: 8 },
  unassignedBannerText: { fontFamily: fonts.medium, fontSize: 11, color: colors.amber, fontWeight: '500' },

  splitModeRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  splitModeBtn: { flex: 1, paddingVertical: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, alignItems: 'center', backgroundColor: colors.surface },
  splitModeBtnOn: { borderColor: colors.accent, backgroundColor: colors.accentBg },
  splitModeBtnText: { fontFamily: fonts.medium, fontSize: 13, fontWeight: '500', color: colors.text2 },

  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 },

  previewTitle: { fontFamily: fonts.medium, fontSize: 12, color: colors.text3, marginBottom: 10, fontWeight: '500' },
  splitRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: colors.border },
  splitName: { flex: 1, fontFamily: fonts.regular, fontSize: 13, color: colors.text },
  splitAmt: { fontSize: 13, fontFamily: fonts.mono, fontWeight: '500', color: colors.amber },

  customRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  customInput: { borderWidth: 0.5, borderColor: colors.accent, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 6, color: colors.text, fontFamily: fonts.mono, fontSize: 14, width: 80, textAlign: 'right' },
  customCurrency: { fontFamily: fonts.regular, fontSize: 12, color: colors.text3, width: 28 },
  customTotalRow: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 0.5, borderTopColor: colors.border2, marginTop: 8, paddingTop: 10 },
  customTotalLabel: { fontFamily: fonts.regular, fontSize: 12, color: colors.text3 },
  customTotalAmt: { fontSize: 13, fontFamily: fonts.mono, fontWeight: '600' },

  totalRow: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 0.5, borderTopColor: colors.border2, marginTop: 6, paddingTop: 8 },
  totalLabel: { fontFamily: fonts.regular, fontSize: 12, color: colors.text3 },
  totalAmt: { fontSize: 13, fontFamily: fonts.mono, fontWeight: '500', color: colors.text },

  contextTitle: { fontFamily: fonts.semibold, fontSize: 14, fontWeight: '600', color: colors.text, marginBottom: 4 },
  contextTotal: { fontSize: 20, fontFamily: fonts.mono, fontWeight: '300', color: colors.accent2 },
  contextSub: { fontFamily: fonts.regular, fontSize: 11, color: colors.text3, marginTop: 4 },

  payerLabelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, marginTop: 4 },
  addPayerBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full, borderWidth: 1, borderColor: colors.accent },
  addPayerText: { fontFamily: fonts.semibold, fontSize: 11, color: colors.accent2, fontWeight: '600' },
  payerCard: { backgroundColor: colors.surface, borderWidth: 0.5, borderColor: colors.border, borderRadius: radius.md, padding: 14, marginBottom: 10 },
  payerCardLabel: { fontFamily: fonts.medium, fontSize: 10, color: colors.text3, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 },
  payerChipList: { flexDirection: 'row', gap: 8, paddingVertical: 2 },
  payerChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.full, borderWidth: 1.5, borderColor: colors.border },
  payerChipOn: { borderColor: colors.accent, backgroundColor: colors.accentBg },
  payerChipText: { fontFamily: fonts.medium, fontSize: 12, fontWeight: '500', color: colors.text2 },
  payerAmountRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  payerAmountInput: { borderWidth: 0.5, borderColor: colors.accent, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 8, color: colors.text, fontFamily: fonts.mono, fontSize: 18, width: 110, textAlign: 'right' },
  payerAmountCurrency: { fontFamily: fonts.regular, fontSize: 13, color: colors.text3 },
  removePayerBtn: { marginLeft: 'auto', paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.sm, borderWidth: 0.5, borderColor: colors.border2 },
  removePayerText: { fontFamily: fonts.regular, fontSize: 11, color: colors.text3 },
  shortcutBtn: { marginTop: 8, paddingVertical: 6, paddingHorizontal: 10, borderRadius: radius.sm, backgroundColor: colors.accentBg, alignSelf: 'flex-start' },
  shortcutText: { fontFamily: fonts.medium, fontSize: 11, color: colors.accent2, fontWeight: '500' },

  balanceBar: { borderRadius: radius.sm, padding: 10, marginBottom: 12, marginTop: 4 },
  balanceBarOk: { backgroundColor: 'rgba(52,211,153,0.08)' },
  balanceBarWarn: { backgroundColor: 'rgba(251,191,36,0.08)' },
  balanceBarText: { fontSize: 13, fontFamily: fonts.mono, fontWeight: '500', textAlign: 'center' },

  receiptImageBlock: { marginBottom: 12 },
  receiptImageBtn: { backgroundColor: colors.surface2, borderWidth: 0.5, borderColor: colors.border, borderRadius: radius.sm, padding: 12, alignItems: 'center' },
  receiptImageBtnText: { fontFamily: fonts.medium, fontSize: 13, color: colors.accent2, fontWeight: '500' },
  receiptImage: { width: '100%', height: 300, borderRadius: radius.sm, marginTop: 8, backgroundColor: colors.surface3 },
});
