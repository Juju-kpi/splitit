// backend/src/routes/expenses.ts
// Changements vs version originale :
//   1. PUT /:id         — conservé, étendu pour mettre à jour items + recalculer isComplete
//   2. PUT /:id/items   — NOUVEAU : met à jour les assignments d'items et recalcule isComplete
//   3. Helper computeIsComplete — détecte si la dépense est "complète"

import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { AuthRequest } from '../middleware/auth';

const router = Router();

// ── Schemas (inchangés) ───────────────────────────────────────────────────
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
// Une dépense est incomplète si :
//   - il y a des items OCR sans aucun membre assigné, OU
//   - la somme des splits ne couvre pas le totalAmount (écart > 1 centime)
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

  // Check 2 : somme des splits == totalAmount
  const splitTotal = expense.splits.reduce((s, sp) => s + sp.amount, 0);
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

  // Calcule isComplete à la création
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
// Mise à jour générale (description, montant, payeurs, répartition)
// Après la mise à jour, recalcule isComplete automatiquement.
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
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const d = parsed.data;
  const totalAmount = d.totalAmount ?? expense.totalAmount;
  const splitType = d.splitType ?? expense.splitType;

  await prisma.expenseSplit.deleteMany({ where: { expenseId: req.params.id } });
  let splits: { memberId: string; amount: number }[] = [];

  if (splitType === 'EQUAL' && d.splitMemberIds) {
    const share = Math.round((totalAmount / d.splitMemberIds.length) * 100) / 100;
    splits = d.splitMemberIds.map(memberId => ({ memberId, amount: share }));
  } else if (splitType === 'CUSTOM' && d.customSplits) {
    splits = d.customSplits as { memberId: string; amount: number }[];
  }

  let paidByMemberId = expense.paidByMemberId;
  if (d.payments && d.payments.length > 0) {
    await prisma.expensePayment.deleteMany({ where: { expenseId: req.params.id } });
    await prisma.expensePayment.createMany({
      data: d.payments.map(p => ({ memberId: p.memberId as string, amount: p.amount as number, expenseId: req.params.id })),
    });
    paidByMemberId = primaryPayer(d.payments as { memberId: string; amount: number }[]);
  } else if (d.paidByMemberId) {
    await prisma.expensePayment.deleteMany({ where: { expenseId: req.params.id } });
    await prisma.expensePayment.create({
      data: { expenseId: req.params.id, memberId: d.paidByMemberId, amount: totalAmount },
    });
    paidByMemberId = d.paidByMemberId;
  }

  await prisma.expense.update({
    where: { id: req.params.id },
    data: {
      ...(d.description && { description: d.description }),
      ...(d.totalAmount && { totalAmount: d.totalAmount }),
      paidByMemberId,
      splits: splits.length > 0 ? { create: splits } : undefined,
    },
  });

  // Recalculer isComplete après la mise à jour
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
// NOUVEAU — appelé depuis CompleteExpenseScreen / AddExpenseScreen (mode edit)
// Remplace la totalité des items + leurs assignments, recalcule les splits
// en mode ITEMIZED, puis recalcule isComplete.
//
// Tous les membres du groupe peuvent appeler cette route (pas seulement le créateur).
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
    // Optionnel : met aussi à jour les payeurs
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

  // 5. Mise à jour de la description si fournie
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

// Ajouts à backend/src/routes/expenses.ts
// Colle ces 2 routes avant le `export default router`

// ── POST /api/expenses/:id/duplicate ─────────────────────────────────────
// Crée une copie exacte de la dépense (mêmes items, splits, payeurs)
// La copie est marquée isComplete=false pour permettre d'ajuster
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

  const copy = await prisma.expense.create({
    data: {
      groupId: original.groupId,
      description: `${original.description} (copie)`,
      totalAmount: original.totalAmount,
      currency: original.currency,
      paidByMemberId: original.paidByMemberId,
      splitType: original.splitType,
      ocrConfidence: original.ocrConfidence,
      isComplete: false,
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

  res.status(201).json({ data: copy });
});

// ── PATCH /api/expenses/:id/note ─────────────────────────────────────────
// Met à jour la note/commentaire d'une dépense
// (géré via PUT /:id existant — le champ `note` est déjà dans le schema)
// Cette route est un alias pratique
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