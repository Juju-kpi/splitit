// app/app/(tabs)/settings.tsx
import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../../src/store/authStore';
import { ocrApi } from '../../src/services/api';
import { Card, Button, SectionLabel, Notice } from '../../src/components/ui';
import { colors, spacing } from '../../src/theme';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

export default function SettingsScreen() {
  const user = useAuthStore(s => s.user);
  const logout = useAuthStore(s => s.logout);
  const router = useRouter();

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
    <ScrollView style={styles.screen} contentContainerStyle={styles.scroll}>
      <Text style={styles.title}>Réglages</Text>

      {/* Profile */}
      <SectionLabel label="Profil" />
      <Card>
        <View style={styles.profileRow}>
          <View style={[styles.avatar, { backgroundColor: user?.avatarColor || colors.accent }]}>
            <Text style={styles.avatarText}>{user?.username?.slice(0, 2).toUpperCase()}</Text>
          </View>
          <View>
            <Text style={styles.profileName}>{user?.username}</Text>
            <Text style={styles.profileEmail}>{user?.email}</Text>
          </View>
        </View>
      </Card>

      {/* OCR Training stats */}
      <SectionLabel label="Entraînement OCR" />
      <Card>
        <View style={styles.ocrHeader}>
          <Text style={styles.ocrTitle}>🧠 Modèle local · v1.4</Text>
          <Text style={styles.ocrConf}>{accuracy.toFixed(0)}% précision</Text>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statNum}>{total}</Text>
            <Text style={styles.statLabel}>Corrections</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statNum, { color: colors.green }]}>{accuracy.toFixed(0)}%</Text>
            <Text style={styles.statLabel}>Précision</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={[styles.statNum, { color: untrained > 0 ? colors.amber : colors.text3 }]}>{untrained}</Text>
            <Text style={styles.statLabel}>En attente</Text>
          </View>
        </View>

        {/* Progress bar */}
        <View style={styles.progBarTrack}>
          <View style={[styles.progBarFill, { width: `${Math.min(accuracy, 100)}%` }]} />
        </View>
        <Text style={styles.progLabel}>
          {untrained > 0
            ? `${untrained} corrections avant le prochain affinement automatique`
            : 'Modèle à jour ✓'}
        </Text>

        {ocrStats?.lastTrainingRun && (
          <Text style={[styles.progLabel, { marginTop: 4 }]}>
            Dernier entraînement : {format(new Date(ocrStats.lastTrainingRun), 'dd MMM yyyy', { locale: fr })}
          </Text>
        )}
      </Card>

      <Notice text="Chaque correction que tu fais sur un ticket améliore l'OCR pour tout le monde. Les données sont anonymisées." />

      {/* Danger zone */}
      <SectionLabel label="Compte" />
      <Button label="Se déconnecter" onPress={handleLogout} variant="ghost" />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingHorizontal: spacing.xl, paddingBottom: 100 },
  title: { fontSize: 26, fontWeight: '700', color: colors.text, marginTop: 20, marginBottom: 4 },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.white, fontSize: 16, fontWeight: '700' },
  profileName: { fontSize: 16, fontWeight: '600', color: colors.text },
  profileEmail: { fontSize: 12, color: colors.text3, marginTop: 2 },
  ocrHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  ocrTitle: { fontSize: 13, fontWeight: '500', color: colors.text },
  ocrConf: { fontSize: 12, color: colors.accent2 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 14 },
  statItem: { alignItems: 'center' },
  statNum: { fontSize: 24, fontWeight: '500', fontFamily: 'monospace', color: colors.accent2 },
  statLabel: { fontSize: 10, color: colors.text3, marginTop: 2 },
  progBarTrack: { backgroundColor: colors.surface2, borderRadius: 4, height: 6, overflow: 'hidden', marginBottom: 6 },
  progBarFill: { height: '100%', borderRadius: 4, backgroundColor: colors.accent },
  progLabel: { fontSize: 11, color: colors.text3 },
});
