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

// ── Remboursements de premier ordre (table settlements) ──────────────────
const settlement = (opts: {
  from: string; to: string; amount: number;
  confirmed?: boolean; cancelled?: boolean;
}) => ({
  fromMemberId: opts.from,
  toMemberId: opts.to,
  amount: opts.amount,
  confirmed: opts.confirmed ?? true,
  cancelledAt: opts.cancelled ? new Date() : null,
});

console.log('\n7) un remboursement confirmé solde la dette');
const oneExpense = [expense({
  total: 100, payments: [{ memberId: 'a', amount: 100 }],
  splits: [{ memberId: 'a', amount: 50 }, { memberId: 'b', amount: 50 }],
})];
bal = computeBalances([a, b], oneExpense, [settlement({ from: 'b', to: 'a', amount: 50 })]);
assert(bal.length === 0, 'b a remboursé 50 à a → plus rien à devoir');

console.log('\n8) un remboursement en attente ne bouge pas les soldes');
bal = computeBalances([a, b], oneExpense, [settlement({ from: 'b', to: 'a', amount: 50, confirmed: false })]);
assert(bal.length === 1 && bal[0].amount === 50,
       'sans le double accord, la dette reste entière');

console.log('\n9) un remboursement annulé ne compte pas');
bal = computeBalances([a, b], oneExpense, [settlement({ from: 'b', to: 'a', amount: 50, cancelled: true })]);
assert(bal.length === 1 && bal[0].amount === 50, 'annulé → la dette redevient due');

console.log('\n10) remboursement partiel');
bal = computeBalances([a, b], oneExpense, [settlement({ from: 'b', to: 'a', amount: 20 })]);
assert(bal.length === 1 && bal[0].fromMemberId === 'b' && Math.abs(bal[0].amount - 30) < 0.001,
       'b a versé 20 sur 50 → il reste 30');

console.log('\n11) compensation en chaîne — le cas que les parts ne savaient pas solder');
// a avance 60 pour a+b, b avance 60 pour b+c : aucune dépense ne lie a et c,
// pourtant le netting affiche "c doit 30 à a".
const chain = [
  expense({ total: 60, payments: [{ memberId: 'a', amount: 60 }],
            splits: [{ memberId: 'a', amount: 30 }, { memberId: 'b', amount: 30 }] }),
  expense({ total: 60, payments: [{ memberId: 'b', amount: 60 }],
            splits: [{ memberId: 'b', amount: 30 }, { memberId: 'c', amount: 30 }] }),
];
bal = computeBalances([a, b, c], chain);
assert(bal.length === 1 && bal[0].fromMemberId === 'c' && bal[0].toMemberId === 'a' && bal[0].amount === 30,
       'le netting fait apparaître une dette c → a sans dépense commune');
bal = computeBalances([a, b, c], chain, [settlement({ from: 'c', to: 'a', amount: 30 })]);
assert(bal.length === 0, 'un remboursement c → a la solde — impossible avec le seul drapeau des parts');

console.log('\n12) les deux mécanismes cohabitent sans se marcher dessus');
// Part réglée à l'ancienne (b) + remboursement enregistré (c) sur la même dépense.
bal = computeBalances([a, b, c], [expense({
  total: 90, payments: [{ memberId: 'a', amount: 90 }],
  splits: [
    { memberId: 'a', amount: 30 },
    { memberId: 'b', amount: 30, settled: true },
    { memberId: 'c', amount: 30 },
  ],
})], [settlement({ from: 'c', to: 'a', amount: 30 })]);
assert(bal.length === 0, 'ancienne part réglée + nouveau remboursement → tout est soldé');

console.log('\n13) un trop-versé inverse la dette au lieu de la faire disparaître');
bal = computeBalances([a, b], oneExpense, [settlement({ from: 'b', to: 'a', amount: 80 })]);
assert(bal.length === 1 && bal[0].fromMemberId === 'a' && Math.abs(bal[0].amount - 30) < 0.001,
       'b a versé 80 pour une dette de 50 → a lui doit 30');

console.log('\n14) sans remboursements, le résultat est identique à avant');
assert(JSON.stringify(computeBalances([a, b], oneExpense))
    === JSON.stringify(computeBalances([a, b], oneExpense, [])),
       'l argument settlements est bien optionnel et neutre');

console.log(`\n${passed} réussis, ${failed} échoués\n`);
process.exit(failed > 0 ? 1 : 0);
