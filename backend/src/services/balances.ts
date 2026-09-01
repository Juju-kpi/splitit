// backend/src/services/balances.ts
// Qui doit quoi a qui — gere les depenses a plusieurs payeurs.
//
// Deux choses reduisent une dette, et elles se cumulent :
//   - une part marquee `settled`, confirmee par le debiteur ET le creancier :
//     elle n'est plus due, et le credit du payeur diminue d'autant ;
//   - un remboursement (table `settlements`) confirme des deux cotes : de
//     l'argent a reellement change de mains, hors de toute depense.
//
// Le second existe parce que le premier ne sait pas solder une compensation
// en chaine : quand le solde net dit "tu dois a A" alors qu'aucune depense ne
// vous lie directement, il n'y a aucune part a marquer.

import { GroupMember, Expense, ExpenseSplit, ExpensePayment } from '@prisma/client';

type ExpenseWithSplitsAndPayments = Expense & {
  splits: ExpenseSplit[];
  payments: ExpensePayment[];
};

/** Ce dont le calcul a besoin — pas le modele Prisma complet, pour rester testable. */
export type SettlementLike = {
  fromMemberId: string;
  toMemberId: string;
  amount: number;
  confirmed: boolean;
  cancelledAt: Date | null;
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
  expenses: ExpenseWithSplitsAndPayments[],
  settlements: SettlementLike[] = []
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

  // Remboursements confirmes : celui qui a verse remonte d'autant, celui qui
  // a recu redescend. Un remboursement annule ou en attente d'un accord ne
  // compte pas — c'est tout l'interet du double accord.
  for (const settlement of settlements) {
    if (!settlement.confirmed || settlement.cancelledAt) continue;
    net[settlement.fromMemberId] = (net[settlement.fromMemberId] || 0) + settlement.amount;
    net[settlement.toMemberId] = (net[settlement.toMemberId] || 0) - settlement.amount;
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
