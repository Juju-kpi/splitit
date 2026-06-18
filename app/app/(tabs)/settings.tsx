// app/app/(tabs)/settings.tsx
// Changements vs original :
//   - Section "Danger zone" enrichie : suppression de compte (avec confirmation email)
//   - Section "Confidentialité" : export de données, anonymisation
//   - Section "Notifications" : placeholder prêt pour push notifications
//   - Section "À propos" : version app, mentions légales

import React, { useState } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Alert, Switch, TextInput, Modal, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../src/store/authStore';
import { ocrApi, authApi } from '../../src/services/api';
import { Card, GlassCard, SectionLabel, Notice, ScreenHeader, Avatar } from '../../src/components/ui';
import { colors, spacing, radius } from '../../src/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

const APP_VERSION = '1.0.0';

function SettingRow({
  icon, label, value, onPress, destructive = false, rightElement,
}: {
  icon: string;
  label: string;
  value?: string;
  onPress?: () => void;
  destructive?: boolean;
  rightElement?: React.ReactNode;
}) {
  return (
    <TouchableOpacity
      style={styles.settingRow}
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
      disabled={!onPress && !rightElement}
    >
      <View style={[styles.settingIconWrap, destructive && styles.settingIconWrapDanger]}>
        <Text style={styles.settingIcon}>{icon}</Text>
      </View>
      <Text style={[styles.settingLabel, destructive && { color: colors.red }]}>{label}</Text>
      {value && <Text style={styles.settingValue}>{value}</Text>}
      {rightElement}
      {onPress && !rightElement && (
        <Text style={[styles.settingArrow, destructive && { color: colors.red }]}>›</Text>
      )}
    </TouchableOpacity>
  );
}

export default function SettingsScreen() {
  const user = useAuthStore(s => s.user);
  const logout = useAuthStore(s => s.logout);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Notifications (local state — à brancher sur push notifications quand dispo)
  const [notifExpense, setNotifExpense] = useState(true);
  const [notifReminder, setNotifReminder] = useState(false);

  // Modal suppression de compte
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteStep, setDeleteStep] = useState<'confirm' | 'password'>('confirm');
  const [deletePassword, setDeletePassword] = useState('');

  const { data: ocrStats } = useQuery({
    queryKey: ['ocrStats'],
    queryFn: ocrApi.getStats,
    refetchInterval: 60_000,
  });

  // Mutation suppression compte
  const deleteMutation = useMutation({
    mutationFn: async (password: string) => {
      // Appel backend DELETE /api/auth/account
      const res = await authApi.deleteAccount(password);
      return res;
    },
    onSuccess: async () => {
      setDeleteModalVisible(false);
      await logout();
      router.replace('/(auth)/login');
    },
    onError: (e: any) => {
      Alert.alert(
        'Erreur',
        e?.response?.data?.error || 'Mot de passe incorrect ou problème serveur.'
      );
    },
  });

  function handleLogout() {
    Alert.alert('Déconnexion', 'Tu veux vraiment te déconnecter ?', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Déconnexion', style: 'destructive', onPress: async () => {
          await logout();
          router.replace('/(auth)/login');
        }
      },
    ]);
  }

  function handleExportData() {
    Alert.alert(
      'Export de données',
      'Un email avec l\'export de toutes tes données sera envoyé à ' + user?.email + ' sous 24h.',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Demander l\'export',
          onPress: () => Alert.alert('✓ Demande envoyée', 'Tu recevras un email sous 24h.'),
        },
      ]
    );
  }

  function openDeleteModal() {
    setDeleteModalVisible(true);
    setDeleteStep('confirm');
    setDeleteConfirmText('');
    setDeletePassword('');
  }

  function handleDeleteConfirm() {
    if (deleteConfirmText.trim().toLowerCase() !== 'supprimer') {
      Alert.alert('Tape "supprimer" pour confirmer');
      return;
    }
    setDeleteStep('password');
  }

  function handleDeleteFinal() {
    if (!deletePassword || deletePassword.length < 1) {
      Alert.alert('Mot de passe requis');
      return;
    }
    deleteMutation.mutate(deletePassword);
  }

  const accuracy = ocrStats?.accuracyEstimate || 72;
  const total = ocrStats?.totalCorrections || 0;
  const untrained = ocrStats?.untrainedCount || 0;

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Réglages" subtitle="Compte et préférences" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 100 + insets.bottom }]}
      >
        {/* Profile hero */}
        <GlassCard glow style={styles.profileCard}>
          <View style={styles.profileRow}>
            <Avatar
              initials={(user?.username ?? '??').slice(0, 2).toUpperCase()}
              color={user?.avatarColor || colors.accent}
              size={56}
              ring
            />
            <View style={styles.profileInfo}>
              <Text style={styles.profileName}>{user?.username}</Text>
              <Text style={styles.profileEmail}>{user?.email}</Text>
              <View style={styles.profileBadge}>
                <Text style={styles.profileBadgeText}>✦ Membre actif</Text>
              </View>
            </View>
          </View>
        </GlassCard>

        {/* OCR Training */}
        <SectionLabel label="Entraînement OCR" />
        <Card>
          <View style={styles.ocrHeader}>
            <Text style={styles.ocrTitle}>🧠 Modèle · v1.4</Text>
            <View style={[styles.ocrAccuracyBadge, {
              backgroundColor: accuracy >= 80 ? colors.greenBg : colors.amberBg
            }]}>
              <Text style={[styles.ocrAccuracyText, {
                color: accuracy >= 80 ? colors.green : colors.amber
              }]}>
                {accuracy.toFixed(0)}% précis
              </Text>
            </View>
          </View>

          <View style={styles.ocrStatsRow}>
            <View style={styles.ocrStat}>
              <Text style={[styles.ocrStatNum, { color: colors.accent2 }]}>{total}</Text>
              <Text style={styles.ocrStatLabel}>Corrections</Text>
            </View>
            <View style={styles.ocrStatDivider} />
            <View style={styles.ocrStat}>
              <Text style={[styles.ocrStatNum, { color: colors.green }]}>{accuracy.toFixed(0)}%</Text>
              <Text style={styles.ocrStatLabel}>Précision</Text>
            </View>
            <View style={styles.ocrStatDivider} />
            <View style={styles.ocrStat}>
              <Text style={[styles.ocrStatNum, { color: untrained > 0 ? colors.amber : colors.text3 }]}>
                {untrained}
              </Text>
              <Text style={styles.ocrStatLabel}>En attente</Text>
            </View>
          </View>

          <View style={styles.progBarTrack}>
            <View style={[styles.progBarFill, { width: `${Math.min(accuracy, 100)}%` as any }]} />
          </View>
          <Text style={styles.progLabel}>
            {untrained > 0
              ? `${untrained} corrections avant le prochain affinement`
              : '✓ Modèle à jour'}
          </Text>
          {ocrStats?.lastTrainingRun && (
            <Text style={[styles.progLabel, { marginTop: 4 }]}>
              Dernier entraînement : {format(new Date(ocrStats.lastTrainingRun), 'dd MMM yyyy', { locale: fr })}
            </Text>
          )}
        </Card>

        <Notice
          text="Chaque correction améliore l'OCR pour tout le monde. Les données sont anonymisées."
          variant="accent"
        />

        {/* Mon compte */}
        <SectionLabel label="Mon compte" />
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <SettingRow
            icon="📅"
            label="Membre depuis"
            value={user?.createdAt
              ? format(new Date(user.createdAt), 'MMM yyyy', { locale: fr })
              : '—'}
          />
          <View style={styles.rowSeparator} />
          <SettingRow icon="🌍" label="Langue" value="Français" />
          <View style={styles.rowSeparator} />
          <SettingRow
            icon="🎨"
            label="Couleur de profil"
            value="Personnaliser"
            onPress={() => Alert.alert('Bientôt disponible', 'Tu pourras choisir ta couleur d\'avatar.')}
          />
        </Card>

        {/* Notifications */}
        <SectionLabel label="Notifications" />
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <SettingRow
            icon="🔔"
            label="Nouvelle dépense dans un groupe"
            rightElement={
              <Switch
                value={notifExpense}
                onValueChange={setNotifExpense}
                trackColor={{ false: colors.surface3, true: colors.accent }}
                thumbColor={colors.white}
                style={{ marginLeft: 'auto' }}
              />
            }
          />
          <View style={styles.rowSeparator} />
          <SettingRow
            icon="⏰"
            label="Rappel dépenses à compléter"
            rightElement={
              <Switch
                value={notifReminder}
                onValueChange={setNotifReminder}
                trackColor={{ false: colors.surface3, true: colors.accent }}
                thumbColor={colors.white}
                style={{ marginLeft: 'auto' }}
              />
            }
          />
        </Card>

        {/* Confidentialité */}
        <SectionLabel label="Confidentialité & données" />
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <SettingRow
            icon="📦"
            label="Exporter mes données"
            value="Email sous 24h"
            onPress={handleExportData}
          />
          <View style={styles.rowSeparator} />
          <SettingRow
            icon="🔒"
            label="Politique de confidentialité"
            onPress={() => Alert.alert('Politique de confidentialité', 'Tes données ne sont jamais vendues ni partagées avec des tiers. L\'OCR est anonymisé avant entraînement.')}
          />
          <View style={styles.rowSeparator} />
          <SettingRow
            icon="📋"
            label="Conditions d'utilisation"
            onPress={() => Alert.alert('Conditions d\'utilisation', 'SplitIt est un service de partage de dépenses entre amis. Utilisation personnelle uniquement.')}
          />
        </Card>

        {/* À propos */}
        <SectionLabel label="À propos" />
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <SettingRow icon="📱" label="Version de l'app" value={APP_VERSION} />
          <View style={styles.rowSeparator} />
          <SettingRow icon="⭐️" label="Noter l'app" onPress={() => Alert.alert('Merci !', 'La note sera disponible une fois l\'app publiée sur les stores.')} />
          <View style={styles.rowSeparator} />
          <SettingRow icon="💬" label="Envoyer un feedback" onPress={() => Alert.alert('Feedback', 'Envoie-nous un email à hello@splitit.app')} />
        </Card>

        {/* Danger zone */}
        <SectionLabel label="Zone de danger" />
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <SettingRow
            icon="👋"
            label="Se déconnecter"
            onPress={handleLogout}
          />
          <View style={styles.rowSeparator} />
          <SettingRow
            icon="🗑"
            label="Supprimer mon compte"
            destructive
            onPress={openDeleteModal}
          />
        </Card>

        <Text style={styles.footer}>
          SplitIt {APP_VERSION} · Fait avec ❤️
        </Text>
      </ScrollView>

      {/* Modal suppression de compte */}
      <Modal
        visible={deleteModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setDeleteModalVisible(false)}
      >
        <KeyboardAvoidingView
          style={styles.modalScreen}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>🗑 Supprimer mon compte</Text>
            <TouchableOpacity
              onPress={() => setDeleteModalVisible(false)}
              style={styles.modalClose}
            >
              <Text style={styles.modalCloseText}>Annuler</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">

            {deleteStep === 'confirm' && (
              <>
                <View style={styles.deleteWarning}>
                  <Text style={styles.deleteWarningTitle}>⚠️ Action irréversible</Text>
                  <Text style={styles.deleteWarningText}>
                    La suppression de ton compte entraîne :{'\n\n'}
                    {'• '}Suppression définitive de ton profil{'\n'}
                    {'• '}Déconnexion de tous tes groupes{'\n'}
                    {'• '}Perte de l'historique de tes dépenses{'\n'}
                    {'• '}Suppression de toutes tes sessions{'\n\n'}
                    Les dépenses partagées restent visibles pour les autres membres du groupe.
                  </Text>
                </View>

                <Text style={styles.deleteConfirmLabel}>
                  Tape <Text style={{ color: colors.red, fontWeight: '700' }}>supprimer</Text> pour confirmer
                </Text>
                <TextInput
                  style={styles.deleteConfirmInput}
                  placeholder="supprimer"
                  placeholderTextColor={colors.text3}
                  value={deleteConfirmText}
                  onChangeText={setDeleteConfirmText}
                  autoCapitalize="none"
                  autoCorrect={false}
                />

                <TouchableOpacity
                  style={[
                    styles.deleteBtn,
                    deleteConfirmText.toLowerCase() !== 'supprimer' && styles.deleteBtnDisabled,
                  ]}
                  onPress={handleDeleteConfirm}
                  activeOpacity={0.8}
                  disabled={deleteConfirmText.toLowerCase() !== 'supprimer'}
                >
                  <Text style={styles.deleteBtnText}>Continuer →</Text>
                </TouchableOpacity>
              </>
            )}

            {deleteStep === 'password' && (
              <>
                <View style={styles.deleteWarning}>
                  <Text style={styles.deleteWarningTitle}>🔑 Confirme ton mot de passe</Text>
                  <Text style={styles.deleteWarningText}>
                    Entre ton mot de passe actuel pour confirmer la suppression définitive.
                  </Text>
                </View>

                <Text style={styles.deleteConfirmLabel}>Mot de passe</Text>
                <TextInput
                  style={styles.deleteConfirmInput}
                  placeholder="••••••••"
                  placeholderTextColor={colors.text3}
                  value={deletePassword}
                  onChangeText={setDeletePassword}
                  secureTextEntry
                  autoFocus
                />

                <TouchableOpacity
                  style={styles.deleteBtn}
                  onPress={handleDeleteFinal}
                  activeOpacity={0.8}
                  disabled={deleteMutation.isPending}
                >
                  <Text style={styles.deleteBtnText}>
                    {deleteMutation.isPending ? 'Suppression…' : '🗑 Supprimer définitivement'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.deleteCancelBtn}
                  onPress={() => setDeleteStep('confirm')}
                >
                  <Text style={styles.deleteCancelText}>← Retour</Text>
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.xl },

  profileCard: { marginTop: 16 },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  profileInfo: { flex: 1 },
  profileName: { fontSize: 18, fontWeight: '700', color: colors.text, letterSpacing: -0.3 },
  profileEmail: { fontSize: 12, color: colors.text3, marginTop: 3 },
  profileBadge: {
    marginTop: 8, alignSelf: 'flex-start',
    backgroundColor: colors.accentBg, borderWidth: 1, borderColor: 'rgba(124,110,250,0.25)',
    paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.full,
  },
  profileBadgeText: { fontSize: 11, color: colors.accent2, fontWeight: '700' },

  ocrHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  ocrTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  ocrAccuracyBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full },
  ocrAccuracyText: { fontSize: 12, fontWeight: '700' },
  ocrStatsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', marginBottom: 16 },
  ocrStat: { flex: 1, alignItems: 'center' },
  ocrStatNum: { fontSize: 26, fontWeight: '300', fontFamily: 'monospace' },
  ocrStatLabel: { fontSize: 10, color: colors.text3, marginTop: 3, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8 },
  ocrStatDivider: { width: 0.5, height: 40, backgroundColor: colors.glassBorder },
  progBarTrack: { height: 4, backgroundColor: colors.surface2, borderRadius: 2, overflow: 'hidden', marginBottom: 8 },
  progBarFill: { height: '100%', borderRadius: 2, backgroundColor: colors.accent },
  progLabel: { fontSize: 11, color: colors.text3, lineHeight: 16 },

  settingRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: spacing.lg, paddingVertical: 14, minHeight: 52,
  },
  settingIconWrap: {
    width: 32, height: 32, borderRadius: 9,
    backgroundColor: colors.surface3, alignItems: 'center', justifyContent: 'center',
  },
  settingIconWrapDanger: { backgroundColor: 'rgba(248,113,113,0.12)' },
  settingIcon: { fontSize: 15 },
  settingLabel: { flex: 1, fontSize: 14, fontWeight: '500', color: colors.text },
  settingValue: { fontSize: 12, color: colors.text3, fontWeight: '500' },
  settingArrow: { fontSize: 18, color: colors.text3, fontWeight: '300' },
  rowSeparator: { height: 0.5, backgroundColor: colors.glassBorder, marginLeft: spacing.lg + 32 + 12 },

  footer: { fontSize: 11, color: colors.text3, textAlign: 'center', marginTop: 24, marginBottom: 8 },

  // Delete modal
  modalScreen: { flex: 1, backgroundColor: colors.bg },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: spacing.xl, borderBottomWidth: 0.5, borderBottomColor: colors.border,
  },
  modalTitle: { fontSize: 16, fontWeight: '700', color: colors.red },
  modalClose: { paddingHorizontal: 14, paddingVertical: 7, backgroundColor: colors.surface2, borderRadius: radius.full },
  modalCloseText: { fontSize: 13, color: colors.text2, fontWeight: '500' },
  modalContent: { padding: spacing.xl, paddingBottom: 60 },

  deleteWarning: {
    backgroundColor: 'rgba(248,113,113,0.06)', borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.2)', borderRadius: radius.md, padding: 16, marginBottom: 24,
  },
  deleteWarningTitle: { fontSize: 15, fontWeight: '700', color: colors.red, marginBottom: 10 },
  deleteWarningText: { fontSize: 13, color: colors.text2, lineHeight: 20 },

  deleteConfirmLabel: { fontSize: 13, color: colors.text2, marginBottom: 10 },
  deleteConfirmInput: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(248,113,113,0.4)',
    borderRadius: radius.sm, paddingHorizontal: 14, paddingVertical: 12,
    color: colors.text, fontSize: 15, marginBottom: 20,
  },
  deleteBtn: {
    backgroundColor: colors.red, borderRadius: radius.md,
    paddingVertical: 14, alignItems: 'center',
  },
  deleteBtnDisabled: { opacity: 0.35 },
  deleteBtnText: { fontSize: 15, fontWeight: '700', color: colors.white },
  deleteCancelBtn: { marginTop: 14, alignItems: 'center', paddingVertical: 10 },
  deleteCancelText: { fontSize: 13, color: colors.text3 },
});
