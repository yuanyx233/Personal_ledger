import { PlaidAdapterError } from "./client";
import type {
  PlaidRemovedTransaction,
  PlaidTransaction,
  PlaidTransactionSyncPage,
} from "./transactions";

const MAXIMUM_PAGES_PER_BATCH = 100;
const MAXIMUM_MUTATION_RESTARTS = 2;

export type { PlaidRemovedTransaction, PlaidTransaction, PlaidTransactionSyncPage };

export interface PlaidTransactionSyncBatch {
  added: PlaidTransaction[];
  finalCursor: string;
  initialCursor: string | null;
  modified: PlaidTransaction[];
  removed: PlaidRemovedTransaction[];
}

export interface TransactionSyncResult {
  addedCount: number;
  finalCursor: string;
  modifiedCount: number;
  pageCount: number;
  removedCount: number;
}

export interface RunTransactionSyncInput {
  accessToken: string;
  fetchPage: (input: {
    accessToken: string;
    cursor: string | null;
  }) => Promise<PlaidTransactionSyncPage>;
  initialCursor: string | null;
  maximumPages?: number;
  persist: (batch: PlaidTransactionSyncBatch) => Promise<void>;
}

export async function runTransactionSync({
  accessToken,
  fetchPage,
  initialCursor,
  maximumPages = MAXIMUM_PAGES_PER_BATCH,
  persist,
}: RunTransactionSyncInput): Promise<TransactionSyncResult> {
  if (
    !Number.isInteger(maximumPages) ||
    maximumPages < 1 ||
    maximumPages > MAXIMUM_PAGES_PER_BATCH
  ) {
    throw new PlaidAdapterError("INVALID_CONFIGURATION");
  }
  let mutationRestarts = 0;
  let totalPageRequests = 0;

  while (true) {
    const added: PlaidTransaction[] = [];
    const modified: PlaidTransaction[] = [];
    const removed: PlaidRemovedTransaction[] = [];
    let cursor = initialCursor;
    let pageCount = 0;

    try {
      while (true) {
        pageCount += 1;
        totalPageRequests += 1;
        if (totalPageRequests > maximumPages) {
          throw new PlaidAdapterError("UPSTREAM_UNAVAILABLE");
        }

        const page = await fetchPage({ accessToken, cursor });
        added.push(...page.added);
        modified.push(...page.modified);
        removed.push(...page.removed);

        if (!page.hasMore) {
          cursor = page.nextCursor;
          break;
        }
        if (page.nextCursor.length === 0 || page.nextCursor === cursor) {
          throw new PlaidAdapterError("UPSTREAM_UNAVAILABLE");
        }
        cursor = page.nextCursor;
      }
    } catch (error) {
      if (
        error instanceof PlaidAdapterError &&
        error.code === "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION" &&
        mutationRestarts < MAXIMUM_MUTATION_RESTARTS
      ) {
        mutationRestarts += 1;
        continue;
      }
      throw error;
    }

    await persist({
      added,
      finalCursor: cursor,
      initialCursor,
      modified,
      removed,
    });

    return {
      addedCount: added.length,
      finalCursor: cursor,
      modifiedCount: modified.length,
      pageCount,
      removedCount: removed.length,
    };
  }
}
