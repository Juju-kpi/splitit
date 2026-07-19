// backend/src/services/ocr/normalize.ts
// Pure, dependency-free helpers for the OCR correction engine.
// Everything here is deterministic and free (no external calls, no paid libs).

/** Normalize a raw OCR string into a stable lookup key.
 *  lowercase → strip accents → keep [a-z0-9 ] → collapse spaces → trim. */
export function normalizeKey(raw: string): string {
  return (raw || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')       // punctuation/symbols → space
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalize a vendor hint ("" means vendor-agnostic). */
export function normalizeVendor(vendor?: string | null): string {
  if (!vendor) return '';
  return normalizeKey(vendor).split(' ').slice(0, 3).join(' '); // first tokens are enough
}

/** Fold common OCR letter/digit look-alikes to a single canonical form so that
 *  "coca c0la", "c0ca cola" and "coca cola" all collapse to the same key.
 *  Used only for clustering/lookup, never for display. */
export function foldOcrConfusions(s: string): string {
  return s
    .replace(/0/g, 'o')
    .replace(/1/g, 'l')
    .replace(/5/g, 's')
    .replace(/8/g, 'b');
}

/** The key used for clustering and matching (normalized + confusion-folded). */
export function lookupKey(raw: string): string {
  return foldOcrConfusions(normalizeKey(raw));
}

/** Classic Levenshtein edit distance (iterative, O(n*m), tiny strings). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,        // deletion
        curr[j - 1] + 1,    // insertion
        prev[j - 1] + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/** Similarity ratio in [0..1] based on normalized edit distance. */
export function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

/** Fix common OCR digit confusions in a price string and parse it.
 *  Deterministic, generic (not learned) — safe to always apply.
 *  Returns null when the string cannot be turned into a plausible price. */
export function sanitizePrice(raw: string): number | null {
  if (raw == null) return null;
  let s = String(raw).trim();

  // A price must contain at least one real digit — otherwise it's not a price.
  if (!/\d/.test(s)) return null;

  // Common OCR letter→digit confusions inside a numeric context.
  s = s
    .replace(/[oO]/g, '0')
    .replace(/[lI|]/g, '1')
    .replace(/[sS]/g, '5')
    .replace(/[bB]/g, '8')
    .replace(/[gG]/g, '9')
    .replace(/[^\d.,]/g, '');   // drop currency symbols, spaces, etc.

  if (!s) return null;

  // Normalize decimal separator: last comma/dot is the decimal point.
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  const decPos = Math.max(lastDot, lastComma);
  if (decPos >= 0) {
    const intPart = s.slice(0, decPos).replace(/[.,]/g, '');
    const fracPart = s.slice(decPos + 1).replace(/[.,]/g, '');
    s = `${intPart}.${fracPart}`;
  } else {
    s = s.replace(/[.,]/g, '');
  }

  const n = parseFloat(s);
  if (!isFinite(n) || n <= 0 || n > 100000) return null;
  return Math.round(n * 100) / 100;
}
