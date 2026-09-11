import {
  categoriesResponseSchema,
  transactionDetailResponseSchema,
  type CategoriesResponse,
  type TransactionDetailResponse,
} from "@ledger/domain/api-contracts";
import { useCallback, useEffect, useState } from "react";

import { readApi } from "../../lib/browser-api";

type DetailReadyData = {
  categories: CategoriesResponse["data"]["categories"];
  transaction: TransactionDetailResponse["data"]["transaction"];
};

type DetailState =
  { status: "error" } | { status: "loading" } | ({ status: "ready" } & DetailReadyData);

async function readDetail(transactionId: string, signal?: AbortSignal): Promise<DetailReadyData> {
  const [detail, taxonomy] = await Promise.all([
    readApi(
      `/api/v1/transactions/${encodeURIComponent(transactionId)}`,
      transactionDetailResponseSchema,
      signal,
    ),
    readApi("/api/v1/categories", categoriesResponseSchema, signal),
  ]);
  return {
    categories: taxonomy.data.categories,
    transaction: detail.data.transaction,
  };
}

export function useTransactionDetail(transactionId: string) {
  const [state, setState] = useState<DetailState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    void readDetail(transactionId, controller.signal)
      .then((data) => setState({ ...data, status: "ready" }))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setState({ status: "error" });
        }
      });
    return () => controller.abort();
  }, [transactionId]);

  const refresh = useCallback(async () => {
    const data = await readDetail(transactionId);
    setState({ ...data, status: "ready" });
  }, [transactionId]);

  return { refresh, state };
}
