import * as z from "zod";

export type RemoteMigrationGuardErrorCode =
  | "EXPORT_FROM_FUTURE"
  | "EXPORT_NOT_FRESH"
  | "EXPORT_TIMESTAMP_INVALID"
  | "RESTORE_EVIDENCE_FAILED"
  | "RESTORE_EVIDENCE_INVALID";

export class RemoteMigrationGuardError extends Error {
  constructor(readonly code: RemoteMigrationGuardErrorCode) {
    super(code);
    this.name = "RemoteMigrationGuardError";
  }
}

export type DestructiveMigrationOperation =
  | "ALTER_TABLE_DROP_COLUMN"
  | "DELETE"
  | "DROP_TABLE"
  | "INSERT_OR_REPLACE"
  | "PRAGMA_WRITABLE_SCHEMA"
  | "REPLACE"
  | "TRUNCATE"
  | "UPDATE";

const recordCountsSchema = z.strictObject({
  budgets: z.int().nonnegative().default(0),
  accounts: z.int().nonnegative(),
  categories: z.int().nonnegative(),
  categoryAudits: z.int().nonnegative(),
  connections: z.int().nonnegative(),
  importBatches: z.int().nonnegative(),
  importRows: z.int().nonnegative(),
  merchantRules: z.int().nonnegative(),
  subscriptionOccurrences: z.int().nonnegative(),
  subscriptions: z.int().nonnegative(),
  transactions: z.int().nonnegative(),
  transferMatchAudits: z.int().nonnegative(),
  transferMatches: z.int().nonnegative(),
});

const restoreCommandOutputSchema = z.strictObject({
  evidence: z.strictObject({
    counts: recordCountsSchema,
    foreignKeyViolations: z.int().nonnegative(),
    relationshipViolations: z.int().nonnegative(),
    reportTotals: z.array(
      z.strictObject({
        currency: z.string().regex(/^[A-Z]{3}$/),
        incomeMinor: z.int(),
        netCashFlowMinor: z.int(),
        netSpendingMinor: z.int(),
      }),
    ),
  }),
  schemaVersion: z.literal(1),
  target: z.string().min(1),
});

export type VerifiedRestoreCommandOutput = z.infer<typeof restoreCommandOutputSchema>;

function stripSqlCommentsAndQuotedValues(sql: string): string {
  let output = "";
  let index = 0;
  while (index < sql.length) {
    const current = sql[index]!;
    const next = sql[index + 1];
    if (current === "-" && next === "-") {
      index += 2;
      while (index < sql.length && sql[index] !== "\n") index += 1;
      output += "\n";
      continue;
    }
    if (current === "/" && next === "*") {
      index += 2;
      while (index < sql.length && !(sql[index] === "*" && sql[index + 1] === "/")) index += 1;
      index = Math.min(index + 2, sql.length);
      output += " ";
      continue;
    }
    if (current === "'" || current === '"' || current === "`") {
      const quote = current;
      index += 1;
      while (index < sql.length) {
        if (sql[index] === quote) {
          if (sql[index + 1] === quote) {
            index += 2;
            continue;
          }
          index += 1;
          break;
        }
        index += 1;
      }
      output += " ";
      continue;
    }
    if (current === "[") {
      index += 1;
      while (index < sql.length && sql[index] !== "]") index += 1;
      index = Math.min(index + 1, sql.length);
      output += " ";
      continue;
    }
    output += current;
    index += 1;
  }
  return output;
}

export function detectDestructiveMigrationOperations(sql: string): DestructiveMigrationOperation[] {
  const operations = new Set<DestructiveMigrationOperation>();
  const statements = stripSqlCommentsAndQuotedValues(sql).split(";");
  for (const statement of statements) {
    const tokens = statement.toUpperCase().match(/[A-Z_]+/g) ?? [];
    if (tokens.length === 0) continue;
    const [first, second, third] = tokens;
    if (first === "UPDATE") operations.add("UPDATE");
    if (first === "DELETE") operations.add("DELETE");
    if (first === "REPLACE") operations.add("REPLACE");
    if (first === "INSERT" && second === "OR" && third === "REPLACE") {
      operations.add("INSERT_OR_REPLACE");
    }
    if (first === "DROP" && second === "TABLE") operations.add("DROP_TABLE");
    if (
      first === "ALTER" &&
      second === "TABLE" &&
      tokens.some((token, index) => token === "DROP" && tokens[index + 1] === "COLUMN")
    ) {
      operations.add("ALTER_TABLE_DROP_COLUMN");
    }
    if (first === "TRUNCATE") operations.add("TRUNCATE");
    if (first === "PRAGMA" && second === "WRITABLE_SCHEMA") {
      operations.add("PRAGMA_WRITABLE_SCHEMA");
    }
    if (first === "WITH") {
      const remainingTokens = new Set<string>(tokens.slice(1));
      if (remainingTokens.has("UPDATE")) operations.add("UPDATE");
      if (remainingTokens.has("DELETE")) operations.add("DELETE");
      if (remainingTokens.has("REPLACE")) operations.add("REPLACE");
    }
  }
  return [...operations];
}

export function parseVerifiedRestoreCommandOutput(value: unknown): VerifiedRestoreCommandOutput {
  const result = restoreCommandOutputSchema.safeParse(value);
  if (!result.success) throw new RemoteMigrationGuardError("RESTORE_EVIDENCE_INVALID");
  if (
    result.data.evidence.foreignKeyViolations !== 0 ||
    result.data.evidence.relationshipViolations !== 0
  ) {
    throw new RemoteMigrationGuardError("RESTORE_EVIDENCE_FAILED");
  }
  return result.data;
}

export function assertRecentFullJsonExport(exportedAt: string, now = new Date()): void {
  const timestamp = Date.parse(exportedAt);
  if (!Number.isFinite(timestamp)) {
    throw new RemoteMigrationGuardError("EXPORT_TIMESTAMP_INVALID");
  }
  const age = now.getTime() - timestamp;
  if (age > 24 * 60 * 60 * 1000) {
    throw new RemoteMigrationGuardError("EXPORT_NOT_FRESH");
  }
  if (age < -5 * 60 * 1000) {
    throw new RemoteMigrationGuardError("EXPORT_FROM_FUTURE");
  }
}
