// backend/src/services/split.ts
//
// Repartition d'un montant en centimes entiers, par plus fort reste : chacun
// recoit le plancher de sa part exacte, puis les centimes restants vont aux
// plus grandes decimales. La somme des parts vaut donc exactement le total.
//
// Arrondir chaque part independamment ne tombe pas juste : 100.00 / 7 donne
// 14.29 x 7 = 100.03. L'ecart faussait les soldes et faisait passer des
// depenses completes en "a completer".

export type Share = { memberId: string; amount: number };

export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

/** Repartit `totalCents` selon des poids. Poids tous nuls → parts egales. */
export function distributeCents(totalCents: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];

  const sum = weights.reduce((s, w) => s + w, 0);
  const effective = sum > 0 ? weights : weights.map(() => 1);
  const effectiveSum = sum > 0 ? sum : n;

  const exact = effective.map(w => (totalCents * w) / effectiveSum);
  const floors = exact.map(v => Math.floor(v));
  // sum(floors) <= totalCents, l'ecart est strictement inferieur a n.
  const remainder = totalCents - floors.reduce((s, v) => s + v, 0);

  // A reste egal, l'ordre d'entree tranche : le resultat est deterministe.
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => (b.frac - a.frac) || (a.i - b.i));

  const out = [...floors];
  for (let k = 0; k < remainder; k++) out[order[k % n].i] += 1;

  return out;
}

/** Parts egales. */
export function splitEqually(totalAmount: number, memberIds: string[]): Share[] {
  if (memberIds.length === 0) return [];
  const cents = distributeCents(toCents(totalAmount), memberIds.map(() => 1));
  return memberIds.map((memberId, i) => ({ memberId, amount: fromCents(cents[i]) }));
}

export type ItemInput = { price: number; assignedToMemberIds: string[] };

/**
 * Parts calculees article par article.
 *
 * L'ecart entre la somme des articles et le total (service, taxe, arrondi de
 * caisse) est reparti au prorata de ce que chacun consomme — sauf s'il reste
 * des articles non assignes : la depense est alors reellement incomplete.
 */
export function splitItemized(
  totalAmount: number,
  items: ItemInput[],
): { shares: Share[]; hasUnassigned: boolean } {
  const hasUnassigned = items.some(i => i.assignedToMemberIds.length === 0);

  const centsByMember = new Map<string, number>();
  for (const item of items) {
    const assignees = item.assignedToMemberIds;
    if (assignees.length === 0) continue;
    const parts = distributeCents(toCents(item.price), assignees.map(() => 1));
    assignees.forEach((memberId, i) => {
      centsByMember.set(memberId, (centsByMember.get(memberId) || 0) + parts[i]);
    });
  }

  let memberIds = [...centsByMember.keys()];
  let cents = memberIds.map(id => centsByMember.get(id)!);

  const assignedCents = cents.reduce((s, c) => s + c, 0);
  const totalCents = toCents(totalAmount);

  if (!hasUnassigned && memberIds.length > 0 && assignedCents !== totalCents) {
    // Mise a l'echelle proportionnelle sur le total reel
    cents = distributeCents(totalCents, cents);
  }

  return {
    shares: memberIds.map((memberId, i) => ({ memberId, amount: fromCents(cents[i]) })),
    hasUnassigned,
  };
}

/**
 * Parts saisies a la main. Un ecart de quelques centimes (arrondi de saisie)
 * est absorbe par la plus grosse part ; au-dela de `tolerance` on ne touche a
 * rien, l'ecart est reel et la depense doit etre signalee.
 */
export function normalizeCustomShares(
  totalAmount: number,
  shares: Share[],
  tolerance = 0.05,
): Share[] {
  if (shares.length === 0) return [];
  const cents = shares.map(s => toCents(s.amount));
  const diff = toCents(totalAmount) - cents.reduce((s, c) => s + c, 0);
  if (diff !== 0 && Math.abs(diff) <= toCents(tolerance)) {
    let biggest = 0;
    for (let i = 1; i < cents.length; i++) if (cents[i] > cents[biggest]) biggest = i;
    cents[biggest] += diff;
  }
  return shares.map((s, i) => ({ memberId: s.memberId, amount: fromCents(cents[i]) }));
}

/**
 * Idem pour les payeurs : sans somme exacte, les soldes ne se compensent
 * jamais. Renvoie null si l'ecart depasse un simple arrondi.
 */
export function normalizePayments(
  totalAmount: number,
  payments: Share[],
  tolerance = 0.05,
): Share[] | null {
  if (payments.length === 0) return null;
  const cents = payments.map(p => toCents(p.amount));
  const diff = toCents(totalAmount) - cents.reduce((s, c) => s + c, 0);
  if (diff !== 0) {
    if (Math.abs(diff) > toCents(tolerance)) return null;
    let biggest = 0;
    for (let i = 1; i < cents.length; i++) if (cents[i] > cents[biggest]) biggest = i;
    cents[biggest] += diff;
  }
  return payments.map((p, i) => ({ memberId: p.memberId, amount: fromCents(cents[i]) }));
}
