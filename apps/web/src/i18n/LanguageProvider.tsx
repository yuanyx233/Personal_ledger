import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { LanguageContext, type LanguageContextValue } from "./context";
import { LANGUAGE_STORAGE_KEY, initialLanguage, translate, type Language } from "./index";

// Storage can throw in a private window or with site data blocked, and the choice
// is only a per-device convenience, so neither read nor write may break the page.
function readStoredLanguage(): string | null {
  try {
    return window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeLanguage(language: Language): void {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
  } catch {
    // Ignored: the interface still works, it just will not remember the choice.
  }
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() =>
    initialLanguage(readStoredLanguage(), navigator.languages ?? [navigator.language]),
  );

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    storeLanguage(next);
  }, []);

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      setLanguage,
      t: (key, values) => translate(language, key, values),
    }),
    [language, setLanguage],
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}
