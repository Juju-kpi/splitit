// backend/src/routes/ocr.ts
import { Router, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../db';
import { AuthRequest } from '../middleware/auth';
import { processReceiptImage } from '../services/ocr';
import { uploadReceiptImage } from '../services/storage';
import { runTrainingPipeline, rollbackToPreviousVersion } from '../services/trainingPipeline';
import { promoteModel } from '../services/modelGovernance';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Admin guard for training operations. Set ADMIN_API_KEY in the backend env,
// then send it as `x-admin-key`. If unset, admin routes are disabled (403).
function requireAdmin(req: AuthRequest, res: Response): boolean {
  const key = process.env.ADMIN_API_KEY;
  if (!key || req.headers['x-admin-key'] !== key) {
    res.status(403).json({ error: 'Forbidden' });
    return false;
  }
  return true;
}

// POST /api/ocr/scan — upload receipt image, returns parsed items
router.post('/scan', upload.single('receipt'), async (req: AuthRequest, res: Response) => {
  if (!req.file) return res.status(400).json({ error: 'No image provided' });

  try {
    const result = await processReceiptImage(req.file.buffer);

    // Upload image to Supabase Storage for later reference
    let imageUrl: string | undefined;
    try {
      imageUrl = await uploadReceiptImage(req.file.buffer, req.file.mimetype, req.userId!);
    } catch (e) {
      console.warn('[OCR] Storage upload failed, continuing without:', e);
    }

    res.json({ data: { ...result, imageUrl } });
  } catch (e) {
    console.error('[OCR] Scan failed:', e);
    res.status(500).json({ error: 'OCR processing failed' });
  }
});

// POST /api/ocr/correction — save a user correction for training
router.post('/correction', async (req: AuthRequest, res: Response) => {
  const schema = z.object({
    receiptId: z.string().optional(),
    ocrRaw: z.string(),
    ocrPriceRaw: z.string(),
    correctedName: z.string(),
    correctedPrice: z.number(),
    confidence: z.number().min(0).max(1),
    vendorHint: z.string().optional(),
    deviceId: z.string().optional(),
    appVersion: z.string().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });

  // Only store if something actually changed (no point training on already-correct items)
  const nameChanged = parsed.data.ocrRaw !== parsed.data.correctedName;
  const priceChanged = parsed.data.ocrPriceRaw !== String(parsed.data.correctedPrice);
  if (!nameChanged && !priceChanged) {
    return res.json({ data: { saved: false, reason: 'no_change' } });
  }

  const correction = await prisma.ocrCorrection.create({ data: parsed.data as any });

  // Return updated stats for UI feedback
  const totalCorrections = await prisma.ocrCorrection.count();
  const untrained = await prisma.ocrCorrection.count({ where: { trained: false } });

  res.json({ data: { saved: true, id: correction.id, totalCorrections, untrainedCount: untrained } });
});

// GET /api/ocr/stats — real training stats (from the active ruleset)
router.get('/stats', async (_req: AuthRequest, res: Response) => {
  const totalCorrections = await prisma.ocrCorrection.count();
  const trainedCorrections = await prisma.ocrCorrection.count({ where: { trained: true } });
  const activeRun = await prisma.ocrTrainingRun.findFirst({ where: { active: true }, orderBy: { version: 'desc' } });
  const lastRun = await prisma.ocrTrainingRun.findFirst({ orderBy: { exportedAt: 'desc' } });

  res.json({
    data: {
      totalCorrections,
      trainedCorrections,
      untrainedCount: totalCorrections - trainedCorrections,
      // Real measured holdout accuracy of the live artifact (null until first promotion).
      activeVersion: activeRun?.version ?? null,
      activeKind: activeRun?.kind ?? null,          // "model" | "rules"
      modelRepo: activeRun?.modelRepo ?? null,
      modelRevision: activeRun?.modelRevision ?? null,
      ruleCount: activeRun?.ruleCount ?? 0,
      nameAccuracy: activeRun?.precisionName ?? null,
      priceAccuracy: activeRun?.precisionPrice ?? null,
      lastTrainingRun: lastRun?.exportedAt ?? null,
      lastRunStatus: lastRun?.status ?? null,
    },
  });
});

// POST /api/ocr/train — trigger the pipeline on demand (admin only)
router.post('/train', async (req: AuthRequest, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const force = req.query.force === 'true' || req.body?.force === true;
  try {
    const result = await runTrainingPipeline({ trigger: 'api', force });
    res.json({ data: result });
  } catch (e) {
    console.error('[OCR] Manual training failed:', e);
    res.status(500).json({ error: 'Training failed' });
  }
});

// POST /api/ocr/rollback — activate the previous promoted version (admin only)
router.post('/rollback', async (req: AuthRequest, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const result = await rollbackToPreviousVersion();
  if (!result.ok) return res.status(409).json({ error: 'No previous version to roll back to' });
  res.json({ data: result });
});

// GET /api/ocr/export — JSONL of all corrections for the offline trainer (admin only)
router.get('/export', async (req: AuthRequest, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const rows = await prisma.ocrCorrection.findMany({
    orderBy: { createdAt: 'asc' },
    select: { id: true, ocrRaw: true, ocrPriceRaw: true, correctedName: true, correctedPrice: true, vendorHint: true, createdAt: true },
  });
  res.type('application/x-ndjson');
  res.send(rows.map(r => JSON.stringify(r)).join('\n'));
});

// POST /api/ocr/promote-model — CI hook: register a fine-tuned model and
// activate it iff it does not regress name accuracy (admin only).
// Body: { modelRepo, modelRevision, precisionName, precisionPrice?, correctionCount?, metrics? }
router.post('/promote-model', async (req: AuthRequest, res: Response) => {
  if (!requireAdmin(req, res)) return;
  const { modelRepo, modelRevision, precisionName } = req.body ?? {};
  if (!modelRepo || !modelRevision || typeof precisionName !== 'number') {
    return res.status(400).json({ error: 'modelRepo, modelRevision and precisionName are required' });
  }
  try {
    const result = await promoteModel({
      modelRepo,
      modelRevision,
      precisionName,
      precisionPrice: req.body.precisionPrice,
      correctionCount: req.body.correctionCount,
      metrics: req.body.metrics,
    });
    res.json({ data: result });
  } catch (e) {
    console.error('[OCR] promote-model failed:', e);
    res.status(500).json({ error: 'Promotion failed' });
  }
});

export default router;