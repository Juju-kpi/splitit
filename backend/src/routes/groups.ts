// backend/src/routes/groups.ts
import { Router, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../db';
import { AuthRequest } from '../middleware/auth';
import { computeBalances } from '../services/balances';

const router = Router();

function initials(name: string) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

// GET /api/groups
router.get('/', async (req: AuthRequest, res: Response) => {
  const memberships = await prisma.groupMember.findMany({
    where: { userId: req.userId },
    include: {
      group: {
        include: {
          members: true,
          _count: { select: { expenses: true } },
        },
      },
    },
    orderBy: { joinedAt: 'desc' },
  });

  const groups = memberships.map(m => ({
    ...m.group,
    expenseCount: m.group._count.expenses,
    myMemberId: m.id,
  }));

  res.json({ data: groups });
});

// POST /api/groups
router.post('/', async (req: AuthRequest, res: Response) => {
  const schema = z.object({
    name: z.string().min(1).max(60),
    emoji: z.string().default('💰'),
    displayName: z.string().min(1).max(40),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) return res.status(404).json({ error: 'User not found' });

  const group = await prisma.group.create({
    data: {
      name: parsed.data.name,
      emoji: parsed.data.emoji,
      members: {
        create: {
          userId: req.userId,
          displayName: parsed.data.displayName,
          avatarColor: user.avatarColor,
          avatarInitials: initials(parsed.data.displayName),
        },
      },
    },
    include: { members: true },
  });

  res.status(201).json({ data: group });
});

// GET /api/groups/:id
router.get('/:id', async (req: AuthRequest, res: Response) => {
  const group = await prisma.group.findUnique({
    where: { id: req.params.id },
    include: {
      members: true,
      expenses: {
        include: {
          // multi-payer: include payments instead of legacy paidBy relation
          payments: { include: { member: true } },
          items: { include: { assignedTo: { include: { member: true } } } },
          splits: { include: { member: true } },
        },
        orderBy: { createdAt: 'desc' },
      },
    },
  });
  if (!group) return res.status(404).json({ error: 'Group not found' });

  const isMember = group.members.some(m => m.userId === req.userId);
  if (!isMember) return res.status(403).json({ error: 'Not a member' });

  const balances = computeBalances(group.members, group.expenses as any);
  res.json({ data: { ...group, balances } });
});

// POST /api/groups/join/:inviteCode
router.post('/join/:inviteCode', async (req: AuthRequest, res: Response) => {
  const schema = z.object({ displayName: z.string().min(1).max(40) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const group = await prisma.group.findUnique({
    where: { inviteCode: req.params.inviteCode },
    include: { members: true },
  });
  if (!group) return res.status(404).json({ error: 'Invalid invite code' });

  const alreadyMember = group.members.some(m => m.userId === req.userId);
  if (alreadyMember) return res.status(409).json({ error: 'Already a member' });

  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) return res.status(404).json({ error: 'User not found' });

  const member = await prisma.groupMember.create({
    data: {
      groupId: group.id,
      userId: req.userId,
      displayName: parsed.data.displayName,
      avatarColor: user.avatarColor,
      avatarInitials: initials(parsed.data.displayName),
    },
  });

  res.json({ data: { group: { id: group.id, name: group.name }, member } });
});

// POST /api/groups/:id/members — add guest member
router.post('/:id/members', async (req: AuthRequest, res: Response) => {
  const schema = z.object({
    displayName: z.string().min(1).max(40),
    avatarColor: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const group = await prisma.group.findUnique({
    where: { id: req.params.id },
    include: { members: true },
  });
  if (!group) return res.status(404).json({ error: 'Group not found' });

  const isMember = group.members.some(m => m.userId === req.userId);
  if (!isMember) return res.status(403).json({ error: 'Not a member' });

  const COLORS = ['#4F46E5','#065F46','#92400E','#831843','#1E40AF'];
  const color = parsed.data.avatarColor || COLORS[group.members.length % COLORS.length];

  const member = await prisma.groupMember.create({
    data: {
      groupId: group.id,
      displayName: parsed.data.displayName,
      avatarColor: color,
      avatarInitials: initials(parsed.data.displayName),
    },
  });
  res.status(201).json({ data: member });
});

export default router;
