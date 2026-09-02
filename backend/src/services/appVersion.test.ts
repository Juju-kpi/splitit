// backend/src/services/appVersion.test.ts
// Test autonome du verdict de mise a jour (aucune base requise).
// Lancer avec :  npx tsx src/services/appVersion.test.ts

import { compareVersions, isVersion, checkVersion, appVersionInfo } from './appVersion';

let passed = 0, failed = 0;
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

console.log('\n1) comparaison de versions');
assert(compareVersions('1.2.2', '1.2.3') === -1, '1.2.2 < 1.2.3');
assert(compareVersions('1.3.0', '1.2.9') === 1, '1.3.0 > 1.2.9');
assert(compareVersions('1.2.2', '1.2.2') === 0, 'egales');
assert(compareVersions('1.10.0', '1.9.0') === 1,
       '1.10.0 > 1.9.0 — comparaison numerique, pas alphabetique');
assert(compareVersions('2.0.0', '1.99.99') === 1, 'le majeur prime');
assert(compareVersions('1.3', '1.3.0') === 0, 'un segment manquant vaut 0');
assert(compareVersions('1.3.0-beta.2', '1.3.0') === 0, 'le suffixe est ignore');

console.log('\n2) ce qui ressemble a une version');
assert(isVersion('1.2.2'), '1.2.2');
assert(isVersion('1.3.0-beta'), 'avec suffixe');
assert(!isVersion(''), 'chaine vide');
assert(!isVersion(undefined), 'absente');
assert(!isVersion('nightly'), 'texte libre');

console.log('\n3) le verdict');
assert(checkVersion('1.2.2', '1.3.0', '1.0.0') === 'update-available',
       'en retard sur le store : on propose');
assert(checkVersion('1.3.0', '1.3.0', '1.0.0') === 'ok', 'a jour : rien');
assert(checkVersion('1.4.0', '1.3.0', '1.0.0') === 'ok',
       'en avance (build interne) : on ne propose rien');
assert(checkVersion('0.9.0', '1.3.0', '1.0.0') === 'update-required',
       'sous le minimum : on bloque');
assert(checkVersion('1.0.0', '1.3.0', '1.0.0') === 'update-available',
       'pile au minimum : on propose, on ne bloque pas');

console.log('\n4) en cas de doute, on ne bloque jamais');
assert(checkVersion('', '1.3.0', '1.3.0') === 'ok', 'version installee inconnue');
assert(checkVersion('nightly', '1.3.0', '1.3.0') === 'ok', 'version illisible');
assert(checkVersion('1.2.2', '', '') === 'ok', 'aucun seuil configure');
assert(checkVersion('1.2.2', 'oups', 'oups') === 'ok', 'seuils mal renseignes');

console.log('\n5) la reponse de l API');
let info = appVersionInfo('1.2.2', {
  APP_LATEST_VERSION: '1.3.0', APP_MIN_VERSION: '1.0.0',
  APP_ANDROID_URL: 'https://play.google.com/store/apps/details?id=com.julien.splitit',
  APP_UPDATE_NOTES: 'Nouvelle identite visuelle.',
} as any);
assert(info.status === 'update-available' && info.latest === '1.3.0'
    && info.android?.includes('play.google.com') === true && info.notes !== null,
       'seuils, lien et message remontent');
assert(info.ios === null, 'un lien non renseigne vaut null, pas une chaine vide');

info = appVersionInfo('1.2.2', {} as any);
assert(info.status === 'ok' && info.latest === null && info.minimum === null,
       'environnement vide : rien n est annonce, l application n est pas genee');

info = appVersionInfo(undefined, { APP_LATEST_VERSION: '9.9.9', APP_MIN_VERSION: '9.9.9' } as any);
assert(info.status === 'ok',
       'un client qui n envoie pas sa version n est jamais bloque');

console.log('');
console.log('6) un blocage sans lien vers le store enfermerait l utilisateur');
// L ecran de mise a jour obligatoire n affiche aucun bouton quand il n a pas
// d adresse ou envoyer : le retour Android est neutralise, l app devient
// inutilisable. Tant qu aucun store n est renseigne, on se contente de
// proposer. La garde vit cote serveur : c est le seul levier qui atteigne
// les applications deja installees.
info = appVersionInfo('1.0.0', { APP_LATEST_VERSION: '1.3.0', APP_MIN_VERSION: '1.2.0' } as any);
assert(info.status === 'update-available',
       'seuil bloquant mais aucun store : on propose au lieu d enfermer');

info = appVersionInfo('1.0.0', {
  APP_LATEST_VERSION: '1.3.0', APP_MIN_VERSION: '1.2.0',
  APP_ANDROID_URL: 'https://play.google.com/store/apps/details?id=com.julien.splitit',
} as any);
assert(info.status === 'update-required',
       'avec un lien Play Store, le blocage reprend ses droits');

info = appVersionInfo('1.0.0', {
  APP_LATEST_VERSION: '1.3.0', APP_MIN_VERSION: '1.2.0',
  APP_IOS_URL: 'https://apps.apple.com/app/id000000',
} as any);
assert(info.status === 'update-required', 'un lien App Store suffit aussi');

info = appVersionInfo('1.3.0', { APP_LATEST_VERSION: '1.3.0', APP_MIN_VERSION: '9.9.9' } as any);
assert(info.status === 'ok',
       'a jour mais sous un minimum absurde et sans store : on ne dit rien');

console.log(`\n${passed} réussis, ${failed} échoués\n`);
process.exit(failed > 0 ? 1 : 0);
