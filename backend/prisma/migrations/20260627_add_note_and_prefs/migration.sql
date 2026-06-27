-- prisma/migrations/20260627_add_note_and_prefs/migration.sql
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "note" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "preferredLanguage" TEXT DEFAULT 'fr';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "preferredCurrency" TEXT NOT NULL DEFAULT 'CHF';