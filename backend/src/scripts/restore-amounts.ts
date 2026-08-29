// backend/src/scripts/restore-amounts.ts
//
// Annule ce qu'a modifié `audit-splits --apply`, à partir d'une sauvegarde
// produite par `backup-db.ts`. C'est le bouton "retour arrière".
//
//   npx tsx src/scripts/restore-amounts.ts --from=splitit-backup-....json
//   npx tsx src/scripts/restore-amounts.ts --from=... --name=morbihan
//   npx tsx src/scripts/restore-amounts.ts --from=... --apply
//
// Sans --apply : liste ce qui serait remis en place, sans rien écrire.
//
// Le script ne restaure QUE les champs que la correction touche :
//   - expense_splits : amount, settled, settledAt
//   - expense_payments : amount
//   - expenses : isComplete, totalAmount
// Il ne crée ni ne supprime aucune ligne. Si une part a été ajoutée après la
// sauvegarde, il te la signale au lieu de la supprimer en silence.

import 'dotenv/config';
import * as fs from 'fs';
import { prisma } from '../db';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const argValue = (prefix: string) => {
  const found = args.find(a => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
};
const FROM = argValue('--from=');
const ONLY_NAME = argValue('--name=');

const cents = (n: number) => Math.round(n * 100);

async function main() {
  if (!FROM) {
    console.error('Indique la sauvegarde : --from=splitit-backup-....json');
    process.exit(1);
  }
  if (!fs.existsSync(FROM)) {
    console.error(`Fichier introuvable : ${FROM}`);
    process.exit(1);
  }

  console.log(APPLY
    ? '\n⚠  MODE ÉCRITURE — les valeurs de la sauvegarde vont être remises\n'
    : '\n🔍 LECTURE SEULE — aucune écriture (ajoute --apply pour restaurer)\n');

  const dump = JSON.parse(fs.readFileSync(FROM, 'utf-8'));
  console.log(`Sauvegarde du ${dump.exportedAt}\n`);

  // Périmètre : tout, ou un seul groupe
  let expenseIds: Set<string> | null = null;
  if (ONLY_NAME) {
    const groups = await prisma.group.findMany({
      where: { name: { contains: ONLY_NAME, mode: 'insensitive' } },
      include: { expenses: { select: { id: true } } },
    });
    if (groups.length === 0) { console.log('Aucun groupe ne correspond.'); await prisma.$disconnect(); return; }
    expenseIds = new Set(groups.flatMap(g => g.expenses.map(e => e.id)));
    console.log(`Périmètre : ${groups.map(g => g.name).join(', ')} (${expenseIds.size} dépenses)\n`);
  }

  const inScope = (expenseId: string) => !expenseIds || expenseIds.has(expenseId);

  let splitsRestored = 0, paymentsRestored = 0, expensesRestored = 0, orphans = 0;

  // ── Parts ───────────────────────────────────────────────────────────────
  const currentSplits = await prisma.expenseSplit.findMany();
  const backupSplits = new Map<string, any>(
    (dump.tables.expenseSplits || []).map((s: any) => [s.id, s]),
  );

  for (const split of currentSplits) {
    if (!inScope(split.expenseId)) continue;
    const before = backupSplits.get(split.id);
    if (!before) { orphans++; continue; }

    const changed = cents(before.amount) !== cents(split.amount)
      || before.settled !== split.settled;
    if (!changed) continue;

    console.log(`   part ${split.id} : ${split.amount.toFixed(2)} → ${before.amount.toFixed(2)}`
      + (before.settled !== split.settled ? `  (réglé : ${split.settled} → ${before.settled})` : ''));
    splitsRestored++;

    if (APPLY) {
      await prisma.expenseSplit.update({
        where: { id: split.id },
        data: {
          amount: before.amount,
          settled: before.settled,
          settledAt: before.settledAt ? new Date(before.settledAt) : null,
        },
      });
    }
  }

  // ── Paiements ───────────────────────────────────────────────────────────
  const currentPayments = await prisma.expensePayment.findMany();
  const backupPayments = new Map<string, any>(
    (dump.tables.expensePayments || []).map((p: any) => [p.id, p]),
  );

  for (const payment of currentPayments) {
    if (!inScope(payment.expenseId)) continue;
    const before = backupPayments.get(payment.id);
    if (!before || cents(before.amount) === cents(payment.amount)) continue;

    console.log(`   paiement ${payment.id} : ${payment.amount.toFixed(2)} → ${before.amount.toFixed(2)}`);
    paymentsRestored++;
    if (APPLY) {
      await prisma.expensePayment.update({ where: { id: payment.id }, data: { amount: before.amount } });
    }
  }

  // ── Dépenses ────────────────────────────────────────────────────────────
  const currentExpenses = await prisma.expense.findMany();
  const backupExpenses = new Map<string, any>(
    (dump.tables.expenses || []).map((e: any) => [e.id, e]),
  );

  for (const exp of currentExpenses) {
    if (!inScope(exp.id)) continue;
    const before = backupExpenses.get(exp.id);
    if (!before) continue;

    const changed = before.isComplete !== exp.isComplete
      || cents(before.totalAmount) !== cents(exp.totalAmount);
    if (!changed) continue;

    console.log(`   dépense "${exp.description}" : `
      + `total ${exp.totalAmount.toFixed(2)} → ${before.totalAmount.toFixed(2)}, `
      + `complète ${exp.isComplete} → ${before.isComplete}`);
    expensesRestored++;
    if (APPLY) {
      await prisma.expense.update({
        where: { id: exp.id },
        data: { isComplete: before.isComplete, totalAmount: before.totalAmount },
      });
    }
  }

  console.log('');
  if (orphans > 0) {
    console.log(`ℹ ${orphans} part(s) absente(s) de la sauvegarde (créées depuis) — laissées en place.`);
  }
  const total = splitsRestored + paymentsRestored + expensesRestored;
  if (total === 0) {
    console.log('Rien à restaurer : la base correspond déjà à la sauvegarde.');
  } else if (APPLY) {
    console.log(`✅ Restauré : ${splitsRestored} part(s), ${paymentsRestored} paiement(s), ${expensesRestored} dépense(s).`);
  } else {
    console.log(`${total} valeur(s) à restaurer. Relance avec --apply.`);
  }

  await prisma.$disconnect();
}

main().catch(async e => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
