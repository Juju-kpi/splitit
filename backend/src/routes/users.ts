// backend/src/routes/users.ts
// Fix : Gmail SMTP → Resend API (Render bloque les connexions SMTP sortantes)
//       + langue/devise préférences utilisateur

import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { AuthRequest } from '../middleware/auth';

const router = Router();

// ── Resend (HTTP API, fonctionne sur Render) ──────────────────────────────
// Variable d'environnement requise : RESEND_API_KEY
// Resend permet d'envoyer depuis onboarding@resend.dev sans domaine custom
async function sendEmailViaResend(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error('RESEND_API_KEY not configured');

  // FROM : utilise ton domaine vérifié si tu en as un, sinon onboarding@resend.dev
  // Pour tester sans domaine : "SplitIt <onboarding@resend.dev>"
  // Avec domaine vérifié  : "SplitIt <noreply@ton-domaine.com>"
  const from = process.env.EMAIL_FROM ?? 'SplitIt <onboarding@resend.dev>';

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend error ${res.status}: ${body}`);
  }
}

// ── PATCH /api/users/profile ─────────────────────────────────────────────
router.patch('/profile', async (req: AuthRequest, res: Response) => {
  const schema = z.object({
    avatarColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    username: z.string().min(2).max(30).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const user = await prisma.user.update({
    where: { id: req.userId },
    data: parsed.data,
    select: { id: true, email: true, username: true, avatarColor: true, createdAt: true },
  });

  if (parsed.data.avatarColor) {
    await prisma.groupMember.updateMany({
      where: { userId: req.userId },
      data: { avatarColor: parsed.data.avatarColor },
    });
  }

  res.json({ data: user });
});

// ── PATCH /api/users/notification-prefs ──────────────────────────────────
router.patch('/notification-prefs', async (req: AuthRequest, res: Response) => {
  const schema = z.object({
    pushToken: z.string().nullable(),
    notifExpense: z.boolean(),
    notifReminder: z.boolean(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const user = await prisma.user.update({
    where: { id: req.userId },
    data: {
      pushToken: parsed.data.pushToken,
      notifExpense: parsed.data.notifExpense,
      notifReminder: parsed.data.notifReminder,
    },
    select: {
      id: true, email: true, username: true, avatarColor: true,
      pushToken: true, notifExpense: true, notifReminder: true, createdAt: true,
    },
  });

  res.json({ data: user });
});

// ── PATCH /api/users/preferences ─────────────────────────────────────────
// Langue et devise préférées (NOUVELLE ROUTE)
router.patch('/preferences', async (req: AuthRequest, res: Response) => {
  const schema = z.object({
    preferredLanguage: z.enum(['fr', 'en', 'de', 'es', 'it']).optional(),
    preferredCurrency: z.enum(['CHF', 'EUR', 'USD', 'GBP']).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const user = await prisma.user.update({
    where: { id: req.userId },
    data: parsed.data,
    select: {
      id: true, email: true, username: true, avatarColor: true,
      preferredLanguage: true, preferredCurrency: true, createdAt: true,
    },
  });

  res.json({ data: user });
});

// ── GET /api/users/me ─────────────────────────────────────────────────────
// Retourne les préférences complètes pour restaurer l'état au démarrage
router.get('/me', async (req: AuthRequest, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: {
      id: true, email: true, username: true, avatarColor: true,
      pushToken: true, notifExpense: true, notifReminder: true,
      preferredLanguage: true, preferredCurrency: true, createdAt: true,
    },
  });
  if (!user) return res.status(404).json({ error: 'Not found' });
  res.json({ data: user });
});

// ── POST /api/users/export ───────────────────────────────────────────────
// Génère un récap HTML et l'envoie par email via Resend
router.post('/export', async (req: AuthRequest, res: Response) => {
  console.log(`[Export] Request from userId=${req.userId}`);

  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    include: {
      groupMembers: {
        include: {
          group: {
            include: {
              expenses: {
                include: {
                  payments: { include: { member: true } },
                  splits: { include: { member: true } },
                },
                orderBy: { createdAt: 'desc' },
                take: 50,
              },
              _count: { select: { members: true } },
            },
          },
        },
      },
    },
  });

  if (!user) return res.status(404).json({ error: 'User not found' });

  const currency = (user as any).preferredCurrency ?? 'CHF';

  const totalSpent = user.groupMembers.reduce((sum, gm) => {
    return sum + gm.group.expenses.reduce((s, exp) => {
      const mySplit = exp.splits.find(sp => sp.memberId === gm.id);
      return s + (mySplit?.amount || 0);
    }, 0);
  }, 0);

  const groupsHtml = user.groupMembers.map(gm => {
    const groupTotal = gm.group.expenses.reduce((s, e) => s + e.totalAmount, 0);
    const myShare = gm.group.expenses.reduce((s, e) => {
      const sp = e.splits.find(sp => sp.memberId === gm.id);
      return s + (sp?.amount || 0);
    }, 0);

    const expensesHtml = gm.group.expenses.slice(0, 10).map(e =>
      `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid #eee">${e.description}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${e.totalAmount.toFixed(2)} ${currency}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;color:#666">${new Date(e.createdAt).toLocaleDateString('fr-CH')}</td>
      </tr>`
    ).join('');

    return `
      <div style="margin-bottom:32px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
        <div style="background:#0D1128;color:white;padding:12px 16px">
          <strong>${gm.group.emoji} ${gm.group.name}</strong>
          <span style="float:right;opacity:0.7">${gm.group._count.members} membres</span>
        </div>
        <div style="padding:12px 16px;background:#f9fafb">
          <span style="margin-right:24px"><small style="color:#666">Total groupe</small><br><strong>${groupTotal.toFixed(2)} ${currency}</strong></span>
          <span><small style="color:#666">Ma part</small><br><strong style="color:#4F46E5">${myShare.toFixed(2)} ${currency}</strong></span>
        </div>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:#f3f4f6">
            <th style="padding:6px 8px;text-align:left;font-size:11px;color:#666">Dépense</th>
            <th style="padding:6px 8px;text-align:right;font-size:11px;color:#666">Montant</th>
            <th style="padding:6px 8px;text-align:left;font-size:11px;color:#666">Date</th>
          </tr></thead>
          <tbody>${expensesHtml}</tbody>
        </table>
      </div>`;
  }).join('');

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:sans-serif;color:#111;max-width:700px;margin:0 auto;padding:32px">
  <div style="background:#0D1128;color:white;padding:24px;border-radius:12px;margin-bottom:32px">
    <h1 style="margin:0;font-size:24px">SplitIt — Export de données</h1>
    <p style="margin:8px 0 0;opacity:0.7">Généré le ${new Date().toLocaleDateString('fr-CH')} pour ${user.username}</p>
  </div>
  <div style="background:#f3f4f6;border-radius:8px;padding:16px;margin-bottom:32px">
    <span style="margin-right:32px"><small style="color:#666;display:block">Total dépensé (ma part)</small><span style="font-size:28px;font-weight:300">${totalSpent.toFixed(2)} ${currency}</span></span>
    <span><small style="color:#666;display:block">Groupes</small><span style="font-size:28px;font-weight:300">${user.groupMembers.length}</span></span>
  </div>
  ${groupsHtml}
  <p style="color:#999;font-size:11px;margin-top:32px">Cet export contient vos 50 dépenses les plus récentes par groupe. Contact : hello@splitit.app</p>
</body></html>`;

  if (!process.env.RESEND_API_KEY) {
    console.error('[Export] RESEND_API_KEY not set');
    return res.status(503).json({ error: 'Service email non configuré (RESEND_API_KEY manquante).' });
  }

  try {
    await sendEmailViaResend({
      to: user.email,
      subject: 'SplitIt — Export de tes données',
      html,
    });
    console.log(`[Export] Email sent to ${user.email}`);
    res.json({ data: { ok: true } });
  } catch (e) {
    console.error('[Export] Resend error:', e);
    res.status(500).json({ error: 'Erreur lors de l\'envoi de l\'email.' });
  }
});

export default router;