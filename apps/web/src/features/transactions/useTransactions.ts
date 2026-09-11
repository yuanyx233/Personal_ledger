import {
  transactionListResponseSchema,
  type TransactionListResponse,
} from "@ledger/domain/api-contracts";
import { useEffect, useState } from "react";

type TransactionLoadState =
  { status: "error" } | { status: "loading" } | { data: TransactionListResponse; status: "ready" };

function apiSearch(search: string): string {
  const parameters = new URLSearchParams(search);
  if (!parameters.has("pageSize")) parameters.set("pageSize", "25");
  if (!parameters.has("sort")) parameters.set("sort", "POSTED_DATE_DESC");
  return parameters.toString();
}

export function useTransactions() {
  const [search, setSearch] = useState(() => window.location.search);
  const [state, setState] = useState<TransactionLoadState>({ status: "loading" });

  useEffect(() => {
    const onPopState = () => setSearch(window.location.search);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/v1/transactions?${apiSearch(search)}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("TRANSACTION_LIST_FAILED");
        return transactionListResponseSchema.parse(await response.json());
      })
      .then((data) => setState({ data, status: "ready" }))
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setState({ status: "error" });
        }
      });
    return () => controller.abort();
  }, [search]);

  function navigate(parameters: URLSearchParams) {
    const query = parameters.toString();
    window.history.pushState(null, "", `/transactions${query ? `?${query}` : ""}`);
    setState({ status: "loading" });
    setSearch(query ? `?${query}` : "");
  }

  return { navigate, search: new URLSearchParams(search), state };
}
