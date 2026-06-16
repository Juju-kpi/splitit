// backend/src/index.ts
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
import { authenticate } from './middleware/auth';
import { runTrainingPipeline } from './services/trainingPipeline';

const app = express();

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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Splitit backend running on :${PORT}`);
});
