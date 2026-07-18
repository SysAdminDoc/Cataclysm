import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  LANGUAGE_TAGS,
  readStoredLocale,
  translate,
  type Locale,
  type MessageKey,
} from "./i18n-core";

type I18nContextValue = {
  locale: Locale;
  languageTag: string;
  t: (key: MessageKey, values?: Record<string, string | number>) => string;
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string;
};

const DEFAULT_CONTEXT: I18nContextValue = {
  locale: "en",
  languageTag: LANGUAGE_TAGS.en,
  t: (key, values) => translate("en", key, values),
  formatNumber: (value, options) => value.toLocaleString(LANGUAGE_TAGS.en, options),
};

const I18nContext = createContext<I18nContextValue>(DEFAULT_CONTEXT);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(readStoredLocale);
  useEffect(() => {
    const refresh = () => setLocale(readStoredLocale());
    window.addEventListener("tsunamisim:settings-saved", refresh);
    return () => window.removeEventListener("tsunamisim:settings-saved", refresh);
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = "ltr";
  }, [locale]);
  const value = useMemo<I18nContextValue>(() => ({
    locale,
    languageTag: LANGUAGE_TAGS[locale],
    t: (key, values) => translate(locale, key, values),
    formatNumber: (number, options) => number.toLocaleString(LANGUAGE_TAGS[locale], options),
  }), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

// The provider and its hook intentionally share a module so consumers cannot
// import a second context instance during hot reload.
// eslint-disable-next-line react-refresh/only-export-components
export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
