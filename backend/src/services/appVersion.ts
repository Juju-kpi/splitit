// backend/src/services/appVersion.ts
//
// Quelle version de l'application mobile tourne chez l'utilisateur, et
// faut-il l'inviter — ou l'obliger — a se mettre a jour.
//
// Les seuils viennent de l'environnement (Render), pas du code : annoncer une
// nouvelle version ne doit pas demander un redeploiement.
//   APP_LATEST_VERSION  version publiee sur le store, ex. "1.3.0"
//   APP_MIN_VERSION     en dessous, l'application est bloquee
//   APP_ANDROID_URL     lien Play Store
//   APP_IOS_URL         lien App Store
//   APP_UPDATE_NOTES    une phrase affichee dans le message

export type VersionVerdict = 'ok' | 'update-available' | 'update-required';

/**
 * Compare deux versions "1.2.10" facon semver : -1, 0 ou 1.
 * Les segments non numeriques ("1.3.0-beta.2") sont ignores apres le tiret ;
 * une version illisible vaut 0.0.0 plutot que de faire echouer la comparaison.
 */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => {
    const core = String(v ?? '').trim().split('-')[0];
    const nums = core.split('.').map(n => parseInt(n, 10));
    return [0, 1, 2].map(i => (Number.isFinite(nums[i]) ? nums[i] : 0));
  };
  const pa = parts(a), pb = parts(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

/** Une chaine de version exploitable ? "" et "abc" ne le sont pas. */
export function isVersion(v: string | undefined | null): boolean {
  return !!v && /^\d+(\.\d+)*(-.*)?$/.test(String(v).trim());
}

/**
 * Le verdict pour une version installee donnee.
 *
 * En cas de doute on repond toujours 'ok' : un seuil mal renseigne ne doit
 * jamais bloquer une application qui fonctionne.
 */
export function checkVersion(
  current: string | undefined | null,
  latest: string | undefined | null,
  minimum: string | undefined | null
): VersionVerdict {
  if (!isVersion(current)) return 'ok';
  if (isVersion(minimum) && compareVersions(current!, minimum!) < 0) return 'update-required';
  if (isVersion(latest) && compareVersions(current!, latest!) < 0) return 'update-available';
  return 'ok';
}

export interface AppVersionInfo {
  status: VersionVerdict;
  latest: string | null;
  minimum: string | null;
  android: string | null;
  ios: string | null;
  notes: string | null;
}

/** Ce que renvoie GET /api/app-version, a partir de l'environnement. */
export function appVersionInfo(current: string | undefined, env = process.env): AppVersionInfo {
  const latest = (env.APP_LATEST_VERSION || '').trim();
  const minimum = (env.APP_MIN_VERSION || '').trim();
  return {
    status: checkVersion(current, latest, minimum),
    latest: isVersion(latest) ? latest : null,
    minimum: isVersion(minimum) ? minimum : null,
    android: (env.APP_ANDROID_URL || '').trim() || null,
    ios: (env.APP_IOS_URL || '').trim() || null,
    notes: (env.APP_UPDATE_NOTES || '').trim() || null,
  };
}
