// backend/src/services/ocr/modelEngine.ts
// Runs the fine-tuned ByT5 OCR post-corrector on CPU, in-process, via
// transformers.js (@huggingface/transformers). No Python at runtime, no paid API.
//
// The model is an int8 ONNX export produced by ml/train.py + ml/export_onnx.py
// and published to the HuggingFace Hub. We load it once (per repo@revision),
// cache the pipeline, and reuse it for every receipt.

import { OcrItem } from '../../../../shared/types';
import { sanitizePrice } from './normalize';

const MAX_NEW_TOKENS = 48;

// transformers.js is ESM-only; load it lazily so it never blocks boot and only
// costs memory once the first model-backed correction actually runs.
type Text2Text = (inputs: string[], opts?: any) => Promise<Array<{ generated_text: string }>>;

let cachedKey = '';
let cachedPipe: Text2Text | null = null;
let loading: Promise<Text2Text> | null = null;

async function getPipeline(repo: string, revision: string): Promise<Text2Text> {
  const key = `${repo}@${revision || 'main'}`;
  if (cachedPipe && cachedKey === key) return cachedPipe;
  if (loading && cachedKey === key) return loading;

  cachedKey = key;
  loading = (async () => {
    const tf: any = await import('@huggingface/transformers');
    tf.env.allowLocalModels = false;   // pull from the Hub
    tf.env.allowRemoteModels = true;
    const pipe = await tf.pipeline('text2text-generation', repo, {
      revision: revision || 'main',
      dtype: 'q8',                     // use the int8 ONNX graphs
    });
    const fn: Text2Text = (inputs, opts) => pipe(inputs, opts);
    cachedPipe = fn;
    return fn;
  })();

  return loading;
}

export function invalidateModelCache(): void {
  cachedKey = '';
  cachedPipe = null;
  loading = null;
}

function buildInput(item: OcrItem, vendor?: string): string {
  let s = `ocr: ${item.ocrRaw || item.name} | price: ${item.ocrPriceRaw || item.price}`;
  if (vendor) s += ` | vendor: ${vendor}`;
  return s;
}

/** Correct a batch of OCR items with the fine-tuned model.
 *  Output format learned by the model: "<name> | <price>". */
export async function correctWithModel(
  items: OcrItem[],
  vendor: string | undefined,
  repo: string,
  revision: string,
): Promise<{ items: OcrItem[]; appliedCount: number }> {
  if (!items.length) return { items, appliedCount: 0 };

  const pipe = await getPipeline(repo, revision);
  const inputs = items.map(it => buildInput(it, vendor));
  const outputs = await pipe(inputs, { max_new_tokens: MAX_NEW_TOKENS });

  let applied = 0;
  const out = items.map((item, i) => {
    const next: OcrItem = { ...item };
    const gen = outputs[i]?.generated_text ?? '';
    const bar = gen.indexOf('|');
    const name = (bar >= 0 ? gen.slice(0, bar) : gen).trim();
    const priceStr = bar >= 0 ? gen.slice(bar + 1).trim() : '';

    if (name && name.toLowerCase() !== (item.name || '').toLowerCase()) {
      next.name = name;
      applied++;
    }
    const p = sanitizePrice(priceStr) ?? sanitizePrice(item.ocrPriceRaw || String(item.price));
    if (p != null) next.price = p;
    return next;
  });

  return { items: out, appliedCount: applied };
}
