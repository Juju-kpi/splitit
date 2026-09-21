#!/usr/bin/env python3
"""Rapport visuel des corrections OCR, pour juger des donnees avant d'entrainer.

    ADMIN_API_KEY=... API_BASE=... python inspect_corrections.py
    # puis ouvrir out/corrections-report.html

Le rapport reste un fichier LOCAL, jamais publie : ces corrections viennent
des tickets de caisse de vrais utilisateurs.

Ce qu'il montre, pour chaque correction :
  - le texte brut sorti de l'OCR, c'est-a-dire l'entree du modele ;
  - ce que l'utilisateur a corrige, c'est-a-dire la cible a apprendre ;
  - de quel cote elle tombe dans la repartition entrainement / validation.

Et ce qui compte le plus : la part de corrections qui touchent le nom, le
prix, ou les deux. Un jeu ou tout le monde ne corrige que le prix n'apprendra
rien sur les noms, et la precision affichee sera trompeuse.
"""
import os, sys, json, html, pathlib, collections
import requests

from export_corrections import bucket, to_example, DEFAULT_HOLDOUT_RATIO, fetch

OUT = pathlib.Path("out")


def normalise(s: str) -> str:
    return " ".join(str(s or "").lower().split())


def as_price(v) -> float:
    """Le prix en nombre, ou NaN si illisible.

    Comparer les prix comme des chaines comptait « 3,20 » -> 3.2 comme une
    correction, alors que la valeur est la meme. Seul l'ecart numerique dit
    si l'utilisateur a vraiment corrige quelque chose.
    """
    try:
        return round(float(str(v).replace(",", ".").strip()), 2)
    except (TypeError, ValueError):
        return float("nan")


def classify(c: dict) -> str:
    """Le nom, le prix, ou les deux ont-ils ete corriges ?"""
    name_changed = normalise(c["ocrRaw"]) != normalise(c["correctedName"])
    raw, fixed = as_price(c["ocrPriceRaw"]), as_price(c["correctedPrice"])
    # NaN != NaN : un prix brut illisible compte comme corrige, ce qui est
    # exact — c'est precisement ce que le modele doit apprendre a redresser.
    price_changed = raw != fixed
    if name_changed and price_changed:
        return "les deux"
    if name_changed:
        return "nom"
    if price_changed:
        return "prix"
    return "aucun"


CSS = """
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: #08090C; color: #fff;
    font: 15px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 40px 24px 64px; }
  h1 { font-size: 30px; font-weight: 600; letter-spacing: -.03em; margin: 0; }
  .sub { color: #8A929F; font-size: 13px; margin-top: 8px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
           gap: 12px; margin: 32px 0; }
  .card { background: #0F1116; border-radius: 16px; padding: 18px; }
  .card .k { font-size: 12px; color: #8A929F; }
  .card .v { font-size: 26px; font-weight: 500; margin-top: 6px;
             font-variant-numeric: tabular-nums; letter-spacing: -.02em; }
  .lbl { font-size: 13px; font-weight: 500; color: #8A929F; margin: 32px 0 12px; }
  table { width: 100%; border-collapse: collapse; background: #0F1116;
          border-radius: 16px; overflow: hidden; }
  th { text-align: left; font-size: 12px; font-weight: 500; color: #8A929F;
       padding: 14px 16px; border-bottom: 1px solid rgba(255,255,255,.06); }
  td { padding: 13px 16px; border-bottom: 1px solid rgba(255,255,255,.04);
       vertical-align: top; font-size: 14px; }
  tr:last-child td { border-bottom: 0; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; }
  .raw { color: #9AA1AF; }
  .fix { color: #fff; font-weight: 500; }
  .tag { display: inline-block; font-size: 11px; padding: 3px 9px;
         border-radius: 999px; white-space: nowrap; }
  .t-nom   { background: rgba(62,207,142,.12); color: #3ECF8E; }
  .t-prix  { background: rgba(232,163,61,.12); color: #E8A33D; }
  .t-deux  { background: rgba(201,206,218,.12); color: #C9CEDA; }
  .t-aucun { background: rgba(236,93,98,.12); color: #EC5D62; }
  .t-h { background: rgba(255,255,255,.08); color: #C9CEDA; }
  .hint { color: #8A929F; font-size: 13px; line-height: 1.6; margin-top: 18px; }
  .warn { background: rgba(232,163,61,.08); color: #E8A33D; border-radius: 14px;
          padding: 16px; margin-top: 24px; font-size: 14px; line-height: 1.55; }
  .overflow { overflow-x: auto; }
"""


def render(rows: list, holdout_ratio: float, min_corrections: int) -> str:
    holdout_max = int(holdout_ratio * 100)
    kinds = collections.Counter(classify(c) for c in rows)
    n_holdout = sum(1 for c in rows if bucket(c["id"]) < holdout_max)
    vendors = collections.Counter((c.get("vendorHint") or "—") for c in rows)

    parts = [
        '<div class="wrap">',
        '<h1>Corrections OCR</h1>',
        f'<p class="sub">{len(rows)} correction(s) · seuil d\'entrainement '
        f'{min_corrections} · validation {holdout_ratio:.0%}</p>',
        '<div class="cards">',
        f'<div class="card"><div class="k">Total</div><div class="v">{len(rows)}</div></div>',
        f'<div class="card"><div class="k">Entraînement</div>'
        f'<div class="v">{len(rows) - n_holdout}</div></div>',
        f'<div class="card"><div class="k">Validation</div>'
        f'<div class="v">{n_holdout}</div></div>',
        f'<div class="card"><div class="k">Nom corrigé</div>'
        f'<div class="v" style="color:#3ECF8E">{kinds["nom"] + kinds["les deux"]}</div></div>',
        f'<div class="card"><div class="k">Prix corrigé</div>'
        f'<div class="v" style="color:#E8A33D">{kinds["prix"] + kinds["les deux"]}</div></div>',
        f'<div class="card"><div class="k">Enseignes</div>'
        f'<div class="v">{len([v for v in vendors if v != "—"])}</div></div>',
        '</div>',
    ]

    # Les avertissements valent plus que les chiffres : ils disent si ce jeu
    # peut apprendre quelque chose.
    warnings = []
    if len(rows) < min_corrections:
        warnings.append(
            f'Sous le seuil de {min_corrections} : le pipeline passera son tour. '
            'Le moteur de règles continue de servir et apprend à chaque correction.')
    if n_holdout == 0 and len(rows) > 1:
        warnings.append(
            'Aucune correction ne tombe du côté validation. Un exemple y sera '
            'déplacé automatiquement, sinon l\'entraînement échouerait.')
    if kinds["aucun"]:
        warnings.append(
            f'{kinds["aucun"]} correction(s) n\'a rien change ni au nom ni au prix. '
            'Elles n\'apprennent rien et diluent la mesure de précision.')
    only = [k for k in ("nom", "prix") if kinds[k] and not kinds["les deux"]
            and not kinds["nom" if k == "prix" else "prix"]]
    if only and len(rows) > 5:
        warnings.append(
            f'Toutes les corrections portent sur le {only[0]}. La précision '
            f'affichée sur l\'autre champ ne voudra rien dire.')
    for w in warnings:
        parts.append(f'<div class="warn">{html.escape(w)}</div>')

    parts += ['<div class="lbl">Chaque correction, entrée du modèle et cible</div>',
              '<div class="overflow"><table><tr>'
              '<th>OCR brut</th><th>Prix brut</th><th>Nom corrigé</th>'
              '<th>Prix corrigé</th><th>Enseigne</th><th>Corrige</th><th>Côté</th>'
              '</tr>']

    for c in sorted(rows, key=lambda c: bucket(c["id"])):
        kind = classify(c)
        side = "validation" if bucket(c["id"]) < holdout_max else "entraînement"
        parts.append(
            '<tr>'
            f'<td><code class="raw">{html.escape(str(c["ocrRaw"]))}</code></td>'
            f'<td><code class="raw">{html.escape(str(c["ocrPriceRaw"]))}</code></td>'
            f'<td><span class="fix">{html.escape(str(c["correctedName"]))}</span></td>'
            f'<td><code class="fix">{html.escape(str(c["correctedPrice"]))}</code></td>'
            f'<td class="raw">{html.escape(str(c.get("vendorHint") or "—"))}</td>'
            f'<td><span class="tag t-{kind.replace(" ", "")}">{kind}</span></td>'
            f'<td><span class="tag t-h">{side}</span></td>'
            '</tr>')

    parts += [
        '</table></div>',
        '<p class="hint">L\'« OCR brut » est ce que le modèle reçoit en entrée ; '
        'le « nom corrigé » est la cible qu\'il doit apprendre à produire. Une '
        'correction utile change réellement l\'un des deux champs.<br>'
        'La répartition est déterministe — un identifiant tombe toujours du même '
        'côté, d\'une exécution à l\'autre, pour que les mesures restent '
        'comparables.</p>',
        '</div>',
    ]
    return ('<!doctype html><html lang="fr"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            '<title>Corrections OCR — Splitit</title>'
            f'<style>{CSS}</style></head><body>' + "\n".join(parts)
            + '</body></html>')


def main() -> None:
    api_base = os.environ.get("API_BASE", "").rstrip("/")
    admin_key = os.environ.get("ADMIN_API_KEY", "")
    if not api_base or not admin_key:
        print("\nIl manque API_BASE et ADMIN_API_KEY.\n", file=sys.stderr)
        print('  API_BASE=https://splitit-9x32.onrender.com \\', file=sys.stderr)
        print('  ADMIN_API_KEY=... python inspect_corrections.py\n', file=sys.stderr)
        sys.exit(2)

    holdout_ratio = float(os.environ.get("HOLDOUT_RATIO", str(DEFAULT_HOLDOUT_RATIO)))
    min_corrections = int(os.environ.get("MIN_CORRECTIONS", "50"))

    rows = fetch(api_base, admin_key)
    if not rows:
        print("Aucune correction en base — rien a inspecter.", file=sys.stderr)
        sys.exit(0)

    OUT.mkdir(exist_ok=True)
    path = OUT / "corrections-report.html"
    path.write_text(render(rows, holdout_ratio, min_corrections), encoding="utf-8")

    kinds = collections.Counter(classify(c) for c in rows)
    print(f"\n{len(rows)} correction(s)")
    for k in ("nom", "prix", "les deux", "aucun"):
        if kinds[k]:
            print(f"  {kinds[k]:>4}  {k} corrige")
    print(f"\nRapport : {path.resolve()}")
    print("Fichier local, jamais publie — ce sont des donnees d'utilisateurs.\n")


if __name__ == "__main__":
    main()
