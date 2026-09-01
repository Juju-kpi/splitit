// backend/src/services/balances.test.ts
// Test autonome du calcul "qui doit quoi" (aucune base de données requise).
// Lancer avec :  npx tsx src/services/balances.test.ts
//
// Une part `settled` a été confirmée par le débiteur ET par le créancier :
// elle disparaît des soldes, et le crédit du payeur diminue d'autant.

import { computeBalances, computeMemberNets, computeNetBreakdown, SettlementLike } from './balances';
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

// ── Position nette par membre (les barres « qui a avancé, qui doit ») ─────
console.log('\n15) la position nette suit les remboursements');
let nets = computeMemberNets([a, b], oneExpense);
assert(nets['a'] === 50 && nets['b'] === -50,
       'a a avancé 50 pour b : +50 / −50');
nets = computeMemberNets([a, b], oneExpense, [settlement({ from: 'b', to: 'a', amount: 50 })]);
assert(nets['a'] === 0 && nets['b'] === 0,
       'après remboursement, les deux barres retombent à zéro');
nets = computeMemberNets([a, b], oneExpense, [settlement({ from: 'b', to: 'a', amount: 50, confirmed: false })]);
assert(nets['a'] === 50 && nets['b'] === -50,
       'un remboursement en attente ne bouge pas les barres non plus');
nets = computeMemberNets([a, b], oneExpense, [settlement({ from: 'b', to: 'a', amount: 20 })]);
assert(nets['a'] === 30 && nets['b'] === -30, 'remboursement partiel : barres à 30');

console.log('\n16) la somme des positions nettes est toujours nulle');
// L'argent ne s'évapore pas : ce que les uns ont avancé en trop, les autres
// le doivent exactement.
const sum = (o: Record<string, number>) =>
  Math.round(Object.values(o).reduce((s, v) => s + v, 0) * 100) / 100;
assert(sum(computeMemberNets([a, b, c], chain)) === 0, 'sur une compensation en chaîne');
assert(sum(computeMemberNets([a, b, c], chain, [settlement({ from: 'c', to: 'a', amount: 30 })])) === 0,
       'et après remboursement');
assert(sum(computeMemberNets([a, b, c], [expense({
  total: 100, payments: [{ memberId: 'a', amount: 100 }],
  splits: splitEqually(100, ['a', 'b', 'c']),
})])) === 0, 'et sur une répartition au centime');

console.log('\n17) les barres et les remboursements racontent la même chose');
// Un membre à zéro ne doit apparaître dans aucune dette, et réciproquement.
const cases: [string, SettlementLike[]][] = [
  ['sans remboursement', []],
  ['partiel', [settlement({ from: 'c', to: 'a', amount: 10 })]],
  ['complet', [settlement({ from: 'c', to: 'a', amount: 30 })]],
];
for (const [label, st] of cases) {
  const n = computeMemberNets([a, b, c], chain, st);
  const bl = computeBalances([a, b, c], chain, st);
  const inBalances = new Set(bl.flatMap(x => [x.fromMemberId, x.toMemberId]));
  const nonZero = Object.entries(n).filter(([, v]) => Math.abs(v) > 0.01).map(([k]) => k);
  assert(nonZero.every(id => inBalances.has(id)) && [...inBalances].every(id => nonZero.includes(id)),
         `${label} : mêmes personnes concernées des deux côtés`);
}

// ── Le détail du calcul, affiché à l'écran ────────────────────────────────
console.log('\n18) chaque ligne du détail redonne bien le net');
const detailCases: [string, any[], SettlementLike[]][] = [
  ['cas simple', oneExpense, []],
  ['avec remboursement', oneExpense, [settlement({ from: 'b', to: 'a', amount: 20 })]],
  ['avec part réglée à l ancienne', [expense({
    total: 90, payments: [{ memberId: 'a', amount: 90 }],
    splits: [
      { memberId: 'a', amount: 30 },
      { memberId: 'b', amount: 30, settled: true },
      { memberId: 'c', amount: 30 },
    ],
  })], []],
  ['les deux mécanismes', chain, [settlement({ from: 'c', to: 'a', amount: 10 })]],
];
for (const [label, exps, st] of detailCases) {
  const rows = computeNetBreakdown([a, b, c], exps, st);
  const nets = computeMemberNets([a, b, c], exps, st);

  const consistent = Object.entries(rows).every(([id, r]) => {
    const recomputed = Math.round((
      r.paid - r.share + r.settledOwn - r.settledAsPayer
      + r.settlementsPaid - r.settlementsReceived
    ) * 100) / 100;
    return recomputed === r.net && r.net === nets[id];
  });
  assert(consistent, `${label} : la somme des lignes affichées donne exactement le net`);

  const total = Math.round(Object.values(rows).reduce((s, r) => s + r.net, 0) * 100) / 100;
  assert(total === 0, `${label} : le total des + et des − vaut 0`);
}

// ── Robustesse : modifier une dépense déjà remboursée ─────────────────────
console.log('\n19) modifier une dépense après un remboursement');
// b doit 50 à a, et a déjà versé 30. Reste 20.
const before = [expense({
  total: 100, payments: [{ memberId: 'a', amount: 100 }],
  splits: [{ memberId: 'a', amount: 50 }, { memberId: 'b', amount: 50 }],
})];
const paid30 = [settlement({ from: 'b', to: 'a', amount: 30 })];
bal = computeBalances([a, b], before, paid30);
assert(bal.length === 1 && bal[0].fromMemberId === 'b' && bal[0].amount === 20,
       'point de départ : il reste 20 après 30 versés');

// La dépense passe de 100 à 160 → la part de b monte à 80.
const raised = [expense({
  total: 160, payments: [{ memberId: 'a', amount: 160 }],
  splits: [{ memberId: 'a', amount: 80 }, { memberId: 'b', amount: 80 }],
})];
bal = computeBalances([a, b], raised, paid30);
assert(bal.length === 1 && bal[0].fromMemberId === 'b' && bal[0].amount === 50,
       'part montée à 80 : les 30 versés restent acquis, il reste 50');

// La dépense descend à 40 → la part de b tombe à 20, sous les 30 déjà versés.
const lowered = [expense({
  total: 40, payments: [{ memberId: 'a', amount: 40 }],
  splits: [{ memberId: 'a', amount: 20 }, { memberId: 'b', amount: 20 }],
})];
bal = computeBalances([a, b], lowered, paid30);
assert(bal.length === 1 && bal[0].fromMemberId === 'a' && bal[0].amount === 10,
       'part descendue à 20 : b a trop versé, a lui doit 10 en retour');

// La dépense disparaît → il ne reste que l'argent réellement déplacé.
bal = computeBalances([a, b], [], paid30);
assert(bal.length === 1 && bal[0].fromMemberId === 'a' && bal[0].amount === 30,
       'dépense supprimée : a doit rendre les 30 reçus');

console.log('\n20) un remboursement ne s accroche à aucune dépense');
// Le meme remboursement, avec des depenses completement differentes.
assert(computeMemberNets([a, b], raised, paid30)['b']
     === computeMemberNets([a, b], raised, [])['b'] + 30,
       'son effet est le même quelle que soit la dépense en face');

console.log('\n21) l ancien drapeau sur les parts, lui, n est PAS robuste');
// Test de caractérisation : il décrit ce que le code fait aujourd'hui, pas ce
// qu'on voudrait. Le drapeau dit « cette part est réglée » sans dire combien a
// été versé ; quand la part change de montant, le drapeau suit aveuglément.
// applyShares() met le montant à jour en place et conserve `settled`.
// C'est la raison d'être de la table settlements, qui garde un montant.
const flagged = (amount: number) => [expense({
  total: amount * 2, payments: [{ memberId: 'a', amount: amount * 2 }],
  splits: [{ memberId: 'a', amount }, { memberId: 'b', amount, settled: true }],
})];
assert(computeBalances([a, b], flagged(50)).length === 0,
       'part de 50 marquée réglée → rien à devoir');
assert(computeBalances([a, b], flagged(80)).length === 0,
       'la même part passée à 80 est considérée réglée elle aussi — les 30 de '
       + 'plus disparaissent sans que personne les ait versés');

console.log(`\n${passed} réussis, ${failed} échoués\n`);
process.exit(failed > 0 ? 1 : 0);
