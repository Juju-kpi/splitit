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

/**
 * Le detail du calcul, ligne a ligne, pour une personne. Chaque champ est un
 * terme de l'addition qui donne `net` — c'est ce que les ecrans affichent
 * quand on demande « pourquoi je dois tant ».
 *
 *   net = paid − share + settledOwn − settledAsPayer
 *             + settlementsPaid − settlementsReceived
 */
export interface NetBreakdown {
  /** Ce qu'il a avance de sa poche, toutes depenses confondues. */
  paid: number;
  /** Sa part totale, qu'elle soit reglee ou non. */
  share: number;
  /** Celles de ses parts deja marquees reglees : il ne les doit plus. */
  settledOwn: number;
  /** Parts reglees dont il etait le payeur : son credit disparait d'autant. */
  settledAsPayer: number;
  /** Remboursements confirmes qu'il a verses. */
  settlementsPaid: number;
  /** Remboursements confirmes qu'il a recus. */
  settlementsReceived: number;
  /** Positif = on lui doit encore ; negatif = il doit. */
  net: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Decompose la position de chaque membre en ses termes. La somme des `net` est
 * toujours nulle : rien ne se cree ni ne se perd, ce que les uns ont avance en
 * trop, les autres le doivent exactement.
 */
export function computeNetBreakdown(
  members: GroupMember[],
  expenses: ExpenseWithSplitsAndPayments[],
  settlements: SettlementLike[] = []
): Record<string, NetBreakdown> {
  const rows: Record<string, NetBreakdown> = {};
  const blank = (): NetBreakdown => ({
    paid: 0, share: 0, settledOwn: 0, settledAsPayer: 0,
    settlementsPaid: 0, settlementsReceived: 0, net: 0,
  });
  members.forEach(m => (rows[m.id] = blank()));
  const row = (id: string) => (rows[id] ||= blank());

  for (const expense of expenses) {
    const payments = expense.payments && expense.payments.length > 0
      ? expense.payments
      : [{ memberId: expense.paidByMemberId, amount: expense.totalAmount } as any];

    for (const payment of payments) {
      row(payment.memberId).paid += payment.amount;
    }
    // Payeur principal = celui qui a le plus avance, meme regle que l'ecran
    // de remboursement.
    const primaryPayer = payments.reduce(
      (best: any, p: any) => (p.amount > best.amount ? p : best),
      payments[0]
    );

    for (const split of expense.splits) {
      row(split.memberId).share += split.amount;
      if (split.settled) {
        // Remboursement confirme par les deux parties : le debiteur est
        // quitte, et le credit du payeur diminue d'autant.
        row(split.memberId).settledOwn += split.amount;
        row(primaryPayer.memberId).settledAsPayer += split.amount;
      }
    }
  }

  // Remboursements confirmes : celui qui a verse remonte d'autant, celui qui
  // a recu redescend. Un remboursement annule ou en attente d'un accord ne
  // compte pas — c'est tout l'interet du double accord.
  for (const settlement of settlements) {
    if (!settlement.confirmed || settlement.cancelledAt) continue;
    row(settlement.fromMemberId).settlementsPaid += settlement.amount;
    row(settlement.toMemberId).settlementsReceived += settlement.amount;
  }

  for (const r of Object.values(rows)) {
    r.paid = round2(r.paid);
    r.share = round2(r.share);
    r.settledOwn = round2(r.settledOwn);
    r.settledAsPayer = round2(r.settledAsPayer);
    r.settlementsPaid = round2(r.settlementsPaid);
    r.settlementsReceived = round2(r.settlementsReceived);
    r.net = round2(
      r.paid - r.share + r.settledOwn - r.settledAsPayer
      + r.settlementsPaid - r.settlementsReceived
    );
  }
  return rows;
}

/**
 * Position nette de chaque membre. Positif = on lui doit encore.
 *
 * C'est la matiere premiere des soldes, exposee telle quelle parce que les
 * ecrans en ont besoin pour les barres « qui a avance, qui doit » : les
 * recalculer cote client sans les remboursements les laissait figes sur
 * l'etat d'avant remboursement.
 */
export function computeMemberNets(
  members: GroupMember[],
  expenses: ExpenseWithSplitsAndPayments[],
  settlements: SettlementLike[] = []
): Record<string, number> {
  const rows = computeNetBreakdown(members, expenses, settlements);
  return Object.fromEntries(Object.entries(rows).map(([id, r]) => [id, r.net]));
}

export function computeBalances(
  members: GroupMember[],
  expenses: ExpenseWithSplitsAndPayments[],
  settlements: SettlementLike[] = []
): Balance[] {
  const net = computeMemberNets(members, expenses, settlements);

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
