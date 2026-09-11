import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { createFullJsonExport, serializeFullJsonExport } from "../packages/domain/dist/index.js";

const workspace = fileURLToPath(new URL("..", import.meta.url));
const restoreScript = fileURLToPath(
  new URL("../.wrangler/restore-json-export.mjs", import.meta.url),
);
const remoteMigrationScript = fileURLToPath(
  new URL("../.wrangler/migrate-remote.mjs", import.meta.url),
);
const wrangler = fileURLToPath(
  new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url),
);
const NOW = "2026-07-17T12:00:00.000Z";
const SYSTEM_NOW = "2026-07-16T00:00:00.000Z";
const EXPORTED_AT = new Date().toISOString();
const PAYMENT_METADATA = {
  payee: null,
  payer: null,
  paymentMethod: null,
  referenceNumber: null,
};

function transaction(input) {
  return {
    accountId: "account-chequing",
    accountLabel: null,
    amountMinor: 1234,
    authorizedDate: null,
    categorizationSource: "MANUAL",
    categoryId: "category-expense-restore",
    categoryRuleId: null,
    createdAt: NOW,
    currency: "CAD",
    description: "Fixture transaction",
    direction: "OUTFLOW",
    importFingerprint: null,
    merchantName: null,
    needsReview: false,
    normalizedMerchant: null,
    paymentMetadata: PAYMENT_METADATA,
    pendingTransactionId: null,
    plaidPersonalFinanceCategory: null,
    postedDate: "2026-07-17",
    providerTransactionId: null,
    reviewReason: null,
    source: "MANUAL",
    status: "POSTED",
    updatedAt: NOW,
    version: 1,
    ...input,
  };
}

function restoreFixture() {
  return createFullJsonExport({
    data: {
      budgets: [
        {
          categoryId: "category-expense-restore",
          currency: "CAD",
          effectiveMonth: "2026-07",
          amountMinor: 50000,
          updatedAt: NOW,
        },
        {
          categoryId: "category-expense-restore",
          currency: "CAD",
          effectiveMonth: "2026-08",
          amountMinor: null,
          updatedAt: NOW,
        },
        {
          categoryId: "category-expense-restore",
          currency: "USD",
          effectiveMonth: "2026-07",
          amountMinor: 0,
          updatedAt: NOW,
        },
      ],
      accounts: [
        {
          connectionId: "connection-restore",
          createdAt: NOW,
          currency: "CAD",
          displayName: "Daily Chequing",
          enabled: true,
          id: "account-chequing",
          subtype: "CHECKING",
          type: "DEPOSITORY",
          updatedAt: NOW,
          version: 1,
        },
        {
          connectionId: "connection-restore",
          createdAt: NOW,
          currency: "CAD",
          displayName: "Credit Card",
          enabled: true,
          id: "account-credit",
          subtype: "CREDIT_CARD",
          type: "CREDIT",
          updatedAt: NOW,
          version: 1,
        },
      ],
      categories: [
        {
          active: true,
          createdAt: SYSTEM_NOW,
          editable: false,
          id: "category-system-transfer",
          kind: "TRANSFER",
          name: "Transfer",
          systemKey: "TRANSFER",
          updatedAt: SYSTEM_NOW,
          version: 1,
        },
        {
          active: true,
          createdAt: SYSTEM_NOW,
          editable: false,
          id: "category-system-unclassified",
          kind: "UNCLASSIFIED",
          name: "Unclassified",
          systemKey: "UNCLASSIFIED",
          updatedAt: SYSTEM_NOW,
          version: 1,
        },
        {
          active: true,
          createdAt: NOW,
          editable: true,
          id: "category-income-restore",
          kind: "INCOME",
          name: "Restore Income",
          systemKey: null,
          updatedAt: NOW,
          version: 1,
        },
        {
          active: true,
          createdAt: NOW,
          editable: true,
          id: "category-expense-restore",
          kind: "EXPENSE",
          name: "Restore Expense",
          systemKey: null,
          updatedAt: NOW,
          version: 1,
        },
      ],
      categoryAudits: [
        {
          createdAt: NOW,
          id: "category-audit-restore",
          newCategoryId: "category-expense-restore",
          newCategoryRuleId: "rule-restore",
          newSource: "RULE",
          oldCategoryId: null,
          oldCategoryRuleId: null,
          oldSource: "UNCLASSIFIED",
          reason: "RULE_CATEGORIZATION",
          transactionId: "transaction-expense",
        },
      ],
      connections: [
        {
          createdAt: NOW,
          id: "connection-restore",
          institutionId: "ins_restore",
          institutionName: "Restore Bank",
          updatedAt: NOW,
          version: 2,
        },
      ],
      importBatches: [
        {
          committedAt: NOW,
          contentChecksum: "a".repeat(64),
          createdAt: NOW,
          id: "import-batch-restore",
          sourceFilenameHash: "b".repeat(64),
          status: "COMMITTED",
          version: 2,
        },
      ],
      importRows: [
        {
          batchId: "import-batch-restore",
          canonicalFingerprint: "c".repeat(64),
          createdAt: NOW,
          errors: [],
          id: "import-row-restore",
          raw: {
            accountLabel: "Credit Card",
            amount: "20.00",
            category: "Transfer",
            currency: "CAD",
            description: "Card payment",
            direction: "INFLOW",
            merchant: null,
            postedDate: "2026-07-17",
          },
          rowNumber: 2,
          transactionId: "transaction-transfer-right",
          validationStatus: "IMPORTED",
        },
      ],
      merchantRules: [
        {
          active: true,
          categoryId: "category-expense-restore",
          createdAt: NOW,
          displayMerchant: "Restore Cafe",
          id: "rule-restore",
          normalizedMerchant: "restore cafe",
          updatedAt: NOW,
          version: 1,
        },
      ],
      subscriptionOccurrences: [
        {
          createdAt: NOW,
          id: "subscription-occurrence-restore",
          ownerDecisionAt: null,
          scheduledDate: "2026-07-17",
          status: "GENERATED",
          subscriptionId: "subscription-restore",
          transactionId: "transaction-subscription",
          updatedAt: NOW,
          version: 1,
        },
      ],
      subscriptions: [
        {
          accountLabel: "BMO Credit",
          amountMinor: 1_149,
          anchorDay: 17,
          cadence: "MONTHLY",
          categoryId: "category-expense-restore",
          createdAt: NOW,
          currency: "CAD",
          id: "subscription-restore",
          cancellationEffectiveDate: "2026-08-01",
          lastErrorCode: null,
          merchantName: "Apple Services",
          name: "Apple Services",
          nextChargeDate: "2026-08-17",
          normalizedMerchant: "apple services",
          status: "CANCELLED",
          updatedAt: NOW,
          version: 1,
        },
      ],
      transactions: [
        transaction({
          amountMinor: 500_000,
          categoryId: "category-income-restore",
          direction: "INFLOW",
          id: "transaction-income",
        }),
        transaction({
          categorizationSource: "RULE",
          reimbursementMinor: 200,
          categoryRuleId: "rule-restore",
          id: "transaction-expense",
          merchantName: "Restore Cafe",
          normalizedMerchant: "restore cafe",
          providerTransactionId: "provider-transaction-restore",
          source: "PLAID",
        }),
        transaction({
          amountMinor: 2_000,
          categoryId: "category-system-transfer",
          direction: "OUTFLOW",
          id: "transaction-transfer-left",
          providerTransactionId: "provider-transfer-left",
          source: "PLAID",
        }),
        transaction({
          accountId: "account-credit",
          amountMinor: 2_000,
          categoryId: "category-system-transfer",
          direction: "INFLOW",
          id: "transaction-transfer-right",
          importFingerprint: "c".repeat(64),
          source: "CSV",
        }),
        transaction({
          accountId: null,
          accountLabel: "BMO Credit",
          amountMinor: 1_149,
          id: "transaction-subscription",
          merchantName: "Apple Services",
          normalizedMerchant: "apple services",
        }),
      ],
      transferMatchAudits: [
        {
          action: "CONFIRM",
          createdAt: NOW,
          id: "transfer-audit-restore",
          matchVersion: 2,
          newStatus: "CONFIRMED",
          oldStatus: "AUTO_CONFIRMED",
          reason: "OWNER_CONFIRMED",
          transferMatchId: "transfer-match-restore",
        },
      ],
      transferMatches: [
        {
          confidence: "HIGH",
          createdAt: NOW,
          decisionReason: "OWNER_CONFIRMED",
          evidence: {
            amountMinor: 2_000,
            currency: "CAD",
            dayDifference: 0,
            reason: null,
            signals: ["DESCRIPTION"],
          },
          id: "transfer-match-restore",
          leftTransactionId: "transaction-transfer-left",
          rightTransactionId: "transaction-transfer-right",
          status: "CONFIRMED",
          updatedAt: NOW,
          version: 2,
        },
      ],
    },
    exportedAt: EXPORTED_AT,
    timezone: "America/Toronto",
  });
}

function run(command, arguments_) {
  return spawnSync(command, arguments_, {
    cwd: workspace,
    encoding: "utf8",
    env: { ...process.env, WRANGLER_WRITE_LOGS: "false" },
    maxBuffer: 64 * 1024 * 1024,
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function query(target, sql) {
  const result = run(process.execPath, [
    wrangler,
    "d1",
    "execute",
    "DB",
    "--local",
    "--persist-to",
    target,
    "--config",
    "apps/web/wrangler.jsonc",
    "--command",
    sql,
    "--json",
  ]);
  assert(result.status === 0, "Independent restore verification query failed.");
  return JSON.parse(result.stdout).flatMap(({ results }) => results ?? []);
}

const testRoot = mkdtempSync(join(tmpdir(), "personal-ledger-restore-verification-"));
try {
  const input = join(testRoot, "export.json");
  const target = join(testRoot, "restored-d1");
  const document = restoreFixture();
  writeFileSync(input, serializeFullJsonExport(document), "utf8");

  const restored = run(process.execPath, [restoreScript, "--input", input, "--persist-to", target]);
  assert(restored.status === 0, `Restore command failed: ${restored.stderr}`);
  const output = JSON.parse(restored.stdout.split("\n", 1)[0]);
  assert(output.evidence.counts.budgets === 3, "Budget history count did not survive restore.");
  assert(
    JSON.stringify(
      query(
        target,
        "SELECT currency, effective_month, amount_minor FROM category_budgets ORDER BY currency, effective_month",
      ),
    ) ===
      JSON.stringify([
        { currency: "CAD", effective_month: "2026-07", amount_minor: 50000 },
        { currency: "CAD", effective_month: "2026-08", amount_minor: null },
        { currency: "USD", effective_month: "2026-07", amount_minor: 0 },
      ]),
    "Budget amounts, currencies or cancellation history changed during restore.",
  );
  assert(output.schemaVersion === 1, "Restore evidence schema version did not match.");
  assert(output.evidence.counts.transactions === 5, "Restore transaction count did not match.");
  assert(output.evidence.counts.subscriptions === 1, "Subscription count did not match.");
  assert(
    output.evidence.counts.subscriptionOccurrences === 1,
    "Subscription occurrence count did not match.",
  );
  assert(output.evidence.counts.categoryAudits === 1, "Category audit count did not match.");
  assert(output.evidence.counts.merchantRules === 1, "Merchant rule count did not match.");
  assert(output.evidence.counts.transferMatches === 1, "Transfer match count did not match.");
  assert(output.evidence.counts.transferMatchAudits === 1, "Transfer audit count did not match.");
  assert(
    JSON.stringify(output.evidence.reportTotals) ===
      JSON.stringify([
        {
          currency: "CAD",
          incomeMinor: 500_000,
          netCashFlowMinor: 497_817,
          netSpendingMinor: 2_183,
        },
      ]),
    "Restored report totals did not reconcile.",
  );

  const [databaseEvidence] = query(
    target,
    `SELECT
       (SELECT COUNT(*) FROM transactions) AS transaction_count,
       (SELECT COUNT(*) FROM category_audits) AS category_audit_count,
       (SELECT COUNT(*) FROM merchant_rules) AS rule_count,
       (SELECT COUNT(*) FROM transfer_matches WHERE status = 'CONFIRMED') AS decision_count,
       (SELECT COUNT(*) FROM transfer_match_audits) AS transfer_audit_count,
       (SELECT COUNT(*) FROM subscriptions) AS subscription_count,
       (SELECT cancellation_effective_date FROM subscriptions WHERE id = 'subscription-restore') AS subscription_cutoff,
       (SELECT COUNT(*) FROM subscription_occurrences) AS subscription_occurrence_count,
       (SELECT COUNT(*) FROM connections
        WHERE status = 'DISCONNECTED' AND sync_cursor IS NULL
          AND plaid_item_id LIKE 'restored-local-item:%'
          AND length(access_token_ciphertext) = 1 AND length(access_token_iv) = 1) AS inert_connection_count,
       (SELECT COUNT(*) FROM accounts
        WHERE mask IS NULL AND plaid_account_id LIKE 'restored-local-account:%') AS restored_account_count`,
  );
  assert(databaseEvidence.transaction_count === 5, "Independent transaction count failed.");
  assert(databaseEvidence.category_audit_count === 1, "Independent category audit link failed.");
  assert(databaseEvidence.rule_count === 1, "Independent merchant rule verification failed.");
  assert(databaseEvidence.decision_count === 1, "Independent transfer decision failed.");
  assert(databaseEvidence.transfer_audit_count === 1, "Independent transfer audit failed.");
  assert(databaseEvidence.subscription_count === 1, "Independent subscription count failed.");
  assert(
    databaseEvidence.subscription_cutoff === "2026-08-01",
    "Subscription cancellation date was not restored.",
  );
  assert(
    databaseEvidence.subscription_occurrence_count === 1,
    "Independent subscription occurrence count failed.",
  );
  assert(databaseEvidence.inert_connection_count === 1, "Restored connection was not inert.");
  assert(databaseEvidence.restored_account_count === 2, "Restored account identity was unsafe.");
  const [deduction] = query(
    target,
    "SELECT amount_minor, reimbursement_minor FROM transactions WHERE id = 'transaction-expense'",
  );
  assert(
    deduction.amount_minor === 1234 && deduction.reimbursement_minor === 200,
    "Restore lost original or reimbursed amount.",
  );

  const replay = run(process.execPath, [restoreScript, "--input", input, "--persist-to", target]);
  assert(replay.status !== 0, "Restore unexpectedly accepted an existing target.");
  assert(replay.stderr.includes("TARGET_ALREADY_EXISTS"), "Existing-target error was unstable.");
  assert(
    query(target, "SELECT COUNT(*) AS count FROM transactions")[0]?.count === 5,
    "Existing-target rejection changed the restored database.",
  );

  const tamperedInput = join(testRoot, "tampered.json");
  const tamperedTarget = join(testRoot, "tampered-d1");
  const tampered = JSON.parse(readFileSync(input, "utf8"));
  tampered.accessToken = "must-not-restore";
  writeFileSync(tamperedInput, JSON.stringify(tampered), "utf8");
  const rejected = run(process.execPath, [
    restoreScript,
    "--input",
    tamperedInput,
    "--persist-to",
    tamperedTarget,
  ]);
  assert(rejected.status !== 0, "Restore unexpectedly accepted a secret field.");
  assert(rejected.stderr.includes("INPUT_SCHEMA_INVALID"), "Secret-field error was unstable.");
  assert(!existsSync(tamperedTarget), "Rejected input created a target database.");
  assert(
    query(target, "SELECT COUNT(*) AS count FROM transactions")[0]?.count === 5,
    "Rejected input changed the valid restored database.",
  );

  const defaultTarget = run(process.execPath, [
    restoreScript,
    "--input",
    input,
    "--persist-to",
    ".wrangler/local-d1",
  ]);
  assert(defaultTarget.status !== 0, "Restore unexpectedly accepted the default local D1.");
  assert(
    defaultTarget.stderr.includes("DEFAULT_DATABASE_FORBIDDEN"),
    "Default-database error was unstable.",
  );

  const guardTarget = join(testRoot, "guard-restored-d1");
  const guarded = run(process.execPath, [
    remoteMigrationScript,
    "--input",
    input,
    "--persist-to",
    guardTarget,
  ]);
  assert(guarded.status === 0, `Remote migration guard failed: ${guarded.stderr}`);
  const guardOutput = JSON.parse(guarded.stdout);
  assert(guardOutput.status === "READY", "Remote migration guard was not ready.");
  assert(guardOutput.remoteExecuted === false, "Check mode unexpectedly executed remotely.");
  assert(/^[a-f0-9]{64}$/.test(guardOutput.exportSha256), "Export digest was invalid.");
  assert(/^[a-f0-9]{64}$/.test(guardOutput.migrationDigest), "Migration digest was invalid.");
  assert(
    guardOutput.destructiveMigrations.some(
      ({ filename }) => filename === "0008_category_taxonomy.sql",
    ),
    "Destructive migration inventory was incomplete.",
  );
  assert(
    query(guardTarget, "SELECT COUNT(*) AS count FROM transactions")[0]?.count === 5,
    "Guard restore database did not reconcile.",
  );

  const legacyInput = join(testRoot, "legacy-v3.json");
  const legacyTarget = join(testRoot, "legacy-v3-restored-d1");
  writeFileSync(legacyInput, JSON.stringify({ ...document, schemaVersion: 3 }), "utf8");
  const legacyGuarded = run(process.execPath, [
    remoteMigrationScript,
    "--input",
    legacyInput,
    "--persist-to",
    legacyTarget,
  ]);
  assert(
    legacyGuarded.status === 0,
    `Remote migration guard rejected a v3 backup: ${legacyGuarded.stderr}`,
  );
  assert(
    JSON.parse(legacyGuarded.stdout).status === "READY",
    "Remote migration guard was not ready for a v3 backup.",
  );
  assert(
    query(legacyTarget, "SELECT COUNT(*) AS count FROM transactions")[0]?.count === 5,
    "Legacy guard restore database did not reconcile.",
  );

  const staleInput = join(testRoot, "stale.json");
  const staleTarget = join(testRoot, "stale-guard-d1");
  writeFileSync(
    staleInput,
    serializeFullJsonExport({ ...document, exportedAt: "2000-01-01T00:00:00.000Z" }),
    "utf8",
  );
  const stale = run(process.execPath, [
    remoteMigrationScript,
    "--input",
    staleInput,
    "--persist-to",
    staleTarget,
  ]);
  assert(stale.status !== 0, "Remote migration guard accepted a stale export.");
  assert(stale.stderr.includes("EXPORT_NOT_FRESH"), "Stale-export error was unstable.");
  assert(!existsSync(staleTarget), "Stale export created a restore target.");

  const passthroughTarget = join(testRoot, "passthrough-guard-d1");
  const passthrough = run(process.execPath, [
    remoteMigrationScript,
    "--input",
    input,
    "--persist-to",
    passthroughTarget,
    "--remote",
  ]);
  assert(passthrough.status !== 0, "Remote migration guard accepted a passthrough flag.");
  assert(passthrough.stderr.includes("INVALID_ARGUMENTS"), "Argument error was unstable.");
  assert(!existsSync(passthroughTarget), "Invalid arguments created a restore target.");

  process.stdout.write("Local JSON restore and remote migration guard verification passed.\n");
} finally {
  rmSync(testRoot, { force: true, recursive: true });
}
