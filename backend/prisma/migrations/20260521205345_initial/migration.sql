-- DropForeignKey
ALTER TABLE "expense_payments" DROP CONSTRAINT "expense_payments_expenseId_fkey";

-- DropForeignKey
ALTER TABLE "expense_payments" DROP CONSTRAINT "expense_payments_memberId_fkey";

-- DropForeignKey
ALTER TABLE "expenses" DROP CONSTRAINT "expenses_paidByMemberId_fkey";

-- AddForeignKey
ALTER TABLE "expense_payments" ADD CONSTRAINT "expense_payments_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_payments" ADD CONSTRAINT "expense_payments_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "group_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
