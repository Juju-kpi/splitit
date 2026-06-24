// backend/src/routes/users.ts  — NOUVEAU FICHIER
// Routes utilisateur : update profil, prefs notifs, export données PDF

import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { AuthRequest } from '../middleware/auth';

const router = Router();

// ── PATCH /api/users/profile ─────────────────────────────────────────────
// Met à jour avatarColor
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

  // Si avatarColor change, mettre à jour aussi les GroupMember
  if (parsed.data.avatarColor) {
    await prisma.groupMember.updateMany({
      where: { userId: req.userId },
      data: { avatarColor: parsed.data.avatarColor },
    });
  }

  res.json({ data: user });
});

// ── PATCH /api/users/notification-prefs ──────────────────────────────────
// Stocke le push token + préférences notifs
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

// ── POST /api/users/export ───────────────────────────────────────────────
// Génère un PDF récap et l'envoie par email via Resend
router.post('/export', async (req: AuthRequest, res: Response) => {
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
            },
          },
        },
      },
    },
  });

  if (!user) return res.status(404).json({ error: 'User not found' });

  // Construction du contenu HTML pour le PDF
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
        <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${e.totalAmount.toFixed(2)} CHF</td>
        <td style="padding:6px 8px;border-bottom:1px solid #eee;color:#666">${new Date(e.createdAt).toLocaleDateString('fr-CH')}</td>
      </tr>`
    ).join('');

    return `
      <div style="margin-bottom:32px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
        <div style="background:#0D1128;color:white;padding:12px 16px">
          <strong>${gm.group.emoji} ${gm.group.name}</strong>
          <span style="float:right;opacity:0.7">${gm.group.members?.length || 0} membres</span>
        </div>
        <div style="padding:12px 16px;background:#f9fafb;display:flex;gap:32px">
          <div><div style="font-size:11px;color:#666">Total groupe</div><div style="font-size:18px;font-weight:600">${groupTotal.toFixed(2)} CHF</div></div>
          <div><div style="font-size:11px;color:#666">Ma part</div><div style="font-size:18px;font-weight:600;color:#4F46E5">${myShare.toFixed(2)} CHF</div></div>
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
<html>
<head><meta charset="utf-8"><style>body{font-family:sans-serif;color:#111;max-width:700px;margin:0 auto;padding:32px}</style></head>
<body>
  <div style="background:#0D1128;color:white;padding:24px;border-radius:12px;margin-bottom:32px">
    <h1 style="margin:0;font-size:24px">SplitIt — Export de données</h1>
    <p style="margin:8px 0 0;opacity:0.7">Généré le ${new Date().toLocaleDateString('fr-CH')} pour ${user.username}</p>
  </div>
  <div style="background:#f3f4f6;border-radius:8px;padding:16px;margin-bottom:32px;display:flex;gap:32px">
    <div><div style="font-size:11px;color:#666;text-transform:uppercase">Total dépensé</div><div style="font-size:28px;font-weight:300">${totalSpent.toFixed(2)} CHF</div></div>
    <div><div style="font-size:11px;color:#666;text-transform:uppercase">Groupes</div><div style="font-size:28px;font-weight:300">${user.groupMembers.length}</div></div>
  </div>
  ${groupsHtml}
  <p style="color:#999;font-size:11px;margin-top:32px">Cet export contient vos 50 dépenses les plus récentes par groupe. Pour toute question : hello@splitit.app</p>
</body>
</html>`;

  // Envoi via Resend
  if (!process.env.RESEND_API_KEY) {
    console.log('[Export] RESEND_API_KEY not set, skipping email');
    return res.json({ data: { ok: true, note: 'Email not sent (no RESEND_API_KEY)' } });
  }

  try {
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: process.env.APP_FROM_EMAIL || 'noreply@splitit.app',
        to: [user.email],
        subject: 'SplitIt — Export de tes données',
        html,
      }),
    });

    if (!resendRes.ok) {
      console.error('[Export] Resend error:', await resendRes.text());
      return res.status(500).json({ error: 'Erreur lors de l\'envoi de l\'email.' });
    }

    res.json({ data: { ok: true } });
  } catch (e) {
    console.error('[Export] Error:', e);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

export default router;
