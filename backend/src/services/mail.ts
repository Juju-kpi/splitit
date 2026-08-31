// backend/src/services/mail.ts
//
// Envoi d'emails, deux transports possibles :
//
//   Brevo  — BREVO_API_KEY. API HTTPS, donc utilisable depuis un hebergeur
//            qui filtre les ports SMTP (c'est le cas de Render sur ses offres
//            gratuites : 25, 465 et 587 sont bloques). Brevo valide une simple
//            ADRESSE d'expedition, pas forcement un domaine : une adresse
//            Gmail verifiee suffit pour ecrire a n'importe qui.
//
//   SMTP   — SMTP_USER + SMTP_PASSWORD (ou GMAIL_USER + GMAIL_APP_PASSWORD),
//            smtp.gmail.com:465 par defaut. Ne fonctionne que la ou les ports
//            SMTP sortants sont ouverts.
//
//   Resend — RESEND_API_KEY. Sans domaine verifie, Resend n'accepte QUE
//            l'adresse du proprietaire du compte comme destinataire.
//
// Ordre de priorite : Brevo, puis SMTP, puis Resend.

import nodemailer, { Transporter } from 'nodemailer';

const SMTP_USER = process.env.SMTP_USER || process.env.GMAIL_USER;
const SMTP_PASSWORD = process.env.SMTP_PASSWORD || process.env.GMAIL_APP_PASSWORD;
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);

export type MailTransport = 'brevo' | 'smtp' | 'resend' | null;

export function activeTransport(): MailTransport {
  if (process.env.BREVO_API_KEY) return 'brevo';
  if (SMTP_USER && SMTP_PASSWORD) return 'smtp';
  if (process.env.RESEND_API_KEY) return 'resend';
  return null;
}

/** Separe "Nom <adresse@exemple.fr>" en ses deux parties. */
function parseFrom(value: string): { name?: string; email: string } {
  const match = value.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (match) return { name: match[1] || undefined, email: match[2].trim() };
  return { email: value.trim() };
}

/** Vrai si l'on peut ecrire a n'importe qui, pas seulement au proprietaire du compte. */
export function canSendToAnyRecipient(): boolean {
  const transport = activeTransport();
  if (transport === 'brevo' || transport === 'smtp') return true;
  // Resend n'accepte des destinataires libres qu'avec un domaine verifie,
  // c'est-a-dire un expediteur autre que son adresse de test partagee.
  const from = process.env.APP_FROM_EMAIL || process.env.EMAIL_FROM || '';
  return transport === 'resend' && !!from && !from.includes('resend.dev');
}

// L'adresse d'expedition. Une adresse resend.dev n'a de sens QUE pour Resend :
// ailleurs elle n'est pas un expediteur validé et le message est rejete en
// silence. On lui prefere alors le compte SMTP configure.
function resolveFrom(transport: MailTransport): string {
  const explicit = process.env.APP_FROM_EMAIL || process.env.EMAIL_FROM;
  if (transport === 'resend') return explicit || 'SplitIt <onboarding@resend.dev>';
  if (explicit && !explicit.includes('resend.dev')) return explicit;
  if (SMTP_USER) return `SplitIt <${SMTP_USER}>`;
  return '';
}

let transporter: Transporter | null = null;
function smtp(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASSWORD },
      // Certains hebergeurs n'ont pas d'IPv6 sortant : sans ca, Node tente
      // l'enregistrement AAAA et echoue en ENETUNREACH. `family` n'est pas
      // declare dans les types de nodemailer mais est transmis a net.connect.
      family: 4,
    } as any);
  }
  return transporter;
}

export async function sendEmail(opts: { to: string; subject: string; html: string }): Promise<void> {
  const transport = activeTransport();
  if (!transport) throw new Error('Aucun transport email configure (BREVO_API_KEY, SMTP_USER ou RESEND_API_KEY)');

  const from = resolveFrom(transport);
  if (!from) {
    throw new Error('Aucune adresse d expedition utilisable : renseigne APP_FROM_EMAIL');
  }

  if (transport === 'brevo') {
    const sender = parseFrom(from);
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': process.env.BREVO_API_KEY!,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender,
        to: [{ email: opts.to }],
        subject: opts.subject,
        htmlContent: opts.html,
      }),
    });
    if (!res.ok) throw new Error(`Brevo ${res.status} : ${await res.text()}`);
    return;
  }

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
  if (transport === 'brevo') {
    const from = resolveFrom('brevo');
    console.log(`[Mail] Brevo (API HTTPS) — expediteur ${from || 'AUCUN'}`);
    if (!from) {
      console.warn('[Mail] Renseigne APP_FROM_EMAIL avec une adresse validee comme '
        + 'expediteur chez Brevo, sinon aucun message ne partira.');
    }
    return;
  }
  if (transport === 'smtp') {
    console.log(`[Mail] SMTP ${SMTP_HOST}:${SMTP_PORT} (${SMTP_USER})`);
    console.warn('[Mail] Attention : de nombreux hebergeurs filtrent les ports SMTP sortants '
      + '(Render bloque 25, 465 et 587). Utilise BREVO_API_KEY si les envois expirent.');
    return;
  }
  console.log('[Mail] Resend');
  if (!canSendToAnyRecipient()) {
    console.warn('[Mail] Expediteur de test Resend : les envois n aboutiront QUE vers '
      + 'l adresse du proprietaire du compte. Verifie un domaine, ou configure '
      + 'GMAIL_USER + GMAIL_APP_PASSWORD pour joindre tes utilisateurs.');
  }
}
