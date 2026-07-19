# SplitIt — OCR self-improvement pipeline (free, real fine-tuning)

A real, versioned, evaluated fine-tuning loop for receipt OCR — **not** prompt
engineering. Every stage uses free tooling.

## Architecture

Two inference stages run inside the Node backend on every receipt:

1. **Raw extraction** — Mistral Pixtral (free tier) with Tesseract.js fallback.
   Turns the image into raw item lines. Unchanged.
2. **Post-correction** — a fine-tuned **ByT5** seq2seq model that maps
   `ocr: <raw> | price: <rawPrice> [| vendor: <v>]` → `<name> | <price>`.
   Character-level, so it's robust to OCR noise. Exported to **int8 ONNX** and
   run on CPU via `@huggingface/transformers` (transformers.js) — no Python,
   no paid API at inference.

Until the first model is trained, stage 2 falls back to a deterministic
**rule engine** learned from corrections (cold-start + permanent safety net).
If the model errors at runtime, the backend automatically falls back to rules.

## The loop

```
users correct items ──▶ corrections in Postgres ──▶ export JSONL
        ▲                                                │
        │                                                ▼
   backend swaps to  ◀── promote if no regression ◀── fine-tune ByT5 (free GPU/CPU)
   the new model                                        │
        ▲                                                ▼
        └──────────── publish to HF Hub ◀──── export int8 ONNX
```

Governance guarantees:
- **Versioned** artifacts (`OcrTrainingRun.version`, one `active` at a time).
- **Held-out evaluation** (name + price accuracy) before anything goes live.
- **Promote only if no regression** vs the active version (`OCR_PROMOTE_EPS`).
- **Rollback** to the previous promoted version at any time.

## Free ways to run training

### Option A — GitHub Actions (fully automated, CPU)
`.github/workflows/ocr-retrain.yml` runs weekly + on demand. Set repo secrets:
`API_BASE`, `ADMIN_API_KEY`, `HF_TOKEN`, `HF_REPO` (e.g. `you/splitit-ocr`).
Default base model is `t5-small` (fast on CPU). It exports data, fine-tunes,
quantizes to ONNX, publishes to the Hub, and calls `/api/ocr/promote-model`.

### Option B — Google Colab (free GPU, best quality)
Use `google/byt5-small` for best OCR-noise robustness:
```bash
pip install -r requirements.txt
API_BASE=... ADMIN_API_KEY=... python export_corrections.py
BASE_MODEL=google/byt5-small EPOCHS=8 python train.py
python export_onnx.py
# then upload out/onnx-model to your HF repo at a new revision and POST /promote-model
```

## Backend env

| Var | Purpose | Default |
|-----|---------|---------|
| `ADMIN_API_KEY` | guards `/train`, `/rollback`, `/export`, `/promote-model` (`x-admin-key` header) | unset ⇒ admin routes disabled |
| `OCR_MIN_CORRECTIONS` | min new corrections before a rules run | 20 |
| `OCR_PROMOTE_EPS` | allowed accuracy regression to still promote | 0.0 |
| `OCR_HOLDOUT_RATIO` | eval holdout fraction | 0.15 |
| `OCR_FUZZY_THRESHOLD` | rule fuzzy-match cutoff | 0.88 |
| `OCR_MERGE_THRESHOLD` | variant-clustering cutoff | 0.9 |
| `TRAINING_EXPORT_DIR` | optional JSONL export dir (else skipped) | unset |

## Deploy notes
- `npm install` pulls `@huggingface/transformers`; `postinstall` regenerates the
  Prisma client. Run the migration `20260718000000_ocr_correction_rules`
  (`prisma migrate deploy`) before starting.
- First model download (~tens of MB int8) happens on the first model-backed
  receipt and is cached in memory; subsequent receipts are fast.
- Endpoints: `GET /api/ocr/stats` (live version + accuracy), `POST /api/ocr/train`
  (rules run), `POST /api/ocr/rollback`, `GET /api/ocr/export`,
  `POST /api/ocr/promote-model`.

## Why not fine-tune Pixtral directly?
Fine-tuning a hosted vision model isn't free and isn't exposed for this use.
The learnable signal in your data is text→text post-correction, so a small
seq2seq is the right thing to fine-tune — cheaper, self-hostable, and it runs
on CPU inside the backend you already pay nothing extra for.
