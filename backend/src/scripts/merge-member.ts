// backend/src/scripts/merge-member.ts
//
// Fusionne deux membres d'un même groupe qui sont en réalité la même personne
// (doublon créé en ajoutant un participant deux fois, ou avant qu'il rejoigne).
//
//   Voir ce qui serait fait (AUCUNE écriture) :
//     npx tsx src/scripts/merge-member.ts --name=Bretagne --from=Max --into=maxfuseau
//
//   Appliquer :
//     npx tsx src/scripts/merge-member.ts --name=Bretagne --from=Max --into=maxfuseau --apply
//
// CE QUI EST DÉPLACÉ de `from` vers `into` :
//   - les parts (expense_splits) ;
//   - les paiements (expense_payments) ;
//   - les assignations d'articles (expense_item_assignments) ;
//   - les dépenses dont `from` est le payeur principal ou le créateur.
// Puis la ligne membre `from` est supprimée.
//
// GARDE-FOUS
//   - Les deux membres doivent appartenir au MÊME groupe.
//   - Si les deux sont liés à des comptes utilisateurs différents, ce sont
//     deux vraies personnes : le script refuse (sauf --force-accounts).
//   - Quand les deux ont déjà une ligne sur la même dépense, les montants sont
//     ADDITIONNÉS (une contrainte d'unicité interdit deux lignes) ; une part
//     n'est considérée réglée que si les deux l'étaient.
//   - Tout se fait dans UNE transaction : en cas de problème, rien n'est écrit.
//   - Avant la suppression, on revérifie qu'plus rien ne pointe vers `from`.
//   - Aucune dépense, aucun article, aucun montant total n'est modifié : la
//     somme des parts et des paiements du groupe reste identique.

import 'dotenv/config';
import { prisma } from '../db';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const FORCE_ACCOUNTS = args.includes('--force-accounts');
const argValue = (prefix: string) => {
  const found = args.find(a => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
};
const GROUP_NAME = argValue('--name=');
const GROUP_ID = argValue('--group=');
const FROM = argValue('--from=');
const INTO = argValue('--into=');

const money = (n: number) => n.toFixed(2);

async function main() {
  if ((!GROUP_NAME && !GROUP_ID) || !FROM || !INTO) {
    console.error('Usage : --name=<groupe> --from=<doublon> --into=<membre gardé> [--apply]');
    process.exit(1);
  }

  const group = await prisma.group.findFirst({
    where: GROUP_ID ? { id: GROUP_ID } : { name: { contains: GROUP_NAME!, mode: 'insensitive' } },
    include: { members: true },
  });
  if (!group) { console.error('Groupe introuvable.'); process.exit(1); }

  const find = (needle: string) => group.members.find(m =>
    m.id === needle || m.displayName.toLowerCase() === needle.toLowerCase());

  const from = find(FROM);
  const into = find(INTO);
  if (!from || !into) {
    console.error(`\n⛔ Membre introuvable dans « ${group.name} ».`);
    console.error(`   Membres : ${group.members.map(m => m.displayName).join(', ')}\n`);
    process.exit(1);
  }
  if (from.id === into.id) { console.error('⛔ Les deux membres sont identiques.'); process.exit(1); }

  console.log(`\n${group.emoji} ${group.name}`);
  console.log(`Fusion : « ${from.displayName} » → « ${into.displayName} »`);
  console.log(`   ${from.displayName} : ${from.userId ? 'compte lié' : 'sans compte'} (id ${from.id})`);
  console.log(`   ${into.displayName} : ${into.userId ? 'compte lié' : 'sans compte'} (id ${into.id})`);

  if (from.userId && into.userId && from.userId !== into.userId && !FORCE_ACCOUNTS) {
    console.error('\n⛔ Ces deux membres sont liés à DEUX comptes utilisateurs différents.');
    console.error('   Ce sont donc deux vraies personnes, pas un doublon. Rien n\'a été touché.');
    console.error('   Si tu es certain du contraire, relance avec --force-accounts.\n');
    return;
  }

  // ── Inventaire de ce qui est accroché au doublon ────────────────────────
  const [splits, payments, assignments, paidExpenses, createdExpenses] = await Promise.all([
    prisma.expenseSplit.findMany({ where: { memberId: from.id }, include: { expense: true } }),
    prisma.expensePayment.findMany({ where: { memberId: from.id }, include: { expense: true } }),
    prisma.expenseItemAssignment.findMany({ where: { memberId: from.id }, include: { item: true } }),
    prisma.expense.findMany({ where: { paidByMemberId: from.id } }),
    prisma.expense.findMany({ where: { createdByMemberId: from.id } }),
  ]);

  const intoSplits = await prisma.expenseSplit.findMany({ where: { memberId: into.id } });
  const intoPayments = await prisma.expensePayment.findMany({ where: { memberId: into.id } });
  const intoAssignments = await prisma.expenseItemAssignment.findMany({ where: { memberId: into.id } });

  console.log(`\nÀ déplacer depuis « ${from.displayName} » :`);
  console.log(`   parts                    ${splits.length}`);
  for (const sp of splits) {
    const collision = intoSplits.find(s => s.expenseId === sp.expenseId);
    console.log(`      « ${sp.expense.description} » ${money(sp.amount)}`
      + (sp.settled ? ' (réglé)' : '')
      + (collision ? `  → fusion avec la part existante de ${into.displayName} (${money(collision.amount)}) = ${money(collision.amount + sp.amount)}` : ''));
  }
  console.log(`   paiements                ${payments.length}`);
  for (const p of payments) {
    const collision = intoPayments.find(x => x.expenseId === p.expenseId);
    console.log(`      « ${p.expense.description} » ${money(p.amount)}`
      + (collision ? `  → fusion (= ${money(collision.amount + p.amount)})` : ''));
  }
  console.log(`   assignations d'articles  ${assignments.length}`);
  console.log(`   dépenses payées          ${paidExpenses.length}`);
  console.log(`   dépenses créées          ${createdExpenses.length}`);

  const nothing = splits.length + payments.length + assignments.length
                + paidExpenses.length + createdExpenses.length === 0;
  console.log(nothing
    ? `\nRien n'est rattaché à « ${from.displayName} » : la ligne peut être supprimée telle quelle.`
    : `\nAprès fusion, « ${from.displayName} » n'aura plus aucune référence et sera supprimé.`);

  if (!APPLY) {
    console.log('\n🔍 LECTURE SEULE — rien n\'a été écrit. Ajoute --apply pour fusionner.\n');
    return;
  }

  // ── Écriture, en une seule transaction ──────────────────────────────────
  await prisma.$transaction(async tx => {
    for (const sp of splits) {
      const existing = await tx.expenseSplit.findUnique({
        where: { expenseId_memberId: { expenseId: sp.expenseId, memberId: into.id } },
      });
      if (existing) {
        // Une contrainte interdit deux parts du même membre sur une dépense :
        // on additionne les montants au lieu de créer un doublon.
        await tx.expenseSplit.update({
          where: { id: existing.id },
          data: {
            amount: Math.round((existing.amount + sp.amount) * 100) / 100,
            settled: existing.settled && sp.settled,
            settledAt: existing.settled && sp.settled ? (existing.settledAt ?? sp.settledAt) : null,
          },
        });
        await tx.expenseSplit.delete({ where: { id: sp.id } });
      } else {
        await tx.expenseSplit.update({ where: { id: sp.id }, data: { memberId: into.id } });
      }
    }

    for (const p of payments) {
      const existing = await tx.expensePayment.findUnique({
        where: { expenseId_memberId: { expenseId: p.expenseId, memberId: into.id } },
      });
      if (existing) {
        await tx.expensePayment.update({
          where: { id: existing.id },
          data: { amount: Math.round((existing.amount + p.amount) * 100) / 100 },
        });
        await tx.expensePayment.delete({ where: { id: p.id } });
      } else {
        await tx.expensePayment.update({ where: { id: p.id }, data: { memberId: into.id } });
      }
    }

    for (const a of assignments) {
      const existing = await tx.expenseItemAssignment.findUnique({
        where: { itemId_memberId: { itemId: a.itemId, memberId: into.id } },
      });
      if (existing) {
        await tx.expenseItemAssignment.delete({ where: { id: a.id } });
      } else {
        await tx.expenseItemAssignment.update({ where: { id: a.id }, data: { memberId: into.id } });
      }
    }

    await tx.expense.updateMany({
      where: { paidByMemberId: from.id },
      data: { paidByMemberId: into.id },
    });
    await tx.expense.updateMany({
      where: { createdByMemberId: from.id },
      data: { createdByMemberId: into.id },
    });

    // Filet : on ne supprime que si plus RIEN ne pointe vers le doublon
    const [s, p, a, pe, ce] = await Promise.all([
      tx.expenseSplit.count({ where: { memberId: from.id } }),
      tx.expensePayment.count({ where: { memberId: from.id } }),
      tx.expenseItemAssignment.count({ where: { memberId: from.id } }),
      tx.expense.count({ where: { paidByMemberId: from.id } }),
      tx.expense.count({ where: { createdByMemberId: from.id } }),
    ]);
    if (s + p + a + pe + ce > 0) {
      throw new Error(`Références restantes sur ${from.displayName} `
        + `(parts ${s}, paiements ${p}, assignations ${a}, payées ${pe}, créées ${ce}) — annulation.`);
    }

    await tx.groupMember.delete({ where: { id: from.id } });
  });

  console.log(`\n✅ « ${from.displayName} » fusionné dans « ${into.displayName} » et supprimé du groupe.`);
  console.log(`   Vérifie avec : npx tsx src/scripts/audit-splits.ts --name=${group.name.split(' ')[0]}\n`);
}

main()
  .catch(e => { console.error('\n⛔', e.message || e, '\n'); process.exit(1); })
  .finally(() => prisma.$disconnect());
