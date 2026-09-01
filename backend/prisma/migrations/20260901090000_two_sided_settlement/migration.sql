-- Double accord de remboursement : chaque partie confirme de son cote.
-- Colonnes nullables ajoutees : aucune donnee existante n'est modifiee ni perdue.
ALTER TABLE "expense_splits" ADD COLUMN "settledByDebtorAt" TIMESTAMP(3);
ALTER TABLE "expense_splits" ADD COLUMN "settledByCreditorAt" TIMESTAMP(3);

-- Les remboursements deja valides le restent : on considere que les deux
-- parties avaient confirme au moment ou ils ont ete marques regles.
UPDATE "expense_splits"
SET "settledByDebtorAt"   = COALESCE("settledAt", CURRENT_TIMESTAMP),
    "settledByCreditorAt" = COALESCE("settledAt", CURRENT_TIMESTAMP)
WHERE "settled" = true;
