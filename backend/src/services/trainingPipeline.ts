// backend/src/services/trainingPipeline.ts
// Nightly job: aggregates OCR corrections into a JSONL fine-tuning dataset.
// Currently exports to disk (and optionally uploads to Supabase).
// You can hook this into OpenAI fine-tuning or your own training infra.

import fs from 'fs/promises';
import path from 'path';
import { prisma } from '../db';

const MIN_CORRECTIONS_TO_RUN = 20; // don't bother unless we have enough data
const EXPORT_DIR = process.env.TRAINING_EXPORT_DIR || '/tmp/splitit-training';

export async function runTrainingPipeline(): Promise<void> {
  const untrainedCount = await prisma.ocrCorrection.count({ where: { trained: false } });

  if (untrainedCount < MIN_CORRECTIONS_TO_RUN) {
    console.log(`[Training] Only ${untrainedCount} untrained corrections, need ${MIN_CORRECTIONS_TO_RUN}. Skipping.`);
    return;
  }

  console.log(`[Training] Starting pipeline with ${untrainedCount} corrections...`);

  // Create training run record
  const run = await prisma.ocrTrainingRun.create({
    data: { correctionCount: untrainedCount, status: 'pending' },
  });

  try {
    // Fetch all untrained corrections
    const corrections = await prisma.ocrCorrection.findMany({
      where: { trained: false },
      orderBy: { createdAt: 'asc' },
    });

    // Build JSONL dataset for fine-tuning
    // Format compatible with OpenAI fine-tuning: system + user + assistant messages
    const jsonlLines = corrections.map(c => {
      const entry = {
        messages: [
          {
            role: 'system',
            content: 'You are an OCR correction assistant. Given a raw OCR-extracted receipt line, output the corrected item name and price as JSON.',
          },
          {
            role: 'user',
            content: `Raw OCR text: "${c.ocrRaw}" | Raw price: "${c.ocrPriceRaw}"${c.vendorHint ? ` | Vendor: "${c.vendorHint}"` : ''}`,
          },
          {
            role: 'assistant',
            content: JSON.stringify({ name: c.correctedName, price: c.correctedPrice }),
          },
        ],
      };
      return JSON.stringify(entry);
    }).join('\n');

    // Also build a simple CSV for analysis
    const csvHeader = 'ocr_raw,ocr_price_raw,corrected_name,corrected_price,confidence,vendor\n';
    const csvLines = corrections.map(c =>
      [c.ocrRaw, c.ocrPriceRaw, c.correctedName, c.correctedPrice, c.confidence, c.vendorHint || '']
        .map(v => `"${String(v).replace(/"/g, '""')}"`)
        .join(',')
    ).join('\n');

    // Write to disk
    await fs.mkdir(EXPORT_DIR, { recursive: true });
    const timestamp = new Date().toISOString().slice(0, 10);
    const jsonlPath = path.join(EXPORT_DIR, `corrections_${timestamp}_run${run.id}.jsonl`);
    const csvPath = path.join(EXPORT_DIR, `corrections_${timestamp}_run${run.id}.csv`);

    await fs.writeFile(jsonlPath, jsonlLines, 'utf8');
    await fs.writeFile(csvPath, csvHeader + csvLines, 'utf8');

    console.log(`[Training] Exported ${corrections.length} corrections to ${jsonlPath}`);

    // Mark corrections as trained
    await prisma.ocrCorrection.updateMany({
      where: { id: { in: corrections.map(c => c.id) } },
      data: { trained: true, trainingRunId: run.id },
    });

    // Update run status
    await prisma.ocrTrainingRun.update({
      where: { id: run.id },
      data: { status: 'exported', datasetUrl: jsonlPath },
    });

    // ── Optional: trigger OpenAI fine-tuning ──────────────────────────────
    // Uncomment and set OPENAI_API_KEY to automatically kick off fine-tuning.
    // The fine-tuned model ID gets stored back in the run record.
    //
    // if (process.env.OPENAI_API_KEY) {
    //   const formData = new FormData();
    //   formData.append('file', new Blob([jsonlLines], { type: 'application/jsonl' }), 'corrections.jsonl');
    //   formData.append('purpose', 'fine-tune');
    //   const uploadRes = await fetch('https://api.openai.com/v1/files', {
    //     method: 'POST',
    //     headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    //     body: formData,
    //   });
    //   const { id: fileId } = await uploadRes.json();
    //   const ftRes = await fetch('https://api.openai.com/v1/fine_tuning/jobs', {
    //     method: 'POST',
    //     headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    //     body: JSON.stringify({ training_file: fileId, model: 'gpt-4o-mini' }),
    //   });
    //   const { id: jobId } = await ftRes.json();
    //   await prisma.ocrTrainingRun.update({ where: { id: run.id }, data: { status: 'trained', notes: jobId } });
    // }

    console.log(`[Training] Pipeline complete. Run ID: ${run.id}`);
  } catch (e) {
    await prisma.ocrTrainingRun.update({ where: { id: run.id }, data: { status: 'failed' } });
    throw e;
  }
}
