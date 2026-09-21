#!/usr/bin/env python3
"""Test autonome de la repartition entrainement / validation.

    python test_export_corrections.py

Aucun reseau, aucune base. C'est la deuxieme fois que ce pipeline echoue sur
cette partie — une repartition qui laisse la validation vide fait echouer
`load_dataset()` bien plus loin, dans train.py, avec un message qui ne pointe
pas la cause.
"""
import sys
from export_corrections import split_examples, bucket, to_example

passed = failed = 0


def check(cond, label):
    global passed, failed
    if cond:
        passed += 1
        print(f"  ok   {label}")
    else:
        failed += 1
        print(f"  FAIL {label}")


def correction(i: str) -> dict:
    return {
        "id": i, "ocrRaw": f"PAIN{i}", "ocrPriceRaw": "2,50",
        "correctedName": "Pain", "correctedPrice": 2.5, "vendorHint": "",
    }


print("\n1) la repartition est deterministe")
rows = [correction(str(i)) for i in range(200)]
a = split_examples(rows)
b = split_examples(rows)
check([e["id"] for e in a[0]] == [e["id"] for e in b[0]],
      "deux appels donnent le meme entrainement")
check([e["id"] for e in a[1]] == [e["id"] for e in b[1]],
      "et la meme validation")

print("\n2) le ratio est approximativement respecte")
train, holdout, _ = split_examples(rows, 0.15)
part = len(holdout) / (len(train) + len(holdout))
check(0.08 < part < 0.24, f"validation a {part:.0%} pour un ratio demande de 15%")
check(len(train) + len(holdout) == 200, "aucun exemple perdu ni duplique")

print("\n3) aucun exemple ne se retrouve des deux cotes")
ids_train = {e["id"] for e in train}
ids_holdout = {e["id"] for e in holdout}
check(not (ids_train & ids_holdout), "les deux ensembles sont disjoints")

print("\n4) la validation n est jamais vide — la cause du dernier echec")
# Deux corrections dont aucune ne tombe dans la tranche de validation :
# c'est exactement le cas qui a fait echouer la CI.
def find_pair_both_in_train():
    found = []
    for i in range(10_000):
        if bucket(str(i)) >= 15:
            found.append(correction(str(i)))
        if len(found) == 2:
            return found
    raise AssertionError("jeu de test introuvable")

pair = find_pair_both_in_train()
check(all(bucket(c["id"]) >= 15 for c in pair),
      "le jeu de test tombe bien entierement du cote entrainement")
train, holdout, moved = split_examples(pair)
check(len(holdout) == 1, "un exemple a ete deplace vers la validation")
check(len(train) == 1, "et il ne reste qu un seul exemple a l entrainement")
check(moved is True, "le rattrapage est signale a l appelant")
check({e["id"] for e in train}.isdisjoint({e["id"] for e in holdout}),
      "toujours disjoints apres rattrapage")

print("\n5) le rattrapage reste deterministe")
x = split_examples(pair)
y = split_examples(pair)
check(x[1][0]["id"] == y[1][0]["id"], "le meme exemple est deplace a chaque fois")

print("\n6) un seul exemple : on ne le deplace pas")
# Le deplacer laisserait l'entrainement vide, ce qui echouerait de la meme
# maniere. Le seuil minimum arrete deja ce cas en amont.
one = [pair[0]]
train, holdout, moved = split_examples(one)
check(len(train) == 1 and not holdout, "l entrainement garde son unique exemple")
check(moved is False, "aucun rattrapage tente")

print("\n7) le format des exemples")
ex = to_example({"id": "x", "ocrRaw": "CRVTT", "ocrPriceRaw": "3,20",
                 "correctedName": "Carottes", "correctedPrice": 3.2,
                 "vendorHint": "Coop"})
check(ex["input"] == "ocr: CRVTT | price: 3,20 | vendor: Coop",
      "l enseigne est reprise dans l entree quand elle existe")
check(ex["target"] == "Carottes | 3.2", "la cible reste nom | prix")
ex = to_example({"id": "y", "ocrRaw": "LAIT", "ocrPriceRaw": "1,10",
                 "correctedName": "Lait", "correctedPrice": 1.1, "vendorHint": None})
check("vendor:" not in ex["input"], "pas d enseigne, pas de champ vide")

print(f"\n{passed} reussis, {failed} echoues\n")
sys.exit(1 if failed else 0)
