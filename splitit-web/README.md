# Splitit Web (PWA pour iPhone)

Version web Next.js de l'app Splitit, conçue pour être ajoutée à l'écran d'accueil sur iPhone (PWA), avec le **même backend** que l'app mobile (`https://splitit-9x32.onrender.com`).

## Stack
- Next.js 15 (App Router) + React 19 + TypeScript
- Tailwind CSS (mêmes couleurs/tokens que l'app mobile : fond `#0C0C0F`, accent `#7C6EFA`, effet glassmorphism)
- Zustand pour l'auth, TanStack Query pour les données serveur
- Axios avec refresh automatique du token

## Lancer en local
```bash
npm install
cp .env.example .env.local
npm run dev
```

## Déployer sur Vercel
1. Pousser ce dossier sur un repo GitHub
2. Importer le repo sur vercel.com
3. Ajouter la variable d'env `NEXT_PUBLIC_API_URL` = `https://splitit-9x32.onrender.com` (ou ton backend)
4. Deploy

Une fois en ligne, sur iPhone : ouvrir le lien dans Safari → bouton Partager → **Sur l'écran d'accueil**. L'app s'ouvre alors en plein écran, sans barre Safari, avec l'icône Splitit (`manifest.json` + `apple-touch-icon.png` déjà configurés).

## Ce qui est implémenté (parité fonctionnelle avec l'app mobile)
- Auth : inscription, connexion, mot de passe oublié / reset par lien email
- Groupes : liste, création, rejoindre par code (+ preview + "claim" d'un membre fantôme), gestion des membres (ajout de membres fantômes)
- Dépenses : ajout (split égal ou montants personnalisés, paiement par un membre), scan de reçu (upload photo → OCR backend, capture caméra native sur iPhone via `<input capture>`), détail (répartition, règlement individuel des soldes, duplication, suppression)
- Soldes : calcul "qui doit à qui" par groupe
- Stats : vue d'ensemble simple par groupe
- Réglages : profil, devise, préférences de notifications (stockées côté backend), export de données, suppression de compte, déconnexion
- PWA : manifest, icônes, mode standalone, safe-area iPhone (encoche/Dynamic Island)

## Limites connues / à compléter dans une prochaine itération
- **Notifications push** : impossible en PWA Safari classique sans Web Push dédié — actuellement désactivées côté web (message explicatif affiché), à activer via Apple Push to Web Apps si besoin.
- **OCR détaillé / correction d'items ligne par ligne** : le scan remplit la description et le montant total automatiquement, mais l'écran d'édition fine des articles scannés (assignation item par item, comme `AddExpenseScreen`/`OcrScanScreen` côté mobile) n'est pas encore porté — actuellement on peut seulement faire un split EQUAL ou CUSTOM.
- **i18n multilingue** (fr/en/de/es/it) : l'app mobile gère 5 langues, la version web n'a pour l'instant que le français (comme `layout.tsx` fourni). Facile à ajouter ensuite avec `i18n-js` ou `next-intl`.
- **Édition d'une dépense existante** (`PUT /expenses/:id/items`) : endpoint backend disponible mais pas encore câblé sur une page d'édition dédiée.

Tout le reste (auth, groupes, dépenses simples, soldes, réglages) est fonctionnel de bout en bout avec le vrai backend.
