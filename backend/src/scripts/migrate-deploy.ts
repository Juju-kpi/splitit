// backend/src/scripts/migrate-deploy.ts
//
// Applique les migrations en attente :  npm run db:deploy
//
// Pourquoi ce script plutot que `prisma migrate deploy` directement :
// DATABASE_URL pointe sur le pooler Supabase en mode transaction (port 6543),
// qui ne supporte pas le verrou d'avis dont Prisma a besoin. Le mode session
// (meme hote, port 5432) fonctionne. On derive donc DIRECT_URL a la volee, au
// lieu de demander a chacun de retenir la manipulation.
//
// Les migrations ne sont volontairement PAS lancees au build : un deploiement
// ne doit pas dependre de la joignabilite de la base ni d'un verrou global.
// On applique la migration, on verifie, puis on deploie.

import 'dotenv/config';
import { execSync } from 'child_process';

function directUrl(): string {
  const raw = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!raw) {
    console.error('DATABASE_URL absente — renseigne backend/.env');
    process.exit(1);
  }
  const url = new URL(raw);
  if (url.port === '6543') url.port = '5432'; // transaction → session
  url.search = '';
  return url.toString();
}

const args = process.argv.slice(2);
const command = args.includes('--status') ? 'status' : 'deploy';

console.log(`\nprisma migrate ${command} — connexion directe (port 5432)\n`);

try {
  // `command` vient d'une liste fermee ci-dessus : rien d'injectable ici.
  execSync(`npx prisma migrate ${command}`, {
    stdio: 'inherit',
    env: { ...process.env, DIRECT_URL: directUrl() },
  });
} catch {
  process.exit(1);
}
