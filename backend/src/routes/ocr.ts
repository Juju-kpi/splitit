// backend/src/routes/ocr.ts
import { Router, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { prisma } from '../db';
import { AuthRequest } from '../middleware/auth';
import { processReceiptImage } from '../services/ocr';
import { uploadReceiptImage } from '../services/storage';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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

// GET /api/ocr/stats — training stats for display
router.get('/stats', async (req: AuthRequest, res: Response) => {
  const totalCorrections = await prisma.ocrCorrection.count();
  const trainedCorrections = await prisma.ocrCorrection.count({ where: { trained: true } });
  const lastRun = await prisma.ocrTrainingRun.findFirst({ orderBy: { exportedAt: 'desc' } });

  // Approximate accuracy improvement: baseline 72%, +0.5% per 10 corrections trained
  const accuracyEstimate = Math.min(99, 72 + Math.floor(trainedCorrections / 10) * 0.5);

  res.json({
    data: {
      totalCorrections,
      trainedCorrections,
      untrainedCount: totalCorrections - trainedCorrections,
      accuracyEstimate,
      lastTrainingRun: lastRun?.exportedAt || null,
      lastRunStatus: lastRun?.status || null,
    },
  });
});

export default router;