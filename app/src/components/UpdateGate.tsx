// app/src/components/UpdateGate.tsx
//
// Previent l'utilisateur qu'une version plus recente est publiee sur le store.
//
// Pourquoi ici et pas une notification push : les preferences notifExpense et
// notifReminder sont a false par defaut, donc la plupart des utilisateurs ne
// recevraient rien. Un message a l'ouverture atteint tout le monde.
//
// Ce composant part par mise a jour OTA : il arrive donc sur les telephones
// deja installes, sans passer par le store — c'est ce qui permet d'annoncer
// le build suivant aux gens qui ont l'ancien.
//
// Rien ici ne doit jamais empecher l'application de demarrer : toute erreur
// reseau est avalee et l'ecran ne s'affiche pas.

import React, { useEffect, useState } from 'react';
import { View, Text, Modal, TouchableOpacity, StyleSheet, Linking, Platform } from 'react-native';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { appApi } from '../services/api';
import { useT } from '../store/langStore';
import { colors, radius, spacing, fonts } from '../theme';

type Verdict = 'ok' | 'update-available' | 'update-required';
type Info = {
  status: Verdict;
  latest: string | null;
  android: string | null;
  ios: string | null;
  notes: string | null;
};

const SNOOZE_KEY = 'splitit_update_snooze';
const SNOOZE_MS = 24 * 60 * 60 * 1000;

/** Version installee, telle que declaree dans app.json. */
export function installedVersion(): string | undefined {
  return Constants.expoConfig?.version ?? undefined;
}

/**
 * Faut-il montrer l'ecran ? Separe du composant pour rester lisible :
 *   - une mise a jour obligatoire ignore la mise en sourdine ;
 *   - une mise a jour proposee se represente au bout de 24 h, ou tout de
 *     suite si une version encore plus recente est parue entre-temps.
 */
export function shouldPrompt(
  status: Verdict, latest: string | null, snooze: string | null, now = Date.now()
): boolean {
  if (status === 'update-required') return true;
  if (status !== 'update-available') return false;
  if (!snooze) return true;
  const [version, atRaw] = snooze.split('|');
  const at = Number(atRaw);
  if (version !== (latest ?? '')) return true;       // une version plus recente est sortie
  if (!Number.isFinite(at)) return true;
  return now - at > SNOOZE_MS;
}

export default function UpdateGate() {
  const t = useT();
  const [info, setInfo] = useState<Info | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const current = installedVersion();
        const [data, snooze] = await Promise.all([
          appApi.version(current) as Promise<Info>,
          SecureStore.getItemAsync(SNOOZE_KEY).catch(() => null),
        ]);
        if (!alive || !data) return;
        if (shouldPrompt(data.status, data.latest, snooze)) setInfo(data);
      } catch {
        // Reseau indisponible, backend endormi : on ne montre rien.
      }
    })();
    return () => { alive = false; };
  }, []);

  if (!info) return null;
  const required = info.status === 'update-required';

  const storeUrl = Platform.OS === 'ios' ? info.ios : info.android;

  async function openStore() {
    if (!storeUrl) return;
    try { await Linking.openURL(storeUrl); } catch { /* rien a faire */ }
  }

  async function later() {
    try {
      await SecureStore.setItemAsync(SNOOZE_KEY, `${info?.latest ?? ''}|${Date.now()}`);
    } catch { /* la mise en sourdine est un confort, pas une garantie */ }
    setInfo(null);
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => { if (!required) later(); }}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{info.latest ?? ''}</Text>
          </View>

          <Text style={styles.title}>
            {required ? t('update.title_required') : t('update.title')}
          </Text>
          <Text style={styles.body}>
            {required
              ? t('update.body_required')
              : t('update.body', { version: info.latest ?? '' })}
          </Text>
          {!!info.notes && <Text style={styles.notes}>{info.notes}</Text>}

          {!!storeUrl && (
            <TouchableOpacity style={styles.primary} onPress={openStore} activeOpacity={0.85}>
              <Text style={styles.primaryText}>{t('update.cta')}</Text>
            </TouchableOpacity>
          )}

          {!required && (
            <TouchableOpacity style={styles.ghost} onPress={later} activeOpacity={0.7}>
              <Text style={styles.ghostText}>{t('update.later')}</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center', justifyContent: 'center', padding: spacing.xl,
  },
  card: {
    width: '100%', maxWidth: 360,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.lg, padding: spacing.xxl,
  },
  badge: {
    alignSelf: 'flex-start', backgroundColor: colors.accentBg,
    borderWidth: 1, borderColor: 'rgba(124,110,250,0.3)',
    borderRadius: radius.full, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 14,
  },
  badgeText: { fontFamily: fonts.semibold, fontSize: 11, color: colors.accent2, fontWeight: '700' },
  title: { fontFamily: fonts.semibold, fontSize: 20, fontWeight: '700', color: colors.text, letterSpacing: -0.3 },
  body: { fontFamily: fonts.regular, fontSize: 14, color: colors.text2, lineHeight: 20, marginTop: 10 },
  notes: { fontFamily: fonts.regular, fontSize: 13, color: colors.text3, lineHeight: 19, marginTop: 10 },
  primary: {
    marginTop: 22, minHeight: 48, borderRadius: radius.md,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
  },
  primaryText: { fontFamily: fonts.semibold, fontSize: 15, color: colors.white, fontWeight: '600' },
  ghost: { marginTop: 10, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  ghostText: { fontFamily: fonts.medium, fontSize: 14, color: colors.text3, fontWeight: '500' },
});
