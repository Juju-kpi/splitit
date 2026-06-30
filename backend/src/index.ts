// backend/src/index.ts
// Changement vs original : ajout de usersRouter + envoi notifs push sur création dépense

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cron from 'node-cron';

import authRouter from './routes/auth';
import groupsRouter from './routes/groups';
import expensesRouter from './routes/expenses';
import ocrRouter from './routes/ocr';
import usersRouter from './routes/users';
import { authenticate } from './middleware/auth';
import { runTrainingPipeline } from './services/trainingPipeline';
import { sendPushNotification } from './services/notifications';
import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

const app = express();
app.set('trust proxy', 1);

// Security
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  credentials: true,
}));

// Rate limiting
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 20 }));
app.use('/api', rateLimit({ windowMs: 60 * 1000, max: 200 }));

app.use(express.json({ limit: '10mb' }));

// Public routes
app.use('/api/auth', authRouter);

// Protected routes
app.use('/api/groups', authenticate, groupsRouter);
app.use('/api/expenses', authenticate, expensesRouter);
app.use('/api/ocr', authenticate, ocrRouter);
app.use('/api/users', authenticate, usersRouter); // NOUVEAU

// Health check
app.get('/health', (_, res) => res.json({ ok: true, ts: new Date() }));

// Nightly OCR training pipeline (2am)
cron.schedule('0 2 * * *', async () => {
  console.log('[Cron] Starting nightly OCR training pipeline...');
  try {
    await runTrainingPipeline();
  } catch (e) {
    console.error('[Cron] Training pipeline failed:', e);
  }
});

// ── Cron : rappel quotidien dépenses incomplètes (9h) ────────────────────
// Envoie une notification push aux membres dont un groupe a des dépenses
// marquées isComplete=false depuis plus de 24h
cron.schedule('0 9 * * *', async () => {
  console.log('[Cron] Sending incomplete expense reminders...');
  try {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const incompleteExpenses = await prisma.expense.findMany({
      where: { isComplete: false, createdAt: { lt: yesterday } },
      include: {
        group: {
          include: {
            members: {
              where: { userId: { not: null } },
              include: { user: true },
            },
          },
        },
      },
    });

    const tokensToNotify = new Set<string>();
    incompleteExpenses.forEach(exp => {
      exp.group.members.forEach(m => {
        if (m.user?.notifReminder) {
          if (m.user.pushToken) tokensToNotify.add(m.user.pushToken);
          if (m.user.webPushToken) tokensToNotify.add(m.user.webPushToken);
        }
      });
    });

    if (tokensToNotify.size === 0) return;

    await sendPushNotification(Array.from(tokensToNotify), {
      title: 'SplitIt — Dépenses à compléter',
      body: `Tu as des dépenses en attente. Complète-les pour équilibrer les comptes.`,
      data: { type: 'reminder' },
    });

    console.log(`[Cron] Sent reminders to ${tokensToNotify.size} users`);
    await prisma.$disconnect();
  } catch (e) {
    console.error('[Cron] Reminder push failed:', e);
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Splitit backend running on :${PORT}`);
});