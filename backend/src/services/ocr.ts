// backend/src/services/ocr.ts
// OCR pipeline: Mistral Pixtral (free) → Tesseract.js fallback
//
// Setup: get a free API key at https://console.mistral.ai
// then set MISTRAL_API_KEY in your .env

import { OcrResult, OcrItem } from '../../../shared/types';

// ─── Mistral Pixtral ───────────────────────────────────────────────────────
// Free at console.mistral.ai — very accurate on receipts, handles FR/DE/IT/EN
async function runMistralPixtral(
  imageBuffer: Buffer,
  mimeType = 'image/jpeg'
): Promise<OcrResult | null> {
  if (!process.env.MISTRAL_API_KEY) return null;

  try {
    const base64 = imageBuffer.toString('base64');
    const dataUrl = `data:${mimeType};base64,${base64}`;

    const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'pixtral-12b-2409',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: dataUrl },
              {
                type: 'text',
                text: `Extract all line items from this receipt. Return ONLY a JSON array, no markdown, no explanation.
Format: [{"name": "Item name", "price": 12.50}, ...]
Rules:
- Only include individual food/drink/product items that have a price
- Skip: totals, subtotals, taxes (TVA/MwSt/IVA), tips, service charge, table numbers, dates, headers, footers
- price must be a plain number, no currency symbol
- If quantity like "x2", "2x" or "×2": expand into SEPARATE items with unit price. E.g. "Café ×2  8.00" → [{"name":"Café","price":4.00},{"name":"Café","price":4.00}]
- Translate product names to French
- Clean up obvious OCR errors in the name
- Keep the original language of the receipt (FR/DE/IT/EN)`,
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      console.error('[OCR] Mistral API error:', response.status, await response.text());
      return null;
    }

    const data = await response.json() as any;
    const content: string = data.choices?.[0]?.message?.content || '';

    // Extract JSON array — model sometimes adds a brief sentence before
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.error('[OCR] Mistral: no JSON found in response:', content.slice(0, 200));
      return null;
    }

    const parsed: Array<{ name: string; price: number }> = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;

    const items: OcrItem[] = parsed
      .filter(item => item.name && typeof item.price === 'number' && item.price >= 0)
      .map(item => ({
        name: item.name.trim(),
        price: Math.round(item.price * 100) / 100,
        // Pixtral returns clean text — ocrRaw == name so user can still correct
        ocrRaw: item.name.trim(),
        ocrPriceRaw: String(item.price),
        confidence: 0.95,
      }));

    console.log('[OCR] Mistral Pixtral: %d items extracted', items.length);
    return { items, rawText: content, confidence: 0.95, vendor: undefined };
  } catch (e) {
    console.error('[OCR] Mistral Pixtral threw:', e);
    return null;
  }
}

// ─── Tesseract.js fallback ─────────────────────────────────────────────────
// Runs locally, no API key, completely free. Slower (~4-8s) and less accurate
// than Pixtral on complex receipts but works offline.
async function runTesseract(imageBuffer: Buffer): Promise<OcrResult> {
  const Tesseract = await import('tesseract.js');
  const worker = await Tesseract.createWorker('fra+eng+deu+ita', 1, {
    logger: () => {}, // silence progress logs
  });

  const { data } = await worker.recognize(imageBuffer);
  await worker.terminate();

  return parseReceiptText(data.text, data.confidence / 100);
}

// ─── Receipt text parser (Tesseract output) ────────────────────────────────
function parseReceiptText(text: string, baseConf: number): OcrResult {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  // Match lines ending with a price: "Risotto champignons   24.00" or "Pizza CHF 18.00"
  const priceRe = /^(.+?)\s+(?:CHF\s*)?(\d{1,4}[.,]\d{2})\s*$/i;

  const items: OcrItem[] = [];

  for (const line of lines) {
    if (/total|subtotal|tva|mwst|iva|rabais|service|merci|bienvenue|table|bon|kasse|receipt|thank/i.test(line)) continue;
    if (line.length < 3) continue;

    const match = priceRe.exec(line);
    if (!match) continue;

    const rawName = match[1].trim();
    const rawPrice = match[2];
    const price = parseFloat(rawPrice.replace(',', '.'));
    if (isNaN(price) || price <= 0 || price > 5000) continue;

    // Lower confidence if text looks noisy
    const noiseRatio = (rawName.match(/[0-9$€@#%^*|\\]/g) || []).length / rawName.length;
    const confidence = Math.max(0.3, baseConf - noiseRatio * 0.4);

    items.push({
      name: rawName.replace(/[|\\]/g, '').replace(/\s{2,}/g, ' ').trim(),
      price,
      ocrRaw: rawName,
      ocrPriceRaw: rawPrice,
      confidence,
    });
  }

  return {
    items,
    rawText: text,
    confidence: baseConf,
    vendor: lines.find(l => l.length > 3 && !/^\d/.test(l))?.slice(0, 60),
  };
}

// ─── Public API ────────────────────────────────────────────────────────────
export async function processReceiptImage(
  imageBuffer: Buffer,
  mimeType = 'image/jpeg'
): Promise<OcrResult> {
  // 1. Try Mistral Pixtral — free, best quality
  if (process.env.MISTRAL_API_KEY) {
    const result = await runMistralPixtral(imageBuffer, mimeType);
    if (result && result.items.length > 0) return result;
    console.warn('[OCR] Pixtral returned no items, falling back to Tesseract');
  } else {
    console.log('[OCR] MISTRAL_API_KEY not set — using Tesseract directly');
    console.log('[OCR] Get a free key at https://console.mistral.ai');
  }

  // 2. Tesseract.js — always available, no key needed
  console.log('[OCR] Running Tesseract.js (takes ~5s)...');
  const tessResult = await runTesseract(imageBuffer);
  console.log('[OCR] Tesseract: %d items at %.0f%% confidence', tessResult.items.length, tessResult.confidence * 100);
  return tessResult;
}