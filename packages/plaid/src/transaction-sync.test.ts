import { describe, expect, it, vi } from "vitest";

import { PlaidAdapterError } from "./client";
import {
  runTransactionSync,
  type PlaidTransactionSyncPage,
  type RunTransactionSyncInput,
} from "./transaction-sync";

function transaction(transactionId: string) {
  return {
    accountId: "plaid-account-1",
    amount: 12.34,
    authorizedDate: "2026-07-14",
    date: "2026-07-15",
    isoCurrencyCode: "CAD",
    merchantName: "Fixture Merchant",
    name: "Fixture purchase",
    paymentMetadata: {
      byOrderOf: null,
      payee: null,
      payer: null,
      paymentMethod: null,
      paymentProcessor: null,
      ppdId: null,
      reason: null,
      referenceNumber: null,
    },
    pending: false,
    pendingTransactionId: null,
    transactionId,
  };
}

function page(overrides: Partial<PlaidTransactionSyncPage> = {}): PlaidTransactionSyncPage {
  return {
    added: [],
    hasMore: false,
    modified: [],
    nextCursor: "cursor-final",
    removed: [],
    ...overrides,
  };
}

describe("Plaid transaction cursor loop", () => {
  it("performs an initial sync from a null cursor and commits only the final page", async () => {
    const fetchPage = vi
      .fn<RunTransactionSyncInput["fetchPage"]>()
      .mockResolvedValue(
        page({ added: [transaction("transaction-added")], nextCursor: "cursor-initial" }),
      );
    const persist = vi.fn<RunTransactionSyncInput["persist"]>().mockResolvedValue(undefined);

    await expect(
      runTransactionSync({
        accessToken: "access-token-private",
        fetchPage,
        initialCursor: null,
        persist,
      }),
    ).resolves.toEqual({
      addedCount: 1,
      finalCursor: "cursor-initial",
      modifiedCount: 0,
      pageCount: 1,
      removedCount: 0,
    });

    expect(fetchPage).toHaveBeenCalledWith({
      accessToken: "access-token-private",
      cursor: null,
    });
    expect(persist).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({ initialCursor: null, finalCursor: "cursor-initial" }),
    );
  });

  it("collects added, modified, and removed changes across every page before one commit", async () => {
    const fetchPage = vi
      .fn<RunTransactionSyncInput["fetchPage"]>()
      .mockResolvedValueOnce(
        page({ added: [transaction("transaction-added")], hasMore: true, nextCursor: "cursor-2" }),
      )
      .mockResolvedValueOnce(
        page({
          modified: [transaction("transaction-modified")],
          nextCursor: "cursor-3",
          removed: [{ accountId: "plaid-account-1", transactionId: "transaction-removed" }],
        }),
      );
    const persist = vi.fn<RunTransactionSyncInput["persist"]>().mockResolvedValue(undefined);

    await runTransactionSync({
      accessToken: "access-token-private",
      fetchPage,
      initialCursor: "cursor-1",
      persist,
    });

    expect(fetchPage.mock.calls.map(([input]) => input.cursor)).toEqual(["cursor-1", "cursor-2"]);
    expect(persist).toHaveBeenCalledWith({
      added: [transaction("transaction-added")],
      finalCursor: "cursor-3",
      initialCursor: "cursor-1",
      modified: [transaction("transaction-modified")],
      removed: [{ accountId: "plaid-account-1", transactionId: "transaction-removed" }],
    });
  });

  it("does not persist a partial batch and lets a later retry start at the committed cursor", async () => {
    const fetchPage = vi
      .fn<RunTransactionSyncInput["fetchPage"]>()
      .mockResolvedValueOnce(page({ hasMore: true, nextCursor: "uncommitted-cursor" }))
      .mockRejectedValueOnce(new PlaidAdapterError("UPSTREAM_UNAVAILABLE"));
    const persist = vi.fn<RunTransactionSyncInput["persist"]>().mockResolvedValue(undefined);
    const input = {
      accessToken: "access-token-private",
      fetchPage,
      initialCursor: "committed-cursor",
      persist,
    };

    await expect(runTransactionSync(input)).rejects.toEqual(
      new PlaidAdapterError("UPSTREAM_UNAVAILABLE"),
    );
    expect(persist).not.toHaveBeenCalled();

    fetchPage.mockResolvedValueOnce(page({ nextCursor: "retry-final" }));
    await runTransactionSync(input);

    expect(fetchPage.mock.calls.map(([request]) => request.cursor)).toEqual([
      "committed-cursor",
      "uncommitted-cursor",
      "committed-cursor",
    ]);
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({
        finalCursor: "retry-final",
        initialCursor: "committed-cursor",
      }),
    );
  });

  it("discards partial changes and rolls back to the original cursor after a mutation error", async () => {
    const fetchPage = vi
      .fn<RunTransactionSyncInput["fetchPage"]>()
      .mockResolvedValueOnce(
        page({
          added: [transaction("discarded-transaction")],
          hasMore: true,
          nextCursor: "discarded-cursor",
        }),
      )
      .mockRejectedValueOnce(new PlaidAdapterError("TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION"))
      .mockResolvedValueOnce(
        page({ added: [transaction("kept-transaction")], nextCursor: "cursor-final" }),
      );
    const persist = vi.fn<RunTransactionSyncInput["persist"]>().mockResolvedValue(undefined);

    await runTransactionSync({
      accessToken: "access-token-private",
      fetchPage,
      initialCursor: "committed-cursor",
      persist,
    });

    expect(fetchPage.mock.calls.map(([request]) => request.cursor)).toEqual([
      "committed-cursor",
      "discarded-cursor",
      "committed-cursor",
    ]);
    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({
        added: [transaction("kept-transaction")],
        finalCursor: "cursor-final",
      }),
    );
  });

  it.each([
    {
      fetchPage: vi
        .fn<RunTransactionSyncInput["fetchPage"]>()
        .mockResolvedValue(page({ hasMore: true, nextCursor: "same-cursor" })),
      initialCursor: "same-cursor",
      name: "a cursor that does not advance",
    },
    {
      fetchPage: vi
        .fn<RunTransactionSyncInput["fetchPage"]>()
        .mockResolvedValue(page({ hasMore: true, nextCursor: "" })),
      initialCursor: "cursor-1",
      name: "an empty intermediate cursor",
    },
  ])("rejects $name without persistence", async ({ fetchPage, initialCursor }) => {
    const persist = vi.fn<RunTransactionSyncInput["persist"]>().mockResolvedValue(undefined);

    await expect(
      runTransactionSync({
        accessToken: "access-token-private",
        fetchPage,
        initialCursor,
        persist,
      }),
    ).rejects.toEqual(new PlaidAdapterError("UPSTREAM_UNAVAILABLE"));
    expect(persist).not.toHaveBeenCalled();
  });

  it("bounds page and mutation-restart loops", async () => {
    const persist = vi.fn<RunTransactionSyncInput["persist"]>().mockResolvedValue(undefined);
    let cursorNumber = 0;
    const tooManyPages = vi
      .fn<RunTransactionSyncInput["fetchPage"]>()
      .mockImplementation(() =>
        Promise.resolve(page({ hasMore: true, nextCursor: `cursor-${(cursorNumber += 1)}` })),
      );

    await expect(
      runTransactionSync({
        accessToken: "access-token-private",
        fetchPage: tooManyPages,
        initialCursor: null,
        persist,
      }),
    ).rejects.toEqual(new PlaidAdapterError("UPSTREAM_UNAVAILABLE"));
    expect(tooManyPages).toHaveBeenCalledTimes(100);

    const repeatedMutations = vi
      .fn<RunTransactionSyncInput["fetchPage"]>()
      .mockRejectedValue(new PlaidAdapterError("TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION"));
    await expect(
      runTransactionSync({
        accessToken: "access-token-private",
        fetchPage: repeatedMutations,
        initialCursor: "cursor-1",
        persist,
      }),
    ).rejects.toEqual(new PlaidAdapterError("TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION"));
    expect(repeatedMutations).toHaveBeenCalledTimes(3);
    expect(persist).not.toHaveBeenCalled();
  });

  it("honors a smaller scheduled page cap without persisting a partial cursor", async () => {
    const fetchPage = vi
      .fn<RunTransactionSyncInput["fetchPage"]>()
      .mockResolvedValue(page({ hasMore: true, nextCursor: "cursor-next" }));
    const persist = vi.fn<RunTransactionSyncInput["persist"]>();

    await expect(
      runTransactionSync({
        accessToken: "access-token-private",
        fetchPage,
        initialCursor: "cursor-1",
        maximumPages: 2,
        persist,
      }),
    ).rejects.toEqual(new PlaidAdapterError("UPSTREAM_UNAVAILABLE"));
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(persist).not.toHaveBeenCalled();
  });

  it.each([0, 101, 1.5])("rejects an invalid maximum page cap of %s", async (maximumPages) => {
    const fetchPage = vi.fn<RunTransactionSyncInput["fetchPage"]>();
    const persist = vi.fn<RunTransactionSyncInput["persist"]>();

    await expect(
      runTransactionSync({
        accessToken: "access-token-private",
        fetchPage,
        initialCursor: null,
        maximumPages,
        persist,
      }),
    ).rejects.toEqual(new PlaidAdapterError("INVALID_CONFIGURATION"));
    expect(fetchPage).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });
});
