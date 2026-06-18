-- Migration: Supabase Auth + Collaborative Expense Completion
-- Run AFTER: npx prisma migrate dev --name add_supabase_auth_and_expense_completion

-- 1. Add supabaseId to users (nullable initially for safe migration)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "supabaseId" TEXT UNIQUE;

-- 2. Remove old password-reset columns (no longer needed with Supabase Auth)
ALTER TABLE "users" DROP COLUMN IF EXISTS "passwordHash";
ALTER TABLE "users" DROP COLUMN IF EXISTS "resetToken";
ALTER TABLE "users" DROP COLUMN IF EXISTS "resetTokenExpiry";

-- 3. Drop refresh_tokens table (Supabase handles sessions)
DROP TABLE IF EXISTS "refresh_tokens";

-- 4. Add expense completion tracking
--    isComplete: true when sum(splits) == totalAmount AND all items assigned
--    createdByMemberId: who uploaded/created the expense (can force-complete)
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "isComplete" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "createdByMemberId" TEXT;

-- Add FK for createdByMemberId
ALTER TABLE "expenses"
  ADD CONSTRAINT "expenses_createdByMemberId_fkey"
  FOREIGN KEY ("createdByMemberId")
  REFERENCES "group_members"("id")
  ON DELETE SET NULL;
