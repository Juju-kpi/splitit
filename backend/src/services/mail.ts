// backend/src/services/mail.ts
//
// Envoi d'emails, deux transports possibles :
//
//   SMTP   — SMTP_USER + SMTP_PASSWORD (ou GMAIL_USER + GMAIL_APP_PASSWORD).
//            Par defaut smtp.gmail.com:465. Envoie a n'importe quel
//            destinataire, sans posseder de domaine. Un mot de passe
//            d'application Google est requis (2FA activee), pas le mot de
//            passe du compte. Environ 500 destinataires par jour.
//
//   Resend — RESEND_API_KEY. Sans domaine verifie, Resend n'accepte QUE
//            l'adresse du proprietaire du compte comme destinataire : a
//            reserver aux mails qui te sont adresses.
//
// SMTP est prioritaire quand il est configure.

import nodemailer, { Transporter } from 'nodemailer';

const SMTP_USER = process.env.SMTP_USER || process.env.GMAIL_USER;
const SMTP_PASSWORD = process.env.SMTP_PASSWORD || process.env.GMAIL_APP_PASSWORD;
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);

export type MailTransport = 'smtp' | 'resend' | null;

export function activeTransport(): MailTransport {
  if (SMTP_USER && SMTP_PASSWORD) return 'smtp';
  if (process.env.RESEND_API_KEY) return 'resend';
  return null;
}

/** Vrai si l'on peut ecrire a n'importe qui, pas seulement au proprietaire du compte. */
export function canSendToAnyRecipient(): boolean {
  if (activeTransport() === 'smtp') return true;
  // Resend n'accepte des destinataires libres qu'avec un domaine verifie,
  // c'est-a-dire un expediteur autre que son adresse de test partagee.
  const from = process.env.APP_FROM_EMAIL || process.env.EMAIL_FROM || '';
  return activeTransport() === 'resend' && !!from && !from.includes('resend.dev');
}

let transporter: Transporter | null = null;
function smtp(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
    });
  }
  return transporter;
}

export async function sendEmail(opts: { to: string; subject: string; html: string }): Promise<void> {
  const transport = activeTransport();
  if (!transport) throw new Error('Aucun transport email configure (SMTP_USER ou RESEND_API_KEY)');

  const from = process.env.APP_FROM_EMAIL
    || process.env.EMAIL_FROM
    || (transport === 'smtp' ? `SplitIt <${SMTP_USER}>` : 'SplitIt <onboarding@resend.dev>');

  if (transport === 'smtp') {
    await smtp().sendMail({ from, to: opts.to, subject: opts.subject, html: opts.html });
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from, to: [opts.to], subject: opts.subject, html: opts.html }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status} : ${await res.text()}`);
}

/** Journalise au demarrage ce qui est reellement configure. */
export function logMailConfig(): void {
  const transport = activeTransport();
  if (!transport) {
    console.warn('[Mail] Aucun transport configure — les mails de reinitialisation ne partiront pas.');
    return;
  }
  if (transport === 'smtp') {
    console.log(`[Mail] SMTP ${SMTP_HOST}:${SMTP_PORT} (${SMTP_USER})`);
    return;
  }
  console.log('[Mail] Resend');
  if (!canSendToAnyRecipient()) {
    console.warn('[Mail] Expediteur de test Resend : les envois n aboutiront QUE vers '
      + 'l adresse du proprietaire du compte. Verifie un domaine, ou configure '
      + 'GMAIL_USER + GMAIL_APP_PASSWORD pour joindre tes utilisateurs.');
  }
}
