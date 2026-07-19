// backend/src/services/ocr/rules.ts
// PURE rule logic — no database, no side effects. Fully unit-testable.
// Shared by the inference engine (correctionEngine.ts) and the training
// pipeline (trainingPipeline.ts) so both use identical matching semantics.

import { normalizeKey, normalizeVendor, similarity, sanitizePrice, lookupKey } from './normalize';

export const FUZZY_THRESHOLD    = Number(process.env.OCR_FUZZY_THRESHOLD ?? 0.88);
export const MIN_APPLY_CONFIDENCE = Number(process.env.OCR_MIN_APPLY_CONFIDENCE ?? 0.6);
export const MIN_SUPPORT         = Number(process.env.OCR_MIN_SUPPORT ?? 2);
export const MIN_CONFIDENCE      = Number(process.env.OCR_MIN_CONFIDENCE ?? 0.6);
export const PRICE_STABILITY     = Number(process.env.OCR_PRICE_STABILITY ?? 0.02);

export const MERGE_THRESHOLD     = Number(process.env.OCR_MERGE_THRESHOLD ?? 0.9);

export interface Rule {
  keyNorm: string;
  vendorNorm: string;
  correctedName: string;
  priceHint: number | null;
  support: number;
  confidence: number;
}

export interface Correction {
  id: string;
  ocrRaw: string;
  ocrPriceRaw: string;
  correctedName: string;
  correctedPrice: number;
  vendorHint: string | null;
}

function better(a: Rule | null, b: Rule): Rule {
  if (!a) return b;
  return b.confidence > a.confidence || (b.confidence === a.confidence && b.support > a.support) ? b : a;
}

/** Match a normalized key against a ruleset.
 *  Priority: exact key + same vendor -> exact key vendor-agnostic -> fuzzy. */
export function pickRule(rules: Rule[], keyNorm: string, vendorNorm: string): Rule | null {
  let exactVendor: Rule | null = null;
  let exactAgnostic: Rule | null = null;

  for (const r of rules) {
    if (r.keyNorm === keyNorm) {
      if (r.vendorNorm && r.vendorNorm === vendorNorm) exactVendor = better(exactVendor, r);
      else if (!r.vendorNorm) exactAgnostic = better(exactAgnostic, r);
    }
  }
  if (exactVendor) return exactVendor;
  if (exactAgnostic) return exactAgnostic;

  let bestRule: Rule | null = null;
  let bestScore = FUZZY_THRESHOLD;
  for (const r of rules) {
    if (Math.abs(r.keyNorm.length - keyNorm.length) > 4) continue;
    if (r.vendorNorm && r.vendorNorm !== vendorNorm) continue;
    const s = similarity(keyNorm, r.keyNorm);
    if (s >= bestScore) { bestRule = r; bestScore = s; }
  }
  return bestRule;
}

/** Aggregate corrections into vendor-specific + vendor-agnostic rules.
 *  Near-duplicate OCR variants (e.g. "Coca C0la" / "C0ca Cola") are clustered
 *  together so recurring misreads accumulate support instead of splitting. */
export function buildRules(corrections: Correction[]): Rule[] {
  interface Cluster {
    keyCounts: Map<string, number>; // variant -> occurrences (to pick canonical)
    names: Map<string, number>;
    prices: number[];
    total: number;
  }
  // buckets keyed by vendorNorm ("" = agnostic) -> list of clusters
  const buckets = new Map<string, Cluster[]>();

  const addToBucket = (vendorNorm: string, keyNorm: string, c: Correction) => {
    let clusters = buckets.get(vendorNorm);
    if (!clusters) { clusters = []; buckets.set(vendorNorm, clusters); }

    // find an existing cluster whose canonical (most common) key is close enough
    let target: Cluster | null = null;
    let bestScore = MERGE_THRESHOLD;
    for (const cl of clusters) {
      const canonical = canonicalKey(cl);
      const s = similarity(keyNorm, canonical);
      if (s >= bestScore) { target = cl; bestScore = s; }
    }
    if (!target) {
      target = { keyCounts: new Map(), names: new Map(), prices: [], total: 0 };
      clusters.push(target);
    }
    target.keyCounts.set(keyNorm, (target.keyCounts.get(keyNorm) ?? 0) + 1);
    target.names.set(c.correctedName, (target.names.get(c.correctedName) ?? 0) + 1);
    if (isFinite(c.correctedPrice) && c.correctedPrice > 0) target.prices.push(c.correctedPrice);
    target.total++;
  };

  for (const c of corrections) {
    const keyNorm = lookupKey(c.ocrRaw);
    if (!keyNorm) continue;
    const vendorNorm = normalizeVendor(c.vendorHint);
    if (vendorNorm) addToBucket(vendorNorm, keyNorm, c);
    addToBucket('', keyNorm, c);
  }

  const rules: Rule[] = [];
  for (const [vendorNorm, clusters] of buckets) {
    for (const cl of clusters) {
      let topName = '', topCount = 0;
      for (const [name, count] of cl.names) if (count > topCount) { topName = name; topCount = count; }
      const confidence = topCount / cl.total;
      if (cl.total < MIN_SUPPORT || confidence < MIN_CONFIDENCE) continue;

      let priceHint: number | null = null;
      if (cl.prices.length >= Math.max(2, MIN_SUPPORT)) {
        const sorted = [...cl.prices].sort((a, b) => a - b);
        const median = sorted[Math.floor(sorted.length / 2)];
        const spread = (sorted[sorted.length - 1] - sorted[0]) / (median || 1);
        if (spread <= PRICE_STABILITY) priceHint = Math.round(median * 100) / 100;
      }

      rules.push({
        keyNorm: canonicalKey(cl),
        vendorNorm,
        correctedName: topName,
        priceHint,
        support: cl.total,
        confidence,
      });
    }
  }
  return rules;

  function canonicalKey(cl: { keyCounts: Map<string, number> }): string {
    let key = '', best = -1;
    for (const [k, n] of cl.keyCounts) if (n > best) { key = k; best = n; }
    return key;
  }
}

/** Measure name/price accuracy of a ruleset on a held-out slice. */
export function evaluate(rules: Rule[], holdout: Correction[]): { precisionName: number; precisionPrice: number } {
  if (holdout.length === 0) return { precisionName: 0, precisionPrice: 0 };
  let nameHits = 0, priceHits = 0;

  for (const c of holdout) {
    const keyNorm = lookupKey(c.ocrRaw);
    const vendorNorm = normalizeVendor(c.vendorHint);
    const rule = pickRule(rules, keyNorm, vendorNorm);

    const predictedName = rule?.correctedName ?? c.ocrRaw;
    if (normalizeKey(predictedName) === normalizeKey(c.correctedName)) nameHits++;

    const sanitized = sanitizePrice(c.ocrPriceRaw);
    const predictedPrice = sanitized ?? rule?.priceHint ?? NaN;
    if (Math.abs(predictedPrice - c.correctedPrice) <= 0.01) priceHits++;
  }

  return { precisionName: nameHits / holdout.length, precisionPrice: priceHits / holdout.length };
}
