// backend/src/services/balances.test.ts
// Test autonome du calcul "qui doit quoi" (aucune base de données requise).
// Lancer avec :  npx tsx src/services/balances.test.ts
//
// Une part `settled` a été confirmée par le débiteur ET par le créancier :
// elle disparaît des soldes, et le crédit du payeur diminue d'autant.

import { computeBalances } from './balances';
import { splitEqually } from './split';

let passed = 0, failed = 0;
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

const member = (id: string) => ({
  id, groupId: 'g', userId: null, displayName: id,
  avatarColor: '#000', avatarInitials: id.toUpperCase(), joinedAt: new Date(),
}) as any;

let seq = 0;
function expense(opts: {
  total: number;
  payments: { memberId: string; amount: number }[];
  splits: { memberId: string; amount: number; settled?: boolean }[];
}) {
  const id = `e${seq++}`;
  return {
    id, groupId: 'g', description: id, totalAmount: opts.total, currency: 'CHF',
    paidByMemberId: opts.payments[0].memberId, splitType: 'EQUAL', isComplete: true,
    createdAt: new Date(), updatedAt: new Date(),
    payments: opts.payments.map((p, i) => ({ id: `${id}p${i}`, expenseId: id, ...p })),
    splits: opts.splits.map((s, i) => ({
      id: `${id}s${i}`, expenseId: id, settled: false, settledAt: null, createdAt: new Date(), ...s,
    })),
  } as any;
}

const [a, b, c] = [member('a'), member('b'), member('c')];

console.log('\n1) cas de base');
let bal = computeBalances([a, b], [expense({
  total: 100, payments: [{ memberId: 'a', amount: 100 }],
  splits: [{ memberId: 'a', amount: 50 }, { memberId: 'b', amount: 50 }],
})]);
assert(bal.length === 1 && bal[0].fromMemberId === 'b' && bal[0].toMemberId === 'a' && bal[0].amount === 50,
       'a avance 100, b lui doit 50');

console.log('\n2) compensation entre deux dépenses croisées');
bal = computeBalances([a, b], [
  expense({ total: 10, payments: [{ memberId: 'a', amount: 10 }],
            splits: [{ memberId: 'a', amount: 5 }, { memberId: 'b', amount: 5 }] }),
  expense({ total: 6, payments: [{ memberId: 'b', amount: 6 }],
            splits: [{ memberId: 'a', amount: 3 }, { memberId: 'b', amount: 3 }] }),
]);
assert(bal.length === 1 && bal[0].fromMemberId === 'b' && bal[0].amount === 2,
       'dettes croisées nettées : b doit 2.00 (et non 5 et 3 séparément)');

console.log('\n3) plusieurs payeurs');
bal = computeBalances([a, b, c], [expense({
  total: 90,
  payments: [{ memberId: 'a', amount: 60 }, { memberId: 'b', amount: 30 }],
  splits: [{ memberId: 'a', amount: 30 }, { memberId: 'b', amount: 30 }, { memberId: 'c', amount: 30 }],
})]);
assert(bal.length === 1 && bal[0].fromMemberId === 'c' && bal[0].toMemberId === 'a' && bal[0].amount === 30,
       'c doit 30 au payeur principal');

console.log('\n4) répartition au centime : pas de dette fantôme');
// 100.00 entre 3 → 33.34 / 33.33 / 33.33. Avant le fix de répartition, les
// trois parts valaient 33.33 : le centime manquant traînait dans les soldes.
const shares = splitEqually(100, ['a', 'b', 'c']);
bal = computeBalances([a, b, c], [expense({
  total: 100, payments: [{ memberId: 'a', amount: 100 }],
  splits: shares.map(s => ({ memberId: s.memberId, amount: s.amount })),
})]);
assert(bal.length === 2, 'b et c doivent chacun leur part, personne d autre');
assert(Math.abs(bal.reduce((s, x) => s + x.amount, 0) - (100 - shares[0].amount)) < 0.001,
       'la somme des dettes vaut exactement ce que le payeur a avancé pour les autres');

console.log('\n5) dépense incomplète : on n invente pas de dette');
bal = computeBalances([a, b, c], [expense({
  total: 100, payments: [{ memberId: 'a', amount: 100 }],
  splits: [{ memberId: 'b', amount: 20 }], // 80.00 non répartis
})]);
assert(bal.length === 1 && bal[0].amount === 20,
       'seule la part réellement attribuée est due');

console.log('\n6) remboursement confirmé par les deux parties');
bal = computeBalances([a, b], [expense({
  total: 100, payments: [{ memberId: 'a', amount: 100 }],
  splits: [{ memberId: 'a', amount: 50 }, { memberId: 'b', amount: 50, settled: true }],
})]);
assert(bal.length === 0, 'part réglée → plus aucune dette');

// Partiellement réglé : seule la part non confirmée subsiste
bal = computeBalances([a, b, c], [expense({
  total: 90, payments: [{ memberId: 'a', amount: 90 }],
  splits: [
    { memberId: 'a', amount: 30 },
    { memberId: 'b', amount: 30, settled: true },
    { memberId: 'c', amount: 30 },
  ],
})]);
assert(bal.length === 1 && bal[0].fromMemberId === 'c' && bal[0].amount === 30,
       'seule la part non réglée reste due');

// Tout réglé, y compris la part du payeur
const allSettled = splitEqually(100, ['a', 'b', 'c']);
bal = computeBalances([a, b, c], [expense({
  total: 100, payments: [{ memberId: 'a', amount: 100 }],
  splits: allSettled.map(s => ({ memberId: s.memberId, amount: s.amount, settled: true })),
})]);
assert(bal.length === 0, 'tout réglé → aucun solde résiduel');

console.log(`\n${passed} réussis, ${failed} échoués\n`);
process.exit(failed > 0 ? 1 : 0);
