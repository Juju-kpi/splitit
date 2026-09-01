// backend/src/services/settlement.test.ts
// Test autonome des regles d'un remboursement (aucune base requise).
// Lancer avec :  npx tsx src/services/settlement.test.ts

import { canRecord, initialConfirmations, deriveConfirmed, round2 } from './settlement';

let passed = 0, failed = 0;
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

const NOW = new Date('2026-09-01T12:00:00Z');
const alice = { memberId: 'alice', hasAccount: true };
const bob = { memberId: 'bob', hasAccount: true };
const carol = { memberId: 'carol', hasAccount: true };
const guest = { memberId: 'guest', hasAccount: false };
const guest2 = { memberId: 'guest2', hasAccount: false };

console.log('\n1) qui a le droit d enregistrer');
assert(canRecord('alice', alice, bob), 'le debiteur peut enregistrer son versement');
assert(canRecord('bob', alice, bob), 'le creancier peut enregistrer ce qu il a recu');
assert(!canRecord('carol', alice, bob), 'un tiers ne declare pas un versement entre deux autres');
assert(canRecord('carol', guest, guest2),
       'entre deux membres sans compte, un membre du groupe doit pouvoir le faire');
assert(!canRecord('carol', alice, guest),
       'des qu un cote a un compte, c est a lui de parler — pas a un tiers');

console.log('\n2) accords acquis a l enregistrement');
let c = initialConfirmations('alice', alice, bob, NOW);
assert(c.fromAt === NOW && c.toAt === null,
       'celui qui enregistre confirme son cote, pas celui de l autre');
c = initialConfirmations('bob', alice, bob, NOW);
assert(c.fromAt === null && c.toAt === NOW,
       'le creancier qui enregistre ne confirme que son propre cote');

console.log('\n3) un membre sans compte est valide d office');
c = initialConfirmations('alice', alice, guest, NOW);
assert(c.fromAt === NOW && c.toAt === NOW,
       'sinon une dette envers un invite resterait due pour toujours');
c = initialConfirmations('carol', guest, guest2, NOW);
assert(c.fromAt === NOW && c.toAt === NOW,
       'entre deux invites, le remboursement est acquis immediatement');

console.log('\n4) le drapeau derive du double accord');
assert(deriveConfirmed(NOW, null, null).confirmed === false, 'un seul accord ne suffit pas');
assert(deriveConfirmed(null, NOW, null).confirmed === false, 'l autre seul non plus');
assert(deriveConfirmed(null, null, null).confirmed === false, 'aucun accord : rien');
assert(deriveConfirmed(NOW, NOW, null).confirmed === true, 'les deux accords : acquis');

console.log('\n5) la date du premier accord complet ne se reecrit pas');
const first = new Date('2026-08-01T09:00:00Z');
assert(deriveConfirmed(NOW, NOW, first).confirmedAt === first,
       'un aller-retour de confirmation garde la date d origine');
assert(deriveConfirmed(NOW, null, first).confirmedAt === null,
       'un accord retire remet la date a zero');
const fresh = deriveConfirmed(NOW, NOW, null).confirmedAt;
assert(fresh instanceof Date, 'un premier accord complet date le remboursement');

console.log('\n6) retirer sa confirmation redonne un remboursement en attente');
// L'appelant passe null pour son cote ; l'autre garde le sien.
assert(deriveConfirmed(null, NOW, first).confirmed === false,
       'le remboursement redevient en attente, il ne disparait pas');

console.log('\n7) arrondi au centime');
assert(round2(10.005) === 10.01, '10.005 → 10.01');
assert(round2(33.333) === 33.33, '33.333 → 33.33');
assert(round2(0.004) === 0, 'un montant sous le centime tombe a zero — refuse en amont');
assert(round2(19.99) === 19.99, 'un montant deja au centime ne bouge pas');

console.log(`\n${passed} réussis, ${failed} échoués\n`);
process.exit(failed > 0 ? 1 : 0);
