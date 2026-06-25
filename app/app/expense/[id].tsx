// app/app/expense/[id].tsx
// Ajouts vs original :
//   - Dupliquer la dépense (bouton dans le détail)
//   - Commentaire/note (champ texte sauvegardé en DB, visible ici)
//   - Safe area insets pour le header

import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Alert, Image, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { expensesApi, groupsApi } from '../../src/services/api';
import { Card, SectionLabel, Divider, Avatar, Button, Chip, AmountInput } from '../../src/components/ui';
import { colors, spacing, radius } from '../../src/theme';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useAuthStore } from '../../src/store/authStore';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function ExpenseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const user = useAuthStore(s => s.user);
  const insets = useSafeAreaInsets();

  const [editing, setEditing] = useState(false);
  const [showPhoto, setShowPhoto] = useState(false);

  // Note/commentaire
  const [noteText, setNoteText] = useState('');
  const [editingNote, setEditingNote] = useState(false);

  // Edit state
  const [editDesc, setEditDesc] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editPaidBy, setEditPaidBy] = useState('');
  const [editSplitIds, setEditSplitIds] = useState<string[]>([]);

  const { data: expense, isLoading } = useQuery<any>({
    queryKey: ['expense', id],
    queryFn: () => expensesApi.get(id),
    enabled: !!id,
  });

  const { data: group } = useQuery<any>({
    queryKey: ['group', expense?.groupId],
    queryFn: () => groupsApi.get(expense!.groupId),
    enabled: !!expense?.groupId,
  });

  const deleteMutation = useMutation({
    mutationFn: () => expensesApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['group'] });
      router.back();
    },
  });

  const updateMutation = useMutation({
    mutationFn: (payload: any) => expensesApi.update(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expense', id] });
      qc.invalidateQueries({ queryKey: ['group', expense?.groupId] });
      setEditing(false);
    },
    onError: (e: any) => Alert.alert('Erreur', e?.response?.data?.error || 'Modification impossible'),
  });

  // Sauvegarde de la note
  // Init noteText quand la dépense est chargée
  React.useEffect(() => {
    if (expense?.note !== undefined) setNoteText(expense.note || '');
  }, [expense?.note]);

  const noteMutation = useMutation({
    mutationFn: (note: string) => expensesApi.update(id, { note }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['expense', id] });
      setEditingNote(false);
    },
    onError: () => Alert.alert('Erreur', 'Impossible de sauvegarder la note.'),
  });

  // Duplication de la dépense
  const duplicateMutation = useMutation({
    mutationFn: () => expensesApi.duplicate(id),
    onSuccess: (newExpense: any) => {
      qc.invalidateQueries({ queryKey: ['group', expense?.groupId] });
      Alert.alert(
        '✓ Dépense dupliquée',
        'Une copie a été créée dans ce groupe.',
        [
          { text: 'Voir la copie', onPress: () => router.replace(`/expense/${newExpense.id}`) },
          { text: 'Rester ici', style: 'cancel' },
        ]
      );
    },
    onError: () => Alert.alert('Erreur', 'Impossible de dupliquer la dépense.'),
  });

  function startEditing() {
    if (!expense) return;
    setEditDesc(expense.description);
    setEditAmount(expense.totalAmount.toFixed(2));
    setEditPaidBy(expense.paidByMemberId);
    setEditSplitIds(expense.splits.map((s: any) => s.memberId));
    setEditing(true);
  }

  function saveEdit() {
    const total = parseFloat(editAmount.replace(',', '.'));
    if (!editDesc.trim() || isNaN(total) || total <= 0) {
      Alert.alert('Données invalides');
      return;
    }
    const memberIds = editSplitIds.length > 0 ? editSplitIds : group?.members.map((m: any) => m.id) || [];
    updateMutation.mutate({
      description: editDesc.trim(),
      totalAmount: total,
      paidByMemberId: editPaidBy,
      splitType: 'EQUAL',
      splitMemberIds: memberIds,
    });
  }

  function confirmDelete() {
    Alert.alert('Supprimer la dépense ?', 'Cette action est irréversible.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: () => deleteMutation.mutate() },
    ]);
  }

  function confirmDuplicate() {
    Alert.alert(
      'Dupliquer cette dépense ?',
      `Une copie de "${expense?.description}" sera créée dans ce groupe.`,
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Dupliquer', onPress: () => duplicateMutation.mutate() },
      ]
    );
  }

  if (isLoading || !expense) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  const members = group?.members || [];
  const myMember = members.find((m: any) => m.userId === user?.id);
  const mySplit = expense.splits.find((s: any) => s.memberId === myMember?.id);
  const headerPaddingTop = Math.max(insets.top, 16) + 6;

  // ── Edit mode ────────────────────────────────────────────────────────
  if (editing) {
    return (
      <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={[styles.header, { paddingTop: headerPaddingTop }]}>
          <TouchableOpacity onPress={() => setEditing(false)} style={styles.backBtn}>
            <Text style={styles.backText}>← Annuler</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Modifier</Text>
          <TouchableOpacity onPress={saveEdit} style={styles.saveBtn}>
            <Text style={styles.saveBtnText}>{updateMutation.isPending ? '…' : 'Sauver'}</Text>
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>DESCRIPTION</Text>
          <TextInput
            style={styles.textInput}
            value={editDesc}
            onChangeText={setEditDesc}
            placeholder="Description"
            placeholderTextColor={colors.text3}
          />
          <Text style={styles.label}>MONTANT TOTAL</Text>
          <AmountInput value={editAmount} onChangeText={setEditAmount} />
          <Text style={styles.label}>PAYÉ PAR</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {members.map((m: any) => (
                <TouchableOpacity
                  key={m.id}
                  style={[styles.payerChip, editPaidBy === m.id && styles.payerChipOn]}
                  onPress={() => setEditPaidBy(m.id)}
                >
                  <Avatar initials={m.avatarInitials} color={m.avatarColor} size={20} />
                  <Text style={[styles.payerChipText, editPaidBy === m.id && { color: colors.accent2 }]}>
                    {m.displayName}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
          <Text style={styles.label}>PARTAGER AVEC</Text>
          <View style={styles.chipWrap}>
            {members.map((m: any) => (
              <Chip
                key={m.id}
                label={m.displayName}
                selected={editSplitIds.includes(m.id)}
                onPress={() => setEditSplitIds(prev =>
                  prev.includes(m.id) ? prev.filter(x => x !== m.id) : [...prev, m.id]
                )}
                avatar={{ initials: m.avatarInitials, color: m.avatarColor }}
              />
            ))}
          </View>
          <Text style={styles.hint}>Aucune sélection = tout le monde</Text>
          <Button label="Sauvegarder" onPress={saveEdit} loading={updateMutation.isPending} />
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // ── View mode ────────────────────────────────────────────────────────
  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: headerPaddingTop }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={styles.backText}>← Retour</Text>
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>{expense.description}</Text>
        <TouchableOpacity onPress={startEditing} style={styles.editBtn}>
          <Text style={styles.editBtnText}>Modifier</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Receipt photo */}
        {expense.receiptImageUrl && (
          <View style={styles.photoBlock}>
            <TouchableOpacity style={styles.photoBtn} onPress={() => setShowPhoto(v => !v)}>
              <Text style={styles.photoBtnText}>
                {showPhoto ? '🙈 Masquer le ticket' : '🧾 Voir le ticket scanné'}
              </Text>
            </TouchableOpacity>
            {showPhoto && (
              <Image source={{ uri: expense.receiptImageUrl }} style={styles.photo} resizeMode="contain" />
            )}
          </View>
        )}

        {/* Meta */}
        <Card>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Date</Text>
            <Text style={styles.metaValue}>
              {format(new Date(expense.createdAt), 'dd MMM yyyy', { locale: fr })}
            </Text>
          </View>
          <Divider />
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Payé par</Text>
            <View>
              {(expense.payments && expense.payments.length > 0 ? expense.payments : []).map((p: any) => (
                <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <Avatar initials={p.member.avatarInitials} color={p.member.avatarColor} size={22} />
                  <Text style={styles.metaValue}>{p.member.displayName}</Text>
                  {expense.payments.length > 1 && (
                    <Text style={{ fontSize: 11, color: colors.text3, fontFamily: 'monospace' }}>
                      {' '}({p.amount.toFixed(2)} CHF)
                    </Text>
                  )}
                </View>
              ))}
            </View>
          </View>
          <Divider />
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Total</Text>
            <Text style={[styles.metaValue, { fontFamily: 'monospace', fontSize: 20 }]}>
              {expense.totalAmount.toFixed(2)} CHF
            </Text>
          </View>
          {mySplit && (
            <>
              <Divider />
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Ma part</Text>
                <Text style={[styles.metaValue, { fontFamily: 'monospace', fontSize: 16, color: colors.accent2 }]}>
                  {mySplit.amount.toFixed(2)} CHF{mySplit.settled ? '  ✓ réglé' : ''}
                </Text>
              </View>
            </>
          )}
        </Card>

        {/* Note / Commentaire */}
        <SectionLabel label="Note" />
        <Card>
          {editingNote ? (
            <View>
              <TextInput
                style={styles.noteInput}
                value={noteText}
                onChangeText={setNoteText}
                placeholder="Ajouter une note ou un commentaire…"
                placeholderTextColor={colors.text3}
                multiline
                numberOfLines={4}
                autoFocus
              />
              <View style={styles.noteActions}>
                <TouchableOpacity onPress={() => setEditingNote(false)} style={styles.noteCancelBtn}>
                  <Text style={styles.noteCancelText}>Annuler</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => noteMutation.mutate(noteText)}
                  style={styles.noteSaveBtn}
                  disabled={noteMutation.isPending}
                >
                  <Text style={styles.noteSaveText}>
                    {noteMutation.isPending ? '…' : 'Sauver'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <TouchableOpacity onPress={() => setEditingNote(true)} activeOpacity={0.7}>
              {expense.note ? (
                <Text style={styles.noteText}>{expense.note}</Text>
              ) : (
                <Text style={styles.notePlaceholder}>Appuie pour ajouter une note…</Text>
              )}
            </TouchableOpacity>
          )}
        </Card>

        {/* Items (OCR) */}
        {expense.items.length > 0 && (
          <>
            <SectionLabel label="Articles" />
            <Card>
              {expense.items.map((item: any, i: number) => (
                <React.Fragment key={item.id}>
                  <View style={styles.itemRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.itemName}>{item.name}</Text>
                      {item.assignedTo.length > 0 && (
                        <Text style={styles.itemAssigned}>
                          {item.assignedTo.map((a: any) => a.member.displayName).join(', ')}
                        </Text>
                      )}
                    </View>
                    <Text style={styles.itemPrice}>{item.price.toFixed(2)} CHF</Text>
                  </View>
                  {i < expense.items.length - 1 && <Divider />}
                </React.Fragment>
              ))}
            </Card>
          </>
        )}

        {/* Splits */}
        <SectionLabel label="Répartition" />
        <Card>
          {expense.splits.map((split: any, i: number) => (
            <React.Fragment key={split.id}>
              <View style={styles.splitRow}>
                <Avatar initials={split.member.avatarInitials} color={split.member.avatarColor} size={28} />
                <Text style={styles.splitName}>{split.member.displayName}</Text>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[styles.splitAmt, split.settled && { color: colors.green }]}>
                    {split.amount.toFixed(2)} CHF
                  </Text>
                  {split.settled && <Text style={styles.settledTag}>✓ réglé</Text>}
                </View>
              </View>
              {i < expense.splits.length - 1 && <Divider />}
            </React.Fragment>
          ))}
        </Card>

        {/* Actions */}
        <Button
          label="Dupliquer cette dépense"
          onPress={confirmDuplicate}
          variant="ghost"
          style={{ marginTop: 12 }}
          loading={duplicateMutation.isPending}
        />
        <Button
          label="Supprimer la dépense"
          onPress={confirmDelete}
          variant="danger"
          style={{ marginTop: 8, marginBottom: 20 }}
          loading={deleteMutation.isPending}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing.lg, paddingBottom: 8,
  },
  backBtn: {
    backgroundColor: colors.surface2, borderWidth: 0.5, borderColor: colors.border,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.full,
  },
  backText: { color: colors.text2, fontSize: 12, fontWeight: '500' },
  title: { fontSize: 15, fontWeight: '600', color: colors.text, flex: 1, textAlign: 'center', marginHorizontal: 8 },
  editBtn: {
    backgroundColor: colors.accentBg, borderWidth: 0.5, borderColor: 'rgba(124,110,250,0.3)',
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.full,
  },
  editBtnText: { color: colors.accent2, fontSize: 12, fontWeight: '600' },
  saveBtn: { backgroundColor: colors.accent, paddingHorizontal: 14, paddingVertical: 6, borderRadius: radius.full },
  saveBtnText: { color: colors.white, fontSize: 12, fontWeight: '600' },
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: 80 },
  photoBlock: { marginBottom: 12 },
  photoBtn: {
    backgroundColor: colors.surface2, borderWidth: 0.5, borderColor: colors.border,
    borderRadius: radius.sm, padding: 12, alignItems: 'center', marginBottom: 2,
  },
  photoBtnText: { fontSize: 13, color: colors.accent2, fontWeight: '500' },
  photo: { width: '100%', height: 320, borderRadius: radius.sm, backgroundColor: colors.surface3, marginTop: 6 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 },
  metaLabel: { fontSize: 13, color: colors.text3 },
  metaValue: { fontSize: 13, color: colors.text, fontWeight: '500' },
  // Note
  noteInput: {
    backgroundColor: colors.surface2, borderRadius: radius.sm, padding: 12,
    color: colors.text, fontSize: 14, minHeight: 80, textAlignVertical: 'top',
  },
  noteActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 10 },
  noteCancelBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.full, borderWidth: 0.5, borderColor: colors.border },
  noteCancelText: { fontSize: 13, color: colors.text3 },
  noteSaveBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.full, backgroundColor: colors.accent },
  noteSaveText: { fontSize: 13, color: colors.white, fontWeight: '600' },
  noteText: { fontSize: 14, color: colors.text, lineHeight: 20 },
  notePlaceholder: { fontSize: 13, color: colors.text3, fontStyle: 'italic' },
  // Items
  itemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  itemName: { fontSize: 13, fontWeight: '500', color: colors.text },
  itemAssigned: { fontSize: 11, color: colors.text3, marginTop: 2 },
  itemPrice: { fontSize: 13, fontFamily: 'monospace', color: colors.text2 },
  // Splits
  splitRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  splitName: { flex: 1, fontSize: 14, color: colors.text },
  splitAmt: { fontSize: 14, fontFamily: 'monospace', color: colors.amber, fontWeight: '500' },
  settledTag: { fontSize: 10, color: colors.green, marginTop: 2 },
  // Edit
  label: { fontSize: 11, fontWeight: '500', color: colors.text3, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8, marginTop: 4 },
  hint: { fontSize: 11, color: colors.text3, marginBottom: 12, marginTop: -4 },
  textInput: {
    backgroundColor: colors.surface2, borderWidth: 0.5, borderColor: colors.border,
    borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 11,
    fontSize: 14, color: colors.text, marginBottom: 12,
  },
  payerChip: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: radius.full, borderWidth: 1.5, borderColor: colors.border,
  },
  payerChipOn: { borderColor: colors.accent, backgroundColor: colors.accentBg },
  payerChipText: { fontSize: 13, fontWeight: '500', color: colors.text2 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap' },
});