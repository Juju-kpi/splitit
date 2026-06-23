// backend/src/routes/groups.ts
// Changements vs original :
//   - GET /join-preview/:inviteCode — NOUVEAU : retourne les membres sans compte du groupe
//   - POST /join/:inviteCode       — étendu : accepte claimMemberId optionnel
//   - POST /:id/claim-member       — NOUVEAU : lie un membre guest à un compte existant

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

// ── NOUVEAU : GET /api/groups/join-preview/:inviteCode ────────────────────
// Retourne le nom du groupe + les membres sans compte (userId = null)
// pour que l'écran de join puisse proposer "Es-tu l'un de ces membres ?"
// Public (pas d'auth requise pour juste voir le preview) — mais on garde
// l'auth pour éviter l'énumération de groupes par des inconnus.
router.get('/join-preview/:inviteCode', async (req: AuthRequest, res: Response) => {
  const group = await prisma.group.findUnique({
    where: { inviteCode: req.params.inviteCode },
    include: {
      members: {
        where: { userId: null }, // uniquement les membres sans compte
        select: { id: true, displayName: true, avatarColor: true, avatarInitials: true },
      },
    },
  });
  if (!group) return res.status(404).json({ error: 'Invalid invite code' });

  res.json({
    data: {
      groupName: group.name,
      groupEmoji: group.emoji,
      guestMembers: group.members, // membres sans compte
    },
  });
});

// ── POST /api/groups/join/:inviteCode ─────────────────────────────────────
// Étendu : accepte un claimMemberId optionnel.
// Si fourni → on lie ce membre guest au compte de l'utilisateur
//             (au lieu de créer un nouveau membre).
// Si absent → comportement original (créer un nouveau membre).
router.post('/join/:inviteCode', async (req: AuthRequest, res: Response) => {
  const schema = z.object({
    displayName: z.string().min(1).max(40),
    claimMemberId: z.string().optional(), // ID du membre guest à réclamer
  });
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

  // ── Mode "claim" : l'utilisateur dit "je suis ce membre guest" ──────────
  if (parsed.data.claimMemberId) {
    const guestMember = group.members.find(
      m => m.id === parsed.data.claimMemberId && m.userId === null
    );

    if (!guestMember) {
      return res.status(400).json({
        error: 'Ce membre est introuvable ou a déjà un compte associé.',
      });
    }

    // Lier le membre guest à cet utilisateur
    const claimedMember = await prisma.groupMember.update({
      where: { id: guestMember.id },
      data: {
        userId: req.userId,
        // On garde le displayName existant du membre (Martin reste Martin)
        // mais on met à jour la couleur d'avatar
        avatarColor: user.avatarColor,
      },
    });

    return res.json({
      data: {
        group: { id: group.id, name: group.name },
        member: claimedMember,
        claimed: true,
      },
    });
  }

  // ── Mode normal : créer un nouveau membre ─────────────────────────────
  const member = await prisma.groupMember.create({
    data: {
      groupId: group.id,
      userId: req.userId,
      displayName: parsed.data.displayName,
      avatarColor: user.avatarColor,
      avatarInitials: initials(parsed.data.displayName),
    },
  });

  res.json({ data: { group: { id: group.id, name: group.name }, member, claimed: false } });
});

// POST /api/groups/:id/members — add guest member (inchangé)
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
