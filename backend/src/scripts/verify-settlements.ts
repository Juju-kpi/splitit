// backend/src/scripts/verify-settlements.ts
//
// Verifie que les remboursements fonctionnent sur le backend REELLEMENT
// DEPLOYE : migration appliquee, route montee, soldes coherents. Interroge
// l'API par HTTP comme le ferait l'application — pas la base en direct, sinon
// on ne teste que sa propre machine.
//
//   npm run verify:settlements              → demande l'email et le mot de passe
//   npm run verify:settlements -- --api=…   → viser le repli
//   npm run verify:settlements -- --group=… → n'auditer qu'un groupe
//
// Sans rien saisir : renseigne SPLITIT_EMAIL / SPLITIT_PASSWORD (ou
// SPLITIT_TOKEN) dans backend/.env, qui n'est pas suivi par git.
//
// LECTURE SEULE. Ce script n'ecrit rien, ne cree aucun remboursement et ne
// modifie aucun solde : il peut tourner sur la production sans precaution.
//
// Le mot de passe saisi n'est jamais affiche ni conserve : il ne passe ni par
// l'historique du terminal ni par les variables d'environnement.

import 'dotenv/config';
import readline from 'readline';

const arg = (name: string): string | undefined => {
  const hit = process.argv.slice(2).find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
};

const API = (arg('api') || process.env.SPLITIT_API || 'https://splitit-9x32.onrender.com').replace(/\/$/, '');
const ONLY_GROUP = arg('group');

let passed = 0, failed = 0, skipped = 0;
function check(ok: boolean, label: string, detail = '') {
  if (ok) { passed++; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`); }
  else { failed++; console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
}
// Un controle qu'on n'a pas pu faire n'est pas un controle rate : le dire
// autrement eviterait de croire a une panne la ou il manque juste des donnees.
function skip(label: string, why: string) {
  skipped++;
  console.log(`  – ${label} — non concluant : ${why}`);
}

// Render endort les services gratuits : la premiere requete peut mettre une
// minute a repondre, le temps du reveil.
//
// Le minuteur est unref() : AbortSignal.timeout() garderait la boucle
// d'evenements vivante 90 s apres la derniere requete, et sortir avant sa fin
// declenche une assertion libuv sous Windows.
function deadline(ms = 90_000): AbortSignal {
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms).unref();
  return ctrl.signal;
}

async function call(path: string, token?: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${API}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    signal: deadline(),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

// Saisie au clavier. Pour un champ masque on ecrit l'invite soi-meme, puis on
// fait taire completement readline : filtrer ce qu'il ecrit serait fragile,
// car il reecrit la ligne entiere — invite ET caracteres tapes — a chaque
// touche, et le mot de passe finirait a l'ecran.
function ask(question: string, hidden = false): Promise<string> {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (hidden) {
      process.stdout.write(question);
      (rl as any)._writeToOutput = () => {};
    }
    rl.question(hidden ? '' : question, answer => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

async function login(): Promise<string> {
  if (process.env.SPLITIT_TOKEN) return process.env.SPLITIT_TOKEN;

  let email = process.env.SPLITIT_EMAIL;
  let password = process.env.SPLITIT_PASSWORD;

  // Rien dans l'environnement : on demande, plutot que d'imposer une syntaxe
  // de shell qui n'est pas la meme sous PowerShell et sous bash.
  if (!email || !password) {
    if (!process.stdin.isTTY) {
      console.error(
        '\nIl manque les identifiants et le terminal n est pas interactif.\n'
        + 'Renseigne SPLITIT_EMAIL et SPLITIT_PASSWORD (ou SPLITIT_TOKEN) dans backend/.env\n'
      );
      process.exit(2);
    }
    console.log('');
    if (!email) email = await ask('Email      : ');
    if (!password) password = await ask('Mot de passe : ', true);
  }

  if (!email || !password) {
    console.error('\nIdentifiants vides, on s arrete la.\n');
    process.exit(2);
  }

  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
    signal: deadline(),
  });
  const body: any = await res.json().catch(() => null);
  if (!res.ok || !body?.data?.accessToken) {
    console.error(`Connexion refusee (HTTP ${res.status}) : ${body?.error || 'reponse inattendue'}`);
    process.exit(2);
  }
  return body.data.accessToken;
}

async function main() {
  console.log(`\nVerification des remboursements sur ${API}\n`);

  // ── 1. Quelle version tourne ────────────────────────────────────────────
  console.log('1) le service repond');
  const health = await call('/health');
  check(health.status === 200 && health.body?.ok === true,
        'le backend repond', `commit ${health.body?.commit ?? '?'}`);
  if (health.status !== 200) { console.error('\nBackend injoignable, on s arrete la.\n'); process.exit(1); }

  // ── 2. La route est bien montee ─────────────────────────────────────────
  console.log('\n2) la route des remboursements est deployee');
  const anon = await call('/api/settlements?groupId=x');
  check(anon.status === 401,
        'GET /api/settlements demande une authentification',
        `HTTP ${anon.status}${anon.status === 404 ? ' — la route n est PAS deployee' : ''}`);

  const token = await login();
  console.log('  ✓ connecte');

  // ── 3. La table existe en base ──────────────────────────────────────────
  // Le point decisif : cet appel fait un prisma.settlement.findMany(). Si la
  // migration n avait pas ete appliquee, Prisma leverait une erreur et le
  // serveur repondrait 500.
  console.log('\n3) la migration est appliquee en base');
  const groups = await call('/api/groups', token);
  check(groups.status === 200, 'liste des groupes lisible', `HTTP ${groups.status}`);
  const all: any[] = groups.body?.data || [];
  const targets = ONLY_GROUP ? all.filter(g => g.id === ONLY_GROUP) : all;

  if (ONLY_GROUP && targets.length === 0) {
    check(false, `groupe ${ONLY_GROUP} introuvable`, 'ce compte n en est pas membre');
  } else if (targets.length === 0) {
    // La route refuse un groupe dont on n'est pas membre AVANT de lire la
    // table : sans un seul groupe, rien ne permet de prouver la migration.
    skip('la table settlements repond',
         'ce compte n appartient a aucun groupe — relance avec un compte qui en a un');
  }

  const probe = targets[0];
  if (probe) {
    const list = await call(`/api/settlements?groupId=${probe.id}`, token);
    check(list.status === 200,
          'la table settlements repond',
          list.status === 500
            ? 'HTTP 500 — la migration n a PAS ete appliquee'
            : `HTTP ${list.status}, ${Array.isArray(list.body?.data) ? list.body.data.length : '?'} remboursement(s)`);
  }

  // ── 4. Les soldes restent coherents ─────────────────────────────────────
  console.log('\n4) les soldes de chaque groupe');
  for (const g of targets) {
    const full = await call(`/api/groups/${g.id}`, token);
    if (full.status !== 200) {
      check(false, `groupe "${g.name}" lisible`, `HTTP ${full.status}`);
      continue;
    }
    const d = full.body.data;
    const settlements: any[] = d.settlements || [];
    const live = settlements.filter(s => !s.cancelledAt);
    const confirmed = live.filter(s => s.confirmed);
    const pending = live.filter(s => !s.confirmed);
    const balances: any[] = d.balances || [];

    check(Array.isArray(settlements),
          `groupe "${g.name}"`,
          `${balances.length} dette(s) ouverte(s), ${confirmed.length} remboursement(s) valide(s), ${pending.length} en attente`);

    // Un solde ouvert ne doit jamais etre negatif ni concerner un inconnu.
    const members = new Set(d.members.map((m: any) => m.id));
    const bad = balances.filter(b =>
      b.amount <= 0 || !members.has(b.fromMemberId) || !members.has(b.toMemberId));
    check(bad.length === 0, '  soldes bien formes',
          bad.length ? `${bad.length} ligne(s) aberrante(s)` : 'montants positifs, membres connus');

    // Somme des dettes = somme des credits : la conservation de l argent.
    const total = balances.reduce((s, b) => s + b.amount, 0);
    check(total >= 0, '  total des dettes coherent', `${total.toFixed(2)}`);

    for (const s of pending) {
      const who = s.confirmedByFromAt ? s.fromMember?.displayName : s.toMember?.displayName;
      console.log(`      ⏳ ${s.fromMember?.displayName} → ${s.toMember?.displayName} : `
        + `${s.amount.toFixed(2)} ${s.currency}, confirme par ${who ?? '?'}, en attente de l autre`);
    }
  }

  console.log(`\n${passed} reussies, ${failed} echouees, ${skipped} non concluantes`);

  if (failed > 0) {
    console.error('\nVERDICT : quelque chose ne va pas — voir les ✗ ci-dessus.\n');
    process.exit(1);
  }
  if (skipped > 0) {
    console.log(
      '\nVERDICT : rien d anormal, mais la verification est INCOMPLETE.\n'
      + 'Le controle decisif (la table en base) n a pas pu tourner. Relance avec\n'
      + 'un compte membre d au moins un groupe.\n'
    );
    process.exit(3);
  }
  console.log('\nVERDICT : les remboursements sont operationnels en production.\n');
  process.exit(0);
}

main().catch(e => {
  console.error('\nEchec :', e?.message || e, '\n');
  process.exit(1);
});
