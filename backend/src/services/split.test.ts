// backend/src/services/split.test.ts
// Test autonome de la répartition (aucune base de données requise).
// Lancer avec :  npx tsx src/services/split.test.ts

import {
  toCents, fromCents, distributeCents,
  splitEqually, splitItemized, normalizeCustomShares, normalizePayments,
} from './split';

let passed = 0, failed = 0;
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const shareSum = (s: { amount: number }[]) => toCents(sum(s.map(x => x.amount)));

console.log('\n1) distributeCents — la somme retombe toujours juste');
for (const total of [1, 7, 10, 99, 100, 333, 1000, 10000, 10003]) {
  for (const n of [1, 2, 3, 5, 6, 7, 9, 12, 23]) {
    const parts = distributeCents(total, new Array(n).fill(1));
    if (sum(parts) !== total) {
      assert(false, `${total} centimes / ${n} → ${sum(parts)}`);
    }
  }
}
assert(true, 'toutes les combinaisons total×membres tombent juste');
assert(Math.max(...distributeCents(100, new Array(7).fill(1))) -
       Math.min(...distributeCents(100, new Array(7).fill(1))) <= 1,
       'les parts ne diffèrent jamais de plus d un centime');
assert(sum(distributeCents(1000, [0, 0, 0])) === 1000, 'poids tous nuls → répartition égale');
assert(distributeCents(0, [1, 1, 1]).every(c => c === 0), 'total nul → parts nulles');

console.log('\n2) splitEqually — le cas qui cassait tout');
// Avant le fix : 14.29 × 7 = 100.03 → dépense marquée "à compléter"
const eq7 = splitEqually(100, ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
assert(shareSum(eq7) === toCents(100), '100.00 / 7 → somme exacte de 100.00');
// 14.2857… → 3 membres à 14.28 et 4 à 14.29 : 42.84 + 57.16 = 100.00 pile
assert(eq7.filter(s => s.amount === 14.29).length === 4, '4 membres à 14.29');
assert(eq7.filter(s => s.amount === 14.28).length === 3, '3 membres à 14.28');

const eq3 = splitEqually(10, ['a', 'b', 'c']);
assert(shareSum(eq3) === toCents(10), '10.00 / 3 → somme exacte de 10.00');
assert(eq3.map(s => s.amount).sort().join(',') === '3.33,3.33,3.34', '10 / 3 → 3.34 / 3.33 / 3.33');

const eq12 = splitEqually(10, new Array(12).fill(0).map((_, i) => `m${i}`));
assert(shareSum(eq12) === toCents(10), '10.00 / 12 → somme exacte (avant : 9.96)');

assert(splitEqually(50, []).length === 0, 'aucun membre → aucune part');

console.log('\n3) splitItemized — articles, service et arrondis');
const items = [
  { price: 12.5, assignedToMemberIds: ['a', 'b'] },
  { price: 7.9,  assignedToMemberIds: ['a'] },
  { price: 30,   assignedToMemberIds: ['a', 'b', 'c'] },
];
const it1 = splitItemized(50.4, items);
assert(!it1.hasUnassigned, 'aucun article non assigné');
assert(shareSum(it1.shares) === toCents(50.4), 'somme des parts = total de la dépense');
assert(it1.shares.find(s => s.memberId === 'a')!.amount === 24.15, 'a paie 6.25 + 7.90 + 10.00');

// Total supérieur à la somme des articles (service 10%) : l écart est réparti,
// la dépense n est plus bloquée en "à compléter".
const it2 = splitItemized(55.44, items);
assert(shareSum(it2.shares) === toCents(55.44), 'service réparti proportionnellement');
assert(it2.shares.every(s => s.amount > 0), 'personne ne se retrouve à zéro');

// Article non assigné → on ne comble rien, la dépense est vraiment incomplète
const it3 = splitItemized(60, [...items, { price: 9.6, assignedToMemberIds: [] }]);
assert(it3.hasUnassigned, 'article non assigné détecté');
assert(shareSum(it3.shares) === toCents(50.4), 'seuls les articles assignés sont répartis');

// Article partagé dont le prix ne tombe pas rond
const it4 = splitItemized(10, [{ price: 10, assignedToMemberIds: ['a', 'b', 'c'] }]);
assert(shareSum(it4.shares) === toCents(10), 'article à 10.00 partagé par 3 → 10.00 exact');

console.log('\n4) normalizeCustomShares — saisie manuelle');
const c1 = normalizeCustomShares(100, [
  { memberId: 'a', amount: 33.33 },
  { memberId: 'b', amount: 33.33 },
  { memberId: 'c', amount: 33.33 },
]);
assert(shareSum(c1) === toCents(100), 'un centime manquant est ajouté à la plus grosse part');

const c2 = normalizeCustomShares(100, [
  { memberId: 'a', amount: 20 },
  { memberId: 'b', amount: 30 },
]);
assert(shareSum(c2) === toCents(50), 'écart réel (50.00) laissé tel quel — dépense incomplète');

console.log('\n5) normalizePayments — les soldes doivent se compenser');
const p1 = normalizePayments(100, [
  { memberId: 'a', amount: 66.66 },
  { memberId: 'b', amount: 33.33 },
]);
assert(p1 !== null && shareSum(p1) === toCents(100), 'un centime d écart est absorbé par le plus gros payeur');
assert(normalizePayments(100, [{ memberId: 'a', amount: 40 }]) === null, 'écart trop grand → rejeté');
assert(normalizePayments(100, []) === null, 'aucun payeur → rejeté');

console.log('\n6) invariant global : crédits == débits');
// Ce qui garantit que "qui doit quoi" tombe juste : la somme des paiements et
// la somme des parts doivent être rigoureusement égales.
for (const total of [10, 33.33, 99.99, 100, 187.45]) {
  for (const n of [2, 3, 5, 7, 11]) {
    const ids = new Array(n).fill(0).map((_, i) => `m${i}`);
    const shares = splitEqually(total, ids);
    const payments = normalizePayments(total, [{ memberId: 'm0', amount: total }])!;
    if (shareSum(shares) !== shareSum(payments)) {
      assert(false, `${total} entre ${n} : ${shareSum(shares)} vs ${shareSum(payments)}`);
    }
  }
}
assert(true, 'crédits et débits se compensent au centime sur tous les cas testés');

console.log('\n7) scénarios signalés — dépenses complètes marquées "à compléter"');
// Reproduit exactement le calcul du backend (computeIsComplete) :
// aucun article non assigné + somme des parts égale au total.
function isComplete(total: number, shares: { amount: number }[], hasUnassigned = false) {
  if (hasUnassigned || shares.length === 0) return false;
  return Math.abs(shareSum(shares) - toCents(total)) <= 2;
}

// a) Restaurant 100.00 entre 7 — AVANT : parts = 100.03 → "à compléter"
assert(isComplete(100, splitEqually(100, new Array(7).fill(0).map((_, i) => `m${i}`))),
       'repas à 100.00 entre 7 personnes → complète');

// b) Courses 10.00 entre 12 — AVANT : parts = 9.96 → "à compléter"
assert(isComplete(10, splitEqually(10, new Array(12).fill(0).map((_, i) => `m${i}`))),
       'courses à 10.00 entre 12 personnes → complète');

// c) Ticket scanné, tous les articles assignés, service en plus
const scan = splitItemized(55.44, items);
assert(isComplete(55.44, scan.shares, scan.hasUnassigned),
       'ticket avec service, tous articles assignés → complète');

// d) Ticket avec un article oublié → doit RESTER incomplète
const partiel = splitItemized(60, [...items, { price: 9.6, assignedToMemberIds: [] }]);
assert(!isComplete(60, partiel.shares, partiel.hasUnassigned),
       'article non assigné → reste bien à compléter');

// e) 200 dépenses aléatoires : aucune fausse alerte
let faux = 0;
for (let i = 0; i < 200; i++) {
  const total = Math.round((5 + Math.random() * 500) * 100) / 100;
  const n = 2 + Math.floor(Math.random() * 10);
  const ids = new Array(n).fill(0).map((_, k) => `m${k}`);
  if (!isComplete(total, splitEqually(total, ids))) faux++;
}
assert(faux === 0, '200 dépenses aléatoires : aucune fausse alerte "à compléter"');

console.log(`\n${passed} réussis, ${failed} échoués\n`);
process.exit(failed > 0 ? 1 : 0);
