-- Migration: multi-payer support + password reset fields
-- Run AFTER the initial migration with: npx prisma migrate deploy

-- 1. Password reset fields on users
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "resetToken"       TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS "resetTokenExpiry" TIMESTAMP(3);

-- 2. Remove the old FK relation (paidBy relation on GroupMember -> paidExpenses)
--    The column paidByMemberId stays for backward compat but loses the @relation
--    No SQL change needed — Prisma manages this in schema only.

-- 3. New expense_payments table
CREATE TABLE IF NOT EXISTS "expense_payments" (
  "id"        TEXT NOT NULL,
  "expenseId" TEXT NOT NULL,
  "memberId"  TEXT NOT NULL,
  "amount"    DOUBLE PRECISION NOT NULL,

  CONSTRAINT "expense_payments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "expense_payments_expenseId_memberId_key" UNIQUE ("expenseId", "memberId"),
  CONSTRAINT "expense_payments_expenseId_fkey"
    FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE CASCADE,
  CONSTRAINT "expense_payments_memberId_fkey"
    FOREIGN KEY ("memberId") REFERENCES "group_members"("id")
);

-- 4. Back-fill: migrate existing single-payer expenses → one payment row each
INSERT INTO "expense_payments" ("id", "expenseId", "memberId", "amount")
SELECT
  gen_random_uuid()::text,
  e."id",
  e."paidByMemberId",
  e."totalAmount"
FROM "expenses" e
ON CONFLICT DO NOTHING;
