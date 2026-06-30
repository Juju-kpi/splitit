// backend/src/routes/expenses.ts
// Fixes appliqués :
//   1. PUT /:id — `note` correctement sauvegardé (était dans le schema mais pas dans data{})
//   2. POST /:id/duplicate — isComplete recalculé après création (plus hardcodé à false)
//   3. PUT /:id — splits supprimés/recréés UNIQUEMENT si splitMemberIds ou customSplits fournis
//      (sinon on écrasait les splits existants avec un tableau vide)
//   4. POST / — notification push envoyée à tous les membres du groupe (notifExpense=true)

import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { AuthRequest } from '../middleware/auth';
import { sendPushNotification } from '../services/notifications';

const router = Router();

// ── Helper : notification push "nouvelle dépense" ────────────────────────
async function sendNewExpenseNotification(opts: {
  groupId: string;
  description: string;
  totalAmount: number;
  currency: string;
  creatorUserId: string; // ne pas notifier la personne qui crée
}): Promise<void> {
  try {
    const members = await prisma.groupMember.findMany({
      where: { groupId: opts.groupId, userId: { not: null } },
      include: { user: true },
    });

    const tokens = members
      .filter(m => (m.user?.pushToken || m.user?.webPushToken) && m.user?.notifExpense && m.userId !== opts.creatorUserId)
      .flatMap(m => [m.user!.pushToken, m.user!.webPushToken].filter(Boolean) as string[]);

    if (tokens.length === 0) return;

    await sendPushNotification(tokens, {
      title: 'SplitIt — Nouvelle dépense',
      body: `${opts.description} · ${opts.totalAmount.toFixed(2)} ${opts.currency}`,
      data: { type: 'new_expense' },
    });
  } catch (e) {
    // Ne pas faire échouer la requête si la notification plante
    console.error('[Push] sendNewExpenseNotification failed:', e);
  }
}


// ── Schemas ───────────────────────────────────────────────────────────────
const itemSchema = z.object({
  name: z.string().min(1),
  price: z.number().min(0),
  ocrRaw: z.string().optional(),
  ocrConfidence: z.number().min(0).max(1).optional(),
  corrected: z.boolean().default(false),
  assignedToMemberIds: z.array(z.string()).default([]),
});

const paymentSchema = z.object({
  memberId: z.string(),
  amount: z.number().positive(),
});

const createExpenseSchema = z.object({
  groupId: z.string(),
  description: z.string().min(1).max(120),
  totalAmount: z.number().positive(),
  currency: z.string().default('CHF'),
  paidByMemberId: z.string().optional(),
  payments: z.array(paymentSchema).optional(),
  splitType: z.enum(['EQUAL', 'ITEMIZED', 'CUSTOM']).default('EQUAL'),
  receiptImageUrl: z.string().url().optional(),
  ocrConfidence: z.number().optional(),
  items: z.array(itemSchema).default([]),
  splitMemberIds: z.array(z.string()).optional(),
  customSplits: z.array(z.object({ memberId: z.string(), amount: z.number() })).optional(),
}).refine(d => d.paidByMemberId || (d.payments && d.payments.length > 0), {
  message: 'Provide either paidByMemberId or payments[]',
});

function resolvePayments(d: z.infer<typeof createExpenseSchema>): { memberId: string; amount: number }[] {
  if (d.payments && d.payments.length > 0) return d.payments as { memberId: string; amount: number }[];
  return [{ memberId: d.paidByMemberId!, amount: d.totalAmount }];
}

function primaryPayer(payments: { memberId: string; amount: number }[]): string {
  return payments.reduce((best, p) => (p.amount > best.amount ? p : best), payments[0]).memberId;
}

// ── Helper : calcule si une dépense est "complète" ───────────────────────
async function computeIsComplete(expenseId: string): Promise<boolean> {
  const expense = await prisma.expense.findUnique({
    where: { id: expenseId },
    include: {
      items: { include: { assignedTo: true } },
      splits: true,
    },
  });
  if (!expense) return false;

  // Check 1 : items non assignés
  if (expense.items.length > 0) {
    const hasUnassigned = expense.items.some(item => item.assignedTo.length === 0);
    if (hasUnassigned) return false;
  }

  // Check 2 : somme des splits == totalAmount (tolérance 2 centimes)
  const splitTotal = expense.splits.reduce((s, sp) => s + sp.amount, 0);
  if (expense.splits.length === 0) return false; // pas de splits = pas complet
  const diff = Math.abs(splitTotal - expense.totalAmount);
  if (diff > 0.02) return false;

  return true;
}

// ── POST /api/expenses ────────────────────────────────────────────────────
router.post('/', async (req: AuthRequest, res: Response) => {
  const parsed = createExpenseSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const d = parsed.data;

  const membership = await prisma.groupMember.findFirst({
    where: { groupId: d.groupId, userId: req.userId },
  });
  if (!membership) return res.status(403).json({ error: 'Not a group member' });

  const payments = resolvePayments(d);
  const paidByMemberId = primaryPayer(payments);

  let splits: { memberId: string; amount: number }[] = [];

  if (d.splitType === 'EQUAL') {
    const memberIds = d.splitMemberIds || [
      ...(await prisma.groupMember.findMany({ where: { groupId: d.groupId }, select: { id: true } })).map(m => m.id),
    ];
    const share = Math.round((d.totalAmount / memberIds.length) * 100) / 100;
    splits = memberIds.map(memberId => ({ memberId, amount: share }));
  } else if (d.splitType === 'ITEMIZED') {
    const memberAmounts: Record<string, number> = {};
    for (const item of d.items) {
      if (item.assignedToMemberIds.length === 0) continue;
      const share = item.price / item.assignedToMemberIds.length;
      for (const mid of item.assignedToMemberIds) {
        memberAmounts[mid] = (memberAmounts[mid] || 0) + share;
      }
    }
    splits = Object.entries(memberAmounts).map(([memberId, amount]) => ({
      memberId,
      amount: Math.round(amount * 100) / 100,
    }));
  } else if (d.splitType === 'CUSTOM' && d.customSplits) {
    splits = d.customSplits as { memberId: string; amount: number }[];
  }

  const hasUnassignedItems = d.items.some(i => i.assignedToMemberIds.length === 0);
  const splitTotal = splits.reduce((s, sp) => s + sp.amount, 0);
  const isComplete = !hasUnassignedItems && Math.abs(splitTotal - d.totalAmount) < 0.02 && splits.length > 0;

  const expense = await prisma.expense.create({
    data: {
      groupId: d.groupId,
      description: d.description,
      totalAmount: d.totalAmount,
      currency: d.currency,
      paidByMemberId,
      splitType: d.splitType as any,
      receiptImageUrl: d.receiptImageUrl,
      ocrConfidence: d.ocrConfidence,
      isComplete,
      payments: { create: payments },
      items: {
        create: d.items.map(item => ({
          name: item.name,
          price: item.price,
          ocrRaw: item.ocrRaw,
          ocrConfidence: item.ocrConfidence,
          corrected: item.corrected,
          assignedTo: {
            create: item.assignedToMemberIds.map(memberId => ({ memberId })),
          },
        })),
      },
      splits: { create: splits },
    },
    include: {
      payments: { include: { member: true } },
      items: { include: { assignedTo: { include: { member: true } } } },
      splits: { include: { member: true } },
    },
  });

  // ── Notification push aux autres membres du groupe ──────────────────
  sendNewExpenseNotification({
    groupId: d.groupId,
    description: d.description,
    totalAmount: d.totalAmount,
    currency: d.currency,
    creatorUserId: req.userId!,
  });

  res.status(201).json({ data: expense });
});

// ── GET /api/expenses/:id ─────────────────────────────────────────────────
router.get('/:id', async (req: AuthRequest, res: Response) => {
  const expense = await prisma.expense.findUnique({
    where: { id: req.params.id },
    include: {
      payments: { include: { member: true } },
      items: { include: { assignedTo: { include: { member: true } } } },
      splits: { include: { member: true } },
    },
  });
  if (!expense) return res.status(404).json({ error: 'Not found' });

  const membership = await prisma.groupMember.findFirst({
    where: { groupId: expense.groupId, userId: req.userId },
  });
  if (!membership) return res.status(403).json({ error: 'Forbidden' });

  res.json({ data: expense });
});

// ── DELETE /api/expenses/:id ──────────────────────────────────────────────
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  const expense = await prisma.expense.findUnique({ where: { id: req.params.id } });
  if (!expense) return res.status(404).json({ error: 'Not found' });

  const membership = await prisma.groupMember.findFirst({
    where: { groupId: expense.groupId, userId: req.userId },
  });
  if (!membership) return res.status(403).json({ error: 'Forbidden' });

  await prisma.expense.delete({ where: { id: req.params.id } });
  res.json({ data: { ok: true } });
});

// ── PATCH /api/expenses/:id/settle ───────────────────────────────────────
router.patch('/:id/settle', async (req: AuthRequest, res: Response) => {
  const schema = z.object({ memberId: z.string() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'memberId required' });

  const expense = await prisma.expense.findUnique({ where: { id: req.params.id } });
  if (!expense) return res.status(404).json({ error: 'Not found' });

  await prisma.expenseSplit.updateMany({
    where: { expenseId: req.params.id, memberId: parsed.data.memberId },
    data: { settled: true, settledAt: new Date() },
  });

  res.json({ data: { ok: true } });
});

// ── PUT /api/expenses/:id ─────────────────────────────────────────────────
// FIX : `note` était dans le schema Zod mais PAS dans prisma.expense.update data{}
//       → la note était validée mais jamais écrite en base
// FIX : splits ne sont supprimés/recréés QUE si splitMemberIds ou customSplits fournis
//       → évite d'écraser les splits avec [] lors d'un simple update de note
router.put('/:id', async (req: AuthRequest, res: Response) => {
  const expense = await prisma.expense.findUnique({ where: { id: req.params.id } });
  if (!expense) return res.status(404).json({ error: 'Not found' });

  const membership = await prisma.groupMember.findFirst({
    where: { groupId: expense.groupId, userId: req.userId },
  });
  if (!membership) return res.status(403).json({ error: 'Forbidden' });

  const schema = z.object({
    description: z.string().min(1).max(120).optional(),
    totalAmount: z.number().positive().optional(),
    paidByMemberId: z.string().optional(),
    payments: z.array(paymentSchema).optional(),
    splitType: z.enum(['EQUAL', 'ITEMIZED', 'CUSTOM']).optional(),
    splitMemberIds: z.array(z.string()).optional(),
    customSplits: z.array(z.object({ memberId: z.string(), amount: z.number() })).optional(),
    note: z.string().max(500).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const d = parsed.data;
  const totalAmount = d.totalAmount ?? expense.totalAmount;
  const splitType = d.splitType ?? expense.splitType;

  // ── Splits : ne toucher que si de nouvelles données sont fournies ──────
  if (d.splitMemberIds || d.customSplits) {
    let splits: { memberId: string; amount: number }[] = [];

    if (splitType === 'EQUAL' && d.splitMemberIds) {
      const share = Math.round((totalAmount / d.splitMemberIds.length) * 100) / 100;
      splits = d.splitMemberIds.map(memberId => ({ memberId, amount: share }));
    } else if (splitType === 'CUSTOM' && d.customSplits) {
      splits = d.customSplits as { memberId: string; amount: number }[];
    }

    if (splits.length > 0) {
      await prisma.expenseSplit.deleteMany({ where: { expenseId: req.params.id } });
      await prisma.expenseSplit.createMany({
        data: splits.map(s => ({ ...s, expenseId: req.params.id })),
      });
    }
  }

  // ── Payeurs ───────────────────────────────────────────────────────────
  let paidByMemberId = expense.paidByMemberId;
  if (d.payments && d.payments.length > 0) {
    await prisma.expensePayment.deleteMany({ where: { expenseId: req.params.id } });
    await prisma.expensePayment.createMany({
      data: d.payments.map(p => ({
        memberId: p.memberId as string,
        amount: p.amount as number,
        expenseId: req.params.id,
      })),
    });
    paidByMemberId = primaryPayer(d.payments as { memberId: string; amount: number }[]);
  } else if (d.paidByMemberId) {
    await prisma.expensePayment.deleteMany({ where: { expenseId: req.params.id } });
    await prisma.expensePayment.create({
      data: { expenseId: req.params.id, memberId: d.paidByMemberId, amount: totalAmount },
    });
    paidByMemberId = d.paidByMemberId;
  }

  // ── Mise à jour principale — NOTE incluse ─────────────────────────────
  await prisma.expense.update({
    where: { id: req.params.id },
    data: {
      ...(d.description !== undefined && { description: d.description }),
      ...(d.totalAmount !== undefined && { totalAmount: d.totalAmount }),
      ...(d.note !== undefined && { note: d.note }),   // ← FIX : note écrite en base
      paidByMemberId,
    },
  });

  // ── Recalcul isComplete ───────────────────────────────────────────────
  const complete = await computeIsComplete(req.params.id);
  const updated = await prisma.expense.update({
    where: { id: req.params.id },
    data: { isComplete: complete },
    include: {
      payments: { include: { member: true } },
      items: { include: { assignedTo: { include: { member: true } } } },
      splits: { include: { member: true } },
    },
  });

  res.json({ data: updated });
});

// ── PUT /api/expenses/:id/items ───────────────────────────────────────────
router.put('/:id/items', async (req: AuthRequest, res: Response) => {
  const expense = await prisma.expense.findUnique({
    where: { id: req.params.id },
    include: { items: true },
  });
  if (!expense) return res.status(404).json({ error: 'Not found' });

  const membership = await prisma.groupMember.findFirst({
    where: { groupId: expense.groupId, userId: req.userId },
  });
  if (!membership) return res.status(403).json({ error: 'Forbidden' });

  const schema = z.object({
    items: z.array(itemSchema),
    payments: z.array(paymentSchema).optional(),
    description: z.string().max(120).optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const { items, payments, description } = parsed.data;

  // 1. Supprimer les anciens items (cascade supprime les assignments)
  await prisma.expenseItem.deleteMany({ where: { expenseId: req.params.id } });

  // 2. Recréer les items avec leurs assignments
  for (const item of items) {
    await prisma.expenseItem.create({
      data: {
        expenseId: req.params.id,
        name: item.name,
        price: item.price,
        ocrRaw: item.ocrRaw,
        ocrConfidence: item.ocrConfidence,
        corrected: item.corrected,
        assignedTo: {
          create: item.assignedToMemberIds.map(memberId => ({ memberId })),
        },
      },
    });
  }

  // 3. Recalculer les splits ITEMIZED
  const memberAmounts: Record<string, number> = {};
  for (const item of items) {
    if (item.assignedToMemberIds.length === 0) continue;
    const share = item.price / item.assignedToMemberIds.length;
    for (const mid of item.assignedToMemberIds) {
      memberAmounts[mid] = (memberAmounts[mid] || 0) + share;
    }
  }
  const newSplits = Object.entries(memberAmounts).map(([memberId, amount]) => ({
    memberId,
    amount: Math.round(amount * 100) / 100,
  }));

  await prisma.expenseSplit.deleteMany({ where: { expenseId: req.params.id } });
  if (newSplits.length > 0) {
    await prisma.expenseSplit.createMany({
      data: newSplits.map(s => ({ ...s, expenseId: req.params.id })),
    });
  }

  // 4. Mettre à jour les payeurs si fournis
  if (payments && payments.length > 0) {
    await prisma.expensePayment.deleteMany({ where: { expenseId: req.params.id } });
    await prisma.expensePayment.createMany({
      data: payments.map(p => ({ memberId: p.memberId, amount: p.amount, expenseId: req.params.id })),
    });
    const paidByMemberId = primaryPayer(payments as { memberId: string; amount: number }[]);
    await prisma.expense.update({ where: { id: req.params.id }, data: { paidByMemberId } });
  }

  // 5. Description si fournie
  if (description !== undefined) {
    await prisma.expense.update({
      where: { id: req.params.id },
      data: { description: description || expense.description },
    });
  }

  // 6. Recalculer isComplete
  const complete = await computeIsComplete(req.params.id);
  const updated = await prisma.expense.update({
    where: { id: req.params.id },
    data: { isComplete: complete },
    include: {
      payments: { include: { member: true } },
      items: { include: { assignedTo: { include: { member: true } } } },
      splits: { include: { member: true } },
    },
  });

  res.json({ data: updated });
});

// ── POST /api/expenses/:id/duplicate ─────────────────────────────────────
// FIX : isComplete recalculé après création au lieu d'être forcé à false
//       (une dépense EQUAL sans items est complète dès la duplication)
router.post('/:id/duplicate', async (req: AuthRequest, res: Response) => {
  const original = await prisma.expense.findUnique({
    where: { id: req.params.id },
    include: {
      items: { include: { assignedTo: true } },
      splits: true,
      payments: true,
    },
  });
  if (!original) return res.status(404).json({ error: 'Not found' });

  const membership = await prisma.groupMember.findFirst({
    where: { groupId: original.groupId, userId: req.userId },
  });
  if (!membership) return res.status(403).json({ error: 'Forbidden' });

  // Créer la copie — isComplete sera recalculé juste après
  const copy = await prisma.expense.create({
    data: {
      groupId: original.groupId,
      description: `${original.description} (copie)`,
      totalAmount: original.totalAmount,
      currency: original.currency,
      paidByMemberId: original.paidByMemberId,
      splitType: original.splitType,
      ocrConfidence: original.ocrConfidence,
      isComplete: false, // provisoire, recalculé en dessous
      items: {
        create: original.items.map(item => ({
          name: item.name,
          price: item.price,
          ocrRaw: item.ocrRaw,
          ocrConfidence: item.ocrConfidence,
          corrected: item.corrected,
          assignedTo: {
            create: item.assignedTo.map(a => ({ memberId: a.memberId })),
          },
        })),
      },
      splits: {
        create: original.splits.map(s => ({
          memberId: s.memberId,
          amount: s.amount,
        })),
      },
      payments: {
        create: original.payments.map(p => ({
          memberId: p.memberId,
          amount: p.amount,
        })),
      },
    },
    include: {
      payments: { include: { member: true } },
      items: { include: { assignedTo: { include: { member: true } } } },
      splits: { include: { member: true } },
    },
  });

  // FIX : recalculer isComplete maintenant que tous les sous-objets existent
  const isComplete = await computeIsComplete(copy.id);
  const finalCopy = await prisma.expense.update({
    where: { id: copy.id },
    data: { isComplete },
    include: {
      payments: { include: { member: true } },
      items: { include: { assignedTo: { include: { member: true } } } },
      splits: { include: { member: true } },
    },
  });

  res.status(201).json({ data: finalCopy });
});

// ── PATCH /api/expenses/:id/note ─────────────────────────────────────────
// Route alias pratique (le PUT /:id gère aussi la note maintenant)
router.patch('/:id/note', async (req: AuthRequest, res: Response) => {
  const schema = z.object({ note: z.string().max(500) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const expense = await prisma.expense.findUnique({ where: { id: req.params.id } });
  if (!expense) return res.status(404).json({ error: 'Not found' });

  const membership = await prisma.groupMember.findFirst({
    where: { groupId: expense.groupId, userId: req.userId },
  });
  if (!membership) return res.status(403).json({ error: 'Forbidden' });

  const updated = await prisma.expense.update({
    where: { id: req.params.id },
    data: { note: parsed.data.note },
  });

  res.json({ data: updated });
});

export default router;