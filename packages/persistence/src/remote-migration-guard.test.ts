import { describe, expect, it } from "vitest";

import {
  RemoteMigrationGuardError,
  assertRecentFullJsonExport,
  detectDestructiveMigrationOperations,
  parseVerifiedRestoreCommandOutput,
} from "./remote-migration-guard";

const VALID_OUTPUT = {
  evidence: {
    counts: {
      budgets: 0,
      accounts: 2,
      categories: 4,
      categoryAudits: 1,
      connections: 1,
      importBatches: 1,
      importRows: 1,
      merchantRules: 1,
      subscriptionOccurrences: 1,
      subscriptions: 1,
      transactions: 4,
      transferMatchAudits: 1,
      transferMatches: 1,
    },
    foreignKeyViolations: 0,
    relationshipViolations: 0,
    reportTotals: [
      {
        currency: "CAD",
        incomeMinor: 500_000,
        netCashFlowMinor: 498_766,
        netSpendingMinor: 1_234,
      },
    ],
  },
  schemaVersion: 1,
  target: "/tmp/restored-d1",
};

describe("remote migration guard", () => {
  it("detects data-destructive SQL without treating comments, literals, or DROP INDEX as data loss", () => {
    const sql = `
      -- DROP TABLE ignored_comment;
      SELECT 'DELETE FROM ignored_literal';
      DROP INDEX idx_old;
      UPDATE categories SET id = id;
      DELETE FROM transactions WHERE status = 'REMOVED';
      INSERT OR REPLACE INTO categories (id) VALUES ('x');
      ALTER TABLE accounts DROP COLUMN mask;
      DROP TABLE old_transactions;
      PRAGMA writable_schema = 1;
    `;

    expect(detectDestructiveMigrationOperations(sql)).toEqual([
      "UPDATE",
      "DELETE",
      "INSERT_OR_REPLACE",
      "ALTER_TABLE_DROP_COLUMN",
      "DROP_TABLE",
      "PRAGMA_WRITABLE_SCHEMA",
    ]);
  });

  it("accepts only strict successful v1 restore evidence", () => {
    expect(parseVerifiedRestoreCommandOutput(VALID_OUTPUT)).toEqual(VALID_OUTPUT);
    expect(() =>
      parseVerifiedRestoreCommandOutput({
        ...VALID_OUTPUT,
        evidence: { ...VALID_OUTPUT.evidence, foreignKeyViolations: 1 },
      }),
    ).toThrow(new RemoteMigrationGuardError("RESTORE_EVIDENCE_FAILED"));
    expect(() => parseVerifiedRestoreCommandOutput({ ...VALID_OUTPUT, unexpected: true })).toThrow(
      new RemoteMigrationGuardError("RESTORE_EVIDENCE_INVALID"),
    );
  });

  it("requires an export from the last 24 hours and rejects future timestamps", () => {
    const now = new Date("2026-07-17T12:00:00.000Z");

    expect(() => assertRecentFullJsonExport("2026-07-16T12:00:00.000Z", now)).not.toThrow();
    expect(() => assertRecentFullJsonExport("2026-07-16T11:59:59.999Z", now)).toThrow(
      new RemoteMigrationGuardError("EXPORT_NOT_FRESH"),
    );
    expect(() => assertRecentFullJsonExport("2026-07-17T12:05:00.001Z", now)).toThrow(
      new RemoteMigrationGuardError("EXPORT_FROM_FUTURE"),
    );
  });
});
