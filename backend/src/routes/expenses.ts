// backend/src/routes/expenses.ts
// Fixes appliqués :
//   1. PUT /:id — `note` correctement sauvegardé (était dans le schema mais pas dans data{})
//   2. POST /:id/duplicate — isComplete recalculé après création (plus hardcodé à false)
//   3. PUT /:id — splits supprimés/recréés UNIQUEMENT si splitMemberIds ou customSplits fournis
//      (sinon on écrasait les splits existants avec un tableau vide)
//   4. POST / — notification push envoyée à tous les membres du groupe (notifExpense=true)
//   5. Répartition au centime (services/split.ts) : la somme des parts est
//      désormais rigoureusement égale au total de la dépense. Avant, chaque
//      part était arrondie séparément, la somme ratait le total de quelques
//      centimes — ce qui faussait les soldes ET marquait des dépenses pourtant
//      complètes comme "à compléter".
//   6. Les parts sont mises à jour en place : un remboursement marqué comme
//      réglé n'est plus effacé par une modification de la dépense.

import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { AuthRequest } from '../middleware/auth';
import { sendPushNotification } from '../services/notifications';
import {
  Share, ItemInput, toCents, splitEqually, splitItemized,
  normalizeCustomShares, normalizePayments,
} from '../services/split';

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

// ── Helper : écrit les parts SANS perdre les remboursements déjà réglés ──
// Avant, chaque recalcul faisait deleteMany + createMany : les colonnes
// settled / settledAt repartaient à zéro et un remboursement déjà validé
// réapparaissait comme dû. On met donc à jour ligne par ligne.
async function applyShares(expenseId: string, shares: Share[]): Promise<void> {
  const existing = await prisma.expenseSplit.findMany({ where: { expenseId } });
  const previous = new Map(existing.map(s => [s.memberId, s]));
  const kept = new Set(shares.map(s => s.memberId));

  for (const share of shares) {
    const prev = previous.get(share.memberId);
    if (prev) {
      if (toCents(prev.amount) !== toCents(share.amount)) {
        await prisma.expenseSplit.update({
          where: { id: prev.id },
          data: { amount: share.amount },
        });
      }
    } else {
      await prisma.expenseSplit.create({
        data: { expenseId, memberId: share.memberId, amount: share.amount },
      });
    }
  }

  const removed = existing.filter(s => !kept.has(s.memberId)).map(s => s.id);
  if (removed.length > 0) {
    await prisma.expenseSplit.deleteMany({ where: { id: { in: removed } } });
  }
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

  // Les paiements doivent tomber exactement sur le total, sinon les soldes ne
  // se compensent jamais (le payeur reste créditeur de quelques centimes).
  const payments = normalizePayments(d.totalAmount, resolvePayments(d));
  if (!payments) {
    return res.status(400).json({ error: 'Payments do not add up to the total amount' });
  }
  const paidByMemberId = primaryPayer(payments);

  let splits: Share[] = [];
  let hasUnassignedItems = false;

  if (d.splitType === 'EQUAL') {
    // splitMemberIds vide → tout le groupe (un tableau vide est "truthy" en JS,
    // l'ancien code divisait alors par zéro)
    const memberIds = d.splitMemberIds && d.splitMemberIds.length > 0
      ? d.splitMemberIds
      : (await prisma.groupMember.findMany({ where: { groupId: d.groupId }, select: { id: true } })).map(m => m.id);
    splits = splitEqually(d.totalAmount, memberIds);
  } else if (d.splitType === 'ITEMIZED') {
    const itemized = splitItemized(d.totalAmount, d.items as ItemInput[]);
    splits = itemized.shares;
    hasUnassignedItems = itemized.hasUnassigned;
  } else if (d.splitType === 'CUSTOM' && d.customSplits) {
    splits = normalizeCustomShares(d.totalAmount, d.customSplits as Share[]);
  }

  const splitTotal = splits.reduce((s, sp) => s + sp.amount, 0);
  const isComplete = !hasUnassignedItems && splits.length > 0
    && Math.abs(splitTotal - d.totalAmount) <= 0.02;

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

  // ── Parts : on ne touche que si de nouvelles données sont fournies ─────
  const totalChanged = d.totalAmount !== undefined
    && toCents(d.totalAmount) !== toCents(expense.totalAmount);

  if (d.splitMemberIds || d.customSplits) {
    let splits: Share[] = [];

    if (splitType === 'EQUAL' && d.splitMemberIds && d.splitMemberIds.length > 0) {
      splits = splitEqually(totalAmount, d.splitMemberIds);
    } else if (splitType === 'CUSTOM' && d.customSplits) {
      splits = normalizeCustomShares(totalAmount, d.customSplits as Share[]);
    }

    if (splits.length > 0) await applyShares(req.params.id, splits);
  } else if (totalChanged) {
    // Le montant a changé sans nouvelle répartition : sans recalcul, la somme
    // des parts ne correspond plus au total et la dépense bascule en
    // "à compléter" alors que l'utilisateur vient juste de corriger un prix.
    if (splitType === 'ITEMIZED') {
      const items = await prisma.expenseItem.findMany({
        where: { expenseId: req.params.id },
        include: { assignedTo: true },
      });
      const { shares } = splitItemized(totalAmount, items.map(i => ({
        price: i.price,
        assignedToMemberIds: i.assignedTo.map(a => a.memberId),
      })));
      if (shares.length > 0) await applyShares(req.params.id, shares);
    } else if (splitType === 'EQUAL') {
      const existing = await prisma.expenseSplit.findMany({
        where: { expenseId: req.params.id },
        orderBy: { id: 'asc' },
      });
      if (existing.length > 0) {
        await applyShares(req.params.id, splitEqually(totalAmount, existing.map(sp => sp.memberId)));
      }
    }
    // CUSTOM : on ne réinvente pas des montants saisis à la main. L'écart est
    // réel, la dépense sera signalée "à compléter" — ce qui est exact.
  }

  // ── Payeurs ───────────────────────────────────────────────────────────
  let paidByMemberId = expense.paidByMemberId;
  if (d.payments && d.payments.length > 0) {
    const normalized = normalizePayments(totalAmount, d.payments as Share[]);
    if (!normalized) {
      return res.status(400).json({ error: 'Payments do not add up to the total amount' });
    }
    await prisma.expensePayment.deleteMany({ where: { expenseId: req.params.id } });
    await prisma.expensePayment.createMany({
      data: normalized.map(p => ({
        memberId: p.memberId,
        amount: p.amount,
        expenseId: req.params.id,
      })),
    });
    paidByMemberId = primaryPayer(normalized);
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
    // Optionnel pour rester compatible avec les versions déjà installées :
    // le client envoie le total qu'il affiche (= somme des articles corrigés).
    totalAmount: z.number().positive().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const { items, payments, description } = parsed.data;
  const totalAmount = parsed.data.totalAmount ?? expense.totalAmount;

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

  // 3. Recalculer les parts.
  //
  //    ⚠ Cas critique : l'écran de modification d'une dépense SANS articles
  //    (une dépense manuelle : essence, courses…) appelle cette route avec
  //    items: []. Avant, on supprimait alors toutes les parts sans en recréer
  //    aucune — la dépense se retrouvait répartie entre personne, et son
  //    montant disparaissait des comptes du groupe. On ne touche donc plus
  //    aux parts quand aucun article n'est fourni : on se contente, si le
  //    montant a changé, de refaire la répartition entre les mêmes personnes.
  if (items.length > 0) {
    // Le reliquat entre la somme des articles et le total (service, taxe,
    // arrondi de caisse) est réparti au prorata, sauf s'il reste des articles
    // non assignés — là, la dépense est réellement incomplète.
    const { shares: newSplits } = splitItemized(totalAmount, items as ItemInput[]);
    await applyShares(req.params.id, newSplits);
  } else if (toCents(totalAmount) !== toCents(expense.totalAmount)) {
    const existing = await prisma.expenseSplit.findMany({
      where: { expenseId: req.params.id },
      orderBy: { id: 'asc' },
    });
    if (existing.length > 0) {
      await applyShares(req.params.id, splitEqually(totalAmount, existing.map(sp => sp.memberId)));
    }
  }

  // 3bis. Le total suit les articles corrigés quand le client le fournit
  if (parsed.data.totalAmount !== undefined) {
    await prisma.expense.update({
      where: { id: req.params.id },
      data: { totalAmount: parsed.data.totalAmount },
    });
  }

  // 4. Mettre à jour les payeurs si fournis
  if (payments && payments.length > 0) {
    const normalized = normalizePayments(totalAmount, payments as Share[]);
    if (!normalized) {
      return res.status(400).json({ error: 'Payments do not add up to the total amount' });
    }
    await prisma.expensePayment.deleteMany({ where: { expenseId: req.params.id } });
    await prisma.expensePayment.createMany({
      data: normalized.map(p => ({ memberId: p.memberId, amount: p.amount, expenseId: req.params.id })),
    });
    const paidByMemberId = primaryPayer(normalized);
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