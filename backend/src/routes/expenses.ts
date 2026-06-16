// backend/src/routes/expenses.ts
import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { AuthRequest } from '../middleware/auth';

const router = Router();

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
  // Legacy single-payer — used when payments[] is not provided
  paidByMemberId: z.string().optional(),
  // Multi-payer: one or more members paying different amounts
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

// POST /api/expenses
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

// GET /api/expenses/:id
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

// DELETE /api/expenses/:id
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

// PATCH /api/expenses/:id/settle
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

// PUT /api/expenses/:id
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

  const updated = await prisma.expense.update({
    where: { id: req.params.id },
    data: {
      ...(d.description && { description: d.description }),
      ...(d.totalAmount && { totalAmount: d.totalAmount }),
      paidByMemberId,
      splits: splits.length > 0 ? { create: splits } : undefined,
    },
    include: {
      payments: { include: { member: true } },
      items: { include: { assignedTo: { include: { member: true } } } },
      splits: { include: { member: true } },
    },
  });

  res.json({ data: updated });
});

export default router;