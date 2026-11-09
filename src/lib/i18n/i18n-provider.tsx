"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import { defaultLocale, locales, LOCALE_COOKIE, type Locale } from "@/lib/i18n/config";
import fr from "@/lib/i18n/messages/fr.json";
import en from "@/lib/i18n/messages/en.json";

const messages: Record<Locale, AbstractIntlMessages> = { fr, en };

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  locales: readonly Locale[];
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

function getInitialLocale(): Locale {
  if (typeof document !== "undefined") {
    const match = document.cookie.match(new RegExp(`(?:^|; )${LOCALE_COOKIE}=([^;]*)`));
    const stored = match?.[1] as Locale | undefined;
    if (stored && locales.includes(stored)) return stored;
    const browser = navigator.language.slice(0, 2).toLowerCase();
    if (locales.includes(browser as Locale)) return browser as Locale;
  }
  return defaultLocale;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(defaultLocale);

  // Hydrate from cookie/browser on mount.
  useEffect(() => {
    setLocaleState(getInitialLocale());
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    document.cookie = `${LOCALE_COOKIE}=${next};path=/;max-age=${60 * 60 * 24 * 365};samesite=lax`;
    document.documentElement.lang = next;
  }, []);

  // Keep <html lang> in sync.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <I18nContext.Provider value={{ locale, setLocale, locales }}>
      <NextIntlClientProvider locale={locale} messages={messages[locale]} timeZone="Africa/Kinshasa">
        {children}
      </NextIntlClientProvider>
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
