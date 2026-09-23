import { useContext } from "react";

import { LanguageContext, type LanguageContextValue } from "./context";

export function useTranslation(): LanguageContextValue {
  const value = useContext(LanguageContext);
  if (value === null) {
    throw new Error("useTranslation must be used inside LanguageProvider");
  }
  return value;
}
