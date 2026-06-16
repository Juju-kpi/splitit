// backend/src/services/balances.ts
// Computes who owes whom — supports multi-payer expenses via ExpensePayment[]

import { GroupMember, Expense, ExpenseSplit, ExpensePayment } from '@prisma/client';

type ExpenseWithSplitsAndPayments = Expense & {
  splits: ExpenseSplit[];
  payments: ExpensePayment[];
};

export interface Balance {
  fromMemberId: string;
  fromMember: GroupMember;
  toMemberId: string;
  toMember: GroupMember;
  amount: number;
}

export function computeBalances(
  members: GroupMember[],
  expenses: ExpenseWithSplitsAndPayments[]
): Balance[] {
  const net: Record<string, number> = {};
  members.forEach(m => (net[m.id] = 0));

  for (const expense of expenses) {
    if (expense.payments && expense.payments.length > 0) {
      // Multi-payer: credit each payer for what they actually paid
      for (const payment of expense.payments) {
        net[payment.memberId] = (net[payment.memberId] || 0) + payment.amount;
      }
    } else {
      // Legacy fallback: single payer credited full amount
      net[expense.paidByMemberId] = (net[expense.paidByMemberId] || 0) + expense.totalAmount;
    }
    // Debit each member for their share
    for (const split of expense.splits) {
      net[split.memberId] = (net[split.memberId] || 0) - split.amount;
    }
  }

  const memberMap = Object.fromEntries(members.map(m => [m.id, m]));

  const debtors = Object.entries(net)
    .filter(([, v]) => v < -0.01)
    .map(([id, v]) => ({ id, amount: -v }))
    .sort((a, b) => b.amount - a.amount);

  const creditors = Object.entries(net)
    .filter(([, v]) => v > 0.01)
    .map(([id, v]) => ({ id, amount: v }))
    .sort((a, b) => b.amount - a.amount);

  const balances: Balance[] = [];
  let i = 0, j = 0;

  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];
    const amount = Math.min(debtor.amount, creditor.amount);

    if (amount > 0.01) {
      balances.push({
        fromMemberId: debtor.id,
        fromMember: memberMap[debtor.id],
        toMemberId: creditor.id,
        toMember: memberMap[creditor.id],
        amount: Math.round(amount * 100) / 100,
      });
    }

    debtor.amount -= amount;
    creditor.amount -= amount;
    if (debtor.amount < 0.01) i++;
    if (creditor.amount < 0.01) j++;
  }

  return balances;
}
