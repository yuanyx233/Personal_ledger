import { useCallback } from "react";

import { formatMoney } from "../lib/money";
import { useTranslation } from "./useTranslation";

// Binds money formatting to the active interface language so grouping and decimal
// separators follow it, while the stored value and its currency do not change.
export function useMoney() {
  const { language } = useTranslation();
  return useCallback(
    (amountMinor: number, currency: string) => formatMoney(amountMinor, currency, language),
    [language],
  );
}
