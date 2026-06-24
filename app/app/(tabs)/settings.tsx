// app/app/(tabs)/settings.tsx
// Production-ready settings screen
// Features:
//   - Couleur de profil : palette 10 couleurs, sauvegarde en DB
//   - Notifications : Expo Push Notifications réelles (nouvelle dépense + rappel complétion)
//   - Export données : email PDF via backend
//   - Politique de confidentialité : WebBrowser vers GitHub Pages
//   - Suppression de compte : flow 2 étapes existant conservé

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, TouchableOpacity,
  Alert, Switch, TextInput, Modal, KeyboardAvoidingView, Platform,
  ActivityIndicator,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as Linking from 'expo-linking';
import { useAuthStore } from '../../src/store/authStore';
import { ocrApi, authApi, userApi } from '../../src/services/api';
import { Card, GlassCard, SectionLabel, Notice, ScreenHeader, Avatar } from '../../src/components/ui';
import { colors, spacing, radius } from '../../src/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

const APP_VERSION = '1.0.0';
const PRIVACY_URL = 'https://juju-kpi.github.io/splitit/privacy-policy.md';

// 10 couleurs de palette
const AVATAR_COLORS = [
  '#4F46E5', // indigo
  '#7C3AED', // violet
  '#DB2777', // pink
  '#DC2626', // red
  '#EA580C', // orange
  '#CA8A04', // yellow
  '#16A34A', // green
  '#0891B2', // cyan
  '#2563EB', // blue
  '#475569', // slate
];

// ── Notifications setup ────────────────────────────────────────────────────
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

async function registerForPushNotifications(): Promise<string | null> {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') return null;

  const token = await Notifications.getExpoPushTokenAsync({
    projectId: process.env.EXPO_PUBLIC_PROJECT_ID,
  });
  return token.data;
}

// ── SettingRow ─────────────────────────────────────────────────────────────
function SettingRow({
  icon, label, value, onPress, destructive = false, rightElement, loading = false,
}: {
  icon: string;
  label: string;
  value?: string;
  onPress?: () => void;
  destructive?: boolean;
  rightElement?: React.ReactNode;
  loading?: boolean;
}) {
  return (
    <TouchableOpacity
      style={styles.settingRow}
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
      disabled={(!onPress && !rightElement) || loading}
    >
      <View style={[styles.settingIconWrap, destructive && styles.settingIconWrapDanger]}>
        <Text style={styles.settingIcon}>{icon}</Text>
      </View>
      <Text style={[styles.settingLabel, destructive && { color: colors.red }]}>{label}</Text>
      {loading && <ActivityIndicator size="small" color={colors.accent} style={{ marginLeft: 'auto' }} />}
      {!loading && value && <Text style={styles.settingValue}>{value}</Text>}
      {!loading && rightElement}
      {!loading && onPress && !rightElement && (
        <Text style={[styles.settingArrow, destructive && { color: colors.red }]}>›</Text>
      )}
    </TouchableOpacity>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────
export default function SettingsScreen() {
  const user = useAuthStore(s => s.user);
  const setUser = useAuthStore(s => s.setUser);
  const logout = useAuthStore(s => s.logout);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  // Color picker modal
  const [colorModalVisible, setColorModalVisible] = useState(false);
  const [selectedColor, setSelectedColor] = useState(user?.avatarColor || AVATAR_COLORS[0]);

  // Notifications
  const [notifExpense, setNotifExpense] = useState(false);
  const [notifReminder, setNotifReminder] = useState(false);
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [notifLoading, setNotifLoading] = useState(false);

  // Delete modal
  const [deleteModalVisible, setDeleteModalVisible] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteStep, setDeleteStep] = useState<'confirm' | 'password'>('confirm');
  const [deletePassword, setDeletePassword] = useState('');

  // Export loading
  const [exportLoading, setExportLoading] = useState(false);

  // OCR stats
  const { data: ocrStats } = useQuery({
    queryKey: ['ocrStats'],
    queryFn: ocrApi.getStats,
    refetchInterval: 60_000,
  });

  // ── Init notifications state from stored prefs ────────────────────────
  useEffect(() => {
    (async () => {
      const stored = await Notifications.getPermissionsAsync();
      if (stored.status === 'granted') {
        const token = await Notifications.getExpoPushTokenAsync({
          projectId: process.env.EXPO_PUBLIC_PROJECT_ID,
        }).catch(() => null);
        if (token) {
          setPushToken(token.data);
          // Restore user prefs from backend
          const prefs = user as any;
          setNotifExpense(prefs?.notifExpense ?? false);
          setNotifReminder(prefs?.notifReminder ?? false);
        }
      }
    })();
  }, []);

  // ── Toggle notification ───────────────────────────────────────────────
  const handleNotifToggle = useCallback(async (type: 'expense' | 'reminder', value: boolean) => {
    setNotifLoading(true);
    try {
      let token = pushToken;

      if (value && !token) {
        token = await registerForPushNotifications();
        if (!token) {
          Alert.alert(
            'Permission refusée',
            'Active les notifications dans les réglages de ton téléphone pour recevoir des alertes.',
            [
              { text: 'Annuler', style: 'cancel' },
              { text: 'Ouvrir les réglages', onPress: () => Linking.openSettings() },
            ]
          );
          setNotifLoading(false);
          return;
        }
        setPushToken(token);
      }

      // Mettre à jour les préférences en DB
      const newPrefs = {
        pushToken: token,
        notifExpense: type === 'expense' ? value : notifExpense,
        notifReminder: type === 'reminder' ? value : notifReminder,
      };

      await userApi.updateNotificationPrefs(newPrefs);

      if (type === 'expense') setNotifExpense(value);
      else setNotifReminder(value);

    } catch (e) {
      Alert.alert('Erreur', 'Impossible de mettre à jour les préférences.');
    } finally {
      setNotifLoading(false);
    }
  }, [pushToken, notifExpense, notifReminder]);

  // ── Color save ────────────────────────────────────────────────────────
  const colorMutation = useMutation({
    mutationFn: (color: string) => userApi.updateProfile({ avatarColor: color }),
    onSuccess: (data) => {
      setUser(data);
      setColorModalVisible(false);
    },
    onError: () => Alert.alert('Erreur', 'Impossible de sauvegarder la couleur.'),
  });

  // ── Export data ───────────────────────────────────────────────────────
  async function handleExportData() {
    Alert.alert(
      'Exporter mes données',
      `Un PDF récapitulatif de tes dépenses, groupes et soldes sera envoyé à ${user?.email}.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Envoyer',
          onPress: async () => {
            setExportLoading(true);
            try {
              await userApi.requestDataExport();
              Alert.alert('✓ Email envoyé', `Vérifie ta boîte mail (${user?.email}).`);
            } catch {
              Alert.alert('Erreur', 'Impossible d\'envoyer l\'export. Réessaie plus tard.');
            } finally {
              setExportLoading(false);
            }
          },
        },
      ]
    );
  }

  // ── Privacy policy ────────────────────────────────────────────────────
  function handlePrivacyPolicy() {
    Linking.openURL(PRIVACY_URL).catch(() =>
      Alert.alert('Erreur', 'Impossible d\'ouvrir la politique de confidentialité.')
    );
  }

  // ── Logout ────────────────────────────────────────────────────────────
  function handleLogout() {
    Alert.alert('Déconnexion', 'Tu veux vraiment te déconnecter ?', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Déconnexion', style: 'destructive', onPress: async () => {
          await logout();
          router.replace('/(auth)/login');
        },
      },
    ]);
  }

  // ── Delete account ────────────────────────────────────────────────────
  const deleteMutation = useMutation({
    mutationFn: (password: string) => authApi.deleteAccount(password),
    onSuccess: async () => {
      setDeleteModalVisible(false);
      await logout();
      router.replace('/(auth)/login');
    },
    onError: (e: any) => {
      Alert.alert('Erreur', e?.response?.data?.error || 'Mot de passe incorrect.');
    },
  });

  function openDeleteModal() {
    setDeleteModalVisible(true);
    setDeleteStep('confirm');
    setDeleteConfirmText('');
    setDeletePassword('');
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
            <TouchableOpacity onPress={() => setColorModalVisible(true)} activeOpacity={0.8}>
              <Avatar
                initials={(user?.username ?? '??').slice(0, 2).toUpperCase()}
                color={user?.avatarColor || colors.accent}
                size={60}
                ring
              />
              <View style={styles.editColorBadge}>
                <Text style={styles.editColorBadgeText}>✏️</Text>
              </View>
            </TouchableOpacity>
            <View style={styles.profileInfo}>
              <Text style={styles.profileName}>{user?.username}</Text>
              <Text style={styles.profileEmail}>{user?.email}</Text>
              <View style={styles.profileBadge}>
                <Text style={styles.profileBadgeText}>✦ Membre actif</Text>
              </View>
            </View>
          </View>
        </GlassCard>

        {/* OCR */}
        <SectionLabel label="Entraînement OCR" />
        <Card>
          <View style={styles.ocrHeader}>
            <Text style={styles.ocrTitle}>🧠 Modèle · v1.4</Text>
            <View style={[styles.ocrAccuracyBadge, {
              backgroundColor: accuracy >= 80 ? colors.greenBg : colors.amberBg,
            }]}>
              <Text style={[styles.ocrAccuracyText, {
                color: accuracy >= 80 ? colors.green : colors.amber,
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
            {untrained > 0 ? `${untrained} corrections avant le prochain affinement` : '✓ Modèle à jour'}
          </Text>
        </Card>
        <Notice text="Chaque correction améliore l'OCR pour tout le monde. Les données sont anonymisées." variant="accent" />

        {/* Mon compte */}
        <SectionLabel label="Mon compte" />
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <SettingRow
            icon="📅"
            label="Membre depuis"
            value={user?.createdAt ? format(new Date(user.createdAt), 'MMM yyyy', { locale: fr }) : '—'}
          />
          <View style={styles.rowSeparator} />
          <SettingRow
            icon="🎨"
            label="Couleur de profil"
            onPress={() => setColorModalVisible(true)}
            rightElement={
              <View style={[styles.colorDot, { backgroundColor: user?.avatarColor || colors.accent }]} />
            }
          />
        </Card>

        {/* Notifications */}
        <SectionLabel label="Notifications" />
        {pushToken && (
          <Notice text="Les notifications push sont activées sur cet appareil." variant="accent" />
        )}
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <SettingRow
            icon="🔔"
            label="Nouvelle dépense dans un groupe"
            rightElement={
              notifLoading ? (
                <ActivityIndicator size="small" color={colors.accent} style={{ marginLeft: 'auto' }} />
              ) : (
                <Switch
                  value={notifExpense}
                  onValueChange={v => handleNotifToggle('expense', v)}
                  trackColor={{ false: colors.surface3, true: colors.accent }}
                  thumbColor={colors.white}
                  style={{ marginLeft: 'auto' }}
                />
              )
            }
          />
          <View style={styles.rowSeparator} />
          <SettingRow
            icon="⏰"
            label="Rappel dépenses à compléter"
            rightElement={
              notifLoading ? (
                <ActivityIndicator size="small" color={colors.accent} style={{ marginLeft: 'auto' }} />
              ) : (
                <Switch
                  value={notifReminder}
                  onValueChange={v => handleNotifToggle('reminder', v)}
                  trackColor={{ false: colors.surface3, true: colors.accent }}
                  thumbColor={colors.white}
                  style={{ marginLeft: 'auto' }}
                />
              )
            }
          />
        </Card>

        {/* Confidentialité */}
        <SectionLabel label="Confidentialité & données" />
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <SettingRow
            icon="📦"
            label="Exporter mes données (PDF)"
            onPress={handleExportData}
            loading={exportLoading}
          />
          <View style={styles.rowSeparator} />
          <SettingRow
            icon="🔒"
            label="Politique de confidentialité"
            onPress={handlePrivacyPolicy}
          />
          <View style={styles.rowSeparator} />
          <SettingRow
            icon="📋"
            label="Conditions d'utilisation"
            onPress={() => Linking.openURL('https://juju-kpi.github.io/splitit/privacy-policy.md')}
          />
        </Card>

        {/* À propos */}
        <SectionLabel label="À propos" />
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <SettingRow icon="📱" label="Version de l'app" value={APP_VERSION} />
          <View style={styles.rowSeparator} />
          <SettingRow
            icon="⭐️"
            label="Noter l'app"
            onPress={() => Linking.openURL('market://details?id=com.splitit.app').catch(() =>
              Linking.openURL('https://play.google.com/store/apps/details?id=com.splitit.app')
            )}
          />
          <View style={styles.rowSeparator} />
          <SettingRow
            icon="💬"
            label="Envoyer un feedback"
            onPress={() => Linking.openURL('mailto:hello@splitit.app?subject=Feedback SplitIt')}
          />
        </Card>

        {/* Danger zone */}
        <SectionLabel label="Zone de danger" />
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <SettingRow icon="👋" label="Se déconnecter" onPress={handleLogout} />
          <View style={styles.rowSeparator} />
          <SettingRow icon="🗑" label="Supprimer mon compte" destructive onPress={openDeleteModal} />
        </Card>

        <Text style={styles.footer}>SplitIt {APP_VERSION} · Fait avec ❤️</Text>
      </ScrollView>

      {/* ── Color picker modal ── */}
      <Modal
        visible={colorModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setColorModalVisible(false)}
      >
        <View style={styles.modalScreen}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Couleur de profil</Text>
            <TouchableOpacity onPress={() => setColorModalVisible(false)} style={styles.modalClose}>
              <Text style={styles.modalCloseText}>Annuler</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.colorPickerContent}>
            <Text style={styles.colorPickerSub}>Choisis une couleur pour ton avatar</Text>
            <View style={styles.colorGrid}>
              {AVATAR_COLORS.map(color => (
                <TouchableOpacity
                  key={color}
                  style={[
                    styles.colorSwatch,
                    { backgroundColor: color },
                    selectedColor === color && styles.colorSwatchSelected,
                  ]}
                  onPress={() => setSelectedColor(color)}
                  activeOpacity={0.8}
                >
                  {selectedColor === color && (
                    <Text style={styles.colorSwatchCheck}>✓</Text>
                  )}
                </TouchableOpacity>
              ))}
            </View>

            {/* Preview */}
            <View style={styles.colorPreview}>
              <Avatar
                initials={(user?.username ?? '??').slice(0, 2).toUpperCase()}
                color={selectedColor}
                size={72}
                ring
              />
              <Text style={styles.colorPreviewName}>{user?.username}</Text>
            </View>

            <TouchableOpacity
              style={[styles.colorSaveBtn, colorMutation.isPending && { opacity: 0.6 }]}
              onPress={() => colorMutation.mutate(selectedColor)}
              disabled={colorMutation.isPending}
              activeOpacity={0.85}
            >
              {colorMutation.isPending
                ? <ActivityIndicator color={colors.white} />
                : <Text style={styles.colorSaveBtnText}>Sauvegarder</Text>
              }
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

      {/* ── Delete account modal ── */}
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
            <Text style={[styles.modalTitle, { color: colors.red }]}>Supprimer mon compte</Text>
            <TouchableOpacity onPress={() => setDeleteModalVisible(false)} style={styles.modalClose}>
              <Text style={styles.modalCloseText}>Annuler</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
            {deleteStep === 'confirm' && (
              <>
                <View style={styles.deleteWarning}>
                  <Text style={styles.deleteWarningTitle}>⚠️ Action irréversible</Text>
                  <Text style={styles.deleteWarningText}>
                    {'• '}Suppression définitive de ton profil{'\n'}
                    {'• '}Déconnexion de tous tes groupes{'\n'}
                    {'• '}Suppression de toutes tes sessions{'\n\n'}
                    Les dépenses partagées restent visibles pour les autres membres.
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
                  style={[styles.deleteBtn, deleteConfirmText.toLowerCase() !== 'supprimer' && styles.deleteBtnDisabled]}
                  onPress={() => {
                    if (deleteConfirmText.toLowerCase() !== 'supprimer') return;
                    setDeleteStep('password');
                  }}
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
                    Entre ton mot de passe pour finaliser la suppression.
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
                  onPress={() => deleteMutation.mutate(deletePassword)}
                  disabled={deleteMutation.isPending}
                >
                  <Text style={styles.deleteBtnText}>
                    {deleteMutation.isPending ? 'Suppression…' : 'Supprimer définitivement'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.deleteCancelBtn} onPress={() => setDeleteStep('confirm')}>
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
  editColorBadge: {
    position: 'absolute', bottom: -2, right: -2,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  editColorBadgeText: { fontSize: 11 },

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
  colorDot: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.border },

  footer: { fontSize: 11, color: colors.text3, textAlign: 'center', marginTop: 24, marginBottom: 8 },

  modalScreen: { flex: 1, backgroundColor: colors.bg },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: spacing.xl, borderBottomWidth: 0.5, borderBottomColor: colors.border,
  },
  modalTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  modalClose: { paddingHorizontal: 14, paddingVertical: 7, backgroundColor: colors.surface2, borderRadius: radius.full },
  modalCloseText: { fontSize: 13, color: colors.text2, fontWeight: '500' },
  modalContent: { padding: spacing.xl, paddingBottom: 60 },

  colorPickerContent: { padding: spacing.xl, alignItems: 'center' },
  colorPickerSub: { fontSize: 14, color: colors.text3, marginBottom: 24, alignSelf: 'flex-start' },
  colorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, justifyContent: 'center', marginBottom: 32 },
  colorSwatch: {
    width: 54, height: 54, borderRadius: 27,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4,
  },
  colorSwatchSelected: {
    borderWidth: 3, borderColor: colors.white,
    shadowOpacity: 0.4, shadowRadius: 8,
  },
  colorSwatchCheck: { fontSize: 20, color: colors.white, fontWeight: '800' },
  colorPreview: { alignItems: 'center', marginBottom: 32, gap: 12 },
  colorPreviewName: { fontSize: 16, fontWeight: '600', color: colors.text },
  colorSaveBtn: {
    backgroundColor: colors.accent, borderRadius: radius.md,
    paddingVertical: 14, paddingHorizontal: 48, alignItems: 'center', width: '100%',
  },
  colorSaveBtnText: { fontSize: 15, fontWeight: '700', color: colors.white },

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
  deleteBtn: { backgroundColor: colors.red, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center' },
  deleteBtnDisabled: { opacity: 0.35 },
  deleteBtnText: { fontSize: 15, fontWeight: '700', color: colors.white },
  deleteCancelBtn: { marginTop: 14, alignItems: 'center', paddingVertical: 10 },
  deleteCancelText: { fontSize: 13, color: colors.text3 },
});
