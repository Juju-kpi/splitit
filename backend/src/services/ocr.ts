// backend/src/services/ocr.ts
// OCR pipeline: Mistral Pixtral (free) → Tesseract.js fallback
//
// Setup: get a free API key at https://console.mistral.ai
// then set MISTRAL_API_KEY in your .env

import { OcrResult, OcrItem } from '../../../shared/types';
import { buildFewShotBlock } from './ocr/correctionEngine';
import { correctItems } from './ocr/postCorrect';

// ─── Mistral Pixtral ───────────────────────────────────────────────────────
// Free at console.mistral.ai — very accurate on receipts, handles FR/DE/IT/EN
async function runMistralPixtral(
  imageBuffer: Buffer,
  mimeType = 'image/jpeg',
  fewShot = '',
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
                text: `Extract all line items from this receipt. Return ONLY JSON, no markdown, no explanation.
Format: {"items": [{"name": "Item name", "price": 12.50}], "total": 49.90, "tax": 2.60}
- "total" = the grand total actually printed on the receipt (tax included). Omit if not printed.
- "tax" = sum of VAT/TVA/MwSt/IVA/service/tip lines. Omit if none.
Rules:
- Only include individual food/drink/product items that have a price
- Skip: totals, subtotals, taxes (TVA/MwSt/IVA), tips, service charge, table numbers, dates, headers, footers
- price must be a plain number, no currency symbol
- If quantity like "x2", "2x" or "×2": expand into SEPARATE items with unit price. E.g. "Café ×2  8.00" → [{"name":"Café","price":4.00},{"name":"Café","price":4.00}]
- Translate product names to French
- Clean up obvious OCR errors in the name
- Keep the original language of the receipt (FR/DE/IT/EN)${fewShot ? `\n\n${fewShot}` : ''}`,
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

    // Le modele repond soit l'objet demande, soit un simple tableau.
    let parsed: Array<{ name: string; price: number }> | null = null;
    let detectedTotal: number | undefined;
    let detectedTax: number | undefined;

    const objectMatch = content.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        const obj = JSON.parse(objectMatch[0]) as any;
        if (Array.isArray(obj?.items)) {
          parsed = obj.items;
          if (typeof obj.total === 'number' && obj.total > 0) detectedTotal = obj.total;
          if (typeof obj.tax === 'number' && obj.tax > 0) detectedTax = obj.tax;
        }
      } catch { /* on retombe sur le tableau */ }
    }

    if (!parsed) {
      const arrayMatch = content.match(/\[[\s\S]*\]/);
      if (!arrayMatch) {
        console.error('[OCR] Mistral: no JSON found in response:', content.slice(0, 200));
        return null;
      }
      parsed = JSON.parse(arrayMatch[0]);
    }

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

    // Total credible uniquement : au moins la somme des articles, et pas plus
    // du double (sinon c'est un numero de ticket mal lu).
    const itemsSum = items.reduce((sum, i) => sum + i.price, 0);
    const totalOk = detectedTotal !== undefined
      && detectedTotal >= itemsSum - 0.01
      && (itemsSum === 0 || detectedTotal <= itemsSum * 2);

    return {
      items,
      rawText: content,
      confidence: 0.95,
      vendor: undefined,
      detectedTotal: totalOk ? Math.round(detectedTotal! * 100) / 100 : undefined,
      detectedTax: detectedTax !== undefined ? Math.round(detectedTax * 100) / 100 : undefined,
    };
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

  // Total imprime et taxes : sur beaucoup de tickets les lignes sont HT, et
  // sans le total TTC la difference n'est payee par personne.
  const amountRe = /(\d{1,5}[.,]\d{2})\s*$/;
  let detectedTotal: number | undefined;
  let detectedTax = 0;

  for (const line of lines) {
    const amountMatch = amountRe.exec(line);
    const amount = amountMatch ? parseFloat(amountMatch[1].replace(',', '.')) : NaN;

    if (/(total|montant|somme|zu zahlen|a payer|à payer)/i.test(line) && !isNaN(amount)) {
      // Plusieurs lignes "total" possibles (sous-total, total TTC) : on garde
      // la plus grande, qui est le montant reellement paye.
      if (detectedTotal === undefined || amount > detectedTotal) detectedTotal = amount;
    }
    if (/(tva|mwst|iva|vat|tax|service|pourboire|tip)/i.test(line) && !isNaN(amount)) {
      detectedTax += amount;
    }

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

  const itemsSum = items.reduce((sum, i) => sum + i.price, 0);

  return {
    items,
    rawText: text,
    confidence: baseConf,
    vendor: lines.find(l => l.length > 3 && !/^\d/.test(l))?.slice(0, 60),
    // On ne renvoie le total que s'il est credible : au moins la somme des
    // articles, et pas plus du double (sinon c'est un numero de ticket).
    detectedTotal: detectedTotal !== undefined
      && detectedTotal >= itemsSum - 0.01
      && (itemsSum === 0 || detectedTotal <= itemsSum * 2)
      ? Math.round(detectedTotal * 100) / 100
      : undefined,
    detectedTax: detectedTax > 0 ? Math.round(detectedTax * 100) / 100 : undefined,
  };
}

// ─── Public API ────────────────────────────────────────────────────────────
export async function processReceiptImage(
  imageBuffer: Buffer,
  mimeType = 'image/jpeg'
): Promise<OcrResult> {
  // Learned few-shot examples (empty until the first ruleset is promoted).
  let fewShot = '';
  try { fewShot = await buildFewShotBlock(); } catch { /* non-fatal */ }

  let result: OcrResult | null = null;

  // 1. Try Mistral Pixtral — free, best quality
  if (process.env.MISTRAL_API_KEY) {
    result = await runMistralPixtral(imageBuffer, mimeType, fewShot);
    if (!result || result.items.length === 0) {
      console.warn('[OCR] Pixtral returned no items, falling back to Tesseract');
      result = null;
    }
  } else {
    console.log('[OCR] MISTRAL_API_KEY not set — using Tesseract directly');
    console.log('[OCR] Get a free key at https://console.mistral.ai');
  }

  // 2. Tesseract.js — always available, no key needed
  if (!result) {
    console.log('[OCR] Running Tesseract.js (takes ~5s)...');
    result = await runTesseract(imageBuffer);
    console.log('[OCR] Tesseract: %d items at %.0f%% confidence', result.items.length, result.confidence * 100);
  }

  // 3. Post-correction: fine-tuned model if promoted, else deterministic rules.
  try {
    const corrected = await correctItems(result.items, result.vendor);
    if (corrected.appliedCount > 0) {
      console.log('[OCR] Applied %d corrections via %s (v%d)', corrected.appliedCount, corrected.engine, corrected.version);
    }
    result.items = corrected.items;
  } catch (e) {
    console.warn('[OCR] Post-correction skipped:', e);
  }

  return result;
}