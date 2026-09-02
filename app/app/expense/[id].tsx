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
import { colors, spacing, radius, fonts } from '../../src/theme';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { useAuthStore } from '../../src/store/authStore';
import { useFormatMoney } from '../../src/store/langStore';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function ExpenseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const user = useAuthStore(s => s.user);
  const insets = useSafeAreaInsets();
  const fmt = useFormatMoney();

  const [showPhoto, setShowPhoto] = useState(false);

  // Note/commentaire
  const [noteText, setNoteText] = useState('');
  const [editingNote, setEditingNote] = useState(false);

  // Edit state

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
      // Le nombre de depenses affiche dans la liste des groupes change aussi.
      qc.invalidateQueries({ queryKey: ['groups'] });
      router.back();
    },
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
        'Une copie a été créée. Tu peux la modifier maintenant.',
        [
          {
            text: 'Modifier la copie',
            onPress: () =>
              router.replace(
                `/expense/add?groupId=${expense?.groupId}&expenseId=${newExpense.id}&isEdit=true`
              ),
          },
          { text: 'Plus tard', style: 'cancel' },
        ]
      );
    },
    onError: () => Alert.alert('Erreur', 'Impossible de dupliquer la dépense.'),
  });

  // Ecran d'edition complet : montant, participants, parts egales ou
  // personnalisees, et articles pour un ticket. Le formulaire reduit forcait
  // une repartition egale, ce qui ecrasait les parts d'un ticket scanne.
  function startEditing() {
    if (!expense) return;
    router.push(`/expense/add?groupId=${expense.groupId}&expenseId=${expense.id}&isEdit=true`);
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
        {/* À compléter — la fiche reste accessible (Modifier / Supprimer) */}
        {expense.isComplete === false && (
          <View style={styles.todoBanner}>
            <Text style={styles.todoTitle}>⏳ Dépense à compléter</Text>
            <Text style={styles.todoText}>
              {expense.items?.length > 0
                ? 'Certains articles ne sont assignés à personne.'
                : 'La répartition ne couvre pas le montant total.'}
            </Text>
            {expense.items?.length > 0 ? (
              <TouchableOpacity
                style={styles.todoBtn}
                onPress={() => router.push(`/expense/add?groupId=${expense.groupId}&expenseId=${expense.id}&isEdit=true`)}
              >
                <Text style={styles.todoBtnText}>Assigner les articles →</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.todoBtn} onPress={startEditing}>
                <Text style={styles.todoBtnText}>Choisir les participants →</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

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
                    <Text style={{ fontSize: 11, color: colors.text3, fontFamily: fonts.mono }}>
                      {' '}({fmt(p.amount)})
                    </Text>
                  )}
                </View>
              ))}
            </View>
          </View>
          <Divider />
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>Total</Text>
            <Text style={[styles.metaValue, { fontFamily: fonts.mono, fontSize: 20 }]}>
              {fmt(expense.totalAmount)}
            </Text>
          </View>
          {mySplit && (
            <>
              <Divider />
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Ma part</Text>
                <Text style={[styles.metaValue, { fontFamily: fonts.mono, fontSize: 16, color: colors.accent2 }]}>
                  {fmt(mySplit.amount)}{mySplit.settled ? '  ✓ réglé' : ''}
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
                    <Text style={styles.itemPrice}>{fmt(item.price)}</Text>
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
                    {fmt(split.amount)}
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
  backText: { color: colors.text2, fontFamily: fonts.medium, fontSize: 12, fontWeight: '500' },
  title: { fontFamily: fonts.semibold, fontSize: 15, fontWeight: '600', color: colors.text, flex: 1, textAlign: 'center', marginHorizontal: 8 },
  editBtn: {
    backgroundColor: colors.accentBg, borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.3)',
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.full,
  },
  editBtnText: { color: colors.accent2, fontFamily: fonts.semibold, fontSize: 12, fontWeight: '600' },
  saveBtn: { backgroundColor: colors.primary, paddingHorizontal: 14, paddingVertical: 6, borderRadius: radius.full },
  saveBtnText: { color: colors.onPrimary, fontFamily: fonts.semibold, fontSize: 12, fontWeight: '600' },
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: 80 },
  photoBlock: { marginBottom: 12 },
  photoBtn: {
    backgroundColor: colors.surface2, borderWidth: 0.5, borderColor: colors.border,
    borderRadius: radius.sm, padding: 12, alignItems: 'center', marginBottom: 2,
  },
  photoBtnText: { fontFamily: fonts.medium, fontSize: 13, color: colors.accent2, fontWeight: '500' },
  photo: { width: '100%', height: 320, borderRadius: radius.sm, backgroundColor: colors.surface3, marginTop: 6 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 },
  metaLabel: { fontFamily: fonts.regular, fontSize: 13, color: colors.text3 },
  metaValue: { fontFamily: fonts.medium, fontSize: 13, color: colors.text, fontWeight: '500' },
  // Note
  noteInput: {
    backgroundColor: colors.surface2, borderRadius: radius.sm, padding: 12,
    color: colors.text, fontFamily: fonts.regular, fontSize: 14, minHeight: 80, textAlignVertical: 'top',
  },
  noteActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 10 },
  noteCancelBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.full, borderWidth: 0.5, borderColor: colors.border },
  noteCancelText: { fontFamily: fonts.regular, fontSize: 13, color: colors.text3 },
  noteSaveBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.full, backgroundColor: colors.primary },
  noteSaveText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.onPrimary },
  noteText: { fontFamily: fonts.regular, fontSize: 14, color: colors.text, lineHeight: 20 },
  notePlaceholder: { fontFamily: fonts.regular, fontSize: 13, color: colors.text3, fontStyle: 'italic' },
  // Items
  itemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  itemName: { fontFamily: fonts.medium, fontSize: 13, fontWeight: '500', color: colors.text },
  itemAssigned: { fontFamily: fonts.regular, fontSize: 11, color: colors.text3, marginTop: 2 },
  itemPrice: { fontSize: 13, fontFamily: fonts.mono, color: colors.text2 },
  // Splits
  splitRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  splitName: { flex: 1, fontFamily: fonts.regular, fontSize: 14, color: colors.text },
  splitAmt: { fontSize: 14, fontFamily: fonts.mono, color: colors.amber, fontWeight: '500' },
  todoBanner: {
    backgroundColor: 'rgba(232,163,61,0.06)',
    borderWidth: 1, borderColor: 'rgba(232,163,61,0.22)',
    borderRadius: 14, padding: 14, marginBottom: 14,
  },
  todoTitle: { fontFamily: fonts.semibold, fontSize: 14, fontWeight: '600', color: colors.amber, marginBottom: 4 },
  todoText: { fontFamily: fonts.regular, fontSize: 12, color: colors.text2, lineHeight: 18, marginBottom: 10 },
  todoBtn: {
    alignSelf: 'flex-start',
    backgroundColor: colors.accentBg,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
  },
  todoBtnText: { fontFamily: fonts.semibold, fontSize: 12, fontWeight: '600', color: colors.accent2 },
  settledTag: { fontFamily: fonts.regular, fontSize: 10, color: colors.green, marginTop: 2 },
  // Edit
  label: { fontFamily: fonts.medium, fontSize: 11, fontWeight: '500', color: colors.text3, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8, marginTop: 4 },
  hint: { fontFamily: fonts.regular, fontSize: 11, color: colors.text3, marginBottom: 12, marginTop: -4 },
  textInput: {
    backgroundColor: colors.surface2, borderWidth: 0.5, borderColor: colors.border,
    borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 11,
    fontFamily: fonts.regular, fontSize: 14, color: colors.text, marginBottom: 12,
  },
  payerChip: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: radius.full, borderWidth: 1.5, borderColor: colors.border,
  },
  payerChipOn: { borderColor: colors.accent, backgroundColor: colors.accentBg },
  payerChipText: { fontFamily: fonts.medium, fontSize: 13, fontWeight: '500', color: colors.text2 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap' },
});