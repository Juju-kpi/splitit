// store/build-metadata.mjs
//
// Transforme store/play-store-listings.md en l'arborescence attendue par
// `fastlane supply`, qui publie les fiches via l'API Google Play Developer.
//
//   node store/build-metadata.mjs
//
// Le markdown reste la source : on l'edite, on relance, on republie. Ecrire
// les .txt a la main finirait par les desynchroniser du texte relu.

import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, 'play-store-listings.md');
const OUT = join(here, '..', 'fastlane', 'metadata', 'android');

// Les intitules varient avec la langue de la section — d'ou les alternatives.
const FIELDS = [
  { file: 'title.txt', limit: 30,
    labels: ['Titre', 'Title', 'Título', 'Titel', 'Titolo'] },
  { file: 'short_description.txt', limit: 80,
    labels: ['Description courte', 'Short description', 'Descripción corta',
             'Kurzbeschreibung', 'Descrizione breve'] },
  { file: 'full_description.txt', limit: 4000,
    labels: ['Description longue', 'Full description', 'Descripción completa',
             'Vollständige Beschreibung', 'Descrizione completa'] },
];

const md = readFileSync(SRC, 'utf8');

// Chaque section « ## Nom (locale) » devient un dossier de langue.
const sections = md.split(/^## /m).slice(1);
let written = 0;
const problems = [];

rmSync(OUT, { recursive: true, force: true });

for (const section of sections) {
  const header = section.split('\n', 1)[0];
  const locale = header.match(/\(([a-z]{2}-[A-Z]{2})\)/)?.[1];
  if (!locale) continue;                       // section libre (captures, notes)

  mkdirSync(join(OUT, locale), { recursive: true });

  for (const { file, limit, labels } of FIELDS) {
    const alt = labels.map(l => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    // Le compteur entre parentheses est facultatif : il n'existe que sur les
    // champs courts, ou il sert de garde-fou a la relecture.
    const re = new RegExp(`\\*\\*(?:${alt})\\*\\*(?: \\(\\d+\\))?\\n\`\`\`\\n([\\s\\S]*?)\\n\`\`\``);
    const value = section.match(re)?.[1];
    if (value == null) {
      problems.push(`${locale} : ${file} introuvable`);
      continue;
    }
    if (value.length > limit) {
      problems.push(`${locale} : ${file} fait ${value.length} caracteres, limite ${limit}`);
      continue;
    }
    writeFileSync(join(OUT, locale, file), value + '\n', 'utf8');
    written++;
  }
  console.log(`  ${locale}`);
}

console.log(`\n${written} fichiers ecrits dans fastlane/metadata/android/`);
if (problems.length) {
  console.error('\nProblemes :');
  for (const p of problems) console.error('  ' + p);
  process.exit(1);
}
