import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../locales/en.json';
import zh from '../locales/zh.json';

function getSavedLanguage(): string {
  try {
    const stored = localStorage.getItem('cooktalk-app');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed?.state?.language) return parsed.state.language;
    }
  } catch {
    // ignore
  }
  return 'en';
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zh },
  },
  lng: getSavedLanguage(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

export default i18n;
