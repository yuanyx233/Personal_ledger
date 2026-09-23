import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { FULL_JSON_EXPORT_LIMITS, normalizeFullJsonExport } from "../packages/domain/dist/index.js";
import {
  FullJsonRestoreError,
  calculateFullJsonRestoreEvidence,
  createFullJsonRestoreSql,
  verifyFullJsonRestoreEvidence,
} from "../packages/persistence/dist/index.js";

const workspace = fileURLToPath(new URL("..", import.meta.url));
const wrangler = fileURLToPath(
  new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url),
);
const config = "apps/web/wrangler.jsonc";
const defaultLocalD1 = resolve(workspace, ".wrangler/local-d1");
const USAGE =
  "Usage: npm run db:restore -- --input <export.json> --persist-to <new-directory>\n" +
  "       [--timezone <IANA zone>]  zone of the instance that will serve the restore;\n" +
  "                                 defaults to VITE_APP_TIMEZONE in apps/web/.env\n";

class RestoreCommandError extends Error {
  constructor(code) {
    super(code);
    this.name = "RestoreCommandError";
    this.code = code;
  }
}

function parseArguments(arguments_) {
  if (arguments_.length === 1 && arguments_[0] === "--help") return { help: true };
  const values = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    if (
      (key !== "--input" && key !== "--persist-to" && key !== "--timezone") ||
      value === undefined ||
      value.startsWith("--") ||
      values.has(key)
    ) {
      throw new RestoreCommandError("INVALID_ARGUMENTS");
    }
    values.set(key, value);
  }
  const input = values.get("--input");
  const persistTo = values.get("--persist-to");
  if (!input || !persistTo || values.size > 3) {
    throw new RestoreCommandError("INVALID_ARGUMENTS");
  }
  return { help: false, input, persistTo, timeZone: values.get("--timezone") };
}

function resolvedNewTarget(rawTarget) {
  const target = resolve(workspace, rawTarget);
  if (target === defaultLocalD1) throw new RestoreCommandError("DEFAULT_DATABASE_FORBIDDEN");
  if (existsSync(target)) throw new RestoreCommandError("TARGET_ALREADY_EXISTS");
  const parent = dirname(target);
  if (!existsSync(parent) || !statSync(parent).isDirectory()) {
    throw new RestoreCommandError("TARGET_PARENT_NOT_FOUND");
  }
  return join(realpathSync(parent), target.slice(parent.length + 1));
}

// Dates in a backup were computed in the zone the exporting instance ran in, so
// restoring it under a different one silently shifts which day each entry belongs to.
// The frontend value is used because task 2.5 forces it to equal the Worker's.
function configuredInstanceTimeZone() {
  const envFile = resolve(workspace, "apps/web/.env");
  if (!existsSync(envFile)) return null;
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const match = /^\s*VITE_APP_TIMEZONE\s*=\s*"?([^"\r\n]+)"?\s*$/.exec(line);
    if (match) return match[1].trim();
  }
  return null;
}

function assertTimeZoneAccepted(document, override) {
  const expected = override ?? configuredInstanceTimeZone();
  if (expected === null || expected === document.timezone) return expected;
  process.stderr.write(
    `Backup records ${document.timezone} but this instance is configured for ${expected}. ` +
      "Stored dates were computed in the backup's zone, so restoring here would move them. " +
      "Pass --timezone to state the zone you intend to restore into.\n",
  );
  throw new RestoreCommandError("TIMEZONE_MISMATCH");
}

function readExport(rawInput) {
  const input = resolve(workspace, rawInput);
  if (!existsSync(input) || !statSync(input).isFile()) {
    throw new RestoreCommandError("INPUT_NOT_FOUND");
  }
  const bytes = readFileSync(input);
  if (bytes.byteLength > FULL_JSON_EXPORT_LIMITS.BYTES) {
    throw new RestoreCommandError("INPUT_TOO_LARGE");
  }
  let json;
  try {
    json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new RestoreCommandError("INPUT_ENCODING_INVALID");
  }
  let value;
  try {
    value = JSON.parse(json);
  } catch {
    throw new RestoreCommandError("INPUT_JSON_INVALID");
  }
  try {
    return normalizeFullJsonExport(value);
  } catch {
    throw new RestoreCommandError("INPUT_SCHEMA_INVALID");
  }
}

function runWrangler(arguments_, failureCode) {
  const result = spawnSync(process.execPath, [wrangler, ...arguments_], {
    cwd: workspace,
    encoding: "utf8",
    env: { ...process.env, WRANGLER_WRITE_LOGS: "false" },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    if (process.env.RESTORE_DEBUG === "1") {
      process.stderr.write(`${result.stdout}${result.stderr}`);
    }
    throw new RestoreCommandError(failureCode);
  }
  return result.stdout;
}

function d1Arguments(target) {
  return ["DB", "--local", "--persist-to", target, "--config", config];
}

function query(target, sql) {
  const output = runWrangler(
    ["d1", "execute", ...d1Arguments(target), "--command", sql, "--json"],
    "WRANGLER_QUERY_FAILED",
  );
  let executions;
  try {
    executions = JSON.parse(output);
  } catch {
    if (process.env.RESTORE_DEBUG === "1") process.stderr.write(output);
    throw new RestoreCommandError("WRANGLER_OUTPUT_INVALID");
  }
  return executions.flatMap(({ results }) => results ?? []);
}

function systemCategoryReadModel(row) {
  return {
    active: row.active === 1,
    createdAt: row.created_at,
    editable: row.editable === 1,
    id: row.id,
    kind: row.kind,
    name: row.name,
    systemKey: row.system_key,
    updatedAt: row.updated_at,
    version: row.version,
  };
}

function assertSystemCategories(target, document) {
  const actual = query(
    target,
    `SELECT id, name, kind, system_key, editable, active, created_at, updated_at, version
     FROM categories WHERE system_key IS NOT NULL ORDER BY system_key ASC`,
  ).map(systemCategoryReadModel);
  const expected = document.data.categories
    .filter(({ systemKey }) => systemKey !== null)
    .sort((left, right) => left.systemKey.localeCompare(right.systemKey));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new RestoreCommandError("SYSTEM_CATEGORY_MISMATCH");
  }
}

const EVIDENCE_QUERY = `
  SELECT
    (SELECT COUNT(*) FROM category_budgets) AS budgets,
    (SELECT COUNT(*) FROM categories) AS categories,
    (SELECT COUNT(*) FROM category_audits) AS categoryAudits,
    (SELECT COUNT(*) FROM import_batches) AS importBatches,
    (SELECT COUNT(*) FROM import_rows) AS importRows,
    (SELECT COUNT(*) FROM merchant_rules) AS merchantRules,
    (SELECT COUNT(*) FROM subscription_occurrences) AS subscriptionOccurrences,
    (SELECT COUNT(*) FROM subscriptions) AS subscriptions,
    (SELECT COUNT(*) FROM transactions) AS transactions,
    (
      (SELECT COUNT(*) FROM merchant_rules AS child
       LEFT JOIN categories AS parent ON parent.id = child.category_id
       WHERE parent.id IS NULL) +
      (SELECT COUNT(*) FROM subscriptions AS child
       LEFT JOIN categories AS parent ON parent.id = child.category_id
       WHERE parent.id IS NULL) +
      (SELECT COUNT(*) FROM subscription_occurrences AS child
       LEFT JOIN subscriptions AS subscription ON subscription.id = child.subscription_id
       LEFT JOIN transactions AS transaction_record ON transaction_record.id = child.transaction_id
       WHERE subscription.id IS NULL OR transaction_record.id IS NULL) +
      (SELECT COUNT(*) FROM transactions AS child
       LEFT JOIN categories AS parent ON parent.id = child.category_id
       WHERE child.category_id IS NOT NULL AND parent.id IS NULL) +
      (SELECT COUNT(*) FROM transactions AS child
       LEFT JOIN merchant_rules AS parent ON parent.id = child.category_rule_id
       WHERE child.category_rule_id IS NOT NULL AND parent.id IS NULL) +
      (SELECT COUNT(*) FROM transactions AS child
       LEFT JOIN transactions AS parent ON parent.id = child.pending_transaction_id
       WHERE child.pending_transaction_id IS NOT NULL AND parent.id IS NULL) +
      (SELECT COUNT(*) FROM category_audits AS child
       LEFT JOIN transactions AS parent ON parent.id = child.transaction_id
       WHERE parent.id IS NULL) +
      (SELECT COUNT(*) FROM import_rows AS child
       LEFT JOIN import_batches AS batch ON batch.id = child.batch_id
       LEFT JOIN transactions AS transaction_record ON transaction_record.id = child.transaction_id
       WHERE batch.id IS NULL OR (child.transaction_id IS NOT NULL AND transaction_record.id IS NULL))
    ) AS relationshipViolations
`;

const REPORT_QUERY = `
  SELECT
    transaction_record.currency AS currency,
    SUM(CASE
      WHEN category.kind = 'INCOME' AND transaction_record.direction = 'INFLOW'
        THEN transaction_record.amount_minor - transaction_record.reimbursement_minor
      WHEN category.kind = 'INCOME' AND transaction_record.direction = 'OUTFLOW'
        THEN -(transaction_record.amount_minor - transaction_record.reimbursement_minor)
      ELSE 0
    END) AS incomeMinor,
    SUM(CASE
      WHEN category.kind = 'EXPENSE' AND transaction_record.direction = 'OUTFLOW'
        THEN transaction_record.amount_minor - transaction_record.reimbursement_minor
      WHEN category.kind = 'EXPENSE' AND transaction_record.direction = 'INFLOW'
        THEN -(transaction_record.amount_minor - transaction_record.reimbursement_minor)
      ELSE 0
    END) AS netSpendingMinor
  FROM transactions AS transaction_record
  JOIN categories AS category ON category.id = transaction_record.category_id
  WHERE transaction_record.status = 'POSTED'
    AND category.kind IN ('INCOME', 'EXPENSE')
  GROUP BY transaction_record.currency
  ORDER BY transaction_record.currency ASC
`;

function restoredEvidence(target) {
  const [counts] = query(target, EVIDENCE_QUERY);
  if (!counts) throw new RestoreCommandError("RECONCILIATION_QUERY_FAILED");
  const reportTotals = query(target, REPORT_QUERY).map((row) => ({
    currency: row.currency,
    incomeMinor: row.incomeMinor,
    netCashFlowMinor: row.incomeMinor - row.netSpendingMinor,
    netSpendingMinor: row.netSpendingMinor,
  }));
  return {
    counts: {
      budgets: counts.budgets,
      categories: counts.categories,
      categoryAudits: counts.categoryAudits,
      importBatches: counts.importBatches,
      importRows: counts.importRows,
      merchantRules: counts.merchantRules,
      subscriptionOccurrences: counts.subscriptionOccurrences,
      subscriptions: counts.subscriptions,
      transactions: counts.transactions,
    },
    foreignKeyViolations: query(target, "PRAGMA foreign_key_check").length,
    relationshipViolations: counts.relationshipViolations,
    reportTotals,
  };
}

function main() {
  let target;
  let temporaryDirectory;
  try {
    const arguments_ = parseArguments(process.argv.slice(2));
    if (arguments_.help) {
      process.stdout.write(USAGE);
      return;
    }
    const document = readExport(arguments_.input);
    assertTimeZoneAccepted(document, arguments_.timeZone);
    const expectedEvidence = calculateFullJsonRestoreEvidence(document);
    const sql = createFullJsonRestoreSql(document);
    target = resolvedNewTarget(arguments_.persistTo);
    mkdirSync(target);

    runWrangler(["d1", "migrations", "apply", ...d1Arguments(target)], "MIGRATION_FAILED");
    assertSystemCategories(target, document);

    temporaryDirectory = mkdtempSync(join(tmpdir(), "personal-ledger-restore-"));
    const sqlFile = join(temporaryDirectory, "restore.sql");
    writeFileSync(sqlFile, sql, { encoding: "utf8", mode: 0o600 });
    runWrangler(
      ["d1", "execute", ...d1Arguments(target), "--file", sqlFile, "--yes"],
      "IMPORT_FAILED",
    );

    const actualEvidence = restoredEvidence(target);
    verifyFullJsonRestoreEvidence(expectedEvidence, actualEvidence);
    process.stdout.write(
      `${JSON.stringify({ evidence: actualEvidence, schemaVersion: 1, target })}\n` +
        "Local JSON restore verified.\n",
    );
  } catch (error) {
    const code =
      error instanceof RestoreCommandError || error instanceof FullJsonRestoreError
        ? error.code
        : "RESTORE_FAILED";
    process.stderr.write(`Local JSON restore failed: ${code}.\n`);
    if (target) process.stderr.write(`Isolated target preserved at ${target}.\n`);
    process.exitCode = 1;
  } finally {
    if (temporaryDirectory) rmSync(temporaryDirectory, { force: true, recursive: true });
  }
}

main();
