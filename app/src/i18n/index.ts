// app/src/i18n/index.ts — NOUVEAU FICHIER
// Setup i18n avec expo-localization + i18n-js
// Langues : fr (défaut), en, de, es, it

import { I18n } from 'i18n-js';
import * as Localization from 'expo-localization';

import fr from './locales/fr';
import en from './locales/en';
import de from './locales/de';
import es from './locales/es';
import it from './locales/it';

const i18n = new I18n({ fr, en, de, es, it });

// Langue du device, fallback fr
i18n.locale = Localization.getLocales()[0]?.languageCode ?? 'fr';
i18n.enableFallback = true;
i18n.defaultLocale = 'fr';

export default i18n;

// Hook pratique
export function t(key: string, options?: Record<string, any>) {
  return i18n.t(key, options);
}
