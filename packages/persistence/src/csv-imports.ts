import {
  CATEGORY_IDS,
  canonicalImportRowKey,
  csvImportAmountToMinorUnits,
  csvImportCommitRequestSchema,
  csvImportCommitResponseSchema,
  csvImportExistingMatchSchema,
  csvImportRawRowSchema,
  csvImportRowErrorSchema,
  normalizeMerchantName,
  importedMerchantFamily,
  importedDefaultCategory,
  type CanonicalImportRowCandidate,
  type CsvImportCommitRequest,
  type CsvImportCommittedBatch,
  type CsvImportExistingMatch,
  type CsvImportPreview,
  type CsvImportPreviewRow,
  type CsvImportRawRow,
} from "@ledger/domain";

const CANDIDATE_CHUNK_SIZE = 250;
const INSERT_CHUNK_SIZE = 100;

export type CsvImportCommitPersistenceErrorCode =
  | "CONFLICT"
  | "IDEMPOTENCY_CONFLICT"
  | "INVALID_INPUT"
  | "NOT_FOUND"
  | "PREVIEW_EXPIRED"
  | "READ_FAILED"
  | "VERSION_CONFLICT"
  | "WRITE_FAILED";

export class CsvImportCommitPersistenceError extends Error {
  constructor(
    readonly code: CsvImportCommitPersistenceErrorCode,
    readonly currentVersion?: number,
  ) {
    super(code);
    this.name = "CsvImportCommitPersistenceError";
  }
}

export interface CommitCsvImportInput extends CsvImportCommitRequest {
  batchId: string;
  idempotencyKey: string;
  now: string;
}

export interface CommittedCsvImportResult {
  importBatch: CsvImportCommittedBatch;
  replayed: boolean;
}

export type CsvImportPreviewPersistenceErrorCode =
  "CONFLICT" | "INVALID_INPUT" | "READ_FAILED" | "WRITE_FAILED";

export class CsvImportPreviewPersistenceError extends Error {
  constructor(readonly code: CsvImportPreviewPersistenceErrorCode) {
    super(code);
    this.name = "CsvImportPreviewPersistenceError";
  }
}

export interface StageCsvImportPreviewInput {
  contentChecksum: string;
  expiresAt: string;
  now: string;
  preview: CsvImportPreview;
  sourceFileNameHash: string;
}

interface StagedCsvImportPreviewBase {
  expiresAt: string;
  id: string;
  version: number;
}

export type StagedCsvImportPreview = StagedCsvImportPreviewBase &
  ({ kind: "CREATED" | "REFRESHED" } | { kind: "REPLAYED"; preview: CsvImportPreview });

export interface CsvImportPreviewRepositoryOptions {
  createId?: () => string;
}

interface ImportBatchRow {
  id: string;
  preview_expires_at: string;
  status: string;
  version: number;
}

interface DuplicateCandidateRow {
  account_label: string;
  amount_minor: number;
  candidate_key: string;
  currency: string;
  direction: string;
  posted_date: string;
  raw_description: string;
}

interface ExistingTransactionCandidateRow {
  category_rule_id: string | null;
  merchant_name: string | null;
  normalized_merchant: string | null;
  owner_rule_active: number | null;
  posted_date: string;
  raw_description: string;
  row_number: number;
  transaction_id: string;
  transaction_source: string;
  transaction_version: number;
}

function dayDistance(left: string, right: string): number {
  return Math.round(
    Math.abs(Date.parse(`${left}T00:00:00.000Z`) - Date.parse(`${right}T00:00:00.000Z`)) /
      86_400_000,
  );
}

interface CommitBatchRow {
  committed_at: string | null;
  content_checksum: string;
  id: string;
  idempotency_key: string;
  preview_expires_at: string;
  source_filename_hash: string | null;
  status: string;
  version: number;
}

interface CommitImportRow {
  canonical_fingerprint: string | null;
  errors_json: string;
  match_evidence_json: string | null;
  raw_json: string;
  resolution: string;
  resolved_at: string | null;
  row_number: number;
  transaction_id: string | null;
  validation_status: string;
}

type DuplicateEvidence =
  | "EXACT_REPEAT"
  | "FINGERPRINT_ALREADY_COMMITTED"
  | "SUSPECTED_EXISTING"
  | "SUSPECTED_SAME_FILE"
  | null;

interface ParsedCommitRow extends CommitImportRow {
  duplicateEvidence: DuplicateEvidence;
  existingMatch: CsvImportExistingMatch | null;
  raw: CsvImportRawRow;
}

type ReviewDecision = CsvImportCommitRequest["reviewDecisions"][number];

interface MergeCommitRow {
  candidateVersion: number;
  resolution: "AUTO_MERGED" | "OWNER_MERGED";
  rowNumber: number;
  transactionId: string;
}

interface SelectedCommitRow {
  accountLabel: string;
  amount: string;
  amountMinor: number;
  categoryRef: string | null;
  defaultCategoryId: string | null;
  familyRuleIds: string[];
  currency: "CAD" | "USD";
  description: string;
  direction: "INFLOW" | "OUTFLOW";
  fingerprint: string;
  merchant: string | null;
  normalizedMerchant: string | null;
  postedDate: string;
  rowNumber: number;
  transactionId: string;
}

function defaultCreateId(): string {
  return `import-preview-${crypto.randomUUID()}`;
}

function assertStageInput(input: StageCsvImportPreviewInput): void {
  const validInstant = (value: string) => !Number.isNaN(Date.parse(value));
  const counts = input.preview.counts;
  if (
    !/^[a-f0-9]{64}$/.test(input.contentChecksum) ||
    !/^[a-f0-9]{64}$/.test(input.sourceFileNameHash) ||
    !validInstant(input.expiresAt) ||
    !validInstant(input.now) ||
    input.expiresAt <= input.now ||
    counts.total !== input.preview.rows.length ||
    counts.valid + counts.invalid + counts.duplicate !== counts.total ||
    input.preview.columns.length < 1 ||
    input.preview.columns.length > 32 ||
    input.preview.rows.some(
      (row) =>
        row.rowNumber < 2 ||
        !Number.isInteger(row.rowNumber) ||
        (row.status !== "INVALID" && row.canonicalFingerprint === null),
    )
  ) {
    throw new CsvImportPreviewPersistenceError("INVALID_INPUT");
  }
}

function candidateFromRow(row: CsvImportPreviewRow) {
  if (row.status !== "VALID" || row.duplicateKey === null) return null;
  const amount = row.raw.amount.split(".");
  const amountMinor = Number(amount[0]) * 100 + Number((amount[1] ?? "").padEnd(2, "0"));
  return {
    amountMinor,
    currency: row.raw.currency,
    direction: row.raw.direction,
    key: row.duplicateKey,
    postedDate: row.raw.postedDate,
  };
}

export class CsvImportPreviewRepository {
  private readonly createId: () => string;

  constructor(
    private readonly database: D1Database,
    options: CsvImportPreviewRepositoryOptions = {},
  ) {
    this.createId = options.createId ?? defaultCreateId;
  }

  async listActiveCategoryReferences(): Promise<Set<string>> {
    try {
      const result = await this.database
        .prepare(
          "SELECT id, name FROM categories WHERE active = 1 AND editable = 1 ORDER BY id LIMIT 1000",
        )
        .all<{ id: string; name: string }>();
      return new Set(result.results.flatMap(({ id, name }) => [id, name]));
    } catch {
      throw new CsvImportPreviewPersistenceError("READ_FAILED");
    }
  }

  async findSuspectedDuplicateKeys(rows: CsvImportPreviewRow[]): Promise<Set<string>> {
    const candidates = rows.flatMap((row) => {
      const candidate = candidateFromRow(row);
      return candidate ? [candidate] : [];
    });
    const suspected = new Set<string>();

    try {
      for (let index = 0; index < candidates.length; index += CANDIDATE_CHUNK_SIZE) {
        const chunk = candidates.slice(index, index + CANDIDATE_CHUNK_SIZE);
        const result = await this.database
          .prepare(
            `WITH candidates AS (
               SELECT
                 json_extract(value, '$.key') AS candidate_key,
                 json_extract(value, '$.postedDate') AS posted_date,
                 CAST(json_extract(value, '$.amountMinor') AS INTEGER) AS amount_minor,
                 json_extract(value, '$.direction') AS direction,
                 json_extract(value, '$.currency') AS currency
               FROM json_each(?)
             )
             SELECT
               candidates.candidate_key,
               transactions.posted_date,
               transactions.amount_minor,
               transactions.direction,
               transactions.currency,
               transactions.raw_description,
               COALESCE(transactions.account_label, accounts.display_name, '') AS account_label
             FROM candidates
             INNER JOIN transactions
               ON transactions.posted_date = candidates.posted_date
              AND transactions.amount_minor = candidates.amount_minor
              AND transactions.direction = candidates.direction
              AND transactions.currency = candidates.currency
              AND transactions.status != 'REMOVED'
             LEFT JOIN accounts ON accounts.id = transactions.account_id`,
          )
          .bind(JSON.stringify(chunk))
          .all<DuplicateCandidateRow>();

        for (const row of result.results) {
          if (
            (row.currency !== "CAD" && row.currency !== "USD") ||
            (row.direction !== "INFLOW" && row.direction !== "OUTFLOW")
          ) {
            continue;
          }
          const existing: CanonicalImportRowCandidate = {
            accountLabel: row.account_label,
            amountMinor: row.amount_minor,
            currency: row.currency,
            description: row.raw_description,
            direction: row.direction,
            postedDate: row.posted_date,
          };
          if (canonicalImportRowKey(existing) === row.candidate_key) {
            suspected.add(row.candidate_key);
          }
        }
      }
      return suspected;
    } catch {
      throw new CsvImportPreviewPersistenceError("READ_FAILED");
    }
  }

  async findExistingMatches(
    rows: CsvImportPreviewRow[],
  ): Promise<Map<number, CsvImportExistingMatch>> {
    const inputs = rows.flatMap((row) => {
      if (row.status === "INVALID") return [];
      const amountMinor = csvImportAmountToMinorUnits(row.raw.amount);
      if (
        amountMinor === null ||
        (row.raw.currency !== "CAD" && row.raw.currency !== "USD") ||
        (row.raw.direction !== "INFLOW" && row.raw.direction !== "OUTFLOW")
      ) {
        return [];
      }
      return [
        {
          accountLabel: row.raw.accountLabel,
          amountMinor,
          currency: row.raw.currency,
          direction: row.raw.direction,
          normalizedDescription: normalizeMerchantName(row.raw.description),
          normalizedMerchant: normalizeMerchantName(row.raw.merchant ?? row.raw.description),
          postedDate: row.raw.postedDate,
          rowNumber: row.rowNumber,
        },
      ];
    });
    if (inputs.length === 0) return new Map();

    const inputByRow = new Map(inputs.map((input) => [input.rowNumber, input]));
    const qualifiedByRow = new Map<number, Array<CsvImportExistingMatch["candidates"][number]>>();
    const nonManualConflicts = new Set<number>();
    try {
      for (let index = 0; index < inputs.length; index += CANDIDATE_CHUNK_SIZE) {
        const chunk = inputs.slice(index, index + CANDIDATE_CHUNK_SIZE);
        const result = await this.database
          .prepare(
            `WITH input AS (
               SELECT
                 CAST(json_extract(value, '$.rowNumber') AS INTEGER) AS row_number,
                 json_extract(value, '$.accountLabel') AS account_label,
                 CAST(json_extract(value, '$.amountMinor') AS INTEGER) AS amount_minor,
                 json_extract(value, '$.currency') AS currency,
                 json_extract(value, '$.direction') AS direction,
                 json_extract(value, '$.postedDate') AS posted_date
               FROM json_each(?)
             )
             SELECT input.row_number,
                    ledger_transaction.id AS transaction_id,
                    ledger_transaction.source AS transaction_source,
                    ledger_transaction.version AS transaction_version,
                    ledger_transaction.posted_date,
                    ledger_transaction.raw_description,
                    ledger_transaction.merchant_name,
                    ledger_transaction.normalized_merchant,
                    ledger_transaction.category_rule_id,
                    CASE WHEN active_rule.id IS NULL THEN 0 ELSE 1 END AS owner_rule_active
             FROM input
             JOIN transactions AS ledger_transaction
               ON ledger_transaction.status = 'POSTED'
              AND ledger_transaction.amount_minor = input.amount_minor
              AND ledger_transaction.currency = input.currency
              AND ledger_transaction.direction = input.direction
              AND abs(julianday(ledger_transaction.posted_date) - julianday(input.posted_date)) <= 3
             LEFT JOIN accounts AS ledger_account
               ON ledger_account.id = ledger_transaction.account_id
             LEFT JOIN merchant_rules AS active_rule
               ON active_rule.id = ledger_transaction.category_rule_id AND active_rule.active = 1
             WHERE COALESCE(
                     ledger_transaction.account_label,
                     ledger_account.display_name,
                     ''
                   ) = input.account_label
               AND NOT EXISTS (
               SELECT 1
               FROM import_rows AS committed_row
               JOIN import_batches AS committed_batch ON committed_batch.id = committed_row.batch_id
               WHERE committed_row.transaction_id = ledger_transaction.id
                 AND committed_batch.status = 'COMMITTED'
                 AND committed_row.resolution IN ('AUTO_MERGED', 'OWNER_MERGED')
             )
             ORDER BY input.row_number, ledger_transaction.posted_date, ledger_transaction.id`,
          )
          .bind(JSON.stringify(chunk))
          .all<ExistingTransactionCandidateRow>();

        for (const candidate of result.results) {
          const input = inputByRow.get(candidate.row_number);
          if (!input) continue;
          const distance = dayDistance(input.postedDate, candidate.posted_date);
          const existingMerchant =
            candidate.normalized_merchant ??
            normalizeMerchantName(candidate.merchant_name ?? candidate.raw_description);
          const merchantExact =
            input.normalizedMerchant !== null && input.normalizedMerchant === existingMerchant;
          const descriptionExact =
            distance === 0 &&
            input.normalizedDescription !== null &&
            input.normalizedDescription === normalizeMerchantName(candidate.raw_description);
          const evidence =
            merchantExact && candidate.owner_rule_active === 1
              ? "OWNER_RULE_EXACT"
              : merchantExact
                ? "MERCHANT_EXACT"
                : descriptionExact
                  ? "DESCRIPTION_EXACT"
                  : null;
          if (evidence === null) continue;
          if (candidate.transaction_source !== "MANUAL") {
            nonManualConflicts.add(candidate.row_number);
            continue;
          }
          const matches = qualifiedByRow.get(candidate.row_number) ?? [];
          matches.push({
            dateDistanceDays: distance,
            description: candidate.raw_description.slice(0, 512),
            evidence,
            postedDate: candidate.posted_date,
            subscriptionName: null,
            subscriptionOccurrenceId: null,
            transactionId: candidate.transaction_id,
            transactionVersion: candidate.transaction_version,
          });
          qualifiedByRow.set(candidate.row_number, matches);
        }
      }
    } catch {
      throw new CsvImportPreviewPersistenceError("READ_FAILED");
    }

    const transactionClaims = new Map<string, number>();
    for (const candidates of qualifiedByRow.values()) {
      for (const { transactionId } of candidates) {
        transactionClaims.set(transactionId, (transactionClaims.get(transactionId) ?? 0) + 1);
      }
    }
    const rowByNumber = new Map(rows.map((row) => [row.rowNumber, row]));
    const matches = new Map<number, CsvImportExistingMatch>();
    for (const [rowNumber, allCandidates] of qualifiedByRow) {
      const candidates = allCandidates.slice(0, 10);
      const only = allCandidates.length === 1 ? allCandidates[0]! : null;
      const automatic =
        only !== null &&
        transactionClaims.get(only.transactionId) === 1 &&
        !nonManualConflicts.has(rowNumber) &&
        rowByNumber.get(rowNumber)?.duplicateEvidence !== "SUSPECTED_SAME_FILE";
      matches.set(rowNumber, {
        candidates,
        disposition: automatic ? "AUTO_MERGE_EXISTING" : "SUSPECTED_EXISTING",
      });
    }
    return matches;
  }

  private insertStatements(
    batchId: string,
    now: string,
    rows: CsvImportPreviewRow[],
  ): D1PreparedStatement[] {
    const statements: D1PreparedStatement[] = [];
    for (let index = 0; index < rows.length; index += INSERT_CHUNK_SIZE) {
      const chunk = rows.slice(index, index + INSERT_CHUNK_SIZE).map((row) => ({
        canonicalFingerprint: row.canonicalFingerprint,
        errorsJson: JSON.stringify({
          duplicateEvidence: row.duplicateEvidence,
          fieldErrors: row.errors,
        }),
        id: `${batchId}-row-${row.rowNumber}`,
        matchEvidenceJson: row.existingMatch === null ? null : JSON.stringify(row.existingMatch),
        rawJson: JSON.stringify(row.raw),
        rowNumber: row.rowNumber,
        status: row.status,
      }));
      statements.push(
        this.database
          .prepare(
            `INSERT INTO import_rows (
               id, batch_id, row_number, raw_json, canonical_fingerprint,
               validation_status, errors_json, transaction_id, created_at,
               resolution, match_evidence_json, resolved_at
             )
             SELECT
               json_extract(value, '$.id'), ?,
               CAST(json_extract(value, '$.rowNumber') AS INTEGER),
               json_extract(value, '$.rawJson'),
               json_extract(value, '$.canonicalFingerprint'),
               json_extract(value, '$.status'),
               json_extract(value, '$.errorsJson'), NULL, ?, 'UNRESOLVED',
               json_extract(value, '$.matchEvidenceJson'), NULL
             FROM json_each(?)`,
          )
          .bind(batchId, now, JSON.stringify(chunk)),
      );
    }
    return statements;
  }

  private async readStagedPreview(
    batchId: string,
    template: CsvImportPreview,
  ): Promise<CsvImportPreview> {
    try {
      const result = await this.database
        .prepare(
          `SELECT row_number, raw_json, canonical_fingerprint, validation_status,
                  errors_json, transaction_id, resolution, match_evidence_json, resolved_at
           FROM import_rows WHERE batch_id = ? ORDER BY row_number`,
        )
        .bind(batchId)
        .all<CommitImportRow>();
      const rows = result.results.map((stored): CsvImportPreviewRow => {
        const row = parseCommitRow(stored);
        const errors = parseFieldErrors(row.errors_json);
        const status =
          row.validation_status === "VALID"
            ? "VALID"
            : row.validation_status === "INVALID"
              ? "INVALID"
              : row.validation_status === "DUPLICATE"
                ? "DUPLICATE"
                : null;
        if (
          status === null ||
          row.resolution !== "UNRESOLVED" ||
          row.resolved_at !== null ||
          row.transaction_id !== null ||
          row.validation_status === "IMPORTED" ||
          row.duplicateEvidence === "FINGERPRINT_ALREADY_COMMITTED"
        ) {
          throw new CsvImportCommitPersistenceError("READ_FAILED");
        }
        return {
          canonicalFingerprint: row.canonical_fingerprint,
          duplicateEvidence: row.duplicateEvidence,
          duplicateKey: null,
          errors,
          existingMatch: row.existingMatch,
          raw: row.raw,
          rowNumber: row.row_number,
          status,
        };
      });
      return {
        adapter: template.adapter,
        columns: [...template.columns],
        counts: {
          duplicate: rows.filter(({ status }) => status === "DUPLICATE").length,
          invalid: rows.filter(({ status }) => status === "INVALID").length,
          total: rows.length,
          valid: rows.filter(({ status }) => status === "VALID").length,
        },
        rows,
      };
    } catch (error) {
      if (error instanceof CsvImportPreviewPersistenceError) throw error;
      throw new CsvImportPreviewPersistenceError("READ_FAILED");
    }
  }

  async stagePreview(input: StageCsvImportPreviewInput): Promise<StagedCsvImportPreview> {
    assertStageInput(input);

    let existing: ImportBatchRow | null;
    try {
      existing = await this.database
        .prepare(
          `SELECT id, preview_expires_at, status, version
           FROM import_batches WHERE content_checksum = ?`,
        )
        .bind(input.contentChecksum)
        .first<ImportBatchRow>();
    } catch {
      throw new CsvImportPreviewPersistenceError("READ_FAILED");
    }

    if (existing?.status === "PREVIEWED" && existing.preview_expires_at > input.now) {
      return {
        expiresAt: existing.preview_expires_at,
        id: existing.id,
        kind: "REPLAYED",
        preview: await this.readStagedPreview(existing.id, input.preview),
        version: existing.version,
      };
    }
    if (existing && existing.status !== "PREVIEWED") {
      throw new CsvImportPreviewPersistenceError("CONFLICT");
    }

    const id = existing?.id ?? this.createId();
    const nextVersion = existing ? existing.version + 1 : 1;
    const statements = existing
      ? [
          this.database.prepare("DELETE FROM import_rows WHERE batch_id = ?").bind(id),
          this.database
            .prepare(
              `UPDATE import_batches
               SET status = 'PREVIEWED', preview_expires_at = ?, committed_at = NULL,
                   created_at = ?, source_filename_hash = ?, version = version + 1
               WHERE id = ?`,
            )
            .bind(input.expiresAt, input.now, input.sourceFileNameHash, id),
        ]
      : [
          this.database
            .prepare(
              `INSERT INTO import_batches (
                 id, content_checksum, idempotency_key, status,
                 preview_expires_at, created_at, committed_at, version,
                 source_filename_hash
               ) VALUES (?, ?, ?, 'PREVIEWED', ?, ?, NULL, 1, ?)`,
            )
            .bind(
              id,
              input.contentChecksum,
              `preview:${input.contentChecksum}`,
              input.expiresAt,
              input.now,
              input.sourceFileNameHash,
            ),
        ];
    statements.push(...this.insertStatements(id, input.now, input.preview.rows));

    try {
      await this.database.batch(statements);
      return {
        expiresAt: input.expiresAt,
        id,
        kind: existing ? "REFRESHED" : "CREATED",
        version: nextVersion,
      };
    } catch {
      throw new CsvImportPreviewPersistenceError("WRITE_FAILED");
    }
  }
}

const COMMIT_BATCH_COLUMNS = `
  id, content_checksum, idempotency_key, status, preview_expires_at,
  created_at, committed_at, version, source_filename_hash
`;

function defaultCreateTransactionId(batchId: string, rowNumber: number): string {
  return `csv-${batchId.slice(-64)}-${rowNumber}`;
}

async function ownerNewFingerprint(
  batchId: string,
  rowNumber: number,
  canonicalFingerprint: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify(["CSV_IMPORT_OWNER_NEW_V1", batchId, rowNumber, canonicalFingerprint]),
    ),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseDuplicateEvidence(errorsJson: string): DuplicateEvidence {
  try {
    const parsed = JSON.parse(errorsJson) as { duplicateEvidence?: unknown };
    const evidence = parsed.duplicateEvidence ?? null;
    if (
      evidence === null ||
      evidence === "EXACT_REPEAT" ||
      evidence === "SUSPECTED_EXISTING" ||
      evidence === "SUSPECTED_SAME_FILE" ||
      evidence === "FINGERPRINT_ALREADY_COMMITTED"
    ) {
      return evidence;
    }
  } catch {
    // The caller maps malformed staged data to a sanitized persistence error.
  }
  throw new CsvImportCommitPersistenceError("READ_FAILED");
}

function parseFieldErrors(errorsJson: string) {
  try {
    const parsed = JSON.parse(errorsJson) as { fieldErrors?: unknown };
    const fieldErrors = csvImportRowErrorSchema.array().safeParse(parsed.fieldErrors);
    if (fieldErrors.success) return fieldErrors.data;
  } catch {
    // The caller maps malformed staged data to a sanitized persistence error.
  }
  throw new CsvImportCommitPersistenceError("READ_FAILED");
}

function parseCommitRow(row: CommitImportRow): ParsedCommitRow {
  const raw = csvImportRawRowSchema.safeParse(JSON.parse(row.raw_json) as unknown);
  const existingMatch =
    row.match_evidence_json === null
      ? { data: null, success: true as const }
      : csvImportExistingMatchSchema.safeParse(JSON.parse(row.match_evidence_json) as unknown);
  if (
    !raw.success ||
    !existingMatch.success ||
    !Number.isInteger(row.row_number) ||
    row.row_number < 2 ||
    !["VALID", "INVALID", "DUPLICATE", "IMPORTED"].includes(row.validation_status) ||
    ![
      "UNRESOLVED",
      "IMPORTED_NEW",
      "AUTO_MERGED",
      "OWNER_MERGED",
      "SKIPPED_INVALID",
      "SKIPPED_DUPLICATE",
    ].includes(row.resolution) ||
    (row.validation_status !== "INVALID" && !/^[a-f0-9]{64}$/.test(row.canonical_fingerprint ?? ""))
  ) {
    throw new CsvImportCommitPersistenceError("READ_FAILED");
  }
  return {
    ...row,
    duplicateEvidence: parseDuplicateEvidence(row.errors_json),
    existingMatch: existingMatch.data,
    raw: raw.data,
  };
}

async function selectedRowPayload(
  batchId: string,
  row: ParsedCommitRow,
  createTransactionId: (batchId: string, rowNumber: number) => string,
  useOwnerNewFingerprint: boolean,
): Promise<SelectedCommitRow> {
  const amountMinor = csvImportAmountToMinorUnits(row.raw.amount);
  if (
    amountMinor === null ||
    (row.raw.currency !== "CAD" && row.raw.currency !== "USD") ||
    (row.raw.direction !== "INFLOW" && row.raw.direction !== "OUTFLOW") ||
    row.canonical_fingerprint === null
  ) {
    throw new CsvImportCommitPersistenceError("READ_FAILED");
  }
  const transactionId = createTransactionId(batchId, row.row_number);
  if (transactionId.length < 1 || transactionId.length > 160) {
    throw new CsvImportCommitPersistenceError("INVALID_INPUT");
  }
  return {
    accountLabel: row.raw.accountLabel,
    amount: row.raw.amount,
    amountMinor,
    categoryRef: row.raw.category,
    defaultCategoryId: importedDefaultCategory({
      merchant: row.raw.merchant ?? row.raw.description,
      accountLabel: row.raw.accountLabel,
      direction: row.raw.direction,
    }),
    familyRuleIds: [],
    currency: row.raw.currency,
    description: row.raw.description,
    direction: row.raw.direction,
    fingerprint: useOwnerNewFingerprint
      ? await ownerNewFingerprint(batchId, row.row_number, row.canonical_fingerprint)
      : row.canonical_fingerprint,
    merchant: row.raw.merchant,
    normalizedMerchant: normalizeMerchantName(row.raw.merchant ?? row.raw.description),
    postedDate: row.raw.postedDate,
    rowNumber: row.row_number,
    transactionId,
  };
}

function assertCommitDecisions(
  rows: ParsedCommitRow[],
  decisions: CsvImportCommitRequest["reviewDecisions"],
): Map<number, ReviewDecision> {
  const reviewRows = new Map(
    rows
      .filter(
        (row) =>
          row.validation_status === "DUPLICATE" &&
          (row.duplicateEvidence === "SUSPECTED_SAME_FILE" ||
            row.existingMatch?.disposition === "SUSPECTED_EXISTING" ||
            (row.duplicateEvidence === "SUSPECTED_EXISTING" && row.existingMatch === null)),
      )
      .map((row) => [row.row_number, row] as const),
  );
  const decisionMap = new Map(decisions.map((decision) => [decision.rowNumber, decision]));
  if (
    decisionMap.size !== reviewRows.size ||
    [...decisionMap.keys()].some((rowNumber) => !reviewRows.has(rowNumber)) ||
    [...reviewRows.keys()].some((rowNumber) => !decisionMap.has(rowNumber))
  ) {
    throw new CsvImportCommitPersistenceError("INVALID_INPUT");
  }
  const mergeTargets = new Set<string>();
  for (const [rowNumber, decision] of decisionMap) {
    if (decision.action !== "MERGE_EXISTING") continue;
    const row = reviewRows.get(rowNumber)!;
    if (
      !row.existingMatch?.candidates.some(
        ({ transactionId, transactionVersion }) =>
          transactionId === decision.candidateTransactionId &&
          transactionVersion === decision.candidateVersion,
      ) ||
      mergeTargets.has(decision.candidateTransactionId)
    ) {
      throw new CsvImportCommitPersistenceError("INVALID_INPUT");
    }
    mergeTargets.add(decision.candidateTransactionId);
  }
  return decisionMap;
}

export interface CsvImportCommitRepositoryOptions {
  createTransactionId?: (batchId: string, rowNumber: number) => string;
}

export class CsvImportCommitRepository {
  private readonly createTransactionId: (batchId: string, rowNumber: number) => string;

  constructor(
    private readonly database: D1Database,
    options: CsvImportCommitRepositoryOptions = {},
  ) {
    this.createTransactionId = options.createTransactionId ?? defaultCreateTransactionId;
  }

  private async findBatch(batchId: string): Promise<CommitBatchRow | null> {
    try {
      return await this.database
        .prepare(`SELECT ${COMMIT_BATCH_COLUMNS} FROM import_batches WHERE id = ?`)
        .bind(batchId)
        .first<CommitBatchRow>();
    } catch {
      throw new CsvImportCommitPersistenceError("READ_FAILED");
    }
  }

  private async findBatchByIdempotencyKey(idempotencyKey: string): Promise<CommitBatchRow | null> {
    try {
      return await this.database
        .prepare(`SELECT ${COMMIT_BATCH_COLUMNS} FROM import_batches WHERE idempotency_key = ?`)
        .bind(idempotencyKey)
        .first<CommitBatchRow>();
    } catch {
      throw new CsvImportCommitPersistenceError("READ_FAILED");
    }
  }

  private async listRows(batchId: string): Promise<ParsedCommitRow[]> {
    try {
      const result = await this.database
        .prepare(
          `SELECT row_number, raw_json, canonical_fingerprint, validation_status,
                  errors_json, transaction_id, resolution, match_evidence_json, resolved_at
           FROM import_rows WHERE batch_id = ? ORDER BY row_number`,
        )
        .bind(batchId)
        .all<CommitImportRow>();
      return result.results.map(parseCommitRow);
    } catch (error) {
      if (error instanceof CsvImportCommitPersistenceError) throw error;
      throw new CsvImportCommitPersistenceError("READ_FAILED");
    }
  }

  private async readCommitted(batch: CommitBatchRow, replayed: boolean) {
    if (
      batch.status !== "COMMITTED" ||
      batch.committed_at === null ||
      !/^[a-f0-9]{64}$/.test(batch.content_checksum) ||
      !/^[a-f0-9]{64}$/.test(batch.source_filename_hash ?? "")
    ) {
      throw new CsvImportCommitPersistenceError("READ_FAILED");
    }
    const rows = (await this.listRows(batch.id)).map((row) => {
      const outcome =
        row.resolution === "IMPORTED_NEW"
          ? "IMPORTED_NEW"
          : row.resolution === "AUTO_MERGED"
            ? "AUTO_MERGED"
            : row.resolution === "OWNER_MERGED"
              ? "OWNER_MERGED"
              : row.resolution === "SKIPPED_INVALID"
                ? "SKIPPED_INVALID"
                : row.resolution === "SKIPPED_DUPLICATE"
                  ? "SKIPPED_DUPLICATE"
                  : null;
      if (
        outcome === null ||
        ((outcome === "IMPORTED_NEW" || outcome === "AUTO_MERGED" || outcome === "OWNER_MERGED") &&
          row.transaction_id === null)
      ) {
        throw new CsvImportCommitPersistenceError("READ_FAILED");
      }
      return {
        duplicateEvidence: row.duplicateEvidence,
        outcome,
        rowNumber: row.row_number,
        transactionId: row.transaction_id,
      };
    });
    const parsed = csvImportCommitResponseSchema.safeParse({
      data: {
        importBatch: {
          committedAt: batch.committed_at,
          contentChecksum: batch.content_checksum,
          counts: {
            autoMerged: rows.filter(({ outcome }) => outcome === "AUTO_MERGED").length,
            importedNew: rows.filter(({ outcome }) => outcome === "IMPORTED_NEW").length,
            ownerMerged: rows.filter(({ outcome }) => outcome === "OWNER_MERGED").length,
            skippedDuplicate: rows.filter(({ outcome }) => outcome === "SKIPPED_DUPLICATE").length,
            skippedInvalid: rows.filter(({ outcome }) => outcome === "SKIPPED_INVALID").length,
            total: rows.length,
          },
          id: batch.id,
          rows,
          sourceFileNameHash: batch.source_filename_hash!,
          status: "COMMITTED",
          version: batch.version,
        },
      },
      meta: { replayed },
    });
    if (!parsed.success) throw new CsvImportCommitPersistenceError("READ_FAILED");
    return { importBatch: parsed.data.data.importBatch, replayed };
  }

  private assertCommittable(batch: CommitBatchRow | null, input: CommitCsvImportInput): void {
    if (batch === null) throw new CsvImportCommitPersistenceError("NOT_FOUND");
    if (batch.status === "COMMITTED") {
      if (batch.idempotency_key !== input.idempotencyKey) {
        throw new CsvImportCommitPersistenceError("IDEMPOTENCY_CONFLICT");
      }
      return;
    }
    if (batch.status !== "PREVIEWED") throw new CsvImportCommitPersistenceError("CONFLICT");
    if (batch.version !== input.version) {
      throw new CsvImportCommitPersistenceError("VERSION_CONFLICT", batch.version);
    }
    if (batch.preview_expires_at <= input.now) {
      throw new CsvImportCommitPersistenceError("PREVIEW_EXPIRED");
    }
    if (!/^[a-f0-9]{64}$/.test(batch.source_filename_hash ?? "")) {
      throw new CsvImportCommitPersistenceError("READ_FAILED");
    }
  }

  private insertTransactionStatements(
    batchId: string,
    idempotencyKey: string,
    now: string,
    rows: SelectedCommitRow[],
  ): D1PreparedStatement[] {
    const statements: D1PreparedStatement[] = [];
    for (let index = 0; index < rows.length; index += INSERT_CHUNK_SIZE) {
      const chunk = rows.slice(index, index + INSERT_CHUNK_SIZE);
      statements.push(
        this.database
          .prepare(
            `WITH input AS (
               SELECT
                 json_extract(value, '$.transactionId') AS transaction_id,
                 json_extract(value, '$.accountLabel') AS account_label,
                 json_extract(value, '$.postedDate') AS posted_date,
                 CAST(json_extract(value, '$.amountMinor') AS INTEGER) AS amount_minor,
                 json_extract(value, '$.direction') AS direction,
                 json_extract(value, '$.currency') AS currency,
                 json_extract(value, '$.amount') AS amount,
                 json_extract(value, '$.description') AS description,
                 json_extract(value, '$.merchant') AS merchant,
                 json_extract(value, '$.normalizedMerchant') AS normalized_merchant,
                 json_extract(value, '$.categoryRef') AS category_ref,
                 json_extract(value, '$.defaultCategoryId') AS default_category_id,
                 json_extract(value, '$.familyRuleIds') AS family_rule_ids,
                 json_extract(value, '$.fingerprint') AS fingerprint
               FROM json_each(?)
             ), family AS (
               SELECT input.transaction_id,
                      COUNT(DISTINCT category.id) AS category_count,
                      MIN(rule.id) AS rule_id
               FROM input
               JOIN json_each(input.family_rule_ids) AS candidate
               JOIN merchant_rules AS rule ON rule.id = candidate.value AND rule.active = 1
               JOIN categories AS category ON category.id = rule.category_id AND category.active = 1
               GROUP BY input.transaction_id
             ), resolved AS (
               SELECT input.*,
                 COALESCE(
                   (
                     SELECT category.id FROM categories AS category
                     WHERE input.category_ref IS NOT NULL
                       AND category.active = 1 AND category.editable = 1
                       AND category.id = input.category_ref
                     LIMIT 1
                   ),
                   (
                     SELECT category.id FROM categories AS category
                     WHERE input.category_ref IS NOT NULL
                       AND category.active = 1 AND category.editable = 1
                       AND category.name = input.category_ref
                     LIMIT 1
                   )
                 ) AS explicit_category_id,
                 CASE WHEN rule_category.id IS NOT NULL THEN rule.id ELSE NULL END AS rule_id,
                 rule_category.id AS rule_category_id,
                 family_rule.category_id AS family_category_id,
                 family_rule.id AS family_rule_id,
                 CASE WHEN COALESCE(family.category_count, 0) = 0
                      THEN default_category.id ELSE NULL END AS builtin_category_id
               FROM input
               LEFT JOIN merchant_rules AS rule
                 ON input.category_ref IS NULL
                AND input.normalized_merchant IS NOT NULL
                AND rule.normalized_merchant = input.normalized_merchant
                AND rule.active = 1
               LEFT JOIN categories AS rule_category
                 ON rule_category.id = rule.category_id AND rule_category.active = 1
               LEFT JOIN family ON family.transaction_id = input.transaction_id
               LEFT JOIN merchant_rules AS family_rule
                 ON family_rule.id = family.rule_id AND family.category_count = 1
               LEFT JOIN categories AS default_category
                 ON default_category.id = input.default_category_id AND default_category.active = 1
             )
             INSERT INTO transactions (
               id, source, account_id, account_label, plaid_transaction_id,
               pending_transaction_id, import_fingerprint, status, authorized_date,
               posted_date, amount_minor, direction, currency, provider_amount_decimal,
               raw_description, merchant_name, payment_metadata_json, category_id,
               categorization_source, category_rule_id, needs_review, review_reason,
               created_at, updated_at, version, normalized_merchant
             )
             SELECT
               transaction_id, 'CSV', NULL, account_label, NULL, NULL, fingerprint,
               'POSTED', NULL, posted_date, amount_minor, direction, currency, amount,
               description, merchant, NULL,
               COALESCE(explicit_category_id, rule_category_id, family_category_id, builtin_category_id, ?),
               CASE
                 WHEN explicit_category_id IS NOT NULL THEN 'MANUAL'
                 WHEN COALESCE(rule_category_id, family_category_id, builtin_category_id) IS NOT NULL THEN 'RULE'
                 ELSE 'UNCLASSIFIED'
               END,
               CASE WHEN explicit_category_id IS NULL THEN COALESCE(rule_id, family_rule_id) ELSE NULL END,
               CASE
                 WHEN COALESCE(explicit_category_id, rule_category_id, family_category_id, builtin_category_id) IS NULL THEN 1 ELSE 0
               END,
               CASE
                 WHEN COALESCE(explicit_category_id, rule_category_id, family_category_id, builtin_category_id) IS NULL
                   THEN 'UNCLASSIFIED_MERCHANT'
                 ELSE NULL
               END,
               ?, ?, 1, normalized_merchant
             FROM resolved
             WHERE EXISTS (
               SELECT 1 FROM import_batches
               WHERE id = ? AND status = 'COMMITTING' AND idempotency_key = ?
             )
             ON CONFLICT(import_fingerprint) DO NOTHING`,
          )
          .bind(
            JSON.stringify(chunk),
            CATEGORY_IDS.systemUnclassified,
            now,
            now,
            batchId,
            idempotencyKey,
          ),
      );
    }
    return statements;
  }

  private async resolveGuardFailure(
    input: CommitCsvImportInput,
  ): Promise<CommittedCsvImportResult> {
    const [batch, keyOwner] = await Promise.all([
      this.findBatch(input.batchId),
      this.findBatchByIdempotencyKey(input.idempotencyKey),
    ]);
    if (batch?.status === "COMMITTED" && batch.idempotency_key === input.idempotencyKey) {
      return this.readCommitted(batch, true);
    }
    if (keyOwner !== null && keyOwner.id !== input.batchId) {
      throw new CsvImportCommitPersistenceError("IDEMPOTENCY_CONFLICT");
    }
    this.assertCommittable(batch, input);
    throw new CsvImportCommitPersistenceError("CONFLICT");
  }

  async commit(input: CommitCsvImportInput): Promise<CommittedCsvImportResult> {
    const parsedRequest = csvImportCommitRequestSchema.safeParse({
      reviewDecisions: input.reviewDecisions,
      version: input.version,
    });
    if (
      !parsedRequest.success ||
      !/^import-preview-[A-Za-z0-9_-]{1,160}$/.test(input.batchId) ||
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/.test(input.idempotencyKey) ||
      Number.isNaN(Date.parse(input.now))
    ) {
      throw new CsvImportCommitPersistenceError("INVALID_INPUT");
    }

    const batch = await this.findBatch(input.batchId);
    this.assertCommittable(batch, input);
    if (batch!.status === "COMMITTED") return this.readCommitted(batch!, true);

    const keyOwner = await this.findBatchByIdempotencyKey(input.idempotencyKey);
    if (keyOwner !== null && keyOwner.id !== input.batchId) {
      throw new CsvImportCommitPersistenceError("IDEMPOTENCY_CONFLICT");
    }

    const rows = await this.listRows(input.batchId);
    const decisionMap = assertCommitDecisions(rows, parsedRequest.data.reviewDecisions);
    const selectedRows = await Promise.all(
      rows
        .filter(
          (row) =>
            row.validation_status === "VALID" ||
            decisionMap.get(row.row_number)?.action === "IMPORT_NEW",
        )
        .map((row) =>
          selectedRowPayload(
            input.batchId,
            row,
            this.createTransactionId,
            decisionMap.get(row.row_number)?.action === "IMPORT_NEW",
          ),
        ),
    );
    // Read the owner catalog once per commit, not once per imported row. The INSERT
    // rechecks active rules/categories and family conflicts in the atomic D1 batch.
    if (
      selectedRows.some(
        (row) =>
          row.categoryRef === null && importedMerchantFamily(row.merchant ?? row.description),
      )
    ) {
      const rules = await this.database
        .prepare("SELECT id, normalized_merchant FROM merchant_rules WHERE active = 1")
        .all<{ id: string; normalized_merchant: string }>();
      if (!rules.success) throw new CsvImportCommitPersistenceError("READ_FAILED");
      const families = new Map<string, string[]>();
      for (const rule of rules.results) {
        const family = importedMerchantFamily(rule.normalized_merchant);
        if (family) families.set(family.key, [...(families.get(family.key) ?? []), rule.id]);
      }
      for (const row of selectedRows) {
        const family = importedMerchantFamily(row.merchant ?? row.description);
        row.familyRuleIds = family ? (families.get(family.key) ?? []) : [];
      }
    }
    const selectedRowNumbers = selectedRows.map(({ rowNumber }) => rowNumber);
    const selectedJson = JSON.stringify(
      selectedRows.map(({ fingerprint, rowNumber, transactionId }) => ({
        fingerprint,
        rowNumber,
        transactionId,
      })),
    );
    const mergeRows = rows.flatMap<MergeCommitRow>((row) => {
      if (row.existingMatch?.disposition === "AUTO_MERGE_EXISTING") {
        const candidate = row.existingMatch.candidates[0]!;
        return [
          {
            candidateVersion: candidate.transactionVersion,
            resolution: "AUTO_MERGED" as const,
            rowNumber: row.row_number,
            transactionId: candidate.transactionId,
          },
        ];
      }
      const decision = decisionMap.get(row.row_number);
      return decision?.action === "MERGE_EXISTING"
        ? [
            {
              candidateVersion: decision.candidateVersion,
              resolution: "OWNER_MERGED" as const,
              rowNumber: row.row_number,
              transactionId: decision.candidateTransactionId,
            },
          ]
        : [];
    });
    if (new Set(mergeRows.map(({ transactionId }) => transactionId)).size !== mergeRows.length) {
      throw new CsvImportCommitPersistenceError("INVALID_INPUT");
    }
    const mergeJson = JSON.stringify(mergeRows);

    const guard = this.database
      .prepare(
        `UPDATE import_batches
         SET status = 'COMMITTING', idempotency_key = ?
         WHERE id = ? AND status = 'PREVIEWED' AND version = ?
           AND preview_expires_at > ? AND source_filename_hash IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM import_batches AS other
             WHERE other.idempotency_key = ? AND other.id != ?
           )
           AND EXISTS (
             SELECT 1 FROM categories
             WHERE id = ? AND system_key = 'UNCLASSIFIED' AND active = 1
           )
           AND NOT EXISTS (
             SELECT 1 FROM import_rows
             WHERE batch_id = ?
               AND row_number IN (
                 SELECT CAST(value AS INTEGER) FROM json_each(?)
               )
               AND json_extract(raw_json, '$.category') IS NOT NULL
               AND NOT EXISTS (
                 SELECT 1 FROM categories AS category
                 WHERE category.active = 1 AND category.editable = 1
                   AND (
                     category.id = json_extract(import_rows.raw_json, '$.category') OR
                     category.name = json_extract(import_rows.raw_json, '$.category')
                   )
               )
           )
           AND NOT EXISTS (
             SELECT 1
             FROM json_each(?) AS selected_merge
             JOIN import_rows AS staged_row
               ON staged_row.batch_id = import_batches.id
              AND staged_row.row_number = CAST(
                json_extract(selected_merge.value, '$.rowNumber') AS INTEGER
              )
             LEFT JOIN transactions AS target
               ON target.id = json_extract(selected_merge.value, '$.transactionId')
             WHERE target.id IS NULL
                OR target.source != 'MANUAL'
                OR target.status != 'POSTED'
                OR target.version != CAST(
                  json_extract(selected_merge.value, '$.candidateVersion') AS INTEGER
                )
                OR staged_row.match_evidence_json IS NULL
                OR NOT EXISTS (
                  SELECT 1
                  FROM json_each(
                    json_extract(staged_row.match_evidence_json, '$.candidates')
                  ) AS staged_candidate
                  WHERE json_extract(staged_candidate.value, '$.transactionId') = target.id
                    AND CAST(
                      json_extract(staged_candidate.value, '$.transactionVersion') AS INTEGER
                    ) = target.version
                )
                OR EXISTS (
                  SELECT 1
                  FROM import_rows AS prior_match
                  JOIN import_batches AS prior_batch ON prior_batch.id = prior_match.batch_id
                  WHERE prior_match.transaction_id = target.id
                    AND prior_batch.status = 'COMMITTED'
                    AND prior_match.resolution IN ('AUTO_MERGED', 'OWNER_MERGED')
                )
           )`,
      )
      .bind(
        input.idempotencyKey,
        input.batchId,
        input.version,
        input.now,
        input.idempotencyKey,
        input.batchId,
        CATEGORY_IDS.systemUnclassified,
        input.batchId,
        JSON.stringify(selectedRowNumbers),
        mergeJson,
      );
    const linkRows = this.database
      .prepare(
        `WITH selected_new AS (
           SELECT
             CAST(json_extract(value, '$.rowNumber') AS INTEGER) AS row_number,
             json_extract(value, '$.transactionId') AS transaction_id,
             json_extract(value, '$.fingerprint') AS fingerprint
           FROM json_each(?)
         ), resolved_new AS (
           SELECT selected_new.row_number,
                  selected_new.transaction_id,
                  transactions.id AS persisted_transaction_id
           FROM selected_new
           LEFT JOIN transactions
             ON transactions.import_fingerprint = selected_new.fingerprint
         ), selected_merge AS (
           SELECT
             CAST(json_extract(value, '$.rowNumber') AS INTEGER) AS row_number,
             json_extract(value, '$.transactionId') AS transaction_id,
             json_extract(value, '$.resolution') AS resolution
           FROM json_each(?)
         )
         UPDATE import_rows
         SET
           transaction_id = CASE
             WHEN EXISTS (
               SELECT 1 FROM selected_merge
               WHERE selected_merge.row_number = import_rows.row_number
             ) THEN (
               SELECT selected_merge.transaction_id FROM selected_merge
               WHERE selected_merge.row_number = import_rows.row_number
             )
             WHEN EXISTS (
               SELECT 1 FROM resolved_new
               WHERE resolved_new.row_number = import_rows.row_number
             ) THEN (
               SELECT resolved_new.persisted_transaction_id FROM resolved_new
               WHERE resolved_new.row_number = import_rows.row_number
             )
             ELSE NULL
           END,
           validation_status = CASE
             WHEN EXISTS (
               SELECT 1 FROM selected_merge
               WHERE selected_merge.row_number = import_rows.row_number
             ) THEN 'IMPORTED'
             WHEN EXISTS (
               SELECT 1 FROM resolved_new WHERE resolved_new.row_number = import_rows.row_number
             ) THEN CASE
               WHEN (
                 SELECT resolved_new.persisted_transaction_id FROM resolved_new
                 WHERE resolved_new.row_number = import_rows.row_number
               ) IS NULL THEN validation_status
               WHEN (
                 SELECT resolved_new.persisted_transaction_id FROM resolved_new
                 WHERE resolved_new.row_number = import_rows.row_number
               ) = (
                 SELECT resolved_new.transaction_id FROM resolved_new
                 WHERE resolved_new.row_number = import_rows.row_number
               ) THEN 'IMPORTED'
               ELSE 'DUPLICATE'
             END
             WHEN validation_status = 'INVALID' THEN 'INVALID'
             ELSE 'DUPLICATE'
           END,
           resolution = CASE
             WHEN EXISTS (
               SELECT 1 FROM selected_merge
               WHERE selected_merge.row_number = import_rows.row_number
             ) THEN (
               SELECT selected_merge.resolution FROM selected_merge
               WHERE selected_merge.row_number = import_rows.row_number
             )
             WHEN EXISTS (
               SELECT 1 FROM resolved_new WHERE resolved_new.row_number = import_rows.row_number
             ) THEN CASE
               WHEN (
                 SELECT resolved_new.persisted_transaction_id FROM resolved_new
                 WHERE resolved_new.row_number = import_rows.row_number
               ) IS NULL THEN 'UNRESOLVED'
               WHEN (
                 SELECT resolved_new.persisted_transaction_id FROM resolved_new
                 WHERE resolved_new.row_number = import_rows.row_number
               ) = (
                 SELECT resolved_new.transaction_id FROM resolved_new
                 WHERE resolved_new.row_number = import_rows.row_number
               ) THEN 'IMPORTED_NEW'
               ELSE 'SKIPPED_DUPLICATE'
             END
             WHEN validation_status = 'INVALID' THEN 'SKIPPED_INVALID'
             ELSE 'SKIPPED_DUPLICATE'
           END,
           resolved_at = ?,
           errors_json = CASE
             WHEN EXISTS (
               SELECT 1 FROM resolved_new WHERE resolved_new.row_number = import_rows.row_number
             ) AND (
               SELECT resolved_new.persisted_transaction_id FROM resolved_new
               WHERE resolved_new.row_number = import_rows.row_number
             ) IS NOT NULL AND (
               SELECT resolved_new.persisted_transaction_id FROM resolved_new
               WHERE resolved_new.row_number = import_rows.row_number
             ) != (
               SELECT resolved_new.transaction_id FROM resolved_new
               WHERE resolved_new.row_number = import_rows.row_number
             ) THEN json_set(
               errors_json, '$.duplicateEvidence', 'FINGERPRINT_ALREADY_COMMITTED'
             )
             ELSE errors_json
           END
         WHERE batch_id = ?
           AND EXISTS (
             SELECT 1 FROM import_batches
             WHERE id = ? AND status = 'COMMITTING' AND idempotency_key = ?
           )`,
      )
      .bind(selectedJson, mergeJson, input.now, input.batchId, input.batchId, input.idempotencyKey);
    const finalize = this.database
      .prepare(
        `UPDATE import_batches
         SET
           status = CASE
             WHEN NOT EXISTS (
               SELECT 1 FROM import_rows
               WHERE import_rows.batch_id = import_batches.id
                 AND (
                   import_rows.resolution = 'UNRESOLVED' OR
                   (
                     import_rows.resolution IN ('IMPORTED_NEW', 'AUTO_MERGED', 'OWNER_MERGED')
                     AND import_rows.transaction_id IS NULL
                   )
                 )
             ) THEN 'COMMITTED'
             ELSE 'ATOMIC_ABORT'
           END,
           committed_at = ?, version = version + 1
         WHERE id = ? AND status = 'COMMITTING' AND idempotency_key = ? AND version = ?`,
      )
      .bind(input.now, input.batchId, input.idempotencyKey, input.version);
    const statements = [
      guard,
      ...this.insertTransactionStatements(
        input.batchId,
        input.idempotencyKey,
        input.now,
        selectedRows,
      ),
      linkRows,
      finalize,
    ];

    let results: D1Result<unknown>[];
    try {
      results = await this.database.batch(statements);
    } catch {
      throw new CsvImportCommitPersistenceError("WRITE_FAILED");
    }
    if (results[0]?.meta.changes !== 1) return this.resolveGuardFailure(input);
    if (results.at(-1)?.meta.changes !== 1) {
      throw new CsvImportCommitPersistenceError("WRITE_FAILED");
    }
    const committed = await this.findBatch(input.batchId);
    if (committed === null) throw new CsvImportCommitPersistenceError("READ_FAILED");
    return this.readCommitted(committed, false);
  }
}
