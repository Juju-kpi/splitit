// backend/src/services/trainingPipeline.ts
//
// Free, deterministic, production-grade OCR self-improvement pipeline.
//
// Turns user corrections into a *versioned ruleset* stored in Postgres that the
// correction engine applies at inference time. No paid fine-tuning, no external
// model, no dependency on ephemeral disk.
//
// Guarantees:
//   - Rebuilt from scratch each run (idempotent).
//   - Evaluated on a held-out slice before going live.
//   - A new version is promoted only if it does NOT regress name accuracy
//     (automatic rollback: the previous version simply stays active).
//   - Exactly one active version is ever used by inference.

import fs from 'fs/promises';
import path from 'path';
import { prisma } from '../db';
import { invalidatePostCorrectCache } from './ocr/postCorrect';
import { buildRules, evaluate, Correction } from './ocr/rules';

const MIN_CORRECTIONS_TO_RUN = Number(process.env.OCR_MIN_CORRECTIONS ?? 20);
const HOLDOUT_RATIO          = Number(process.env.OCR_HOLDOUT_RATIO ?? 0.15);
const PROMOTE_EPS            = Number(process.env.OCR_PROMOTE_EPS ?? 0.0);

export interface PipelineResult {
  ran: boolean;
  reason?: string;
  version?: number;
  promoted?: boolean;
  ruleCount?: number;
  precisionName?: number;
  precisionPrice?: number;
  correctionCount?: number;
}

// Deterministic 0..99 bucket from an id (stable train/holdout split).
function bucket(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 100;
}

// Optional JSONL export (bonus, for future offline fine-tuning). Skipped unless
// TRAINING_EXPORT_DIR is set -> no ephemeral /tmp dependency by default.
async function maybeExportJsonl(corrections: Correction[], version: number): Promise<string | null> {
  const dir = process.env.TRAINING_EXPORT_DIR;
  if (!dir) return null;
  try {
    await fs.mkdir(dir, { recursive: true });
    const lines = corrections.map(c => JSON.stringify({
      messages: [
        { role: 'system', content: 'Correct the OCR receipt line into {name, price} JSON.' },
        { role: 'user', content: `Raw: "${c.ocrRaw}" | Price: "${c.ocrPriceRaw}"${c.vendorHint ? ` | Vendor: "${c.vendorHint}"` : ''}` },
        { role: 'assistant', content: JSON.stringify({ name: c.correctedName, price: c.correctedPrice }) },
      ],
    })).join('\n');
    const p = path.join(dir, `corrections_v${version}.jsonl`);
    await fs.writeFile(p, lines, 'utf8');
    return p;
  } catch (e) {
    console.warn('[Training] JSONL export skipped:', e);
    return null;
  }
}

export async function runTrainingPipeline(
  opts: { trigger?: 'cron' | 'manual' | 'api'; force?: boolean } = {},
): Promise<PipelineResult> {
  const trigger = opts.trigger ?? 'cron';

  const untrainedCount = await prisma.ocrCorrection.count({ where: { trained: false } });
  const totalCount = await prisma.ocrCorrection.count();

  if (!opts.force && untrainedCount < MIN_CORRECTIONS_TO_RUN) {
    const reason = `Only ${untrainedCount} new corrections (need ${MIN_CORRECTIONS_TO_RUN}).`;
    console.log(`[Training] Skipping. ${reason}`);
    return { ran: false, reason };
  }
  if (totalCount === 0) return { ran: false, reason: 'No corrections yet.' };

  const all: Correction[] = await prisma.ocrCorrection.findMany({
    orderBy: { createdAt: 'asc' },
    select: { id: true, ocrRaw: true, ocrPriceRaw: true, correctedName: true, correctedPrice: true, vendorHint: true },
  });

  // Deterministic train/holdout split.
  const holdoutMax = Math.floor(HOLDOUT_RATIO * 100);
  const train = all.filter(c => bucket(c.id) >= holdoutMax);
  const holdout = all.filter(c => bucket(c.id) < holdoutMax);

  // Evaluate a candidate built from the train split only.
  const evalRules = buildRules(train.length ? train : all);
  const { precisionName, precisionPrice } = evaluate(evalRules, holdout);

  // Production ruleset uses ALL data.
  const prodRules = buildRules(all);

  const lastRun = await prisma.ocrTrainingRun.findFirst({ orderBy: { version: 'desc' } });
  const activeRun = await prisma.ocrTrainingRun.findFirst({ where: { active: true } });
  const nextVersion = (lastRun?.version ?? 0) + 1;

  // Promotion gate: never regress name accuracy vs the currently active version.
  const baseline = activeRun?.precisionName ?? -1;
  const promote = precisionName >= baseline - PROMOTE_EPS;

  console.log(
    `[Training] v${nextVersion}: ${prodRules.length} rules, ` +
    `precisionName=${(precisionName * 100).toFixed(1)}% (baseline ${(baseline * 100).toFixed(1)}%), ` +
    `precisionPrice=${(precisionPrice * 100).toFixed(1)}% -> ${promote ? 'PROMOTE' : 'KEEP OLD'}`,
  );

  const run = await prisma.$transaction(async (tx) => {
    const created = await tx.ocrTrainingRun.create({
      data: {
        version: nextVersion,
        active: false,
        correctionCount: all.length,
        ruleCount: prodRules.length,
        status: promote ? 'promoted' : 'evaluated',
        trigger,
        precisionName,
        precisionPrice,
        metrics: {
          trainSize: train.length,
          holdoutSize: holdout.length,
          vendorSpecificRules: prodRules.filter(r => r.vendorNorm).length,
          agnosticRules: prodRules.filter(r => !r.vendorNorm).length,
        } as any,
      },
    });

    if (prodRules.length) {
      await tx.ocrCorrectionRule.createMany({
        data: prodRules.map(r => ({
          runId: created.id,
          version: nextVersion,
          keyNorm: r.keyNorm,
          vendorNorm: r.vendorNorm,
          correctedName: r.correctedName,
          priceHint: r.priceHint,
          support: r.support,
          confidence: r.confidence,
        })),
      });
    }

    if (promote) {
      await tx.ocrTrainingRun.updateMany({ where: { active: true }, data: { active: false } });
      await tx.ocrTrainingRun.update({ where: { id: created.id }, data: { active: true } });
    }

    await tx.ocrCorrection.updateMany({
      where: { trained: false },
      data: { trained: true, trainingRunId: created.id },
    });

    return created;
  });

  const datasetUrl = await maybeExportJsonl(all, nextVersion);
  if (datasetUrl) await prisma.ocrTrainingRun.update({ where: { id: run.id }, data: { datasetUrl } });

  if (promote) invalidatePostCorrectCache();

  return {
    ran: true,
    version: nextVersion,
    promoted: promote,
    ruleCount: prodRules.length,
    precisionName,
    precisionPrice,
    correctionCount: all.length,
  };
}

/** Roll back to the previous promoted version (ops safety net). */
export async function rollbackToPreviousVersion(): Promise<{ ok: boolean; activeVersion?: number }> {
  const promoted = await prisma.ocrTrainingRun.findMany({
    where: { status: 'promoted' },
    orderBy: { version: 'desc' },
    take: 2,
  });
  if (promoted.length < 2) return { ok: false };
  const previous = promoted[1];
  await prisma.$transaction([
    prisma.ocrTrainingRun.updateMany({ where: { active: true }, data: { active: false } }),
    prisma.ocrTrainingRun.update({ where: { id: previous.id }, data: { active: true } }),
  ]);
  invalidatePostCorrectCache();
  return { ok: true, activeVersion: previous.version };
}
