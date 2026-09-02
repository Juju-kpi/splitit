// store/build-privacy.mjs
//
// Transforme les privacy-policy*.md en un module TypeScript consomme par la
// page /privacy du site. Les markdown restent la source unique : on les edite,
// on relance, la page suit.
//
//   node store/build-privacy.mjs
//
// Pourquoi generer plutot que lire le markdown a l'execution : le fichier vit
// a la racine du depot, hors du dossier deploye par Vercel. Un fs.readFile au
// build marcherait en local et casserait en production.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..');
const OUT = join(ROOT, 'splitit-web', 'src', 'content');

const LANGS = [
  { code: 'fr', file: 'privacy-policy.md',    label: 'Français' },
  { code: 'en', file: 'privacy-policy.en.md', label: 'English' },
  { code: 'es', file: 'privacy-policy.es.md', label: 'Español' },
  { code: 'de', file: 'privacy-policy.de.md', label: 'Deutsch' },
  { code: 'it', file: 'privacy-policy.it.md', label: 'Italiano' },
];

/** Decoupe le markdown en titre, date et sections. */
function parse(md) {
  const lines = md.split('\n');
  let title = '';
  let updated = '';
  const sections = [];
  let current = null;

  const flush = () => { if (current) sections.push(current); };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.startsWith('# ')) { title = line.slice(2).trim(); continue; }
    if (/^\*[^*].*\*$/.test(line)) { updated = line.slice(1, -1).trim(); continue; }
    if (line.startsWith('## ')) {
      flush();
      current = { heading: line.slice(3).trim(), blocks: [] };
      continue;
    }
    if (!current) continue;

    if (line.startsWith('- ')) {
      const last = current.blocks[current.blocks.length - 1];
      const item = line.slice(2).trim();
      if (last?.type === 'ul') last.items.push(item);
      else current.blocks.push({ type: 'ul', items: [item] });
      continue;
    }
    if (line.trim()) current.blocks.push({ type: 'p', text: line.trim() });
  }
  flush();
  return { title, updated, sections };
}

const policies = {};
for (const { code, file, label } of LANGS) {
  const md = readFileSync(join(ROOT, file), 'utf8');
  policies[code] = { label, ...parse(md) };
  const n = policies[code].sections.length;
  console.log(`  ${code}  ${n} sections  « ${policies[code].title} »`);
  if (n !== 6) console.error(`     !! attendu 6 sections, trouve ${n}`);
}

mkdirSync(OUT, { recursive: true });
writeFileSync(
  join(OUT, 'privacy.ts'),
  `// GENERE PAR store/build-privacy.mjs — NE PAS EDITER A LA MAIN.
// La source est privacy-policy*.md a la racine du depot.
// Relancer :  node store/build-privacy.mjs

export type PolicyBlock =
  | { type: 'p'; text: string }
  | { type: 'ul'; items: string[] }

export interface Policy {
  label: string
  title: string
  updated: string
  sections: { heading: string; blocks: PolicyBlock[] }[]
}

export const PRIVACY_LANGS = ${JSON.stringify(LANGS.map(l => l.code))} as const
export type PolicyLang = (typeof PRIVACY_LANGS)[number]

export const PRIVACY: Record<PolicyLang, Policy> = ${JSON.stringify(policies, null, 2)}
`,
  'utf8',
);
console.log(`\nsplitit-web/src/content/privacy.ts ecrit`);
