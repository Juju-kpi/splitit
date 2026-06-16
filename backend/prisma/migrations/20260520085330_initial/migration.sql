-- DropForeignKey
ALTER TABLE "expense_item_assignments" DROP CONSTRAINT "eia_memberId_fkey";

-- DropForeignKey
ALTER TABLE "expense_splits" DROP CONSTRAINT "es_memberId_fkey";

-- RenameForeignKey
ALTER TABLE "expense_item_assignments" RENAME CONSTRAINT "eia_itemId_fkey" TO "expense_item_assignments_itemId_fkey";

-- RenameForeignKey
ALTER TABLE "expense_items" RENAME CONSTRAINT "ei_expenseId_fkey" TO "expense_items_expenseId_fkey";

-- RenameForeignKey
ALTER TABLE "expense_splits" RENAME CONSTRAINT "es_expenseId_fkey" TO "expense_splits_expenseId_fkey";

-- RenameForeignKey
ALTER TABLE "expenses" RENAME CONSTRAINT "exp_groupId_fkey" TO "expenses_groupId_fkey";

-- RenameForeignKey
ALTER TABLE "expenses" RENAME CONSTRAINT "exp_paidBy_fkey" TO "expenses_paidByMemberId_fkey";

-- RenameForeignKey
ALTER TABLE "group_members" RENAME CONSTRAINT "gm_groupId_fkey" TO "group_members_groupId_fkey";

-- RenameForeignKey
ALTER TABLE "group_members" RENAME CONSTRAINT "gm_userId_fkey" TO "group_members_userId_fkey";

-- AddForeignKey
ALTER TABLE "expense_item_assignments" ADD CONSTRAINT "expense_item_assignments_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "group_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_splits" ADD CONSTRAINT "expense_splits_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "group_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "eia_item_member" RENAME TO "expense_item_assignments_itemId_memberId_key";
