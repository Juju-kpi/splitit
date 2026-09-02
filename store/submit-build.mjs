// store/submit-build.mjs
//
// Envoie un .aab sur une piste du Play Store via l'API Google Play Developer.
//
//   node store/submit-build.mjs --key "C:/.../cle.json" --aab "C:/.../app.aab"
//        → simulation : verifie le fichier et la piste, n'envoie rien
//
//   node store/submit-build.mjs --key "..." --aab "..." --commit
//        → televerse et publie sur la piste
//
//   --track alpha        (defaut) « Tests fermes — Alpha »
//   --track internal     tests internes
//   --track beta         tests ouverts
//   --track production   production
//
// Le compte de service doit avoir le droit de publier sur les pistes de test,
// pas seulement de modifier la fiche : Play Console → Utilisateurs et
// autorisations → « Gerer les versions de test ».

import { createReadStream, existsSync, statSync } from 'node:fs';
import { google } from 'googleapis';

const PACKAGE_NAME = 'com.julien.splitit';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const keyFile = arg('key', process.env.PLAY_SERVICE_ACCOUNT);
const aab = arg('aab');
const track = arg('track', 'alpha');
const commit = process.argv.includes('--commit');

function bail(msg, code = 2) {
  console.error(`\n${msg}\n`);
  process.exit(code);
}

if (!keyFile) bail('Il manque la cle : --key "C:/chemin/vers/cle.json"');
if (!existsSync(keyFile)) bail(`Cle introuvable : ${keyFile}`);
if (!aab) bail('Il manque le bundle : --aab "C:/chemin/vers/app.aab"');
if (!existsSync(aab)) bail(`Bundle introuvable : ${aab}`);
if (!aab.endsWith('.aab')) {
  bail(`Ce n'est pas un App Bundle : ${aab}\nLe Play Store attend un .aab, pas un .apk.`);
}

const sizeMb = (statSync(aab).size / 1024 / 1024).toFixed(1);
console.log(`\n${commit ? 'Envoi' : 'Simulation'} — ${PACKAGE_NAME}`);
console.log(`  bundle : ${aab} (${sizeMb} Mo)`);
console.log(`  piste  : ${track}\n`);

const auth = new google.auth.GoogleAuth({
  keyFile,
  scopes: ['https://www.googleapis.com/auth/androidpublisher'],
});
const publisher = google.androidpublisher({ version: 'v3', auth });

const fail = (e, hint) => {
  const msg = e?.errors?.[0]?.message || e?.message || String(e);
  console.error(`\nEchec : ${msg}`);
  if (hint) console.error(hint);
  console.error('');
};

let edit;
try {
  const res = await publisher.edits.insert({ packageName: PACKAGE_NAME });
  edit = res.data.id;
} catch (e) {
  fail(e, "Le compte de service a-t-il ete invite dans Play Console\n"
        + "(Utilisateurs et autorisations) avec le droit de publier ?");
  process.exit(1);
}

try {
  if (!commit) {
    // On liste les pistes existantes : c'est la verification la plus utile
    // avant d'envoyer, elle confirme l'acces et le nom exact de la piste.
    const { data } = await publisher.edits.tracks.list({
      packageName: PACKAGE_NAME, editId: edit,
    });
    const names = (data.tracks || []).map(t => t.track);
    console.log(`  pistes accessibles : ${names.join(', ') || 'aucune'}`);
    if (!names.includes(track)) {
      console.log(`\n  Attention : la piste « ${track} » n'apparait pas.`);
      console.log('  Cree-la d\'abord dans Play Console, ou choisis-en une ci-dessus.');
    }
    await publisher.edits.delete({ packageName: PACKAGE_NAME, editId: edit });
    console.log('\nSimulation seulement — rien n\'a ete envoye.');
    console.log('Relance avec --commit pour televerser.\n');
    process.exit(0);
  }

  console.log('  televersement…');
  const { data: bundle } = await publisher.edits.bundles.upload({
    packageName: PACKAGE_NAME,
    editId: edit,
    media: { mimeType: 'application/octet-stream', body: createReadStream(aab) },
  });
  console.log(`  versionCode ${bundle.versionCode} recu`);

  await publisher.edits.tracks.update({
    packageName: PACKAGE_NAME,
    editId: edit,
    track,
    requestBody: {
      track,
      releases: [{ versionCodes: [String(bundle.versionCode)], status: 'completed' }],
    },
  });

  await publisher.edits.commit({ packageName: PACKAGE_NAME, editId: edit });
  console.log(`\nPublie sur « ${track} ». Les testeurs le verront apres la revue Google.\n`);
} catch (e) {
  fail(e, "Verifie que le versionCode est superieur a celui deja publie,\n"
        + "et que le compte de service peut publier sur les pistes de test.");
  try { await publisher.edits.delete({ packageName: PACKAGE_NAME, editId: edit }); } catch {}
  process.exit(1);
}
