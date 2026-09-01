// backend/src/services/balances.ts
// Qui doit quoi a qui — gere les depenses a plusieurs payeurs.
//
// Une part marquee `settled` a ete confirmee par le debiteur ET par le
// creancier : elle n'est plus due, et le credit du payeur diminue d'autant.

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
    const payments = expense.payments && expense.payments.length > 0
      ? expense.payments
      : [{ memberId: expense.paidByMemberId, amount: expense.totalAmount } as any];

    for (const payment of payments) {
      net[payment.memberId] = (net[payment.memberId] || 0) + payment.amount;
    }
    // Payeur principal = celui qui a le plus avance, meme regle que l'ecran
    // de remboursement.
    const primaryPayer = payments.reduce(
      (best: any, p: any) => (p.amount > best.amount ? p : best),
      payments[0]
    );

    for (const split of expense.splits) {
      if (!split.settled) {
        net[split.memberId] = (net[split.memberId] || 0) - split.amount;
        continue;
      }
      // Remboursement confirme par les deux parties : le debiteur est quitte,
      // et le credit du payeur diminue d'autant.
      net[primaryPayer.memberId] = (net[primaryPayer.memberId] || 0) - split.amount;
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
