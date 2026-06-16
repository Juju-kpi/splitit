// backend/src/routes/auth.ts
import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

const COLORS = ['#4F46E5','#065F46','#92400E','#831843','#1E40AF','#7C2D12','#134E4A'];
function randomColor() { return COLORS[Math.floor(Math.random() * COLORS.length)]; }

function signAccess(userId: string) {
  return jwt.sign({ sub: userId }, process.env.JWT_SECRET!, { expiresIn: '15m' });
}
function signRefresh(userId: string) {
  return jwt.sign({ sub: userId }, process.env.JWT_REFRESH_SECRET!, { expiresIn: '30d' });
}

// POST /api/auth/register
router.post('/register', async (req: Request, res: Response) => {
  const schema = z.object({
    email: z.string().email(),
    username: z.string().min(2).max(30).regex(/^[a-zA-Z0-9_]+$/),
    password: z.string().min(8),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const { email, username, password } = parsed.data;

  const existing = await prisma.user.findFirst({
    where: { OR: [{ email }, { username }] },
  });
  if (existing) {
    const field = existing.email === email ? 'email' : 'username';
    return res.status(409).json({ error: `This ${field} is already taken` });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({
    data: { email, username, passwordHash, avatarColor: randomColor() },
    select: { id: true, email: true, username: true, avatarColor: true, createdAt: true },
  });

  const accessToken = signAccess(user.id);
  const refreshToken = signRefresh(user.id);
  await prisma.refreshToken.create({
    data: {
      token: refreshToken,
      userId: user.id,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  res.status(201).json({ data: { accessToken, refreshToken, user } });
});

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  const schema = z.object({
    email: z.string().email(),
    password: z.string(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input' });

  const { email, password } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const accessToken = signAccess(user.id);
  const refreshToken = signRefresh(user.id);
  await prisma.refreshToken.create({
    data: {
      token: refreshToken,
      userId: user.id,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  const { passwordHash: _, ...safeUser } = user;
  res.json({ data: { accessToken, refreshToken, user: safeUser } });
});

// POST /api/auth/refresh
router.post('/refresh', async (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'Missing refresh token' });

  let payload: { sub: string };
  try {
    payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET!) as { sub: string };
  } catch {
    return res.status(401).json({ error: 'Invalid refresh token' });
  }

  const stored = await prisma.refreshToken.findFirst({
    where: { token: refreshToken, userId: payload.sub, expiresAt: { gt: new Date() } },
  });
  if (!stored) return res.status(401).json({ error: 'Refresh token revoked' });

  await prisma.refreshToken.delete({ where: { id: stored.id } });
  const newRefresh = signRefresh(payload.sub);
  await prisma.refreshToken.create({
    data: {
      token: newRefresh,
      userId: payload.sub,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  res.json({ data: { accessToken: signAccess(payload.sub), refreshToken: newRefresh } });
});

// POST /api/auth/logout
router.post('/logout', authenticate, async (req: AuthRequest, res: Response) => {
  const { refreshToken } = req.body;
  if (refreshToken) {
    await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
  }
  res.json({ data: { ok: true } });
});

// GET /api/auth/me
router.get('/me', authenticate, async (req: AuthRequest, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { id: true, email: true, username: true, avatarColor: true, createdAt: true },
  });
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ data: user });
});

// ─── Password Reset ────────────────────────────────────────────────────────

// POST /api/auth/forgot-password
// Always returns 200 to avoid email enumeration.
// Requires: RESEND_API_KEY + APP_FROM_EMAIL + APP_RESET_BASE_URL in .env
router.post('/forgot-password', async (req: Request, res: Response) => {
  const schema = z.object({ email: z.string().email() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Email invalide' });

  const { email } = parsed.data;
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });

  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiry = new Date(Date.now() + 60 * 60 * 1000); // 1h

    await prisma.user.update({
      where: { id: user.id },
      data: { resetToken: token, resetTokenExpiry: expiry },
    });

    const resetUrl = `${process.env.APP_RESET_BASE_URL || 'splitit://forgot-password'}?token=${token}`;

    if (process.env.RESEND_API_KEY) {
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
            subject: 'Réinitialisation de ton mot de passe SplitIt',
            html: `
              <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#0C0C0F;color:#F2F2F5;border-radius:12px">
                <h2 style="margin-top:0;color:#A899FF">Mot de passe oublié ?</h2>
                <p>Clique sur le bouton ci-dessous pour réinitialiser ton mot de passe.<br>
                Ce lien est valable <strong>1 heure</strong>.</p>
                <a href="${resetUrl}"
                   style="display:inline-block;margin:20px 0;padding:14px 28px;background:#7C6EFA;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">
                  Réinitialiser mon mot de passe
                </a>
                <p style="color:#5A5A72;font-size:12px">
                  Si tu n'as pas demandé de réinitialisation, ignore cet email.<br>
                  Lien direct : ${resetUrl}
                </p>
              </div>
            `,
          }),
        });
        if (!resendRes.ok) {
          console.error('[Auth] Resend error:', await resendRes.text());
        } else {
          console.log(`[Auth] Reset email sent to ${email}`);
        }
      } catch (e) {
        console.error('[Auth] Failed to send reset email:', e);
      }
    } else {
      // Dev fallback — print link in console
      console.log(`[Auth] RESEND_API_KEY not set. Reset link for ${email}:`);
      console.log(resetUrl);
    }
  }

  // Always 200 — never reveal whether email exists
  res.json({ data: { ok: true } });
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req: Request, res: Response) => {
  const schema = z.object({
    token: z.string().min(1),
    password: z.string().min(8),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  const { token, password } = parsed.data;

  const user = await prisma.user.findFirst({
    where: {
      resetToken: token,
      resetTokenExpiry: { gt: new Date() },
    },
  });

  if (!user) {
    return res.status(400).json({ error: 'Lien invalide ou expiré. Refais une demande.' });
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, resetToken: null, resetTokenExpiry: null },
  });

  // Invalidate all sessions for security
  await prisma.refreshToken.deleteMany({ where: { userId: user.id } });

  res.json({ data: { ok: true } });
});

export default router;
