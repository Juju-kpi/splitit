// backend/src/routes/settlements.ts
//
// Un remboursement est ici un objet a part entiere : X verse un montant a Y,
// a une date, avec l'accord des deux. Il ne s'accroche a aucune depense, ce
// qui permet de solder un solde ne d'une compensation en chaine — le cas que
// le drapeau `settled` pose sur des parts de depense ne sait pas traiter.
//
// L'ancien PATCH /api/expenses/:id/settle reste en place et fonctionne :
// les remboursements deja enregistres de cette maniere ne bougent pas.

import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { AuthRequest } from '../middleware/auth';
import { sendPushNotification } from '../services/notifications';
import { canRecord, initialConfirmations, deriveConfirmed, round2 } from '../services/settlement';

const router = Router();

const withMembers = {
  fromMember: true,
  toMember: true,
  createdBy: true,
} as const;

// ── Notification a l'autre partie ─────────────────────────────────────────
// Un remboursement est un evenement personnel et actionnable : on previent
// des que l'un des deux a active une notification, quelle qu'elle soit.
async function notifyCounterpart(opts: {
  memberId: string;
  title: string;
  body: string;
  data?: Record<string, any>;
}): Promise<void> {
  try {
    const member = await prisma.groupMember.findUnique({
      where: { id: opts.memberId },
      include: { user: true },
    });
    const user = member?.user;
    if (!user || (!user.notifExpense && !user.notifReminder)) return;

    const tokens = [user.pushToken, user.webPushToken].filter(Boolean) as string[];
    if (tokens.length === 0) return;

    await sendPushNotification(tokens, {
      title: opts.title,
      body: opts.body,
      data: opts.data || {},
    });
  } catch (e) {
    // Une notification qui echoue ne doit jamais faire echouer l'ecriture.
    console.error('[Push] notification de remboursement impossible :', e);
  }
}

// ── GET /api/settlements?groupId=… ────────────────────────────────────────
router.get('/', async (req: AuthRequest, res: Response) => {
  const groupId = typeof req.query.groupId === 'string' ? req.query.groupId : '';
  if (!groupId) return res.status(400).json({ error: 'groupId requis' });

  const me = await prisma.groupMember.findFirst({ where: { groupId, userId: req.userId } });
  if (!me) return res.status(403).json({ error: 'Not a group member' });

  const settlements = await prisma.settlement.findMany({
    where: { groupId },
    include: withMembers,
    orderBy: { createdAt: 'desc' },
  });

  res.json({ data: settlements });
});

// ── POST /api/settlements ─────────────────────────────────────────────────
// Enregistre un versement. Le cote de celui qui enregistre est confirme
// d'office ; un membre sans compte ne pouvant rien confirmer, son cote l'est
// aussi — sinon sa dette resterait bloquee pour toujours.
router.post('/', async (req: AuthRequest, res: Response) => {
  const schema = z.object({
    groupId: z.string(),
    fromMemberId: z.string(),
    toMemberId: z.string(),
    amount: z.number().positive(),
    currency: z.string().optional(),
    method: z.string().max(40).optional(),
    note: z.string().max(300).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const d = parsed.data;
  if (d.fromMemberId === d.toMemberId) {
    return res.status(400).json({ error: 'On ne se rembourse pas soi-meme' });
  }
  if (round2(d.amount) < 0.01) {
    return res.status(400).json({ error: 'Montant trop faible' });
  }

  const group = await prisma.group.findUnique({
    where: { id: d.groupId },
    include: {
      members: true,
      expenses: { select: { currency: true }, orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });
  if (!group) return res.status(404).json({ error: 'Group not found' });

  const me = group.members.find(m => m.userId === req.userId);
  if (!me) return res.status(403).json({ error: 'Not a group member' });

  const from = group.members.find(m => m.id === d.fromMemberId);
  const to = group.members.find(m => m.id === d.toMemberId);
  if (!from || !to) return res.status(400).json({ error: 'Membre introuvable dans ce groupe' });

  const fromSide = { memberId: from.id, hasAccount: !!from.userId };
  const toSide = { memberId: to.id, hasAccount: !!to.userId };

  if (!canRecord(me.id, fromSide, toSide)) {
    return res.status(403).json({ error: 'Seuls le debiteur et le creancier peuvent enregistrer ce remboursement' });
  }

  const { fromAt, toAt } = initialConfirmations(me.id, fromSide, toSide, new Date());

  const settlement = await prisma.settlement.create({
    data: {
      groupId: group.id,
      fromMemberId: from.id,
      toMemberId: to.id,
      amount: round2(d.amount),
      currency: d.currency || group.expenses[0]?.currency || 'CHF',
      method: d.method,
      note: d.note,
      confirmedByFromAt: fromAt,
      confirmedByToAt: toAt,
      createdByMemberId: me.id,
      ...deriveConfirmed(fromAt, toAt, null),
    },
    include: withMembers,
  });

  // Prevenir celui qui doit encore confirmer.
  const pendingSide = !fromAt ? from : !toAt ? to : null;
  if (pendingSide) {
    const iPaid = me.id === from.id;
    await notifyCounterpart({
      memberId: pendingSide.id,
      title: 'SplitIt — Remboursement a confirmer',
      body: iPaid
        ? `${me.displayName} dit t'avoir rembourse ${settlement.amount.toFixed(2)} ${settlement.currency}.`
        : `${me.displayName} dit avoir recu ${settlement.amount.toFixed(2)} ${settlement.currency} de ta part.`,
      data: { type: 'settlement_pending', groupId: group.id, settlementId: settlement.id },
    });
  }

  res.status(201).json({ data: settlement });
});

// ── POST /api/settlements/:id/confirm ─────────────────────────────────────
// L'autre partie valide. `undo: true` retire sa propre confirmation.
router.post('/:id/confirm', async (req: AuthRequest, res: Response) => {
  const undo = req.body?.undo === true;

  const settlement = await prisma.settlement.findUnique({ where: { id: req.params.id } });
  if (!settlement) return res.status(404).json({ error: 'Not found' });
  if (settlement.cancelledAt) {
    return res.status(409).json({ error: 'Ce remboursement a ete annule' });
  }

  const me = await prisma.groupMember.findFirst({
    where: { groupId: settlement.groupId, userId: req.userId },
  });
  if (!me) return res.status(403).json({ error: 'Not a group member' });

  const isFrom = me.id === settlement.fromMemberId;
  const isTo = me.id === settlement.toMemberId;
  if (!isFrom && !isTo) {
    return res.status(403).json({ error: 'Seuls le debiteur et le creancier peuvent confirmer' });
  }

  const stamp = undo ? null : new Date();
  const fromAt = isFrom ? stamp : settlement.confirmedByFromAt;
  const toAt = isTo ? stamp : settlement.confirmedByToAt;

  const updated = await prisma.settlement.update({
    where: { id: settlement.id },
    data: {
      confirmedByFromAt: fromAt,
      confirmedByToAt: toAt,
      ...deriveConfirmed(fromAt, toAt, settlement.confirmedAt),
    },
    include: withMembers,
  });

  // Le remboursement vient d'etre acquis : l'autre partie merite de le savoir.
  if (updated.confirmed && !settlement.confirmed) {
    const other = isFrom ? updated.toMember : updated.fromMember;
    await notifyCounterpart({
      memberId: other.id,
      title: 'SplitIt — Remboursement valide',
      body: `${me.displayName} a confirme : ${updated.amount.toFixed(2)} ${updated.currency}. Le solde est a jour.`,
      data: { type: 'settlement_confirmed', groupId: updated.groupId, settlementId: updated.id },
    });
  }

  res.json({ data: updated });
});

// ── POST /api/settlements/:id/cancel ──────────────────────────────────────
// Annulation douce : la ligne reste dans l'historique mais sort des soldes.
// `undo: true` la remet en service, avec ses confirmations d'origine.
router.post('/:id/cancel', async (req: AuthRequest, res: Response) => {
  const undo = req.body?.undo === true;

  const settlement = await prisma.settlement.findUnique({ where: { id: req.params.id } });
  if (!settlement) return res.status(404).json({ error: 'Not found' });

  const me = await prisma.groupMember.findFirst({
    where: { groupId: settlement.groupId, userId: req.userId },
  });
  if (!me) return res.status(403).json({ error: 'Not a group member' });

  const isParty = me.id === settlement.fromMemberId || me.id === settlement.toMemberId;
  if (!isParty && me.id !== settlement.createdByMemberId) {
    return res.status(403).json({ error: 'Seuls le debiteur et le creancier peuvent annuler' });
  }

  const updated = await prisma.settlement.update({
    where: { id: settlement.id },
    data: {
      cancelledAt: undo ? null : new Date(),
      cancelledByMemberId: undo ? null : me.id,
    },
    include: withMembers,
  });

  if (!undo) {
    const otherId = me.id === settlement.fromMemberId ? settlement.toMemberId : settlement.fromMemberId;
    await notifyCounterpart({
      memberId: otherId,
      title: 'SplitIt — Remboursement annule',
      body: `${me.displayName} a annule un remboursement de ${updated.amount.toFixed(2)} ${updated.currency}. La dette redevient due.`,
      data: { type: 'settlement_cancelled', groupId: updated.groupId, settlementId: updated.id },
    });
  }

  res.json({ data: updated });
});

export default router;
