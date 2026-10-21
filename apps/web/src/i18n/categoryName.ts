import type { LanguageContextValue } from "./context";

export interface NameableCategory {
  editable: boolean;
  name: string;
  systemKey: "TRANSFER" | "UNCLASSIFIED" | null;
}

// Only the two immutable system categories are localised. Every other category —
// including the default taxonomy — is editable, so the owner may have renamed it,
// and translating it would overwrite that name with a guess (design D6).
export function categoryDisplayName(
  category: NameableCategory,
  t: LanguageContextValue["t"],
): string {
  if (category.systemKey !== null && !category.editable) {
    return t(`category.system.${category.systemKey}`);
  }
  return category.name;
}
