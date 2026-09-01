// backend/src/scripts/backup-db.ts
//
// Sauvegarde COMPLÈTE de la base dans un fichier JSON sur ton ordinateur.
// Aucune installation nécessaire (pas de pg_dump, pas de Docker) : le script
// lit tout via Prisma et écrit un seul fichier.
//
//   npx tsx src/scripts/backup-db.ts
//   npx tsx src/scripts/backup-db.ts --out=C:\sauvegardes\splitit.json
//
// Le fichier contient toutes les tables métier : utilisateurs (sans mot de
// passe utilisable pour se connecter — le hash est conservé tel quel, ne le
// partage pas), groupes, membres, dépenses, articles, assignations, parts et
// paiements. Il sert de filet avant une correction, et de référence si tu
// veux vérifier une valeur d'avant.
//
// Pour annuler spécifiquement les montants modifiés par audit-splits --apply,
// utilise restore-amounts.ts avec ce fichier.

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { prisma } from '../db';

const args = process.argv.slice(2);
const outArg = args.find(a => a.startsWith('--out='));

function defaultName(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `splitit-backup-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
       + `-${p(d.getHours())}${p(d.getMinutes())}.json`;
}

async function main() {
  const outPath = path.resolve(outArg ? outArg.slice('--out='.length) : defaultName());
  console.log('\n📦 Sauvegarde en cours…\n');

  // SQL brut plutot que le client type : la sauvegarde reste possible meme
  // quand le schema Prisma a pris de l'avance sur la base (migration en
  // attente), ce qui est precisement le moment ou l'on en a besoin.
  const dumpTable = (table: string) => prisma.$queryRawUnsafe<any[]>(`SELECT * FROM "${table}"`);

  const [
    users, groups, groupMembers, expenses,
    expenseItems, expenseItemAssignments, expenseSplits, expensePayments,
  ] = await Promise.all([
    dumpTable('users'),
    dumpTable('groups'),
    dumpTable('group_members'),
    dumpTable('expenses'),
    dumpTable('expense_items'),
    dumpTable('expense_item_assignments'),
    dumpTable('expense_splits'),
    dumpTable('expense_payments'),
  ]);

  const dump = {
    exportedAt: new Date().toISOString(),
    schema: 'splitit',
    tables: {
      users, groups, groupMembers, expenses,
      expenseItems, expenseItemAssignments, expenseSplits, expensePayments,
    },
  };

  fs.writeFileSync(outPath, JSON.stringify(dump, null, 2), 'utf-8');

  const rows = [
    ['utilisateurs', users.length],
    ['groupes', groups.length],
    ['membres', groupMembers.length],
    ['dépenses', expenses.length],
    ['articles', expenseItems.length],
    ['assignations', expenseItemAssignments.length],
    ['parts', expenseSplits.length],
    ['paiements', expensePayments.length],
  ] as const;

  for (const [label, count] of rows) {
    console.log(`   ${label.padEnd(16)} ${String(count).padStart(6)}`);
  }

  const size = (fs.statSync(outPath).size / 1024).toFixed(0);
  console.log(`\n✅ ${outPath}  (${size} Ko)\n`);
  console.log('Garde ce fichier hors du dépôt git : il contient des données personnelles.\n');

  await prisma.$disconnect();
}

main().catch(async e => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
