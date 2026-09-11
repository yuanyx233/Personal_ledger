import {
  categoriesResponseSchema,
  merchantRuleListResponseSchema,
  type CategoriesResponse,
  type MerchantRuleListResponse,
} from "@ledger/domain/api-contracts";
import { useCallback, useEffect, useState } from "react";

import { readApi } from "../../lib/browser-api";

export interface SettingsData {
  categories: CategoriesResponse["data"]["categories"];
  rules: MerchantRuleListResponse["data"]["rules"];
}

type State = { status: "error" } | { status: "loading" } | ({ status: "ready" } & SettingsData);

async function readSettings(signal?: AbortSignal): Promise<SettingsData> {
  const [categories, rules] = await Promise.all([
    readApi("/api/v1/categories", categoriesResponseSchema, signal),
    readApi("/api/v1/merchant-rules?pageSize=100", merchantRuleListResponseSchema, signal),
  ]);
  return {
    categories: categories.data.categories,
    rules: rules.data.rules,
  };
}

export function useSettingsData() {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    void readSettings(controller.signal)
      .then((data) => setState({ ...data, status: "ready" }))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setState({ status: "error" });
        }
      });
    return () => controller.abort();
  }, []);

  const refresh = useCallback(async () => {
    const data = await readSettings();
    setState({ ...data, status: "ready" });
  }, []);
  return { refresh, retry: refresh, state };
}
