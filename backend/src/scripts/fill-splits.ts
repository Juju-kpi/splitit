// backend/src/scripts/fill-splits.ts
//
// Répare UNE dépense qui n'a aucune part enregistrée, quand on ne peut pas le
// faire depuis l'app (par exemple : on n'est pas membre du groupe).
//
//   1. Lister les dépenses sans parts d'un groupe :
//        npx tsx src/scripts/fill-splits.ts --name=Bretagne
//
//   2. Voir la répartition proposée pour l'une d'elles (AUCUNE écriture) :
//        npx tsx src/scripts/fill-splits.ts --expense=<id>
//        npx tsx src/scripts/fill-splits.ts --expense=<id> --members=Valou,Yannou,Aug
//
//   3. L'appliquer :
//        npx tsx src/scripts/fill-splits.ts --expense=<id> --members=... --apply
//
// GARDE-FOUS
//   - Refuse net si la dépense a déjà des parts : ce script ne remplace jamais
//     une répartition existante, il ne fait que combler un vide.
//   - Ne touche qu'à la dépense visée : aucune autre ligne, aucun autre groupe.
//   - Ne supprime rien. Ne modifie ni le montant, ni les payeurs, ni les
//     articles. Il crée les parts manquantes, puis recalcule le seul drapeau
//     isComplete de cette dépense.
//   - Les parts sont réparties au centime : leur somme est exactement égale
//     au montant de la dépense.
//   - Sans --apply, rien n'est écrit.

import 'dotenv/config';
import { prisma } from '../db';
import { splitEqually, toCents } from '../services/split';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const argValue = (prefix: string) => {
  const found = args.find(a => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
};
const GROUP_NAME = argValue('--name=');
const EXPENSE_ID = argValue('--expense=');
const MEMBERS_ARG = argValue('--members=');

const money = (n: number) => n.toFixed(2);

async function main() {
  if (!EXPENSE_ID && !GROUP_NAME) {
    console.error('Usage : --name=<groupe> pour lister, puis --expense=<id> [--members=a,b] [--apply]');
    process.exit(1);
  }

  // ── Mode listage ────────────────────────────────────────────────────────
  if (!EXPENSE_ID) {
    const groups = await prisma.group.findMany({
      where: { name: { contains: GROUP_NAME!, mode: 'insensitive' } },
      include: { members: true, expenses: { include: { splits: true, payments: true } } },
    });
    if (groups.length === 0) { console.log('Aucun groupe ne correspond.'); return; }

    for (const group of groups) {
      console.log(`\n${group.emoji} ${group.name}  (id: ${group.id})`);
      console.log(`   Membres : ${group.members.map(m => m.displayName).join(', ')}\n`);

      const orphans = group.expenses.filter(e => e.splits.length === 0);
      if (orphans.length === 0) {
        console.log('   Aucune dépense sans parts. ✓\n');
        continue;
      }
      console.log('   Dépenses sans aucune part :');
      for (const exp of orphans) {
        const payers = exp.payments
          .map(p => group.members.find(m => m.id === p.memberId)?.displayName || '?')
          .join(', ');
        console.log(`     ▸ ${exp.description} — ${money(exp.totalAmount)} ${exp.currency}`);
        console.log(`       payé par ${payers || '—'}`);
        console.log(`       npx tsx src/scripts/fill-splits.ts --expense=${exp.id}\n`);
      }
    }
    return;
  }

  // ── Mode réparation d'une dépense ───────────────────────────────────────
  const expense = await prisma.expense.findUnique({
    where: { id: EXPENSE_ID },
    include: {
      splits: true,
      payments: true,
      items: { include: { assignedTo: true } },
      group: { include: { members: true } },
    },
  });

  if (!expense) { console.error(`Dépense introuvable : ${EXPENSE_ID}`); process.exit(1); }

  const group = expense.group;
  console.log(`\n${group.emoji} ${group.name}`);
  console.log(`Dépense : « ${expense.description} » — ${money(expense.totalAmount)} ${expense.currency}`);
  console.log(`Payée par : ${expense.payments.map(p =>
    `${group.members.find(m => m.id === p.memberId)?.displayName || '?'} (${money(p.amount)})`
  ).join(', ') || '—'}`);

  // GARDE-FOU : on ne remplace jamais une répartition existante
  if (expense.splits.length > 0) {
    console.log(`\n⛔ Cette dépense a déjà ${expense.splits.length} part(s) :`);
    for (const sp of expense.splits) {
      const name = group.members.find(m => m.id === sp.memberId)?.displayName || sp.memberId;
      console.log(`     ${name} — ${money(sp.amount)}${sp.settled ? ' (réglé)' : ''}`);
    }
    console.log('\nCe script ne sert qu\'à combler une dépense SANS parts. Rien n\'a été touché.');
    console.log('Pour corriger des montants existants, utilise audit-splits.ts.\n');
    return;
  }

  if (expense.items.length > 0) {
    console.log(`\n⚠ Cette dépense a ${expense.items.length} article(s) scanné(s).`);
    console.log('  Une répartition égale ignorerait qui a pris quoi — passe plutôt par l\'app');
    console.log('  si tu peux, ou assume la répartition égale ci-dessous.\n');
  }

  // ── Qui participe d'habitude dans ce groupe ? ───────────────────────────
  // Aide à choisir : un membre qui n'apparaît dans aucune autre dépense est
  // probablement un doublon ou quelqu'un qui n'a jamais rien partagé.
  const groupExpenses = await prisma.expense.findMany({
    where: { groupId: group.id, id: { not: expense.id } },
    include: { splits: true },
  });
  console.log('\nParticipation habituelle dans ce groupe :');
  for (const m of group.members) {
    const count = groupExpenses.filter(e => e.splits.some(sp => sp.memberId === m.id)).length;
    const flag = count === 0 ? '   ← jamais dans aucune dépense' : '';
    console.log(`     ${m.displayName.padEnd(18)} ${String(count).padStart(3)} / ${groupExpenses.length} dépenses${flag}`);
  }

  // ── Participants ────────────────────────────────────────────────────────
  let participants = group.members;
  if (MEMBERS_ARG) {
    const wanted = MEMBERS_ARG.split(',').map(x => x.trim()).filter(Boolean);
    const resolved = wanted.map(w => {
      const found = group.members.find(m =>
        m.id === w || m.displayName.toLowerCase() === w.toLowerCase());
      if (!found) {
        console.error(`\n⛔ Membre introuvable dans ce groupe : « ${w} »`);
        console.error(`   Membres disponibles : ${group.members.map(m => m.displayName).join(', ')}\n`);
        process.exit(1);
      }
      return found;
    });
    participants = resolved;
  }

  const shares = splitEqually(expense.totalAmount, participants.map(m => m.id));
  const sum = shares.reduce((s, x) => s + x.amount, 0);

  console.log(`\nRépartition proposée entre ${participants.length} personne(s) :`);
  for (const share of shares) {
    const name = participants.find(m => m.id === share.memberId)!.displayName;
    console.log(`     ${name.padEnd(18)} ${money(share.amount)}`);
  }
  console.log(`     ${''.padEnd(18)} ─────────`);
  console.log(`     ${'total'.padEnd(18)} ${money(sum)}  ${toCents(sum) === toCents(expense.totalAmount) ? '✓' : '⛔ ÉCART'}`);

  if (!MEMBERS_ARG) {
    console.log('\nℹ Par défaut : tous les membres du groupe. Pour restreindre :');
    console.log(`     --members=${group.members.slice(0, 3).map(m => m.displayName).join(',')}`);
  }

  if (!APPLY) {
    console.log('\n🔍 LECTURE SEULE — rien n\'a été écrit. Ajoute --apply pour créer ces parts.\n');
    return;
  }

  // ── Écriture ────────────────────────────────────────────────────────────
  await prisma.expenseSplit.createMany({
    data: shares.map(s => ({ expenseId: expense.id, memberId: s.memberId, amount: s.amount })),
  });

  // Recalcul du seul drapeau de cette dépense
  const hasUnassignedItems = expense.items.some(i => i.assignedTo.length === 0);
  const isComplete = !hasUnassignedItems && toCents(sum) === toCents(expense.totalAmount);
  await prisma.expense.update({ where: { id: expense.id }, data: { isComplete } });

  const after = await prisma.expenseSplit.findMany({ where: { expenseId: expense.id } });
  console.log(`\n✅ ${after.length} part(s) créée(s). Dépense marquée ${isComplete ? 'complète' : 'à compléter'}.`);
  console.log('   Vérifie avec : npx tsx src/scripts/audit-splits.ts --name=' + group.name.split(' ')[0] + '\n');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
