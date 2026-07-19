// backend/src/services/ocr/rules.test.ts
// Standalone sanity test for the pure OCR rule logic (no DB required).
// Run with:  npx tsx src/services/ocr/rules.test.ts

import { normalizeKey, lookupKey, sanitizePrice, similarity } from './normalize';
import { buildRules, evaluate, pickRule, Correction } from './rules';

let passed = 0, failed = 0;
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

console.log('\n1) normalize + price sanitation');
assert(normalizeKey('Café  ÉXPRESSO !!') === 'cafe expresso', 'normalizeKey strips accents/punctuation');
assert(sanitizePrice('l2,5O') === 12.50, 'sanitizePrice fixes OCR digit confusions (l2,5O -> 12.50)');
assert(sanitizePrice('CHF 4.00') === 4.00, 'sanitizePrice strips currency');
assert(sanitizePrice('abc') === null, 'sanitizePrice rejects garbage');
assert(similarity('cocacola', 'cocacol') > 0.85, 'similarity high for near-identical');

console.log('\n2) rule construction (majority vote + support/confidence)');
const corrections: Correction[] = [
  // "Coca Cola" misread several ways at vendor "Migros" -> Coca-Cola
  { id: 'a1', ocrRaw: 'Coca C0la',  ocrPriceRaw: '2.50', correctedName: 'Coca-Cola', correctedPrice: 2.5, vendorHint: 'Migros' },
  { id: 'a2', ocrRaw: 'C0ca Cola',  ocrPriceRaw: '2,50', correctedName: 'Coca-Cola', correctedPrice: 2.5, vendorHint: 'Migros' },
  { id: 'a3', ocrRaw: 'Coca Cola',  ocrPriceRaw: '2.50', correctedName: 'Coca-Cola', correctedPrice: 2.5, vendorHint: 'Migros' },
  // Croissant at a bakery, stable price
  { id: 'b1', ocrRaw: 'Croissnt',   ocrPriceRaw: '1.80', correctedName: 'Croissant', correctedPrice: 1.8, vendorHint: 'Boulangerie' },
  { id: 'b2', ocrRaw: 'Croissant',  ocrPriceRaw: '1,80', correctedName: 'Croissant', correctedPrice: 1.8, vendorHint: 'Boulangerie' },
  { id: 'b3', ocrRaw: 'Cr0issant',  ocrPriceRaw: '1.80', correctedName: 'Croissant', correctedPrice: 1.8, vendorHint: 'Boulangerie' },
  // A single noisy one-off (should be filtered: support < 2)
  { id: 'c1', ocrRaw: 'Xyzzy',      ocrPriceRaw: '9.99', correctedName: 'Mystery',   correctedPrice: 9.99, vendorHint: null },
];

const rules = buildRules(corrections);
const coca = rules.find(r => r.correctedName === 'Coca-Cola' && r.vendorNorm.startsWith('migros'));
const croissant = rules.find(r => r.correctedName === 'Croissant' && !r.vendorNorm);

assert(!!coca, 'builds a vendor-specific Coca-Cola rule');
assert(!!croissant, 'builds a vendor-agnostic Croissant rule');
assert(!rules.some(r => r.correctedName === 'Mystery'), 'drops single-support noise');
assert(!!croissant && croissant.priceHint === 1.8, 'derives a stable price hint for fixed-price item');

console.log('\n3) matching (exact + vendor priority + fuzzy)');
const exact = pickRule(rules, lookupKey('Coca Cola'), 'migros');
assert(!!exact && exact.correctedName === 'Coca-Cola', 'exact key + vendor match');
const fuzzy = pickRule(rules, lookupKey('Croissnt'), '');
assert(!!fuzzy && fuzzy.correctedName === 'Croissant', 'fuzzy match tolerates a typo');
const miss = pickRule(rules, lookupKey('Completely Different'), '');
assert(miss === null, 'no false-positive match on unrelated text');

console.log('\n4) evaluation on a holdout');
const holdout: Correction[] = [
  { id: 'h1', ocrRaw: 'Coca C0la', ocrPriceRaw: '2.50', correctedName: 'Coca-Cola', correctedPrice: 2.5, vendorHint: 'Migros' },
  { id: 'h2', ocrRaw: 'Croissnt',  ocrPriceRaw: 'l.80', correctedName: 'Croissant', correctedPrice: 1.8, vendorHint: 'Boulangerie' },
];
const metrics = evaluate(rules, holdout);
assert(metrics.precisionName === 1, 'name accuracy = 100% on holdout');
assert(metrics.precisionPrice === 1, 'price accuracy = 100% on holdout (incl. OCR-fixed l.80)');

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
