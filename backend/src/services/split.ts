// backend/src/services/split.ts
//
// Répartition d'un montant à l'exactitude du centime.
//
// Problème résolu : avant, chaque part était calculée avec
//   Math.round((total / n) * 100) / 100
// appliqué INDÉPENDAMMENT à chaque membre. La somme des parts ne retombait
// donc pas sur le total. Exemple réel : 100.00 CHF partagés entre 7 →
// 14.2857… arrondi à 14.29 pour tout le monde → 100.03 au lieu de 100.00.
// Conséquences en cascade :
//   - les parts affichées étaient fausses (de quelques centimes) ;
//   - computeIsComplete() comparait somme(parts) au total avec une tolérance
//     de 2 centimes → la dépense passait "à compléter" alors qu'elle était
//     parfaitement remplie ;
//   - computeBalances() créditait le payeur du total mais débitait une somme
//     différente → les soldes ne se compensaient pas exactement.
//
// Méthode : on travaille en centimes (entiers), on donne à chacun le plancher
// de sa part exacte, puis on distribue les centimes restants aux plus grands
// restes (méthode du plus fort reste, celle des répartitions de sièges).
// La somme des parts est alors TOUJOURS égale au total, au centime près.

export type Share = { memberId: string; amount: number };

export function toCents(amount: number): number {
  return Math.round(amount * 100);
}

export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

/**
 * Répartit `totalCents` selon des poids, en centimes entiers.
 * La somme du résultat vaut exactement `totalCents`.
 * Poids tous nuls (ou absents) → répartition égale.
 */
export function distributeCents(totalCents: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];

  const sum = weights.reduce((s, w) => s + w, 0);
  const effective = sum > 0 ? weights : weights.map(() => 1);
  const effectiveSum = sum > 0 ? sum : n;

  const exact = effective.map(w => (totalCents * w) / effectiveSum);
  const floors = exact.map(v => Math.floor(v));
  // sum(floors) <= totalCents, et l'écart est strictement inférieur à n.
  const remainder = totalCents - floors.reduce((s, v) => s + v, 0);

  // Les centimes restants vont aux plus grands restes. À reste égal, l'ordre
  // d'entrée tranche — la répartition est donc déterministe (même dépense,
  // même résultat à chaque recalcul).
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => (b.frac - a.frac) || (a.i - b.i));

  const out = [...floors];
  for (let k = 0; k < remainder; k++) out[order[k % n].i] += 1;

  return out;
}

/** Parts égales — la somme vaut exactement `totalAmount`. */
export function splitEqually(totalAmount: number, memberIds: string[]): Share[] {
  if (memberIds.length === 0) return [];
  const cents = distributeCents(toCents(totalAmount), memberIds.map(() => 1));
  return memberIds.map((memberId, i) => ({ memberId, amount: fromCents(cents[i]) }));
}

export type ItemInput = { price: number; assignedToMemberIds: string[] };

/**
 * Parts calculées article par article.
 *
 * 1. Le prix de chaque article est réparti au centime entre ses assignés.
 * 2. Si tous les articles sont assignés mais que leur somme ne tombe pas sur
 *    le total de la dépense (service, taxe, arrondi de caisse, total OCR),
 *    l'écart est réparti proportionnellement à ce que chacun consomme.
 *    Sans ça, l'écart n'était payé par personne : la dépense restait
 *    éternellement "à compléter" et les soldes étaient faux.
 * 3. S'il reste des articles non assignés, on ne comble RIEN : la dépense est
 *    réellement incomplète et doit le rester.
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
    // Mise à l'échelle proportionnelle sur le total réel de la dépense
    cents = distributeCents(totalCents, cents);
  }

  return {
    shares: memberIds.map((memberId, i) => ({ memberId, amount: fromCents(cents[i]) })),
    hasUnassigned,
  };
}

/**
 * Parts saisies à la main. On respecte les montants de l'utilisateur, mais si
 * la somme rate le total de quelques centimes (arrondis de saisie), on corrige
 * la plus grosse part pour que le compte tombe juste. Au-delà de `tolerance`,
 * on ne touche à rien : l'écart est réel et la dépense doit être signalée.
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
 * Idem pour les payeurs : si la somme des paiements rate le total de quelques
 * centimes, les soldes ne se compensent jamais. On ajuste le plus gros payeur.
 * Renvoie null si l'écart est trop grand pour être un arrondi (le rappel doit
 * alors être renvoyé à l'appelant sous forme d'erreur).
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
