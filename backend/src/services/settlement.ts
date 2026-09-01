// backend/src/services/settlement.ts
// Regles de decision d'un remboursement, isolees de la couche HTTP pour etre
// testables sans base : qui a le droit d'enregistrer, quels accords sont
// acquis d'office, et quand le remboursement devient effectif.

export type Side = {
  memberId: string;
  /** Un membre sans compte ne peut jamais confirmer quoi que ce soit. */
  hasAccount: boolean;
};

/**
 * Qui peut enregistrer ce remboursement.
 * On enregistre un versement dont on fait partie. Seule exception : deux
 * membres sans compte, que personne d'autre ne pourrait declarer.
 */
export function canRecord(recorderMemberId: string, from: Side, to: Side): boolean {
  if (recorderMemberId === from.memberId || recorderMemberId === to.memberId) return true;
  return !from.hasAccount && !to.hasAccount;
}

/**
 * Accords acquis des l'enregistrement : celui de la personne qui enregistre,
 * et celui d'un membre sans compte — sinon sa dette resterait bloquee a vie.
 */
export function initialConfirmations(
  recorderMemberId: string, from: Side, to: Side, now: Date
): { fromAt: Date | null; toAt: Date | null } {
  return {
    fromAt: recorderMemberId === from.memberId || !from.hasAccount ? now : null,
    toAt: recorderMemberId === to.memberId || !to.hasAccount ? now : null,
  };
}

/**
 * Les deux drapeaux derives des accords de chaque cote. `confirmedAt` garde la
 * date du premier accord complet : un aller-retour d'annulation ne la reecrit
 * pas tant que le remboursement reste acquis.
 */
export function deriveConfirmed(
  fromAt: Date | null, toAt: Date | null, previousConfirmedAt: Date | null
): { confirmed: boolean; confirmedAt: Date | null } {
  const confirmed = !!fromAt && !!toAt;
  return {
    confirmed,
    confirmedAt: confirmed ? (previousConfirmedAt ?? new Date()) : null,
  };
}

/** Arrondi au centime — les montants sont stockes en Float. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
