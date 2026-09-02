// store/publish-listings.mjs
//
// Publie les fiches Play Store dans les 5 langues via l'API Google Play
// Developer. Remplace `fastlane supply`, qui demanderait Ruby.
//
//   node store/publish-listings.mjs --key "C:/chemin/vers/cle.json"
//        → simulation : montre ce qui changerait, n'ecrit rien
//
//   node store/publish-listings.mjs --key "..." --commit
//        → publie pour de bon
//
// La simulation est le defaut par choix : une fiche est ce que voient tes
// utilisateurs, et une modification passe en revue chez Google. Mieux vaut
// relire avant d'envoyer.
//
// Prerequis : un compte de service Google Cloud invite dans Play Console
// (Utilisateurs et autorisations) avec le droit de modifier la fiche.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { google } from 'googleapis';

const here = dirname(fileURLToPath(import.meta.url));
const META = join(here, '..', 'fastlane', 'metadata', 'android');
const PACKAGE_NAME = 'com.julien.splitit';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};
const keyFile = arg('key') || process.env.PLAY_SERVICE_ACCOUNT;
const commit = process.argv.includes('--commit');

if (!keyFile) {
  console.error(`
Il manque la cle du compte de service.

  node store/publish-listings.mjs --key "C:/chemin/vers/cle.json"

ou renseigne PLAY_SERVICE_ACCOUNT dans l'environnement.
`);
  process.exit(2);
}
if (!existsSync(keyFile)) {
  console.error(`Cle introuvable : ${keyFile}`);
  process.exit(2);
}

// ── Lecture des fiches ────────────────────────────────────────────────────
const LIMITS = { title: 30, shortDescription: 80, fullDescription: 4000 };

function readLocale(locale) {
  const read = (f) => readFileSync(join(META, locale, f), 'utf8').replace(/\n+$/, '');
  return {
    language: locale,
    title: read('title.txt'),
    shortDescription: read('short_description.txt'),
    fullDescription: read('full_description.txt'),
  };
}

const locales = readdirSync(META).filter((d) => /^[a-z]{2}-[A-Z]{2}$/.test(d));
if (locales.length === 0) {
  console.error('Aucune langue dans fastlane/metadata/android — lance d\'abord :');
  console.error('  node store/build-metadata.mjs');
  process.exit(2);
}

const listings = locales.map(readLocale);

// Verification avant tout appel reseau : un depassement doit echouer ici,
// pas au milieu d'une modification a moitie envoyee.
let invalid = false;
for (const l of listings) {
  for (const [field, limit] of Object.entries(LIMITS)) {
    // Google compte des caracteres, pas des octets — un tiret cadratin en
    // pese trois, ce qui rend `wc -c` trompeur.
    if ([...l[field]].length > limit) {
      console.error(`${l.language} : ${field} fait ${[...l[field]].length} caracteres, limite ${limit}`);
      invalid = true;
    }
  }
}
if (invalid) process.exit(1);

// ── Publication ───────────────────────────────────────────────────────────
const auth = new google.auth.GoogleAuth({
  keyFile,
  scopes: ['https://www.googleapis.com/auth/androidpublisher'],
});
const publisher = google.androidpublisher({ version: 'v3', auth });

console.log(`\n${commit ? 'Publication' : 'Simulation'} — ${PACKAGE_NAME}\n`);

let edit;
try {
  const res = await publisher.edits.insert({ packageName: PACKAGE_NAME });
  edit = res.data.id;
} catch (e) {
  const msg = e?.errors?.[0]?.message || e?.message || String(e);
  console.error(`Impossible d'ouvrir une modification : ${msg}\n`);
  if (/permission|forbidden|401|403/i.test(msg)) {
    console.error("Verifie que le compte de service est bien invite dans Play Console");
    console.error("(Utilisateurs et autorisations) avec le droit sur la fiche du store.\n");
  }
  process.exit(1);
}

try {
  for (const listing of listings) {
    // On lit l'existant pour montrer ce qui change reellement.
    let before = null;
    try {
      const res = await publisher.edits.listings.get({
        packageName: PACKAGE_NAME, editId: edit, language: listing.language,
      });
      before = res.data;
    } catch { /* la langue n'existe pas encore */ }

    const changed = Object.keys(LIMITS).filter((f) => (before?.[f] ?? '') !== listing[f]);
    const state = !before ? 'nouvelle' : changed.length ? changed.join(', ') : 'inchangee';
    console.log(`  ${listing.language.padEnd(7)} ${state}`);

    if (commit && (changed.length || !before)) {
      await publisher.edits.listings.update({
        packageName: PACKAGE_NAME, editId: edit, language: listing.language,
        requestBody: listing,
      });
    }
  }

  if (commit) {
    await publisher.edits.commit({ packageName: PACKAGE_NAME, editId: edit });
    console.log('\nPublie. Google passe la fiche en revue avant mise en ligne.\n');
  } else {
    await publisher.edits.delete({ packageName: PACKAGE_NAME, editId: edit });
    console.log('\nSimulation seulement — rien n\'a ete envoye.');
    console.log('Relance avec --commit pour publier.\n');
  }
} catch (e) {
  const msg = e?.errors?.[0]?.message || e?.message || String(e);
  console.error(`\nEchec : ${msg}\n`);
  try { await publisher.edits.delete({ packageName: PACKAGE_NAME, editId: edit }); } catch {}
  process.exit(1);
}
