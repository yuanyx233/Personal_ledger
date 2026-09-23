import { createContext } from "react";

import type { Language, TranslationKey } from "./index";

export interface LanguageContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: TranslationKey, values?: Record<string, string | number>) => string;
}

// Kept apart from the provider component so fast refresh can still reload it.
export const LanguageContext = createContext<LanguageContextValue | null>(null);
