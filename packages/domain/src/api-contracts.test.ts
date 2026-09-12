import { describe, expect, it } from "vitest";
import * as z from "zod";

import {
  API_ERROR_STATUS,
  apiErrorEnvelopeSchema,
  apiSuccessEnvelopeSchema,
  calendarDateSchema,
  categoryCreateRequestSchema,
  categoryMutationResponseSchema,
  categoriesResponseSchema,
  cursorPaginationMetaSchema,
  cursorPaginationQuerySchema,
  currencyCodeSchema,
  decimalAmountToMinorUnits,
  idempotencyKeySchema,
  merchantRuleCorrectionRequestSchema,
  merchantRuleCorrectionResponseSchema,
  merchantRuleCreateRequestSchema,
  merchantRuleListResponseSchema,
  merchantRuleMutationResponseSchema,
  merchantRulePreviewResponseSchema,
  merchantRuleUpdateRequestSchema,
  manualTransactionCreateRequestSchema,
  manualTransactionCreateResponseSchema,
  manualTransactionDeleteRequestSchema,
  manualTransactionMutationResponseSchema,
  manualTransactionPreviewRequestSchema,
  manualTransactionPreviewResponseSchema,
  manualTransactionUpdateRequestSchema,
  moneySchema,
  optimisticVersionSchema,
  sessionResponseSchema,
  transactionCategoryOverrideRequestSchema,
  transactionCategoryOverrideResponseSchema,
  transactionDetailResponseSchema,
  transactionListResponseSchema,
  transactionPaymentMetadataSchema,
  parseTransactionCsvExportQuery,
  parseTransactionListQuery,
  parseMerchantRuleListQuery,
  parseMerchantRulePreviewQuery,
} from "./api-contracts";

describe("API envelope contracts", () => {
  it("uses one strict success envelope", () => {
    const schema = apiSuccessEnvelopeSchema(z.array(z.string()), cursorPaginationMetaSchema);

    expect(
      schema.parse({
        data: ["transaction-1"],
        meta: { hasMore: false, nextCursor: null },
      }),
    ).toEqual({
      data: ["transaction-1"],
      meta: { hasMore: false, nextCursor: null },
    });
    expect(
      schema.safeParse({
        data: [],
        meta: { hasMore: false, nextCursor: null },
        status: "ok",
      }).success,
    ).toBe(false);
  });

  it("defines the protected session bootstrap response", () => {
    const response = {
      data: {
        csrfToken: "cGF5bG9hZA.c2lnbmF0dXJl",
        identity: { email: "owner@example.invalid" },
        timezone: "America/Toronto",
      },
      meta: {},
    };

    expect(sessionResponseSchema.parse(response)).toEqual(response);
    expect(
      sessionResponseSchema.safeParse({
        ...response,
        data: { ...response.data, csrfToken: "not-a-signed-token" },
      }).success,
    ).toBe(false);
  });

  it("uses stable sanitized error codes and field errors", () => {
    expect(
      apiErrorEnvelopeSchema.parse({
        error: {
          code: "VERSION_CONFLICT",
          currentVersion: 7,
          fieldErrors: { version: ["The record changed on another device."] },
          message: "Refresh and try again.",
        },
      }),
    ).toEqual({
      error: {
        code: "VERSION_CONFLICT",
        currentVersion: 7,
        fieldErrors: { version: ["The record changed on another device."] },
        message: "Refresh and try again.",
      },
    });
    expect(API_ERROR_STATUS.VERSION_CONFLICT).toBe(409);
    expect(
      apiErrorEnvelopeSchema.safeParse({
        error: {
          code: "DATABASE_EXCEPTION",
          details: "SQLITE_CONSTRAINT at repository.ts:42",
          message: "Internal failure",
        },
      }).success,
    ).toBe(false);
    expect(
      apiErrorEnvelopeSchema.safeParse({
        error: {
          code: "VERSION_CONFLICT",
          currentVersion: 0,
          message: "Refresh and try again.",
        },
      }).success,
    ).toBe(false);
  });
});

describe("category taxonomy contracts", () => {
  it("defines a strict complete taxonomy read model", () => {
    const response = {
      data: {
        categories: [
          {
            active: true,
            createdAt: "2026-07-16T00:00:00.000Z",
            editable: false,
            id: "category-system-transfer",
            kind: "TRANSFER",
            name: "Transfer",
            systemKey: "TRANSFER",
            updatedAt: "2026-07-16T00:00:00.000Z",
            version: 1,
          },
        ],
      },
      meta: {},
    } as const;

    expect(categoriesResponseSchema.parse(response)).toEqual(response);
    expect(
      categoriesResponseSchema.safeParse({
        ...response,
        data: {
          categories: [{ ...response.data.categories[0], providerCode: "must-not-leak" }],
        },
      }).success,
    ).toBe(false);
  });
});

describe("pagination and concurrency contracts", () => {
  it("parses bounded cursor pagination query values", () => {
    expect(cursorPaginationQuerySchema.parse({ pageSize: "25" })).toEqual({ pageSize: 25 });
    expect(cursorPaginationQuerySchema.parse({})).toEqual({ pageSize: 50 });
    expect(cursorPaginationQuerySchema.safeParse({ pageSize: "101" }).success).toBe(false);
    expect(cursorPaginationQuerySchema.safeParse({ cursor: "not+base64" }).success).toBe(false);
  });

  it("keeps hasMore and nextCursor consistent", () => {
    expect(
      cursorPaginationMetaSchema.safeParse({ hasMore: true, nextCursor: "bmV4dA" }).success,
    ).toBe(true);
    expect(cursorPaginationMetaSchema.safeParse({ hasMore: true, nextCursor: null }).success).toBe(
      false,
    );
    expect(
      cursorPaginationMetaSchema.safeParse({ hasMore: false, nextCursor: "bmV4dA" }).success,
    ).toBe(false);
  });

  it("accepts bounded idempotency keys and positive optimistic versions", () => {
    expect(idempotencyKeySchema.parse("request-20260715-0001")).toBe("request-20260715-0001");
    expect(idempotencyKeySchema.safeParse("too-short").success).toBe(false);
    expect(idempotencyKeySchema.safeParse("request key with spaces").success).toBe(false);

    expect(optimisticVersionSchema.parse(1)).toBe(1);
    expect(optimisticVersionSchema.safeParse(0).success).toBe(false);
    expect(optimisticVersionSchema.safeParse(1.5).success).toBe(false);
    expect(optimisticVersionSchema.safeParse("1").success).toBe(false);
  });
});

describe("ledger primitive contracts", () => {
  it("defines a strict four-field transaction payment-metadata contract", () => {
    const metadata = {
      payee: "Alex",
      payer: "",
      paymentMethod: null,
      referenceNumber: "reference-1",
    };

    expect(transactionPaymentMetadataSchema.parse(metadata)).toEqual(metadata);
    expect(
      transactionPaymentMetadataSchema.safeParse({ ...metadata, reason: "must not leak" }).success,
    ).toBe(false);
    expect(
      transactionPaymentMetadataSchema.safeParse({ ...metadata, payee: undefined }).success,
    ).toBe(false);
  });

  it("defines exact, strict manual transaction mutation contracts", () => {
    const create = {
      accountLabel: "Cash wallet",
      amount: "12.34",
      categoryId: "category-groceries",
      currency: "CAD",
      description: "Neighbourhood market",
      direction: "OUTFLOW",
      postedDate: "2026-07-15",
    } as const;
    expect(manualTransactionCreateRequestSchema.parse(create)).toEqual(create);
    const quickCreate = { ...create, accountLabel: "RBC Credit" };
    delete (quickCreate as { categoryId?: string }).categoryId;
    expect(manualTransactionCreateRequestSchema.parse(quickCreate)).toEqual(quickCreate);
    expect(
      manualTransactionCreateRequestSchema.parse({ ...create, rememberMerchant: true }),
    ).toEqual({ ...create, rememberMerchant: true });
    expect(manualTransactionCreateRequestSchema.parse({ ...create, installmentCount: 3 })).toEqual({
      ...create,
      installmentCount: 3,
    });
    for (const installmentCount of [1, 61, 2.5, "3"]) {
      expect(
        manualTransactionCreateRequestSchema.safeParse({ ...create, installmentCount }).success,
      ).toBe(false);
    }
    expect(
      manualTransactionCreateRequestSchema.safeParse({
        ...quickCreate,
        rememberMerchant: true,
      }).success,
    ).toBe(false);
    expect(
      manualTransactionCreateRequestSchema.safeParse({ ...create, rememberMerchant: false })
        .success,
    ).toBe(false);
    expect(
      manualTransactionCreateRequestSchema.safeParse({ ...create, amount: 12.34 }).success,
    ).toBe(false);
    expect(
      manualTransactionCreateRequestSchema.safeParse({ ...create, amount: "12.345" }).success,
    ).toBe(false);
    expect(
      manualTransactionCreateRequestSchema.safeParse({ ...create, currency: "JPY" }).success,
    ).toBe(false);
    expect(
      manualTransactionCreateRequestSchema.safeParse({ ...create, currency: "ZZZ" }).success,
    ).toBe(false);
    expect(
      manualTransactionCreateRequestSchema.safeParse({ ...create, plaidTransactionId: "forged" })
        .success,
    ).toBe(false);

    expect(
      manualTransactionUpdateRequestSchema.parse({
        amount: "0.01",
        description: "Corrected text",
        version: 2,
      }),
    ).toEqual({ amount: "0.01", description: "Corrected text", version: 2 });
    expect(manualTransactionUpdateRequestSchema.safeParse({ version: 2 }).success).toBe(false);
    expect(manualTransactionDeleteRequestSchema.parse({ version: 3 })).toEqual({ version: 3 });
    expect(decimalAmountToMinorUnits("0.01", "CAD")).toBe(1);
    expect(decimalAmountToMinorUnits("12.30", "USD")).toBe(1230);
    expect(() => decimalAmountToMinorUnits("100", "JPY")).toThrow();
  });

  it("defines strict non-writing quick-entry preview variants", () => {
    const preview = {
      accountLabel: "RBC Credit",
      amount: "12.34",
      currency: "CAD",
      description: "IKEA",
      direction: "OUTFLOW",
      postedDate: "2026-07-15",
    } as const;
    expect(manualTransactionPreviewRequestSchema.parse(preview)).toEqual(preview);
    expect(
      manualTransactionPreviewRequestSchema.parse({ ...preview, installmentCount: 12 }),
    ).toEqual({ ...preview, installmentCount: 12 });
    expect(
      manualTransactionPreviewRequestSchema.safeParse({
        ...preview,
        categoryId: "category-expense-shopping",
      }).success,
    ).toBe(false);

    const category = {
      active: true,
      createdAt: "2026-07-15T12:00:00.000Z",
      editable: true,
      id: "category-expense-shopping",
      kind: "EXPENSE",
      name: "Shopping",
      systemKey: null,
      updatedAt: "2026-07-15T12:00:00.000Z",
      version: 1,
    } as const;
    for (const kind of ["KNOWN_MERCHANT", "NEW_MERCHANT"] as const) {
      expect(
        manualTransactionPreviewResponseSchema.parse({
          data: { category, kind },
          meta: {},
        }),
      ).toBeDefined();
    }
    expect(
      manualTransactionPreviewResponseSchema.safeParse({
        data: { category, kind: "UNKNOWN", transactionId: "transaction-forged" },
        meta: {},
      }).success,
    ).toBe(false);
  });

  it("returns only canonical manual transaction fields", () => {
    const transaction = {
      accountLabel: "Cash wallet",
      amountMinor: 1234,
      reimbursementMinor: 0,
      categorizationSource: "MANUAL",
      categoryId: "category-groceries",
      createdAt: "2026-07-15T12:00:00.000Z",
      currency: "CAD",
      description: "Neighbourhood market",
      direction: "OUTFLOW",
      id: "transaction-manual-1",
      installment: {
        count: 2,
        groupId: "installment-group-1",
        number: 1,
      },
      merchantName: "Neighbourhood market",
      normalizedMerchant: "neighbourhood market",
      postedDate: "2026-07-15",
      source: "MANUAL",
      status: "POSTED",
      updatedAt: "2026-07-15T12:00:00.000Z",
      version: 1,
    } as const;

    expect(
      manualTransactionCreateResponseSchema.parse({
        data: {
          categoryConfirmationRequired: false,
          transaction,
          transactions: [
            transaction,
            {
              ...transaction,
              amountMinor: 1235,
              id: "transaction-manual-2",
              installment: { ...transaction.installment, number: 2 },
              postedDate: "2026-08-15",
            },
          ],
        },
        meta: {},
      }),
    ).toBeDefined();
    expect(
      manualTransactionMutationResponseSchema.parse({
        data: { transaction: { ...transaction, status: "REMOVED", version: 2 } },
        meta: {},
      }),
    ).toBeDefined();
    expect(
      manualTransactionCreateResponseSchema.safeParse({
        data: { transaction: { ...transaction, status: "REMOVED" } },
        meta: {},
      }).success,
    ).toBe(false);
    expect(
      manualTransactionCreateResponseSchema.safeParse({
        data: { transaction: { ...transaction, providerAmountDecimal: "12.34" } },
        meta: {},
      }).success,
    ).toBe(false);
  });

  it("defines strict quick-entry category create contracts", () => {
    expect(categoryCreateRequestSchema.parse({ kind: "EXPENSE", name: "Restaurant" })).toEqual({
      kind: "EXPENSE",
      name: "Restaurant",
    });
    expect(
      categoryCreateRequestSchema.safeParse({ kind: "INCOME", name: "Restaurant" }).success,
    ).toBe(false);
    expect(
      categoryCreateRequestSchema.safeParse({ kind: "EXPENSE", name: "Bad\u0000Name" }).success,
    ).toBe(false);
    expect(
      categoryCreateRequestSchema.safeParse({ kind: "EXPENSE", name: "<script>" }).success,
    ).toBe(false);

    const category = {
      active: true,
      createdAt: "2026-07-15T12:00:00.000Z",
      editable: true,
      id: "category-expense-restaurant",
      kind: "EXPENSE",
      name: "Restaurant",
      systemKey: null,
      updatedAt: "2026-07-15T12:00:00.000Z",
      version: 1,
    } as const;
    expect(categoryMutationResponseSchema.parse({ data: { category }, meta: {} })).toBeDefined();
  });

  it("defines a strict transaction-level category override contract", () => {
    const request = { categoryId: "category-groceries", version: 2 } as const;
    expect(transactionCategoryOverrideRequestSchema.parse(request)).toEqual(request);
    expect(
      transactionCategoryOverrideRequestSchema.safeParse({ ...request, applyToMerchant: true })
        .success,
    ).toBe(false);

    const transaction = {
      accountLabel: null,
      amountMinor: 1234,
      reimbursementMinor: 0,
      authorizedDate: "2026-07-14",
      categorizationSource: "MANUAL",
      categoryId: "category-groceries",
      categoryRuleId: null,
      createdAt: "2026-07-15T12:00:00.000Z",
      currency: "CAD",
      description: "Neighbourhood market",
      direction: "OUTFLOW",
      id: "transaction-plaid-1",
      merchantName: "Neighbourhood Market",
      needsReview: false,
      normalizedMerchant: "neighbourhood market",
      paymentMetadata: {
        payee: null,
        payer: null,
        paymentMethod: null,
        referenceNumber: null,
      },
      postedDate: "2026-07-15",
      reviewReason: null,
      source: "CSV",
      status: "POSTED",
      updatedAt: "2026-07-15T13:00:00.000Z",
      version: 3,
    } as const;
    const response = { data: { transaction }, meta: {} } as const;
    expect(transactionCategoryOverrideResponseSchema.parse(response)).toEqual(response);
    expect(
      transactionCategoryOverrideResponseSchema.safeParse({
        data: { transaction: { ...transaction, providerPayload: "private" } },
        meta: {},
      }).success,
    ).toBe(false);

    expect(merchantRuleCorrectionRequestSchema.parse(request)).toEqual(request);
    const ruleResponse = {
      data: {
        merchantRule: {
          active: true,
          categoryId: "category-groceries",
          createdAt: "2026-07-15T13:00:00.000Z",
          displayMerchant: "Neighbourhood Market",
          id: "merchant-rule-market-1",
          normalizedMerchant: "neighbourhood market",
          updatedAt: "2026-07-15T13:00:00.000Z",
          version: 1,
        },
        transaction,
      },
      meta: { historicalTransactionsChanged: 0 },
    } as const;
    expect(merchantRuleCorrectionResponseSchema.parse(ruleResponse)).toEqual(ruleResponse);
    expect(
      merchantRuleCorrectionResponseSchema.safeParse({
        ...ruleResponse,
        meta: { historicalTransactionsChanged: 1 },
      }).success,
    ).toBe(false);
  });

  it("defines strict, cursor-paginated merchant-rule management contracts", () => {
    expect(parseMerchantRuleListQuery(new URLSearchParams("active=true&pageSize=25"))).toEqual({
      active: true,
      pageSize: 25,
    });
    expect(() =>
      parseMerchantRuleListQuery(new URLSearchParams("active=true&active=false")),
    ).toThrow();
    expect(() =>
      parseMerchantRuleListQuery(new URLSearchParams("sort=normalized_merchant")),
    ).toThrow();
    expect(
      parseMerchantRulePreviewQuery(
        new URLSearchParams("displayMerchant=Acme+Store+42&categoryId=category-food"),
      ),
    ).toEqual({ categoryId: "category-food", displayMerchant: "Acme Store 42" });

    const create = { categoryId: "category-food", displayMerchant: "Acme Store 42" };
    expect(merchantRuleCreateRequestSchema.parse(create)).toEqual(create);
    expect(
      merchantRuleCreateRequestSchema.safeParse({ ...create, normalizedMerchant: "forged" })
        .success,
    ).toBe(false);
    expect(merchantRuleUpdateRequestSchema.parse({ active: false, version: 2 })).toEqual({
      active: false,
      version: 2,
    });
    expect(merchantRuleUpdateRequestSchema.safeParse({ version: 2 }).success).toBe(false);

    const rule = {
      active: true,
      categoryId: "category-food",
      createdAt: "2026-07-15T13:00:00.000Z",
      displayMerchant: "Acme Store 42",
      id: "merchant-rule-acme",
      normalizedMerchant: "acme",
      updatedAt: "2026-07-15T13:00:00.000Z",
      version: 1,
    } as const;
    const impact = {
      conflictingTransactions: 2,
      historicalTransactionsChanged: 0,
      matchingTransactions: 3,
    } as const;
    expect(
      merchantRuleListResponseSchema.parse({
        data: { rules: [rule] },
        meta: {
          hasMore: false,
          nextCursor: null,
          query: { active: true, pageSize: 25 },
        },
      }),
    ).toBeDefined();
    expect(
      merchantRuleMutationResponseSchema.parse({
        data: { merchantRule: rule },
        meta: impact,
      }),
    ).toBeDefined();
    expect(
      merchantRulePreviewResponseSchema.parse({
        data: {
          existingRule: null,
          proposedRule: {
            categoryId: "category-food",
            displayMerchant: "Acme Store 42",
            normalizedMerchant: "acme",
          },
        },
        meta: impact,
      }),
    ).toBeDefined();
    expect(
      merchantRuleMutationResponseSchema.safeParse({
        data: { merchantRule: rule },
        meta: { ...impact, historicalTransactionsChanged: 1 },
      }).success,
    ).toBe(false);
  });

  it("represents exact money without floating point or implicit sign", () => {
    expect(
      moneySchema.parse({ amountMinor: 12345, currency: "CAD", direction: "OUTFLOW" }),
    ).toEqual({ amountMinor: 12345, currency: "CAD", direction: "OUTFLOW" });
    expect(
      moneySchema.safeParse({ amountMinor: 12.34, currency: "CAD", direction: "OUTFLOW" }).success,
    ).toBe(false);
    expect(
      moneySchema.safeParse({ amountMinor: -1, currency: "CAD", direction: "OUTFLOW" }).success,
    ).toBe(false);
  });

  it("accepts only uppercase three-letter currency codes", () => {
    expect(currencyCodeSchema.parse("USD")).toBe("USD");
    expect(currencyCodeSchema.safeParse("cad").success).toBe(false);
    expect(currencyCodeSchema.safeParse("USDT").success).toBe(false);
  });

  it("accepts real ISO calendar dates only", () => {
    expect(calendarDateSchema.parse("2024-02-29")).toBe("2024-02-29");
    expect(calendarDateSchema.safeParse("2025-02-29").success).toBe(false);
    expect(calendarDateSchema.safeParse("2025-2-01").success).toBe(false);
  });
});

describe("transaction read contracts", () => {
  const transaction = {
    accountLabel: null,
    amountMinor: 14327,
    reimbursementMinor: 0,
    authorizedDate: "2026-07-14",
    categorizationSource: "RULE",
    categoryId: "category-shopping",
    categoryRuleId: null,
    createdAt: "2026-07-15T12:00:00.000Z",
    currency: "CAD",
    description: "AMZN Mktp CA",
    direction: "OUTFLOW",
    id: "transaction-amazon-1",
    merchantName: "Amazon",
    needsReview: false,
    normalizedMerchant: null,
    paymentMetadata: {
      payee: null,
      payer: null,
      paymentMethod: null,
      referenceNumber: null,
    },
    postedDate: "2026-07-15",
    reviewReason: null,
    source: "CSV",
    status: "POSTED",
    updatedAt: "2026-07-15T12:00:00.000Z",
    version: 1,
  } as const;

  it("parses one allowlisted, URL-reproducible transaction query", () => {
    const query = parseTransactionListQuery(
      new URLSearchParams([
        ["accountId", "account-1"],
        ["categoryId", "category-shopping"],
        ["categorizationSource", "RULE"],
        ["currency", "CAD"],
        ["dateFrom", "2026-07-01"],
        ["dateTo", "2026-07-31"],
        ["normalizedMerchant", "neighbourhood market"],
        ["needsReview", "false"],
        ["pageSize", "25"],
        ["reportMetric", "NET_SPENDING"],
        ["sort", "AMOUNT_DESC"],
        ["source", "CSV"],
        ["status", "POSTED"],
      ]),
    );

    expect(query).toEqual({
      accountId: "account-1",
      categorizationSource: "RULE",
      categoryId: "category-shopping",
      currency: "CAD",
      dateFrom: "2026-07-01",
      dateTo: "2026-07-31",
      normalizedMerchant: "neighbourhood market",
      needsReview: false,
      pageSize: 25,
      reportMetric: "NET_SPENDING",
      sort: "AMOUNT_DESC",
      source: "CSV",
      status: "POSTED",
    });
    expect(parseTransactionListQuery(new URLSearchParams())).toEqual({
      pageSize: 50,
      sort: "POSTED_DATE_DESC",
    });
    expect(
      parseTransactionListQuery(new URLSearchParams("categorizationSource=RULE&pageSize=10")),
    ).toEqual({ categorizationSource: "RULE", pageSize: 10, sort: "POSTED_DATE_DESC" });
  });

  it("rejects unknown, repeated, and malformed transaction query values", () => {
    for (const query of [
      "unsafeWhere=1%3D1",
      "status=POSTED&status=REMOVED",
      "needsReview=1",
      "sort=posted_date%20desc",
      "pageSize=0",
      "cursor=not+base64url",
      "merchantMissing=false",
      "merchantMissing=true&normalizedMerchant=acme",
      "reportMetric=NET_SPENDING&status=PENDING",
      "reportMetric=INCOME",
    ]) {
      expect(() => parseTransactionListQuery(new URLSearchParams(query))).toThrow();
    }
  });

  it("parses the explicit missing-merchant net-spending drill-down population", () => {
    expect(
      parseTransactionListQuery(
        new URLSearchParams(
          "dateFrom=2026-07-01&dateTo=2026-07-31&currency=CAD&merchantMissing=true&reportMetric=NET_SPENDING",
        ),
      ),
    ).toEqual({
      currency: "CAD",
      dateFrom: "2026-07-01",
      dateTo: "2026-07-31",
      merchantMissing: true,
      pageSize: 50,
      reportMetric: "NET_SPENDING",
      sort: "POSTED_DATE_DESC",
    });
  });

  it("parses CSV export filters without accepting pagination-only state", () => {
    expect(
      parseTransactionCsvExportQuery(
        new URLSearchParams(
          "accountId=account-1&categoryId=category-food&categorizationSource=RULE&" +
            "currency=CAD&dateFrom=2026-01-01&dateTo=2026-01-31&needsReview=false&" +
            "normalizedMerchant=fixture+cafe&reportMetric=NET_SPENDING&source=CSV&" +
            "status=POSTED&sort=AMOUNT_ASC",
        ),
      ),
    ).toEqual({
      accountId: "account-1",
      categorizationSource: "RULE",
      categoryId: "category-food",
      currency: "CAD",
      dateFrom: "2026-01-01",
      dateTo: "2026-01-31",
      needsReview: false,
      normalizedMerchant: "fixture cafe",
      reportMetric: "NET_SPENDING",
      sort: "AMOUNT_ASC",
      source: "CSV",
      status: "POSTED",
    });
    expect(parseTransactionCsvExportQuery(new URLSearchParams())).toEqual({
      sort: "POSTED_DATE_DESC",
    });

    for (const query of [
      "cursor=eyJ2IjoxfQ",
      "pageSize=100",
      "unknown=value",
      "source=CSV&source=CSV",
      "merchantMissing=true&normalizedMerchant=fixture",
      "reportMetric=NET_SPENDING&status=PENDING",
    ]) {
      expect(() => parseTransactionCsvExportQuery(new URLSearchParams(query))).toThrow();
    }
  });

  it("defines strict paginated list and traceable detail responses", () => {
    const listResponse = {
      data: { transactions: [transaction] },
      meta: {
        hasMore: true,
        nextCursor: "eyJ2IjoxfQ",
        query: { pageSize: 25, sort: "POSTED_DATE_DESC" },
      },
    } as const;
    expect(transactionListResponseSchema.parse(listResponse)).toEqual(listResponse);

    const detailResponse = {
      data: {
        transaction: {
          ...transaction,
          categoryAudits: [
            {
              createdAt: "2026-07-15T13:00:00.000Z",
              id: "category-audit-1",
              newCategoryId: "category-shopping",
              newCategoryRuleId: null,
              newSource: "MANUAL",
              oldCategoryId: null,
              oldCategoryRuleId: null,
              oldSource: "UNCLASSIFIED",
              reason: "OWNER_TRANSACTION_OVERRIDE",
            },
          ],
          lifecycle: {
            pendingTransactionId: "transaction-amazon-pending",
            replacedByTransactionId: null,
          },
        },
      },
      meta: {},
    } as const;
    expect(transactionDetailResponseSchema.parse(detailResponse)).toEqual(detailResponse);
    expect(
      transactionDetailResponseSchema.safeParse({
        ...detailResponse,
        data: {
          transaction: {
            ...detailResponse.data.transaction,
            providerPayload: { lineItems: ["must not leak"] },
          },
        },
      }).success,
    ).toBe(false);
  });

  it("exposes bounded installment metadata in list and detail reads", () => {
    const installmentTransaction = {
      ...transaction,
      accountLabel: "RBC Credit",
      authorizedDate: null,
      categorizationSource: "MANUAL",
      id: "transaction-installment-1",
      installment: { count: 12, groupId: "installment-group-1", number: 1 },
      source: "MANUAL",
    } as const;
    expect(
      transactionListResponseSchema.parse({
        data: { transactions: [installmentTransaction] },
        meta: {
          hasMore: false,
          nextCursor: null,
          query: { pageSize: 50, sort: "POSTED_DATE_DESC" },
        },
      }).data.transactions[0]?.installment,
    ).toEqual({ count: 12, groupId: "installment-group-1", number: 1 });
    expect(
      transactionDetailResponseSchema.parse({
        data: {
          transaction: {
            ...installmentTransaction,
            categoryAudits: [],
            lifecycle: { pendingTransactionId: null, replacedByTransactionId: null },
          },
        },
        meta: {},
      }).data.transaction.installment,
    ).toEqual({ count: 12, groupId: "installment-group-1", number: 1 });
  });
});
