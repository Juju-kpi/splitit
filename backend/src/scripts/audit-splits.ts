// backend/src/scripts/audit-splits.ts
//
// Audite (et répare, sur demande explicite) les dépenses créées AVANT le fix
// de répartition. Les dépenses écrites depuis le fix sont déjà exactes.
//
//   npx tsx src/scripts/audit-splits.ts                      → tous les groupes, LECTURE SEULE
//   npx tsx src/scripts/audit-splits.ts --name=morbihan      → un seul groupe, en détail
//   npx tsx src/scripts/audit-splits.ts --group=<id>         → idem, par identifiant
//   npx tsx src/scripts/audit-splits.ts --name=morbihan --apply   → applique
//
// GARDE-FOUS — ce script ne supprime JAMAIS un groupe, un membre, une dépense
// ni un article. En mode --apply il ne touche qu'à trois choses :
//   - le montant des parts existantes (mise à jour en place : `settled` et
//     `settledAt` sont conservés, les remboursements déjà validés restent) ;
//   - le montant des paiements quand leur somme rate le total de quelques
//     centimes ;
//   - le drapeau isComplete, qui est une valeur dérivée, recalculée.
// Le calcul des soldes n'est pas modifié : les mêmes parts corrigées donnent
// les mêmes dettes, au centime près.
//
// Sans --apply, AUCUNE écriture n'est faite : lance-le d'abord comme ça.

import 'dotenv/config';
import { prisma } from '../db';
import {
  Share, toCents, splitEqually, splitItemized, normalizeCustomShares, normalizePayments,
} from '../services/split';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const argValue = (prefix: string) => {
  const found = args.find(a => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
};
const ONLY_ID = argValue('--group=');
const ONLY_NAME = argValue('--name=');

const money = (n: number) => n.toFixed(2);
const pad = (s: string, n: number) => s.length >= n ? s : s + ' '.repeat(n - s.length);

type Plan = {
  expenseId: string;
  description: string;
  splitType: string;
  totalAmount: number;
  currentCents: number;
  shares: Share[] | null;      // parts corrigées, null = ne pas toucher
  payments: Share[] | null;    // paiements corrigés, null = rien à faire
  isCompleteNow: boolean;
  isCompleteAfter: boolean;
  notes: string[];
};

async function main() {
  console.log(APPLY
    ? '\n⚠  MODE ÉCRITURE — les corrections vont être appliquées\n'
    : '\n🔍 LECTURE SEULE — aucune écriture (ajoute --apply pour corriger)\n');

  const groups = await prisma.group.findMany({
    where: ONLY_ID
      ? { id: ONLY_ID }
      : ONLY_NAME
        ? { name: { contains: ONLY_NAME, mode: 'insensitive' } }
        : undefined,
    include: {
      members: true,
      expenses: {
        include: {
          splits: true,
          payments: true,
          items: { include: { assignedTo: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  if (groups.length === 0) {
    console.log('Aucun groupe ne correspond.');
    await prisma.$disconnect();
    return;
  }

  const detailed = groups.length === 1;
  let totalPlans = 0, appliedShares = 0, appliedPayments = 0, appliedFlags = 0;

  for (const group of groups) {
    const names = new Map(group.members.map(m => [m.id, m.displayName]));
    const plans: Plan[] = [];

    let groupTotal = 0, groupSplit = 0;

    for (const exp of group.expenses) {
      groupTotal += exp.totalAmount;
      groupSplit += exp.splits.reduce((s, sp) => s + sp.amount, 0);

      const totalCents = toCents(exp.totalAmount);
      const currentCents = exp.splits.reduce((s, sp) => s + toCents(sp.amount), 0);
      const payCents = exp.payments.reduce((s, p) => s + toCents(p.amount), 0);
      const hasUnassigned = exp.items.some(i => i.assignedTo.length === 0);
      const notes: string[] = [];

      // ── Parts ──────────────────────────────────────────────────────────
      let shares: Share[] | null = null;
      if (exp.splits.length === 0) {
        notes.push('aucune part enregistrée — ouvre la dépense dans l app, '
                 + 'Modifier, coche les participants, enregistre');
      } else if (currentCents !== totalCents) {
        shares = expectedShares(exp);
        if (!shares) {
          notes.push(hasUnassigned
            ? 'des articles ne sont assignés à personne — à compléter dans l app'
            : 'parts saisies à la main, écart trop grand pour être un arrondi');
        }
      }

      // ── Paiements ──────────────────────────────────────────────────────
      let payments: Share[] | null = null;
      if (exp.payments.length > 0 && payCents !== totalCents) {
        payments = normalizePayments(exp.totalAmount, exp.payments.map(p => ({
          memberId: p.memberId, amount: p.amount,
        })));
        if (!payments) notes.push(`payé ${money(payCents / 100)} pour un total de ${money(exp.totalAmount)} — à vérifier`);
      }

      // ── Drapeau ────────────────────────────────────────────────────────
      const afterCents = shares
        ? shares.reduce((s, x) => s + toCents(x.amount), 0)
        : currentCents;
      const isCompleteAfter = !hasUnassigned && exp.splits.length > 0
        && Math.abs(afterCents - totalCents) <= 2;

      const changesSomething = shares || payments || exp.isComplete !== isCompleteAfter;
      if (changesSomething || notes.length > 0) {
        plans.push({
          expenseId: exp.id, description: exp.description, splitType: exp.splitType,
          totalAmount: exp.totalAmount, currentCents, shares, payments,
          isCompleteNow: exp.isComplete, isCompleteAfter, notes,
        });
      }
    }

    const delta = toCents(groupTotal) - toCents(groupSplit);
    console.log(
      `${group.emoji} ${pad(group.name, 30)} ${pad(String(group.expenses.length) + ' dép.', 10)}` +
      `total ${pad(money(groupTotal), 11)}réparti ${pad(money(groupSplit), 11)}` +
      (delta === 0 ? '✓' : `← écart ${money(delta / 100)}`)
    );
    if (detailed) console.log(`   id: ${group.id}\n`);

    // ── Détail dépense par dépense quand un seul groupe est visé ────────
    if (detailed) {
      for (const plan of plans) {
        console.log(`   ▸ ${plan.description} — ${money(plan.totalAmount)} (${plan.splitType})`);
        if (plan.shares) {
          const exp = group.expenses.find(e => e.id === plan.expenseId)!;
          console.log(`     parts : ${money(plan.currentCents / 100)} → ${money(plan.shares.reduce((s, x) => s + x.amount, 0))}`);
          for (const share of plan.shares) {
            const before = exp.splits.find(s => s.memberId === share.memberId);
            const beforeTxt = before ? money(before.amount) : '—';
            const changed = !before || toCents(before.amount) !== toCents(share.amount);
            console.log(`       ${pad(names.get(share.memberId) || share.memberId, 18)}` +
                        `${pad(beforeTxt, 9)} → ${money(share.amount)}${changed ? '' : '   (inchangé)'}` +
                        `${before?.settled ? '   [déjà réglé, conservé]' : ''}`);
          }
        }
        if (plan.payments) console.log(`     paiements ajustés au total`);
        if (plan.isCompleteNow !== plan.isCompleteAfter) {
          console.log(`     drapeau : ${plan.isCompleteNow ? 'complète' : 'à compléter'} → ${plan.isCompleteAfter ? 'complète' : 'à compléter'}`);
        }
        for (const note of plan.notes) console.log(`     ⚠ ${note}`);
        console.log('');
      }
      if (plans.length === 0) console.log('   Rien à corriger dans ce groupe.\n');
    }

    totalPlans += plans.length;

    // ── Écriture ────────────────────────────────────────────────────────
    if (APPLY) {
      for (const plan of plans) {
        const exp = group.expenses.find(e => e.id === plan.expenseId)!;
        if (plan.shares) {
          await applyShares(plan.expenseId, plan.shares, exp.splits);
          appliedShares++;
        }
        if (plan.payments) {
          for (const p of exp.payments) {
            const target = plan.payments.find(n => n.memberId === p.memberId);
            if (target && toCents(target.amount) !== toCents(p.amount)) {
              await prisma.expensePayment.update({ where: { id: p.id }, data: { amount: target.amount } });
            }
          }
          appliedPayments++;
        }
        if (plan.isCompleteNow !== plan.isCompleteAfter) {
          await prisma.expense.update({
            where: { id: plan.expenseId }, data: { isComplete: plan.isCompleteAfter },
          });
          appliedFlags++;
        }
      }
    }
  }

  console.log('');
  if (APPLY) {
    console.log(`✅ ${appliedShares} répartition(s), ${appliedPayments} paiement(s), ${appliedFlags} drapeau(x) corrigés.`);
  } else if (totalPlans > 0) {
    console.log(`${totalPlans} dépense(s) à corriger. Relance avec --apply (après une sauvegarde Supabase).`);
  } else {
    console.log('Tout est déjà exact — rien à faire.');
  }

  await prisma.$disconnect();
}

/** Parts attendues. null = on ne touche à rien (cas non automatisable). */
function expectedShares(exp: {
  totalAmount: number;
  splitType: string;
  splits: { memberId: string; amount: number }[];
  items: { price: number; assignedTo: { memberId: string }[] }[];
}): Share[] | null {
  if (exp.splitType === 'ITEMIZED') {
    const { shares, hasUnassigned } = splitItemized(exp.totalAmount, exp.items.map(i => ({
      price: i.price,
      assignedToMemberIds: i.assignedTo.map(a => a.memberId),
    })));
    return hasUnassigned || shares.length === 0 ? null : shares;
  }
  if (exp.splitType === 'EQUAL') {
    // Mêmes participants qu'aujourd'hui — on ne change QUE la répartition des centimes
    return splitEqually(exp.totalAmount, exp.splits.map(s => s.memberId));
  }
  // CUSTOM : uniquement l'ajustement au centime, jamais une redistribution
  const adjusted = normalizeCustomShares(exp.totalAmount, exp.splits.map(s => ({
    memberId: s.memberId, amount: s.amount,
  })));
  const exact = adjusted.reduce((s, a) => s + toCents(a.amount), 0) === toCents(exp.totalAmount);
  return exact ? adjusted : null;
}

/** Mise à jour en place : `settled` / `settledAt` sont conservés. */
async function applyShares(
  expenseId: string,
  shares: Share[],
  existing: { id: string; memberId: string; amount: number }[],
): Promise<void> {
  const previous = new Map(existing.map(s => [s.memberId, s]));
  for (const share of shares) {
    const prev = previous.get(share.memberId);
    if (prev) {
      if (toCents(prev.amount) !== toCents(share.amount)) {
        await prisma.expenseSplit.update({ where: { id: prev.id }, data: { amount: share.amount } });
      }
    } else {
      await prisma.expenseSplit.create({ data: { expenseId, memberId: share.memberId, amount: share.amount } });
    }
  }
}

main().catch(async e => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
