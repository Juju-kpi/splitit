// backend/src/services/modelGovernance.ts
// Records a freshly fine-tuned model as a new versioned run and activates it
// only if it does not regress name accuracy vs the currently active version.
// Called by the CI/Colab job after training + publishing to the HF Hub.

import { prisma } from '../db';
import { invalidatePostCorrectCache } from './ocr/postCorrect';

const PROMOTE_EPS = Number(process.env.OCR_PROMOTE_EPS ?? 0.0);

export interface PromoteModelInput {
  modelRepo: string;
  modelRevision: string;
  precisionName: number;
  precisionPrice?: number;
  correctionCount?: number;
  metrics?: unknown;
}

export interface PromoteModelResult {
  version: number;
  promoted: boolean;
  baseline: number;
  precisionName: number;
}

export async function promoteModel(input: PromoteModelInput): Promise<PromoteModelResult> {
  const lastRun = await prisma.ocrTrainingRun.findFirst({ orderBy: { version: 'desc' } });
  const activeRun = await prisma.ocrTrainingRun.findFirst({ where: { active: true } });
  const nextVersion = (lastRun?.version ?? 0) + 1;

  const baseline = activeRun?.precisionName ?? -1;
  const promote = input.precisionName >= baseline - PROMOTE_EPS;

  await prisma.$transaction(async (tx) => {
    const run = await tx.ocrTrainingRun.create({
      data: {
        version: nextVersion,
        kind: 'model',
        active: false,
        correctionCount: input.correctionCount ?? 0,
        modelRepo: input.modelRepo,
        modelRevision: input.modelRevision,
        status: promote ? 'promoted' : 'evaluated',
        trigger: 'ci',
        precisionName: input.precisionName,
        precisionPrice: input.precisionPrice ?? null,
        metrics: (input.metrics ?? {}) as any,
      },
    });
    if (promote) {
      await tx.ocrTrainingRun.updateMany({ where: { active: true }, data: { active: false } });
      await tx.ocrTrainingRun.update({ where: { id: run.id }, data: { active: true } });
    }
  });

  if (promote) invalidatePostCorrectCache(); // inference switches to the new model

  return { version: nextVersion, promoted: promote, baseline, precisionName: input.precisionName };
}
