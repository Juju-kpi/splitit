// backend/src/services/notifications.ts
// Service unifié d'envoi de push notifications.
//
// Le champ User.pushToken contient soit :
//   - un token Expo mobile : "ExponentPushToken[xxxxxxxxxxxx]"
//   - un abonnement Web Push stringifié en JSON : '{"endpoint":"...","keys":{...}}'
//
// Avant ce fix, TOUT était envoyé à l'API Expo (exp.host), ce qui ne fonctionne
// que pour les tokens mobiles. Les abonnements web étaient silencieusement
// rejetés par Expo (format invalide) → aucune notif web n'était jamais reçue.
//
// Ce service détecte le type de token et route vers le bon transport.

import webpush from 'web-push';

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = (process.env.VAPID_PRIVATE_KEY || '').trim();
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:contact@splitit.app';

let webPushConfigured = false;
if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
  webPushConfigured = true;
} else {
  console.warn('[Push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY manquants — web push désactivé');
}

export type PushPayload = {
  title: string;
  body: string;
  data?: Record<string, any>;
};

function isExpoToken(token: string): boolean {
  return token.startsWith('ExponentPushToken[') || token.startsWith('ExpoPushToken[');
}

function isWebSubscription(token: string): boolean {
  return token.trim().startsWith('{');
}

// ── Envoi vers les tokens mobiles (Expo) ────────────────────────────────────
async function sendExpoPush(tokens: string[], payload: PushPayload): Promise<void> {
  if (tokens.length === 0) return;

  const messages = tokens.map(token => ({
    to: token,
    title: payload.title,
    body: payload.body,
    data: payload.data || {},
  }));

  try {
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
    });

    const json: any = await res.json().catch(() => null);

    if (!res.ok) {
      console.error('[Push][Expo] HTTP error', res.status, json);
      return;
    }

    // Expo renvoie un "ticket" par message, avec status 'ok' ou 'error'.
    // On logge les erreurs individuelles (ex: DeviceNotRegistered, projet FCM
    // mal configuré, credentials FCM manquants, etc.) au lieu de les ignorer.
    const tickets: any[] = json?.data || [];
    tickets.forEach((ticket, i) => {
      if (ticket.status === 'error') {
        console.error(
          `[Push][Expo] Échec pour le token ${tokens[i]?.slice(0, 25)}… :`,
          ticket.message,
          ticket.details
        );
      }
    });
  } catch (e) {
    console.error('[Push][Expo] fetch failed:', e);
  }
}

// ── Envoi vers les abonnements web (VAPID) ──────────────────────────────────
async function sendWebPush(subscriptionsJson: string[], payload: PushPayload): Promise<void> {
  if (!webPushConfigured || subscriptionsJson.length === 0) return;

  await Promise.all(
    subscriptionsJson.map(async raw => {
      try {
        const subscription = JSON.parse(raw);
        await webpush.sendNotification(
          subscription,
          JSON.stringify({ title: payload.title, body: payload.body, data: payload.data || {} })
        );
      } catch (e: any) {
        // 410 / 404 = abonnement expiré ou révoqué par le navigateur.
        // On log juste ; le nettoyage des tokens invalides peut être fait
        // séparément si besoin (suppression en DB).
        console.error('[Push][Web] Échec d\'envoi:', e?.statusCode || e?.message || e);
      }
    })
  );
}

// ── Point d'entrée unique ────────────────────────────────────────────────────
// Prend une liste de pushToken bruts (mélange mobile + web) et route chacun
// vers le bon transport.
export async function sendPushNotification(tokens: string[], payload: PushPayload): Promise<void> {
  const expoTokens: string[] = [];
  const webSubscriptions: string[] = [];

  for (const token of tokens) {
    if (!token) continue;
    if (isExpoToken(token)) {
      expoTokens.push(token);
    } else if (isWebSubscription(token)) {
      webSubscriptions.push(token);
    } else {
      console.warn('[Push] Token de format inconnu ignoré:', token.slice(0, 30));
    }
  }

  await Promise.all([
    sendExpoPush(expoTokens, payload),
    sendWebPush(webSubscriptions, payload),
  ]);
}