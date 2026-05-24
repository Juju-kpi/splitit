// app/app/(tabs)/settings.tsx
import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../src/store/authStore';
import { ocrApi } from '../../src/services/api';
import { Card, GlassCard, Button, SectionLabel, Notice, ScreenHeader, Avatar } from '../../src/components/ui';
import { colors, spacing, radius, shadows } from '../../src/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

function SettingRow({ icon, label, value, onPress }: { icon: string; label: string; value?: string; onPress?: () => void }) {
  return (
    <TouchableOpacity
      style={styles.settingRow}
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
      disabled={!onPress}
    >
      <View style={styles.settingIconWrap}>
        <Text style={styles.settingIcon}>{icon}</Text>
      </View>
      <Text style={styles.settingLabel}>{label}</Text>
      {value && <Text style={styles.settingValue}>{value}</Text>}
      {onPress && <Text style={styles.settingArrow}>›</Text>}
    </TouchableOpacity>
  );
}

export default function SettingsScreen() {
  const user = useAuthStore(s => s.user);
  const logout = useAuthStore(s => s.logout);
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { data: ocrStats } = useQuery({
    queryKey: ['ocrStats'],
    queryFn: ocrApi.getStats,
    refetchInterval: 60_000,
  });

  function handleLogout() {
    Alert.alert('Déconnexion', 'Tu veux vraiment te déconnecter ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Déconnexion', style: 'destructive', onPress: async () => {
        await logout();
        router.replace('/(auth)/login');
      }},
    ]);
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
            <View style={[styles.ocrAccuracyBadge, { backgroundColor: accuracy >= 80 ? colors.greenBg : colors.amberBg }]}>
              <Text style={[styles.ocrAccuracyText, { color: accuracy >= 80 ? colors.green : colors.amber }]}>
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

          {/* Progress bar */}
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

        {/* User info */}
        <SectionLabel label="Mon compte" />
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <SettingRow
            icon="📅"
            label="Membre depuis"
            value={user?.createdAt ? format(new Date(user.createdAt), 'MMM yyyy', { locale: fr }) : '—'}
          />
          <View style={styles.rowSeparator} />
          <SettingRow icon="🌍" label="Langue" value="Français" />
        </Card>

        {/* Danger zone */}
        <SectionLabel label="Compte" />
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout} activeOpacity={0.8}>
          <Text style={styles.logoutIcon}>👋</Text>
          <Text style={styles.logoutText}>Se déconnecter</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing.xl },

  // Profile
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

  // OCR
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

  // Setting rows
  settingRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: spacing.lg, paddingVertical: 14, minHeight: 52,
  },
  settingIconWrap: {
    width: 32, height: 32, borderRadius: 9,
    backgroundColor: colors.surface3, alignItems: 'center', justifyContent: 'center',
  },
  settingIcon: { fontSize: 15 },
  settingLabel: { flex: 1, fontSize: 14, fontWeight: '500', color: colors.text },
  settingValue: { fontSize: 12, color: colors.text3, fontWeight: '500' },
  settingArrow: { fontSize: 18, color: colors.text3, fontWeight: '300' },
  rowSeparator: { height: 0.5, backgroundColor: colors.glassBorder, marginLeft: spacing.lg + 32 + 12 },

  // Logout
  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: 'rgba(248,113,113,0.08)',
    borderWidth: 1, borderColor: 'rgba(248,113,113,0.2)',
    borderRadius: radius.md, paddingVertical: 15, minHeight: 52,
  },
  logoutIcon: { fontSize: 18 },
  logoutText: { fontSize: 15, fontWeight: '600', color: colors.red },
});