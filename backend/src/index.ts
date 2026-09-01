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
import settlementsRouter from './routes/settlements';
import { authenticate } from './middleware/auth';
import { prisma } from './db';
import { computeBalances } from './services/balances';
import { logMailConfig } from './services/mail';
import { runTrainingPipeline } from './services/trainingPipeline';
import { sendPushNotification } from './services/notifications';
import { appVersionInfo } from './services/appVersion';
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

// ── GET /api/app-version ─────────────────────────────────────────────────
// Publique : l'application interroge cette route avant meme la connexion,
// et un client trop ancien doit pouvoir apprendre qu'il doit se mettre a
// jour meme si son jeton n'est plus accepte.
// Les seuils vivent dans l'environnement Render — annoncer une version ne
// demande aucun redeploiement.
app.get('/api/app-version', (req, res) => {
  const current = typeof req.query.version === 'string' ? req.query.version : undefined;
  res.json({ data: appVersionInfo(current) });
});

// Protected routes
app.use('/api/groups', authenticate, groupsRouter);
app.use('/api/expenses', authenticate, expensesRouter);
app.use('/api/ocr', authenticate, ocrRouter);
app.use('/api/users', authenticate, usersRouter); // NOUVEAU
app.use('/api/settlements', authenticate, settlementsRouter);

// Health check
// commit : Render expose RENDER_GIT_COMMIT — permet de verifier en une
// requete quelle version tourne reellement en prod (curl .../health)
app.get('/health', (_, res) => res.json({
  ok: true,
  ts: new Date(),
  commit: (process.env.RENDER_GIT_COMMIT || 'local').slice(0, 7),
}));

// Nightly OCR training pipeline (2am)
cron.schedule('0 2 * * *', async () => {
  console.log('[Cron] Starting nightly OCR training pipeline...');
  try {
    await runTrainingPipeline({ trigger: 'cron' });
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

// ── Cron : rappel des dettes ─────────────────────────────────────────────
// Hebdomadaire par defaut (lundi 9h). DEBT_REMINDER_CRON permet de passer au
// quotidien ('0 9 * * *') ou de desactiver ('off') sans toucher au code.
// Ne notifie que les membres qui doivent encore quelque chose et qui ont
// active les rappels dans leurs reglages.
const debtReminderCron = process.env.DEBT_REMINDER_CRON || '0 9 * * 1';
if (debtReminderCron !== 'off') {
  cron.schedule(debtReminderCron, async () => {
    console.log('[Cron] Rappel des dettes...');
    try {
      const groups = await prisma.group.findMany({
        include: {
          members: { include: { user: true } },
          expenses: { include: { splits: true, payments: true } },
          settlements: true,
        },
      });

      // Une notification par personne, quel que soit le nombre de groupes
      const owed = new Map<string, { total: number; groups: number; tokens: string[] }>();

      for (const group of groups) {
        // Sans les remboursements, on relancerait des gens deja a jour.
        const balances = computeBalances(group.members, group.expenses as any, group.settlements);
        for (const balance of balances) {
          const debtor = group.members.find(m => m.id === balance.fromMemberId);
          if (!debtor?.user?.notifReminder) continue;
          const tokens = [debtor.user.pushToken, debtor.user.webPushToken].filter(Boolean) as string[];
          if (tokens.length === 0) continue;

          const entry = owed.get(debtor.user.id) || { total: 0, groups: 0, tokens };
          entry.total += balance.amount;
          entry.groups += 1;
          owed.set(debtor.user.id, entry);
        }
      }

      for (const entry of owed.values()) {
        await sendPushNotification(entry.tokens, {
          title: 'SplitIt — Remboursements en attente',
          body: entry.groups > 1
            ? `Tu dois ${entry.total.toFixed(2)} au total dans ${entry.groups} groupes.`
            : `Tu dois encore ${entry.total.toFixed(2)}. Pense a rembourser.`,
          data: { type: 'debt_reminder' },
        });
      }

      console.log(`[Cron] Rappel envoye a ${owed.size} personne(s)`);
    } catch (e) {
      console.error('[Cron] Rappel des dettes impossible :', e);
    }
  });
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Splitit backend running on :${PORT}`);
  logMailConfig();
});