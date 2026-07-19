// backend/src/services/ocr/postCorrect.ts
// Single entry point for OCR post-correction. Picks the active engine:
//   - a promoted fine-tuned MODEL (transformers.js), when available;
//   - otherwise the deterministic RULE engine (cold-start + fallback).
// Always returns sanitized items so the caller never has to care which ran.

import { prisma } from '../../db';
import { OcrItem } from '../../../../shared/types';
import { applyCorrections, invalidateRuleCache } from './correctionEngine';
import { correctWithModel, invalidateModelCache } from './modelEngine';

const CACHE_TTL_MS = Number(process.env.OCR_ACTIVE_CACHE_TTL_MS ?? 5 * 60 * 1000);

interface ActiveRef {
  kind: 'model' | 'rules' | 'none';
  version: number;
  modelRepo: string | null;
  modelRevision: string | null;
  loadedAt: number;
}
let active: ActiveRef | null = null;

export function invalidatePostCorrectCache(): void {
  active = null;
  invalidateModelCache();
  invalidateRuleCache();
}

async function loadActive(): Promise<ActiveRef> {
  if (active && Date.now() - active.loadedAt < CACHE_TTL_MS) return active;
  const run = await prisma.ocrTrainingRun.findFirst({
    where: { active: true },
    orderBy: { version: 'desc' },
  });
  active = {
    kind: (run?.kind as ActiveRef['kind']) ?? 'none',
    version: run?.version ?? -1,
    modelRepo: run?.modelRepo ?? null,
    modelRevision: run?.modelRevision ?? null,
    loadedAt: Date.now(),
  };
  return active;
}

export interface PostCorrectResult { items: OcrItem[]; appliedCount: number; engine: string; version: number; }

export async function correctItems(items: OcrItem[], vendor?: string): Promise<PostCorrectResult> {
  const a = await loadActive();

  if (a.kind === 'model' && a.modelRepo) {
    try {
      const r = await correctWithModel(items, vendor, a.modelRepo, a.modelRevision ?? 'main');
      return { ...r, engine: 'model', version: a.version };
    } catch (e) {
      console.warn('[OCR] Model engine failed, falling back to rules:', e);
    }
  }

  const r = await applyCorrections(items, vendor); // rules (or plain sanitation if none)
  return { items: r.items, appliedCount: r.appliedCount, engine: a.kind === 'model' ? 'rules-fallback' : 'rules', version: r.version };
}
