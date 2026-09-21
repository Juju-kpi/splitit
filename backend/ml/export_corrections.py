#!/usr/bin/env python3
"""Recupere les corrections d'utilisateurs et ecrit train/holdout en JSONL.

L'entraineur ne touche jamais la base : il appelle la route d'export reservee
a l'administration (GET /api/ocr/export) avec ADMIN_API_KEY. Les identifiants
de base restent ainsi hors de la CI.

Env :
  API_BASE         ex. https://splitit-9x32.onrender.com
  ADMIN_API_KEY    meme valeur que l'ADMIN_API_KEY du backend
  HOLDOUT_RATIO    optionnel, 0.15 par defaut
  MIN_CORRECTIONS  optionnel, 50 par defaut — en dessous, le tour est passe
Sorties : data/train.jsonl, data/holdout.jsonl
"""
import os, json, hashlib, pathlib, sys
import requests

DEFAULT_HOLDOUT_RATIO = 0.15
# Affiner un seq2seq sur une poignee d'exemples produit un modele pire que le
# moteur de regles qu'il remplace, pour une demi-heure de CI. En dessous de ce
# seuil on passe le tour. MIN_CORRECTIONS permet de l'abaisser pour tester la
# chaine de bout en bout.
DEFAULT_MIN_CORRECTIONS = 50


def to_example(c: dict) -> dict:
    """Le format exact sur lequel le modele est entraine et servi."""
    vendor = (c.get("vendorHint") or "").strip()
    src = f'ocr: {c["ocrRaw"]} | price: {c["ocrPriceRaw"]}'
    if vendor:
        src += f' | vendor: {vendor}'
    tgt = f'{c["correctedName"]} | {c["correctedPrice"]}'
    return {"input": src, "target": tgt, "id": c["id"]}


def bucket(_id: str) -> int:
    """Repartition deterministe 0..99, stable d'une execution a l'autre."""
    h = int(hashlib.md5(_id.encode()).hexdigest(), 16)
    return h % 100


def split_examples(rows: list, holdout_ratio: float = DEFAULT_HOLDOUT_RATIO):
    """Repartit les corrections entre entrainement et validation.

    Le tirage est deterministe — donc reproductible d'une execution a l'autre,
    ce qui rend les mesures comparables. Mais rien ne garantit qu'il remplisse
    les deux cotes : avec peu d'exemples, la validation peut ressortir vide, et
    `load_dataset()` echoue alors sur « Instruction "holdout" corresponds to no
    data ». On y deplace donc l'exemple au plus petit bucket, ce qui reste
    deterministe.

    Renvoie (train, holdout, moved) — `moved` dit si le rattrapage a servi.
    """
    holdout_max = int(holdout_ratio * 100)
    train, holdout = [], []
    for c in rows:
        ex = to_example(c)
        (holdout if bucket(c["id"]) < holdout_max else train).append(ex)

    moved = False
    if not holdout and len(train) > 1:
        lowest = min(rows, key=lambda c: bucket(c["id"]))
        ex = to_example(lowest)
        train = [e for e in train if e["id"] != ex["id"]]
        holdout = [ex]
        moved = True

    return train, holdout, moved


def fetch(api_base: str, admin_key: str) -> list:
    """Appelle la route d'export et renvoie les corrections brutes."""
    r = requests.get(f"{api_base}/api/ocr/export",
                     headers={"x-admin-key": admin_key}, timeout=60)

    # `raise_for_status()` seul n'affiche que « 403 Client Error », ce qui
    # n'indique pas de quel cote chercher. On remonte le message du serveur,
    # qui distingue une cle absente (503) d'une cle qui ne correspond pas (403).
    if not r.ok:
        try:
            detail = r.json().get("error", r.text[:200])
        except ValueError:
            detail = r.text[:200]
        print(f"HTTP {r.status_code} sur {api_base}/api/ocr/export", file=sys.stderr)
        print(f"  {detail}", file=sys.stderr)
        if r.status_code == 403:
            print("  -> Le secret GitHub ADMIN_API_KEY differe de celui du serveur.",
                  file=sys.stderr)
            print("     Attention aux espaces et au retour a la ligne colles avec la valeur.",
                  file=sys.stderr)
        elif r.status_code == 503:
            print("  -> ADMIN_API_KEY n'est pas renseignee sur ce service.", file=sys.stderr)
            print(f"     Verifie qu'API_BASE pointe le bon service : {api_base}", file=sys.stderr)
        elif r.status_code == 401:
            print("  -> La route est derriere l'authentification utilisateur ;",
                  file=sys.stderr)
            print("     le backend deploye est anterieur au correctif.", file=sys.stderr)
        sys.exit(1)

    return [json.loads(l) for l in r.text.splitlines() if l.strip()]


def main() -> None:
    api_base = os.environ["API_BASE"].rstrip("/")
    admin_key = os.environ["ADMIN_API_KEY"]
    holdout_ratio = float(os.environ.get("HOLDOUT_RATIO", str(DEFAULT_HOLDOUT_RATIO)))
    min_corrections = int(os.environ.get("MIN_CORRECTIONS", str(DEFAULT_MIN_CORRECTIONS)))

    rows = fetch(api_base, admin_key)

    if not rows:
        print("Aucune correction ; rien a entrainer.", file=sys.stderr)
        sys.exit(78)  # EX_CONFIG -> la CI traite ca comme « passer », pas « echouer »

    if len(rows) < min_corrections:
        print(f"{len(rows)} correction(s) seulement, minimum {min_corrections} "
              f"— on passe ce tour.", file=sys.stderr)
        print("  Le moteur de regles continue de servir ; il apprend a chaque "
              "correction d'utilisateur.", file=sys.stderr)
        sys.exit(78)

    train, holdout, moved = split_examples(rows, holdout_ratio)
    if moved:
        print("Jeu de validation vide apres tirage ; un exemple y a ete deplace.",
              file=sys.stderr)

    out = pathlib.Path("data")
    out.mkdir(exist_ok=True)
    for name, data in (("train", train), ("holdout", holdout)):
        with (out / f"{name}.jsonl").open("w", encoding="utf-8") as f:
            for ex in data:
                f.write(json.dumps({k: ex[k] for k in ("input", "target")},
                                    ensure_ascii=False) + "\n")

    print(f"Exported {len(train)} train / {len(holdout)} holdout examples.")


if __name__ == "__main__":
    main()
