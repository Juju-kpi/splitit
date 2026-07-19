// backend/src/services/ocr/correctionEngine.ts
// Applies learned correction rules to raw OCR output at inference time.
// 100% deterministic and free: reads the *active* ruleset from Postgres,
// caches it in memory (TTL), and fixes item names/prices before returning.

import { prisma } from '../../db';
import { OcrItem } from '../../../../shared/types';
import { normalizeKey, normalizeVendor, sanitizePrice, lookupKey } from './normalize';
import { Rule, pickRule, MIN_APPLY_CONFIDENCE } from './rules';

const CACHE_TTL_MS = Number(process.env.OCR_RULES_CACHE_TTL_MS ?? 5 * 60 * 1000);

interface RuleCache { version: number; rules: Rule[]; loadedAt: number; }
let cache: RuleCache | null = null;

export function invalidateRuleCache(): void { cache = null; }

async function loadActiveRules(): Promise<RuleCache> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache;

  const activeRun = await prisma.ocrTrainingRun.findFirst({
    where: { active: true },
    orderBy: { version: 'desc' },
  });

  const rules: Rule[] = activeRun
    ? (await prisma.ocrCorrectionRule.findMany({ where: { version: activeRun.version } })).map(r => ({
        keyNorm: r.keyNorm,
        vendorNorm: r.vendorNorm,
        correctedName: r.correctedName,
        priceHint: r.priceHint,
        support: r.support,
        confidence: r.confidence,
      }))
    : [];

  cache = { version: activeRun?.version ?? -1, rules, loadedAt: Date.now() };
  return cache;
}

export interface CorrectionOutcome { items: OcrItem[]; appliedCount: number; version: number; }

/** Apply the active ruleset to a list of OCR items.
 *  - Always sanitizes the price string (generic, safe).
 *  - Replaces the name when a rule matches with enough confidence.
 *  - Uses priceHint only as a fallback when the OCR price is unusable. */
export async function applyCorrections(items: OcrItem[], vendor?: string): Promise<CorrectionOutcome> {
  const c = await loadActiveRules();
  const vendorNorm = normalizeVendor(vendor);
  let applied = 0;

  const out = items.map(item => {
    const next: OcrItem = { ...item };

    const sanitized = sanitizePrice(item.ocrPriceRaw || String(item.price));
    if (sanitized != null) next.price = sanitized;

    const keyNorm = lookupKey(item.ocrRaw || item.name);
    const rule = c.rules.length ? pickRule(c.rules, keyNorm, vendorNorm) : null;

    if (rule && rule.confidence >= MIN_APPLY_CONFIDENCE) {
      if (rule.correctedName && lookupKey(rule.correctedName) !== keyNorm) {
        next.name = rule.correctedName;
        next.confidence = Math.max(next.confidence, rule.confidence);
        applied++;
      }
      if ((sanitized == null || next.price <= 0) && rule.priceHint != null) {
        next.price = rule.priceHint;
      }
    }

    return next;
  });

  return { items: out, appliedCount: applied, version: c.version };
}

/** Few-shot examples (raw -> corrected) from the highest-support rules,
 *  injected into the vision prompt to steer raw extraction. "" when empty. */
export async function buildFewShotBlock(limit = 12): Promise<string> {
  const c = await loadActiveRules();
  if (!c.rules.length) return '';
  const top = [...c.rules]
    .sort((a, b) => b.support - a.support)
    .slice(0, limit)
    .map(r => `- "${r.keyNorm}" -> "${r.correctedName}"`);
  return `Known corrections for receipts like this (prefer these spellings when text is similar):\n${top.join('\n')}`;
}
