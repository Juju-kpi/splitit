#!/usr/bin/env python3
"""Pull user corrections from the backend and write train/holdout JSONL.

The trainer never touches the DB directly: it calls the admin-only export
endpoint (GET /api/ocr/export) with the ADMIN_API_KEY. This keeps DB
credentials out of CI.

Env:
  API_BASE       e.g. https://splitit-9x32.onrender.com
  ADMIN_API_KEY  same value as the backend's ADMIN_API_KEY
  HOLDOUT_RATIO  optional, default 0.15
Outputs: data/train.jsonl, data/holdout.jsonl
"""
import os, json, hashlib, pathlib, sys
import requests

API_BASE = os.environ["API_BASE"].rstrip("/")
ADMIN_KEY = os.environ["ADMIN_API_KEY"]
HOLDOUT_RATIO = float(os.environ.get("HOLDOUT_RATIO", "0.15"))

# Same input/target format the model is trained and served with.
def to_example(c: dict) -> dict:
    vendor = (c.get("vendorHint") or "").strip()
    src = f'ocr: {c["ocrRaw"]} | price: {c["ocrPriceRaw"]}'
    if vendor:
        src += f' | vendor: {vendor}'
    tgt = f'{c["correctedName"]} | {c["correctedPrice"]}'
    return {"input": src, "target": tgt, "id": c["id"]}

def bucket(_id: str) -> int:
    # Deterministic 0..99 split, stable across runs (mirrors the backend).
    h = int(hashlib.md5(_id.encode()).hexdigest(), 16)
    return h % 100

def main() -> None:
    r = requests.get(f"{API_BASE}/api/ocr/export",
                     headers={"x-admin-key": ADMIN_KEY}, timeout=60)
    r.raise_for_status()
    rows = [json.loads(l) for l in r.text.splitlines() if l.strip()]
    if not rows:
        print("No corrections returned; nothing to train.", file=sys.stderr)
        sys.exit(78)  # EX_CONFIG -> CI can treat as "skip, not fail"

    holdout_max = int(HOLDOUT_RATIO * 100)
    train, holdout = [], []
    for c in rows:
        ex = to_example(c)
        (holdout if bucket(c["id"]) < holdout_max else train).append(ex)

    out = pathlib.Path("data"); out.mkdir(exist_ok=True)
    for name, data in (("train", train), ("holdout", holdout)):
        with (out / f"{name}.jsonl").open("w", encoding="utf-8") as f:
            for ex in data:
                f.write(json.dumps({k: ex[k] for k in ("input", "target")}, ensure_ascii=False) + "\n")

    print(f"Exported {len(train)} train / {len(holdout)} holdout examples.")

if __name__ == "__main__":
    main()
