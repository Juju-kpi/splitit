// backend/src/services/settlement.scenario.test.ts
// Parcours complet d'un remboursement, sans base : on rejoue les decisions des
// routes (services/settlement.ts) et on lit le solde apres chaque etape avec
// le vrai computeBalances. C'est le comportement attendu de bout en bout.
//
// Lancer avec :  npx tsx src/services/settlement.scenario.test.ts

import { computeBalances, SettlementLike } from './balances';
import { canRecord, initialConfirmations, deriveConfirmed, round2 } from './settlement';

let passed = 0, failed = 0;
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

// ── Un groupe minimal ─────────────────────────────────────────────────────
const member = (id: string, hasAccount = true) => ({
  id, groupId: 'g', userId: hasAccount ? `u_${id}` : null, displayName: id,
  avatarColor: '#000', avatarInitials: id.slice(0, 2).toUpperCase(), joinedAt: new Date(),
}) as any;

const alice = member('alice'), bob = member('bob'), carol = member('carol');
const guest = member('guest', false);
const members = [alice, bob, carol, guest];

let seq = 0;
const expense = (payer: string, total: number, splits: { memberId: string; amount: number }[]) => {
  const id = `e${seq++}`;
  return {
    id, groupId: 'g', description: id, totalAmount: total, currency: 'CHF',
    paidByMemberId: payer, splitType: 'EQUAL', isComplete: true,
    createdAt: new Date(), updatedAt: new Date(),
    payments: [{ id: `${id}p`, expenseId: id, memberId: payer, amount: total }],
    splits: splits.map((s, i) => ({
      id: `${id}s${i}`, expenseId: id, settled: false, settledAt: null,
      settledByDebtorAt: null, settledByCreditorAt: null, createdAt: new Date(), ...s,
    })),
  } as any;
};

// alice avance 60 pour alice+bob ; bob avance 60 pour bob+carol.
// Aucune depense ne lie alice et carol — le netting cree pourtant la dette.
const expenses = [
  expense('alice', 60, [{ memberId: 'alice', amount: 30 }, { memberId: 'bob', amount: 30 }]),
  expense('bob', 60, [{ memberId: 'bob', amount: 30 }, { memberId: 'carol', amount: 30 }]),
];

// ── Le magasin des remboursements, comme la table ─────────────────────────
type Row = SettlementLike & {
  id: string; fromMemberId: string; toMemberId: string;
  confirmedByFromAt: Date | null; confirmedByToAt: Date | null; confirmedAt: Date | null;
};
let store: Row[] = [];
let rowSeq = 0;

const hasAccount = (id: string) => !!members.find(m => m.id === id)!.userId;
const side = (id: string) => ({ memberId: id, hasAccount: hasAccount(id) });

/** POST /api/settlements */
function record(actor: string, from: string, to: string, amount: number): Row | string {
  if (from === to) return 'On ne se rembourse pas soi-meme';
  if (round2(amount) < 0.01) return 'Montant trop faible';
  if (!canRecord(actor, side(from), side(to))) return 'Interdit';
  const { fromAt, toAt } = initialConfirmations(actor, side(from), side(to), new Date());
  const row: Row = {
    id: `s${rowSeq++}`, fromMemberId: from, toMemberId: to, amount: round2(amount),
    confirmedByFromAt: fromAt, confirmedByToAt: toAt, cancelledAt: null,
    ...deriveConfirmed(fromAt, toAt, null),
  };
  store.push(row);
  return row;
}

/** POST /api/settlements/:id/confirm */
function confirm(actor: string, id: string, undo = false): Row | string {
  const row = store.find(r => r.id === id)!;
  if (row.cancelledAt) return 'Ce remboursement a ete annule';
  const isFrom = actor === row.fromMemberId, isTo = actor === row.toMemberId;
  if (!isFrom && !isTo) return 'Interdit';
  const stamp = undo ? null : new Date();
  row.confirmedByFromAt = isFrom ? stamp : row.confirmedByFromAt;
  row.confirmedByToAt = isTo ? stamp : row.confirmedByToAt;
  Object.assign(row, deriveConfirmed(row.confirmedByFromAt, row.confirmedByToAt, row.confirmedAt));
  return row;
}

/** POST /api/settlements/:id/cancel */
function cancel(actor: string, id: string, undo = false): Row | string {
  const row = store.find(r => r.id === id)!;
  if (actor !== row.fromMemberId && actor !== row.toMemberId) return 'Interdit';
  row.cancelledAt = undo ? null : new Date();
  return row;
}

const owed = (from: string, to: string) => {
  const b = computeBalances(members, expenses, store)
    .find(x => x.fromMemberId === from && x.toMemberId === to);
  return b ? b.amount : 0;
};
const openCount = () => computeBalances(members, expenses, store).length;

// ── Le parcours ───────────────────────────────────────────────────────────
console.log('\n1) au depart : une dette née d une compensation en chaîne');
assert(owed('carol', 'alice') === 30,
       'carol doit 30 à alice, sans avoir jamais partagé de dépense avec elle');

console.log('\n2) carol enregistre son versement');
const s1 = record('carol', 'carol', 'alice', 30) as Row;
assert(typeof s1 !== 'string', 'l enregistrement est accepté');
assert(s1.confirmedByFromAt !== null && s1.confirmedByToAt === null,
       'son côté est confirmé, celui d alice reste à faire');
assert(s1.confirmed === false && owed('carol', 'alice') === 30,
       'le solde ne bouge pas tant qu alice n a pas validé');

console.log('\n3) un tiers ne peut pas valider à la place d alice');
assert(confirm('bob', s1.id) === 'Interdit', 'bob est refusé');
assert(owed('carol', 'alice') === 30, 'et le solde n a pas bougé');

console.log('\n4) alice valide');
confirm('alice', s1.id);
assert(s1.confirmed === true, 'les deux sont d accord');
assert(owed('carol', 'alice') === 0 && openCount() === 0, 'plus aucune dette ouverte');

console.log('\n5) alice se ravise et retire sa confirmation');
confirm('alice', s1.id, true);
assert(s1.confirmed === false, 'le remboursement redevient en attente');
assert(owed('carol', 'alice') === 30, 'la dette réapparaît telle quelle');

console.log('\n6) puis annule carrément le remboursement');
confirm('alice', s1.id);
cancel('alice', s1.id);
assert(owed('carol', 'alice') === 30, 'annulé → la dette est de nouveau due');
assert(confirm('carol', s1.id) === 'Ce remboursement a ete annule',
       'on ne re-confirme pas un remboursement annulé');

console.log('\n7) rétablir l annulation restaure l état d avant');
cancel('alice', s1.id, true);
assert(s1.confirmed === true && owed('carol', 'alice') === 0,
       'les accords d origine sont intacts, le solde repart à zéro');

console.log('\n8) remboursement en deux fois');
store = [];
assert(owed('carol', 'alice') === 30, 'on repart de la dette entière');
const p1 = record('carol', 'carol', 'alice', 12) as Row;
confirm('alice', p1.id);
assert(owed('carol', 'alice') === 18, 'après 12 versés, il reste 18');
const p2 = record('alice', 'carol', 'alice', 18) as Row;
assert(p2.confirmedByToAt !== null && p2.confirmedByFromAt === null,
       'alice enregistre ce qu elle a reçu : c est à carol de valider');
assert(owed('carol', 'alice') === 18, 'et le solde attend cette validation');
confirm('carol', p2.id);
assert(owed('carol', 'alice') === 0 && openCount() === 0, 'soldé en deux versements');

console.log('\n9) un versement pour un membre sans compte est acquis tout de suite');
store = [];
const g = record('alice', 'guest', 'alice', 5) as Row;
assert(g.confirmed === true,
       'l invité ne pourra jamais confirmer : son accord est donné d office');

console.log('\n10) montants refusés');
store = [];
assert(record('carol', 'carol', 'carol', 10) === 'On ne se rembourse pas soi-meme', 'from = to');
assert(record('carol', 'carol', 'alice', 0.004) === 'Montant trop faible', 'sous le centime');
assert(store.length === 0, 'aucune ligne écrite en base au passage');

console.log('\n11) rien d autre n a bougé dans le groupe');
store = [];
assert(owed('bob', 'alice') === 0, 'bob et alice sont à l équilibre par compensation');
assert(openCount() === 1, 'une seule dette ouverte au total, comme au départ');

console.log(`\n${passed} réussis, ${failed} échoués\n`);
process.exit(failed > 0 ? 1 : 0);
