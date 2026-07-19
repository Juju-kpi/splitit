#!/usr/bin/env python3
"""Fine-tune a small seq2seq model (ByT5) as an OCR post-corrector.

Input  : "ocr: <raw> | price: <rawPrice> [| vendor: <v>]"
Target : "<correctedName> | <correctedPrice>"

ByT5 is character-level, which is ideal for OCR noise (no sub-word OOV issues).
For a lighter/faster model on CPU-only CI, set BASE_MODEL=t5-small.

Env:
  BASE_MODEL   default google/byt5-small  (alt: t5-small)
  EPOCHS       default 8
  LR           default 5e-4
  BATCH        default 8
  OUT_DIR      default out/model
Reads data/train.jsonl + data/holdout.jsonl (from export_corrections.py).
Writes the fine-tuned model to OUT_DIR and metrics to out/metrics.json.
"""
import os, json, pathlib
from datasets import load_dataset
from transformers import (AutoTokenizer, AutoModelForSeq2SeqLM,
                          DataCollatorForSeq2Seq, Seq2SeqTrainer,
                          Seq2SeqTrainingArguments)

BASE_MODEL = os.environ.get("BASE_MODEL", "google/byt5-small")
EPOCHS = float(os.environ.get("EPOCHS", "8"))
LR = float(os.environ.get("LR", "5e-4"))
BATCH = int(os.environ.get("BATCH", "8"))
OUT_DIR = os.environ.get("OUT_DIR", "out/model")
MAX_IN, MAX_OUT = 160, 64

def main() -> None:
    tok = AutoTokenizer.from_pretrained(BASE_MODEL)
    model = AutoModelForSeq2SeqLM.from_pretrained(BASE_MODEL)

    ds = load_dataset("json", data_files={
        "train": "data/train.jsonl",
        "holdout": "data/holdout.jsonl",
    })

    def preprocess(batch):
        model_inputs = tok(batch["input"], max_length=MAX_IN, truncation=True)
        labels = tok(text_target=batch["target"], max_length=MAX_OUT, truncation=True)
        model_inputs["labels"] = labels["input_ids"]
        return model_inputs

    tokenized = ds.map(preprocess, batched=True, remove_columns=ds["train"].column_names)
    collator = DataCollatorForSeq2Seq(tok, model=model)

    args = Seq2SeqTrainingArguments(
        output_dir="out/checkpoints",
        num_train_epochs=EPOCHS,
        learning_rate=LR,
        per_device_train_batch_size=BATCH,
        per_device_eval_batch_size=BATCH,
        predict_with_generate=True,
        generation_max_length=MAX_OUT,
        logging_steps=25,
        save_strategy="no",
        report_to=[],
        fp16=False,
    )

    trainer = Seq2SeqTrainer(
        model=model, args=args,
        train_dataset=tokenized["train"],
        eval_dataset=tokenized["holdout"],
        data_collator=collator, tokenizer=tok,
    )
    trainer.train()

    # ── Evaluate exactly like the backend serves: name/price accuracy ──
    name_hits = price_hits = total = 0
    for ex in ds["holdout"]:
        enc = tok(ex["input"], return_tensors="pt", truncation=True, max_length=MAX_IN)
        out = model.generate(**enc, max_length=MAX_OUT)
        pred = tok.decode(out[0], skip_special_tokens=True)
        pred_name, _, pred_price = pred.partition("|")
        gold_name, _, gold_price = ex["target"].partition("|")
        total += 1
        if pred_name.strip().lower() == gold_name.strip().lower():
            name_hits += 1
        try:
            if abs(float(pred_price.strip()) - float(gold_price.strip())) <= 0.01:
                price_hits += 1
        except ValueError:
            pass

    metrics = {
        "baseModel": BASE_MODEL,
        "trainSize": len(ds["train"]),
        "holdoutSize": total,
        "precisionName": round(name_hits / total, 4) if total else 0.0,
        "precisionPrice": round(price_hits / total, 4) if total else 0.0,
    }
    pathlib.Path("out").mkdir(exist_ok=True)
    (pathlib.Path("out") / "metrics.json").write_text(json.dumps(metrics, indent=2))

    model.save_pretrained(OUT_DIR)
    tok.save_pretrained(OUT_DIR)
    print("Metrics:", json.dumps(metrics))

if __name__ == "__main__":
    main()
