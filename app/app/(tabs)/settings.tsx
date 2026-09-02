// app/app/(tabs)/settings.tsx
// Fixes et ajouts :
//   - Notifs prod : useEffect init utilise aussi la fonction registerForPushNotifications()
//     avec le bon projectId (résout le bug "token undefined en build Play Store")
//   - Langue : picker FR/EN/DE/ES/IT → sauvegarde en DB + applique i18n.locale immédiatement
//   - Devise : picker CHF/EUR/USD/GBP → sauvegarde en DB (pas de conversion)
//   - Export erreur : affiche le vrai message d'erreur backend

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
import Constants from 'expo-constants';
import { useAuthStore } from '../../src/store/authStore';
import { ocrApi, authApi, userApi } from '../../src/services/api';
import { Card, GlassCard, SectionLabel, Notice, ScreenHeader, Avatar } from '../../src/components/ui';
import Feather from '@expo/vector-icons/Feather';
import { colors, spacing, radius, fonts } from '../../src/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import i18n from '../../src/i18n';
import { useLangStore, useT } from '../../src/store/langStore';
import {
  PreferredLanguage,
  PreferredCurrency,
} from '../../src/types/preferences';

const APP_VERSION = '1.2.1';
const PRIVACY_URL = 'https://juju-kpi.github.io/splitit/privacy-policy.md';

const AVATAR_COLORS = [
  '#4F46E5', '#7C3AED', '#DB2777', '#DC2626', '#EA580C',
  '#CA8A04', '#16A34A', '#0891B2', '#2563EB', '#475569',
];

// Langue : code → label affiché
const LANGUAGES: { code: string; label: string; flag: string }[] = [
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
  { code: 'it', label: 'Italiano', flag: '🇮🇹' },
];

// Devise : code → symbole
const CURRENCIES: { code: string; label: string; symbol: string }[] = [
  { code: 'CHF', label: 'CHF — Franc suisse', symbol: 'Fr.' },
  { code: 'EUR', label: 'EUR — Euro', symbol: '€' },
  { code: 'USD', label: 'USD — Dollar US', symbol: '$' },
  { code: 'GBP', label: 'GBP — Livre sterling', symbol: '£' },
];

// ── Notifications setup ────────────────────────────────────────────────────
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// FIX NOTIFS PROD : projectId correctement résolu depuis app.json/eas.json
async function registerForPushNotifications(): Promise<string | null> {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return null;

  try {
    // Ordre de priorité : extra.eas.projectId → easConfig.projectId (build standalone)
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      (Constants as any).easConfig?.projectId;

    if (!projectId) {
      console.error('[Push] projectId manquant — vérifier app.json extra.eas.projectId');
      return null;
    }

    const tokenResult = await Notifications.getExpoPushTokenAsync({ projectId });
    console.log('[Push] Token obtenu:', tokenResult.data.slice(0, 20) + '…');
    return tokenResult.data;
  } catch (e) {
    console.error('[Push] getExpoPushTokenAsync failed:', e);
    return null;
  }
}

// ── SettingRow ─────────────────────────────────────────────────────────────
function SettingRow({
  icon, label, value, onPress, destructive = false, rightElement, loading = false,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
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
        <Feather name={icon} size={17} color={destructive ? colors.red : colors.text2} />
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
  const t = useT();
  const deleteKeyword = t('settings.delete_keyword').toLowerCase();

  // Color picker modal
  const [colorModalVisible, setColorModalVisible] = useState(false);
  const [selectedColor, setSelectedColor] = useState(user?.avatarColor || AVATAR_COLORS[0]);

  // Langue & Devise modals
  const [langModalVisible, setLangModalVisible] = useState(false);
  const [currencyModalVisible, setCurrencyModalVisible] = useState(false);
  const [selectedLang, setSelectedLang] = useState((user as any)?.preferredLanguage ?? i18n.locale ?? 'fr');
  const [selectedCurrency, setSelectedCurrency] = useState((user as any)?.preferredCurrency ?? 'CHF');

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

  // REMPLACE uniquement le useEffect d'init notifications dans settings.tsx
// (cherche "── Init notifications state" et remplace tout le bloc useEffect)

  // ── Init notifications state ──────────────────────────────────────────
  // Lit notifExpense/notifReminder depuis user (chargé via userApi.getMe au démarrage)
  // ET restaure le pushToken si la permission est déjà accordée
  useEffect(() => {
    // 1. Restaurer les prefs depuis le user store (déjà chargé par authStore.initialize)
    if (user?.notifExpense !== undefined) setNotifExpense(user.notifExpense);
    if (user?.notifReminder !== undefined) setNotifReminder(user.notifReminder);
    if (user?.pushToken) setPushToken(user.pushToken);

    // 2. Si permission déjà accordée mais token absent, en obtenir un nouveau
    (async () => {
      const { status } = await Notifications.getPermissionsAsync();
      if (status === 'granted' && !user?.pushToken) {
        const token = await registerForPushNotifications();
        if (token) setPushToken(token);
      }
    })();
  }, [user?.id]); // dépend de user.id pour se relancer si l'user change

  // ── Toggle notification ───────────────────────────────────────────────
  const handleNotifToggle = useCallback(async (type: 'expense' | 'reminder', value: boolean) => {
    setNotifLoading(true);
    try {
      let token = pushToken;

      if (value && !token) {
        token = await registerForPushNotifications();
        if (!token) {
          Alert.alert(
            t('settings.perm_denied'),
            t('settings.perm_denied_msg_mobile'),
            [
              { text: t('common.cancel'), style: 'cancel' },
              { text: t('common.open_settings'), onPress: () => Linking.openSettings() },
            ]
          );
          setNotifLoading(false);
          return;
        }
        setPushToken(token);
      }

      const newPrefs = {
        pushToken: token,
        notifExpense: type === 'expense' ? value : notifExpense,
        notifReminder: type === 'reminder' ? value : notifReminder,
      };

      await userApi.updateNotificationPrefs(newPrefs);

      if (type === 'expense') setNotifExpense(value);
      else setNotifReminder(value);

    } catch (e: any) {
      console.error('[Notif toggle error]', e?.response?.data || e?.message);
      Alert.alert(t('common.error'), e?.response?.data?.error || t('settings.notif_update_err'));
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
    onError: () => Alert.alert(t('common.error'), t('settings.color_save_err')),
  });

  // ── Langue save ───────────────────────────────────────────────────────
  const langMutation = useMutation({
    mutationFn: (lang: PreferredLanguage) =>
      userApi.updatePreferences({ preferredLanguage: lang }),
    onSuccess: (_, lang) => {
      useLangStore.getState().setLocale(lang);
      setUser({ ...(user as any), preferredLanguage: lang });
      setSelectedLang(lang);
      setLangModalVisible(false);
    },
  });

  // ── Devise save ───────────────────────────────────────────────────────
  const currencyMutation = useMutation({
    mutationFn: (currency: PreferredCurrency) =>
      userApi.updatePreferences({ preferredCurrency: currency }),
    onSuccess: (_, currency) => {
      useLangStore.getState().setCurrency(currency);
      setUser({ ...(user as any), preferredCurrency: currency });
      setSelectedCurrency(currency);
      setCurrencyModalVisible(false);
    },
  });

  // ── Export data ───────────────────────────────────────────────────────
  async function handleExportData() {
    Alert.alert(
      t('settings.export_data'),
      t('settings.export_confirm', { email: user?.email }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.send'),
          onPress: async () => {
            setExportLoading(true);
            try {
              await userApi.requestDataExport();
              Alert.alert(t('settings.export_sent'), t('settings.export_check', { email: user?.email }));
            } catch (e: any) {
              // FIX : afficher le vrai message d'erreur pour faciliter le debug
              const msg = e?.response?.data?.error || e?.message || 'Erreur inconnue';
              console.error('[Export error]', e?.response?.status, msg);
              Alert.alert(t('settings.export_err'), msg);
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
      Alert.alert(t('common.error'), t('settings.privacy_open_err'))
    );
  }

  // ── Logout ────────────────────────────────────────────────────────────
  function handleLogout() {
    Alert.alert(t('auth.logout'), t('auth.logout_confirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('auth.logout'), style: 'destructive', onPress: async () => {
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
      Alert.alert(t('common.error'), e?.response?.data?.error || t('settings.wrong_password'));
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

  const currentLang = LANGUAGES.find(l => l.code === selectedLang) ?? LANGUAGES[0];
  const currentCurrency = CURRENCIES.find(c => c.code === selectedCurrency) ?? CURRENCIES[0];

  return (
    <View style={styles.screen}>
      <ScreenHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />
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
                <Feather name="edit-2" size={11} color={colors.onPrimary} />
              </View>
            </TouchableOpacity>
            <View style={styles.profileInfo}>
              <Text style={styles.profileName}>{user?.username}</Text>
              <Text style={styles.profileEmail}>{user?.email}</Text>
              <View style={styles.profileBadge}>
                <Text style={styles.profileBadgeText}>{t('settings.active_member')}</Text>
              </View>
            </View>
          </View>
        </GlassCard>

        {/* OCR */}
        <SectionLabel label={t('settings.ocr_title')} />
        <Card>
          <View style={styles.ocrHeader}>
            <Text style={styles.ocrTitle}>{t('settings.ocr_model')} · v1.4</Text>
            <View style={[styles.ocrAccuracyBadge, {
              backgroundColor: accuracy >= 80 ? colors.greenBg : colors.amberBg,
            }]}>
              <Text style={[styles.ocrAccuracyText, {
                color: accuracy >= 80 ? colors.green : colors.amber,
              }]}>
                {t('settings.ocr_accurate', { v: accuracy.toFixed(0) })}
              </Text>
            </View>
          </View>
          <View style={styles.ocrStatsRow}>
            <View style={styles.ocrStat}>
              <Text style={[styles.ocrStatNum, { color: colors.accent2 }]}>{total}</Text>
              <Text style={styles.ocrStatLabel}>{t('settings.ocr_corrections')}</Text>
            </View>
            <View style={styles.ocrStatDivider} />
            <View style={styles.ocrStat}>
              <Text style={[styles.ocrStatNum, { color: colors.green }]}>{accuracy.toFixed(0)}%</Text>
              <Text style={styles.ocrStatLabel}>{t('settings.ocr_precision')}</Text>
            </View>
            <View style={styles.ocrStatDivider} />
            <View style={styles.ocrStat}>
              <Text style={[styles.ocrStatNum, { color: untrained > 0 ? colors.amber : colors.text3 }]}>
                {untrained}
              </Text>
              <Text style={styles.ocrStatLabel}>{t('settings.ocr_pending')}</Text>
            </View>
          </View>
          <View style={styles.progBarTrack}>
            <View style={[styles.progBarFill, { width: `${Math.min(accuracy, 100)}%` as any }]} />
          </View>
          <Text style={styles.progLabel}>
            {untrained > 0 ? t('settings.ocr_before_next', { n: untrained }) : t('settings.ocr_uptodate')}
          </Text>
        </Card>
        <Notice text={t('settings.ocr_notice')} variant="accent" />

        {/* Mon compte */}
        <SectionLabel label={t('settings.account')} />
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <SettingRow
            icon="calendar"
            label={t('settings.member_since')}
            value={user?.createdAt ? format(new Date(user.createdAt), 'MMM yyyy', { locale: fr }) : '—'}
          />
          <View style={styles.rowSeparator} />
          <SettingRow
            icon="droplet"
            label={t('settings.profile_color')}
            onPress={() => setColorModalVisible(true)}
            rightElement={
              <View style={[styles.colorDot, { backgroundColor: user?.avatarColor || colors.accent }]} />
            }
          />
        </Card>

        {/* Langue & Devise */}
        <SectionLabel label={t('settings.language_currency')} />
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <SettingRow
            icon="globe"
            label={t('settings.language')}
            value={`${currentLang.flag} ${currentLang.label}`}
            onPress={() => setLangModalVisible(true)}
          />
          <View style={styles.rowSeparator} />
          <SettingRow
            icon="repeat"
            label={t('settings.currency')}
            value={`${currentCurrency.symbol} ${currentCurrency.code}`}
            onPress={() => setCurrencyModalVisible(true)}
          />
        </Card>
        <Notice text={t('settings.currency_notice')} variant="amber" />

        {/* Notifications */}
        <SectionLabel label={t('settings.notifications')} />
        {pushToken && (
          <Notice text={t('settings.notif_enabled_device')} variant="accent" />
        )}
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <SettingRow
            icon="bell"
            label={t('settings.notif_expense')}
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
            icon="clock"
            label={t('settings.notif_reminder')}
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
        <SectionLabel label={t('settings.privacy')} />
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <SettingRow
            icon="download"
            label={t('settings.export_data')}
            onPress={handleExportData}
            loading={exportLoading}
          />
          <View style={styles.rowSeparator} />
          <SettingRow
            icon="lock"
            label={t('settings.privacy_policy')}
            onPress={handlePrivacyPolicy}
          />
          <View style={styles.rowSeparator} />
          <SettingRow
            icon="file-text"
            label={t('settings.terms')}
            onPress={() => Linking.openURL('https://juju-kpi.github.io/splitit/privacy-policy.md')}
          />
        </Card>

        {/* À propos */}
        <SectionLabel label={t('settings.about')} />
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <SettingRow icon="smartphone" label={t('settings.version')} value={APP_VERSION} />
          <View style={styles.rowSeparator} />
          <SettingRow
            icon="star"
            label={t('settings.rate')}
            onPress={() => Linking.openURL('market://details?id=com.julien.splitit').catch(() =>
              Linking.openURL('https://play.google.com/store/apps/details?id=com.julien.splitit')
            )}
          />
          <View style={styles.rowSeparator} />
          <SettingRow
            icon="message-circle"
            label={t('settings.feedback')}
            onPress={() => Linking.openURL('mailto:ares88775@gmail.com?subject=Feedback SplitIt')}
          />
        </Card>

        {/* Danger zone */}
        <SectionLabel label={t('settings.danger')} />
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <SettingRow icon="log-out" label={t('settings.logout_row')} onPress={handleLogout} />
          <View style={styles.rowSeparator} />
          <SettingRow icon="trash-2" label={t('settings.delete_account')} destructive onPress={openDeleteModal} />
        </Card>

        <Text style={styles.footer}>SplitIt {APP_VERSION} · {t('settings.made_with')}</Text>
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
            <Text style={styles.modalTitle}>{t('settings.profile_color')}</Text>
            <TouchableOpacity onPress={() => setColorModalVisible(false)} style={styles.modalClose}>
              <Text style={styles.modalCloseText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.colorPickerContent}>
            <Text style={styles.colorPickerSub}>{t('settings.color_pick_sub')}</Text>
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
                : <Text style={styles.colorSaveBtnText}>{t('common.save')}</Text>
              }
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

      {/* ── Langue modal ── */}
      <Modal
        visible={langModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setLangModalVisible(false)}
      >
        <View style={styles.modalScreen}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{t('settings.language')}</Text>
            <TouchableOpacity onPress={() => setLangModalVisible(false)} style={styles.modalClose}>
              <Text style={styles.modalCloseText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.pickerContent}>
            {LANGUAGES.map(lang => (
              <TouchableOpacity
                key={lang.code}
                style={[styles.pickerRow, selectedLang === lang.code && styles.pickerRowSelected]}
                onPress={() => setSelectedLang(lang.code)}
                activeOpacity={0.7}
              >
                <Text style={styles.pickerFlag}>{lang.flag}</Text>
                <Text style={[styles.pickerLabel, selectedLang === lang.code && { color: colors.accent2, fontWeight: '700' }]}>
                  {lang.label}
                </Text>
                {selectedLang === lang.code && <Text style={styles.pickerCheck}>✓</Text>}
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[styles.colorSaveBtn, { marginTop: 24 }, langMutation.isPending && { opacity: 0.6 }]}
              onPress={() => langMutation.mutate(selectedLang)}
              disabled={langMutation.isPending}
            >
              {langMutation.isPending
                ? <ActivityIndicator color={colors.white} />
                : <Text style={styles.colorSaveBtnText}>{t('common.apply')}</Text>
              }
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

      {/* ── Devise modal ── */}
      <Modal
        visible={currencyModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setCurrencyModalVisible(false)}
      >
        <View style={styles.modalScreen}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{t('settings.currency')}</Text>
            <TouchableOpacity onPress={() => setCurrencyModalVisible(false)} style={styles.modalClose}>
              <Text style={styles.modalCloseText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.pickerContent}>
            <Notice text={t('settings.currency_notice_short')} variant="amber" />
            {CURRENCIES.map(currency => (
              <TouchableOpacity
                key={currency.code}
                style={[styles.pickerRow, selectedCurrency === currency.code && styles.pickerRowSelected]}
                onPress={() => setSelectedCurrency(currency.code)}
                activeOpacity={0.7}
              >
                <Text style={styles.pickerSymbol}>{currency.symbol}</Text>
                <Text style={[styles.pickerLabel, selectedCurrency === currency.code && { color: colors.accent2, fontWeight: '700' }]}>
                  {t(`settings.currency_${currency.code.toLowerCase()}`)}
                </Text>
                {selectedCurrency === currency.code && <Text style={styles.pickerCheck}>✓</Text>}
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={[styles.colorSaveBtn, { marginTop: 24 }, currencyMutation.isPending && { opacity: 0.6 }]}
              onPress={() => currencyMutation.mutate(selectedCurrency)}
              disabled={currencyMutation.isPending}
            >
              {currencyMutation.isPending
                ? <ActivityIndicator color={colors.white} />
                : <Text style={styles.colorSaveBtnText}>{t('common.apply')}</Text>
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
            <Text style={[styles.modalTitle, { color: colors.red }]}>{t('settings.delete_account')}</Text>
            <TouchableOpacity onPress={() => setDeleteModalVisible(false)} style={styles.modalClose}>
              <Text style={styles.modalCloseText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
            {deleteStep === 'confirm' && (
              <>
                <View style={styles.deleteWarning}>
                  <Text style={styles.deleteWarningTitle}>{t('settings.delete_warning')}</Text>
                  <Text style={styles.deleteWarningText}>{t('settings.delete_bullets')}</Text>
                </View>
                <Text style={styles.deleteConfirmLabel}>
                  {t('settings.delete_type_before')} <Text style={{ color: colors.red, fontWeight: '700' }}>{t('settings.delete_keyword')}</Text> {t('settings.delete_type_after')}
                </Text>
                <TextInput
                  style={styles.deleteConfirmInput}
                  placeholder={t('settings.delete_keyword')}
                  placeholderTextColor={colors.text3}
                  value={deleteConfirmText}
                  onChangeText={setDeleteConfirmText}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity
                  style={[styles.deleteBtn, deleteConfirmText.trim().toLowerCase() !== deleteKeyword && styles.deleteBtnDisabled]}
                  onPress={() => {
                    if (deleteConfirmText.trim().toLowerCase() !== deleteKeyword) return;
                    setDeleteStep('password');
                  }}
                  disabled={deleteConfirmText.trim().toLowerCase() !== deleteKeyword}
                >
                  <Text style={styles.deleteBtnText}>{t('common.continue')} →</Text>
                </TouchableOpacity>
              </>
            )}
            {deleteStep === 'password' && (
              <>
                <View style={styles.deleteWarning}>
                  <Text style={styles.deleteWarningTitle}>{t('settings.delete_confirm_pw')}</Text>
                  <Text style={styles.deleteWarningText}>{t('settings.delete_confirm_pw_sub')}</Text>
                </View>
                <Text style={styles.deleteConfirmLabel}>{t('auth.password')}</Text>
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
                    {deleteMutation.isPending ? t('settings.deleting') : t('settings.delete_final')}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.deleteCancelBtn} onPress={() => setDeleteStep('confirm')}>
                  <Text style={styles.deleteCancelText}>{t('common.back')}</Text>
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
  profileName: { fontFamily: fonts.semibold, fontSize: 18, fontWeight: '700', color: colors.text, letterSpacing: -0.3 },
  profileEmail: { fontFamily: fonts.regular, fontSize: 12, color: colors.text3, marginTop: 3 },
  profileBadge: {
    marginTop: 8, alignSelf: 'flex-start',
    backgroundColor: colors.accentBg, borderWidth: 1, borderColor: 'rgba(124,110,250,0.25)',
    paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.full,
  },
  profileBadgeText: { fontFamily: fonts.semibold, fontSize: 11, color: colors.accent2, fontWeight: '700' },
  editColorBadge: {
    position: 'absolute', bottom: -2, right: -2,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  editColorBadgeText: { fontFamily: fonts.regular, fontSize: 11 },

  ocrHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  ocrTitle: { fontFamily: fonts.semibold, fontSize: 14, fontWeight: '700', color: colors.text },
  ocrAccuracyBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.full },
  ocrAccuracyText: { fontFamily: fonts.semibold, fontSize: 12, fontWeight: '700' },
  ocrStatsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', marginBottom: 16 },
  ocrStat: { flex: 1, alignItems: 'center' },
  ocrStatNum: { fontSize: 26, fontWeight: '300', fontFamily: fonts.mono },
  ocrStatLabel: { fontFamily: fonts.semibold, fontSize: 10, color: colors.text3, marginTop: 3, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8 },
  ocrStatDivider: { width: 0.5, height: 40, backgroundColor: colors.glassBorder },
  progBarTrack: { height: 4, backgroundColor: colors.surface2, borderRadius: 2, overflow: 'hidden', marginBottom: 8 },
  progBarFill: { height: '100%', borderRadius: 2, backgroundColor: colors.primary },
  progLabel: { fontFamily: fonts.regular, fontSize: 11, color: colors.text3, lineHeight: 16 },

  settingRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: spacing.lg, paddingVertical: 14, minHeight: 52,
  },
  settingIconWrap: {
    width: 32, height: 32, borderRadius: 9,
    backgroundColor: colors.surface3, alignItems: 'center', justifyContent: 'center',
  },
  settingIconWrapDanger: { backgroundColor: 'rgba(248,113,113,0.12)' },
  settingIcon: { fontFamily: fonts.regular, fontSize: 15 },
  settingLabel: { flex: 1, fontFamily: fonts.medium, fontSize: 14, fontWeight: '500', color: colors.text },
  settingValue: { fontFamily: fonts.medium, fontSize: 12, color: colors.text3, fontWeight: '500' },
  settingArrow: { fontFamily: fonts.regular, fontSize: 18, color: colors.text3, fontWeight: '300' },
  rowSeparator: { height: 0.5, backgroundColor: colors.glassBorder, marginLeft: spacing.lg + 32 + 12 },
  colorDot: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.border },

  footer: { fontFamily: fonts.regular, fontSize: 11, color: colors.text3, textAlign: 'center', marginTop: 24, marginBottom: 8 },

  modalScreen: { flex: 1, backgroundColor: colors.bg },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: spacing.xl, borderBottomWidth: 0.5, borderBottomColor: colors.border,
  },
  modalTitle: { fontFamily: fonts.semibold, fontSize: 16, fontWeight: '700', color: colors.text },
  modalClose: { paddingHorizontal: 14, paddingVertical: 7, backgroundColor: colors.surface2, borderRadius: radius.full },
  modalCloseText: { fontFamily: fonts.medium, fontSize: 13, color: colors.text2, fontWeight: '500' },
  modalContent: { padding: spacing.xl, paddingBottom: 60 },

  colorPickerContent: { padding: spacing.xl, alignItems: 'center' },
  colorPickerSub: { fontFamily: fonts.regular, fontSize: 14, color: colors.text3, marginBottom: 24, alignSelf: 'flex-start' },
  colorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, justifyContent: 'center', marginBottom: 32 },
  colorSwatch: {
    width: 54, height: 54, borderRadius: 27,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4,
  },
  colorSwatchSelected: { borderWidth: 3, borderColor: colors.white, shadowOpacity: 0.4, shadowRadius: 8 },
  colorSwatchCheck: { fontFamily: fonts.semibold, fontSize: 20, color: colors.white, fontWeight: '800' },
  colorPreview: { alignItems: 'center', marginBottom: 32, gap: 12 },
  colorPreviewName: { fontFamily: fonts.semibold, fontSize: 16, fontWeight: '600', color: colors.text },
  colorSaveBtn: {
    backgroundColor: colors.primary, borderRadius: radius.md,
    paddingVertical: 14, paddingHorizontal: 48, alignItems: 'center', width: '100%',
  },
  colorSaveBtnText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.onPrimary },

  // Langue & Devise picker
  pickerContent: { padding: spacing.xl, paddingBottom: 60 },
  pickerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingVertical: 16, paddingHorizontal: 12,
    borderRadius: radius.md, marginBottom: 4,
  },
  pickerRowSelected: { backgroundColor: colors.accentBg },
  pickerFlag: { fontFamily: fonts.regular, fontSize: 24 },
  pickerSymbol: { fontFamily: fonts.semibold, fontSize: 20, width: 32, textAlign: 'center', color: colors.text, fontWeight: '600' },
  pickerLabel: { flex: 1, fontFamily: fonts.regular, fontSize: 15, color: colors.text },
  pickerCheck: { fontFamily: fonts.semibold, fontSize: 16, color: colors.accent2, fontWeight: '700' },

  deleteWarning: {
    backgroundColor: 'rgba(248,113,113,0.06)', borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.2)', borderRadius: radius.md, padding: 16, marginBottom: 24,
  },
  deleteWarningTitle: { fontFamily: fonts.semibold, fontSize: 15, fontWeight: '700', color: colors.red, marginBottom: 10 },
  deleteWarningText: { fontFamily: fonts.regular, fontSize: 13, color: colors.text2, lineHeight: 20 },
  deleteConfirmLabel: { fontFamily: fonts.regular, fontSize: 13, color: colors.text2, marginBottom: 10 },
  deleteConfirmInput: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: 'rgba(248,113,113,0.4)',
    borderRadius: radius.sm, paddingHorizontal: 14, paddingVertical: 12,
    color: colors.text, fontFamily: fonts.regular, fontSize: 15, marginBottom: 20,
  },
  deleteBtn: { backgroundColor: colors.red, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center' },
  deleteBtnDisabled: { opacity: 0.35 },
  deleteBtnText: { fontFamily: fonts.semibold, fontSize: 15, fontWeight: '700', color: colors.white },
  deleteCancelBtn: { marginTop: 14, alignItems: 'center', paddingVertical: 10 },
  deleteCancelText: { fontFamily: fonts.regular, fontSize: 13, color: colors.text3 },
});