-- OCR self-improvement pipeline: versioned correction rules + richer training runs.

-- 1. Extend training runs with versioning, promotion flag and evaluation metrics.
ALTER TABLE "ocr_training_runs" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ocr_training_runs" ADD COLUMN IF NOT EXISTS "active" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ocr_training_runs" ADD COLUMN IF NOT EXISTS "ruleCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ocr_training_runs" ADD COLUMN IF NOT EXISTS "trigger" TEXT NOT NULL DEFAULT 'cron';
ALTER TABLE "ocr_training_runs" ADD COLUMN IF NOT EXISTS "precisionName" DOUBLE PRECISION;
ALTER TABLE "ocr_training_runs" ADD COLUMN IF NOT EXISTS "precisionPrice" DOUBLE PRECISION;
ALTER TABLE "ocr_training_runs" ADD COLUMN IF NOT EXISTS "metrics" JSONB;

CREATE INDEX IF NOT EXISTS "ocr_training_runs_active_idx" ON "ocr_training_runs" ("active");
CREATE INDEX IF NOT EXISTS "ocr_corrections_trained_idx" ON "ocr_corrections" ("trained");

-- 2. Learned correction rules used at inference time.
CREATE TABLE IF NOT EXISTS "ocr_correction_rules" (
  "id"            TEXT NOT NULL,
  "runId"         TEXT NOT NULL,
  "version"       INTEGER NOT NULL,
  "keyNorm"       TEXT NOT NULL,
  "vendorNorm"    TEXT NOT NULL DEFAULT '',
  "correctedName" TEXT NOT NULL,
  "priceHint"     DOUBLE PRECISION,
  "support"       INTEGER NOT NULL,
  "confidence"    DOUBLE PRECISION NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ocr_correction_rules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ocr_correction_rules_version_keyNorm_vendorNorm_key"
  ON "ocr_correction_rules" ("version", "keyNorm", "vendorNorm");
CREATE INDEX IF NOT EXISTS "ocr_correction_rules_version_idx"
  ON "ocr_correction_rules" ("version");

ALTER TABLE "ocr_correction_rules"
  ADD CONSTRAINT "ocr_correction_rules_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "ocr_training_runs" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 3. Model governance (fine-tuned post-corrector artifacts).
ALTER TABLE "ocr_training_runs" ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'rules';
ALTER TABLE "ocr_training_runs" ADD COLUMN IF NOT EXISTS "modelRepo" TEXT;
ALTER TABLE "ocr_training_runs" ADD COLUMN IF NOT EXISTS "modelRevision" TEXT;
