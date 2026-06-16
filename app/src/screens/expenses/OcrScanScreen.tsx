// app/src/screens/expenses/OcrScanScreen.tsx
// Full OCR flow: pick image → upload → parse → review & correct items → assign to members

import React, { useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity, TextInput,
  ActivityIndicator, Alert, Animated,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { ocrApi } from '../../services/api';
import { Button, Chip, Notice, Avatar, Divider } from '../../components/ui';
import { colors, spacing, radius } from '../../theme';
import { OcrItem, GroupMember } from '../../../../shared/types';

interface LocalItem extends OcrItem {
  id: string;
  editing: boolean;
  corrected: boolean;
  assignedTo: string[]; // member ids
  editName: string;
  editPrice: string;
}

interface Props {
  members: GroupMember[];
  onComplete: (items: LocalItem[], imageUrl?: string) => void;
}

export default function OcrScanScreen({ members, onComplete }: Props) {
  const [phase, setPhase] = useState<'pick' | 'scanning' | 'review'>('pick');
  const [scanStatus, setScanStatus] = useState('Initialisation…');
  const [items, setItems] = useState<LocalItem[]>([]);
  const [imageUrl, setImageUrl] = useState<string | undefined>();
  const [activeMember, setActiveMember] = useState<string>(members[0]?.id || '');
  const [corrections, setCorrections] = useState<LocalItem[]>([]);

  async function pickAndScan() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      const gallery = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!gallery.granted) { Alert.alert('Permission requise', 'Autorise l\'accès caméra ou galerie.'); return; }
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85,
      allowsEditing: true,
    });

    if (result.canceled || !result.assets[0]) return;
    const uri = result.assets[0].uri;

    setPhase('scanning');
    const steps = [
      'Recadrage de l\'image…',
      'Chargement du moteur OCR…',
      'Détection du texte…',
      'Extraction des articles…',
      'Correction automatique…',
    ];
    let stepIdx = 0;
    const interval = setInterval(() => {
      if (stepIdx < steps.length) setScanStatus(steps[stepIdx++]);
    }, 600);

    try {
      const result = await ocrApi.scan(uri);
      clearInterval(interval);
      setScanStatus('Terminé ✓');

      const localItems: LocalItem[] = result.items.map((item: OcrItem, i: number) => ({
        ...item,
        id: `item_${i}`,
        editing: false,
        corrected: false,
        assignedTo: [],
        editName: item.name,
        editPrice: item.price.toFixed(2),
      }));

      setItems(localItems);
      setImageUrl(result.imageUrl);
      setPhase('review');
    } catch (e) {
      clearInterval(interval);
      Alert.alert('Erreur OCR', 'Impossible de traiter l\'image. Réessaie ou saisis manuellement.');
      setPhase('pick');
    }
  }

  function toggleAssign(itemId: string, memberId: string) {
    setItems(prev => prev.map(item => {
      if (item.id !== itemId) return item;
      const has = item.assignedTo.includes(memberId);
      return { ...item, assignedTo: has ? item.assignedTo.filter(m => m !== memberId) : [...item.assignedTo, memberId] };
    }));
  }

  function startEdit(itemId: string) {
    setItems(prev => prev.map(i => ({ ...i, editing: i.id === itemId })));
  }

  function saveEdit(itemId: string) {
    setItems(prev => prev.map(item => {
      if (item.id !== itemId) return item;
      const newName = item.editName.trim();
      const newPrice = parseFloat(item.editPrice.replace(',', '.')) || item.price;
      const changed = newName !== item.name || newPrice !== item.price;
      if (changed) {
        // Queue correction for training
        ocrApi.saveCorrection({
          ocrRaw: item.ocrRaw,
          ocrPriceRaw: item.ocrPriceRaw,
          correctedName: newName,
          correctedPrice: newPrice,
          confidence: item.confidence,
        }).catch(() => {}); // fire-and-forget
      }
      return { ...item, name: newName, price: newPrice, editing: false, corrected: changed };
    }));
  }

  function handleConfirm() {
    onComplete(items, imageUrl);
  }

  // ── Phase: pick image ──────────────────────────────────────────────────
  if (phase === 'pick') {
    return (
      <View style={styles.pickContainer}>
        <Notice text="Le scan OCR extrait automatiquement les articles du ticket. Tu peux corriger chaque ligne — tes corrections améliorent le modèle !" />
        <TouchableOpacity style={styles.uploadZone} onPress={pickAndScan} activeOpacity={0.8}>
          <Text style={styles.uploadIcon}>📷</Text>
          <Text style={styles.uploadTitle}>Photographier le ticket</Text>
          <Text style={styles.uploadSub}>JPG, PNG · OCR gratuit</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Phase: scanning ────────────────────────────────────────────────────
  if (phase === 'scanning') {
    return (
      <View style={styles.scanningContainer}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={styles.scanStatus}>{scanStatus}</Text>
      </View>
    );
  }

  // ── Phase: review items ────────────────────────────────────────────────
  const totalChecked = items.reduce((s, i) => s + (i.assignedTo.length > 0 ? i.price : 0), 0);
  const totalAll = items.reduce((s, i) => s + i.price, 0);

  return (
    <ScrollView style={styles.reviewContainer} contentContainerStyle={{ paddingBottom: 40 }}>
      {/* Member selector */}
      <Text style={styles.sectionLabel}>COCHER POUR</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
        <View style={styles.chipRow}>
          {members.map(m => (
            <Chip
              key={m.id}
              label={m.displayName}
              selected={activeMember === m.id}
              onPress={() => setActiveMember(m.id)}
              avatar={{ initials: m.avatarInitials, color: m.avatarColor }}
            />
          ))}
        </View>
      </ScrollView>

      {/* Items */}
      <Notice variant="amber" text="Corriger un article = améliorer le modèle OCR. Merci !" />
      <View style={styles.itemsCard}>
        <View style={styles.itemsHeader}>
          <Text style={styles.itemsTitle}>Ticket scanné</Text>
          <Text style={styles.itemsConf}>{Math.round((items[0]?.confidence || 0.85) * 100)}% confiance</Text>
        </View>
        {items.map((item, idx) => (
          <View key={item.id}>
            <ItemRow
              item={item}
              activeMemberId={activeMember}
              onToggle={() => toggleAssign(item.id, activeMember)}
              onStartEdit={() => startEdit(item.id)}
              onSaveEdit={() => saveEdit(item.id)}
              onChangeName={v => setItems(prev => prev.map(i => i.id === item.id ? { ...i, editName: v } : i))}
              onChangePrice={v => setItems(prev => prev.map(i => i.id === item.id ? { ...i, editPrice: v } : i))}
            />
            {idx < items.length - 1 && <Divider />}
          </View>
        ))}
      </View>

      {/* Totals */}
      <View style={styles.totalRow}>
        <Text style={styles.totalLabel}>Articles cochés</Text>
        <Text style={styles.totalAmt}>{totalChecked.toFixed(2)} / {totalAll.toFixed(2)} CHF</Text>
      </View>

      <Button label="Calculer les parts →" onPress={handleConfirm} style={{ marginTop: 16 }} />
    </ScrollView>
  );
}

// ── ItemRow component ──────────────────────────────────────────────────────
function ItemRow({ item, activeMemberId, onToggle, onStartEdit, onSaveEdit, onChangeName, onChangePrice }: {
  item: LocalItem;
  activeMemberId: string;
  onToggle: () => void;
  onStartEdit: () => void;
  onSaveEdit: () => void;
  onChangeName: (v: string) => void;
  onChangePrice: (v: string) => void;
}) {
  const checked = item.assignedTo.includes(activeMemberId);

  return (
    <View style={styles.itemRow}>
      <TouchableOpacity
        onPress={onToggle}
        style={[styles.checkbox, checked && styles.checkboxOn]}
      >
        {checked && <Text style={styles.checkmark}>✓</Text>}
      </TouchableOpacity>

      <View style={styles.itemInfo}>
        {item.editing ? (
          <View style={styles.editRow}>
            <TextInput
              style={[styles.editInput, { flex: 1 }]}
              value={item.editName}
              onChangeText={onChangeName}
              autoFocus
              selectionColor={colors.accent}
            />
            <TextInput
              style={[styles.editInput, { width: 72 }]}
              value={item.editPrice}
              onChangeText={onChangePrice}
              keyboardType="decimal-pad"
              selectionColor={colors.accent}
            />
            <TouchableOpacity onPress={onSaveEdit} style={styles.saveBtn}>
              <Text style={styles.saveBtnText}>OK</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.itemNameRow}>
              <Text style={styles.itemName}>{item.name}</Text>
              {item.corrected && (
                <View style={styles.correctedBadge}>
                  <Text style={styles.correctedText}>corrigé ✓</Text>
                </View>
              )}
            </View>
            <Text style={styles.ocrRaw}>
              OCR brut: <Text style={{ fontFamily: 'monospace' }}>{item.ocrRaw}</Text>
              {'  '}{Math.round(item.confidence * 100)}%
            </Text>
          </>
        )}
      </View>

      {!item.editing && (
        <>
          <TouchableOpacity onPress={onStartEdit} style={styles.editBtn}>
            <Text style={styles.editBtnText}>✏️</Text>
          </TouchableOpacity>
          <Text style={styles.itemPrice}>{item.price.toFixed(2)}</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pickContainer: { padding: spacing.xl },
  uploadZone: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border2,
    borderStyle: 'dashed',
    borderRadius: radius.md,
    alignItems: 'center',
    padding: 40,
  },
  uploadIcon: { fontSize: 40, marginBottom: 10 },
  uploadTitle: { fontSize: 15, fontWeight: '500', color: colors.text, marginBottom: 4 },
  uploadSub: { fontSize: 12, color: colors.text3 },
  scanningContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  scanStatus: { color: colors.text2, fontSize: 14, marginTop: 16, textAlign: 'center' },
  reviewContainer: { flex: 1 },
  sectionLabel: { fontSize: 11, fontWeight: '500', color: colors.text3, letterSpacing: 0.8, marginBottom: 8 },
  chipRow: { flexDirection: 'row', paddingRight: spacing.xl },
  itemsCard: {
    backgroundColor: colors.surface,
    borderWidth: 0.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: 12,
  },
  itemsHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  itemsTitle: { fontSize: 14, fontWeight: '500', color: colors.text },
  itemsConf: { fontSize: 11, color: colors.text3 },
  itemRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 10 },
  checkbox: {
    width: 22, height: 22, borderRadius: 6,
    borderWidth: 1.5, borderColor: colors.border2,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  checkmark: { color: colors.white, fontSize: 13, fontWeight: '700' },
  itemInfo: { flex: 1 },
  itemNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  itemName: { fontSize: 13, color: colors.text, fontWeight: '500' },
  correctedBadge: {
    backgroundColor: colors.greenBg, borderRadius: 4,
    paddingHorizontal: 5, paddingVertical: 1,
  },
  correctedText: { fontSize: 9, color: colors.green, fontWeight: '500' },
  ocrRaw: { fontSize: 10, color: colors.text3, marginTop: 2 },
  editRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  editInput: {
    backgroundColor: colors.surface2,
    borderWidth: 0.5, borderColor: colors.accent,
    borderRadius: 6, color: colors.text,
    fontFamily: 'monospace', fontSize: 12,
    paddingHorizontal: 7, paddingVertical: 4,
  },
  saveBtn: {
    backgroundColor: colors.accent, borderRadius: 6,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  saveBtnText: { color: colors.white, fontSize: 12, fontWeight: '600' },
  editBtn: { padding: 4 },
  editBtnText: { fontSize: 14 },
  itemPrice: { fontSize: 13, fontWeight: '500', fontFamily: 'monospace', color: colors.text2, minWidth: 54, textAlign: 'right' },
  totalRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    backgroundColor: colors.surface2, borderRadius: radius.sm,
    padding: spacing.md, marginTop: 4,
  },
  totalLabel: { fontSize: 13, color: colors.text3 },
  totalAmt: { fontSize: 13, fontFamily: 'monospace', color: colors.text, fontWeight: '500' },
});
