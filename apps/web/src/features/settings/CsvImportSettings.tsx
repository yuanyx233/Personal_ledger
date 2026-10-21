import {
  csvImportCommitResponseSchema,
  csvImportPreviewResponseSchema,
  type CsvImportCommitRequest,
} from "@ledger/domain";
import { useState, type FormEvent } from "react";

import { writeApi } from "../../lib/browser-api";
import { useTranslation } from "../../i18n/useTranslation";

type Preview = ReturnType<typeof csvImportPreviewResponseSchema.parse>["data"]["preview"];
type ReviewDecisionValue = "IMPORT_NEW" | "SKIP" | `MERGE:${number}`;

function field(form: FormData, name: string) {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

async function fileBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
}

export function CsvImportSettings() {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [decisions, setDecisions] = useState<Record<number, ReviewDecisionValue>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  async function createPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!file) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setNotice(null);
    try {
      const response = await writeApi(
        "/api/v1/imports/csv",
        "POST",
        {
          contentBase64: await fileBase64(file),
          fileName: file.name,
          mapping: {
            accountLabel: field(form, "accountLabel"),
            amount: field(form, "amount"),
            category: field(form, "category") || undefined,
            currency: field(form, "currency"),
            description: field(form, "description"),
            direction: field(form, "direction"),
            merchant: field(form, "merchant") || undefined,
            postedDate: field(form, "postedDate"),
          },
        },
        csvImportPreviewResponseSchema,
      );
      setPreview(response.data.preview);
      setDecisions({});
    } catch {
      setNotice(t("csv.previewFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!preview) return;
    const reviewRows = [...preview.rows, ...preview.reviewRows].filter(
      ({ duplicateEvidence, existingMatch }) =>
        duplicateEvidence === "SUSPECTED_SAME_FILE" ||
        existingMatch?.disposition === "SUSPECTED_EXISTING",
    );
    if (reviewRows.some(({ rowNumber }) => decisions[rowNumber] === undefined)) {
      setNotice(t("csv.decideFirst"));
      return;
    }
    const request: CsvImportCommitRequest = {
      reviewDecisions: reviewRows.map((row) => {
        const { rowNumber } = row;
        const decision = decisions[rowNumber]!;
        if (decision === "IMPORT_NEW" || decision === "SKIP") {
          return { action: decision, rowNumber };
        }
        const candidate = row.existingMatch!.candidates[Number(decision.slice("MERGE:".length))]!;
        return {
          action: "MERGE_EXISTING" as const,
          candidateTransactionId: candidate.transactionId,
          candidateVersion: candidate.transactionVersion,
          rowNumber,
        };
      }),
      version: preview.version,
    };
    setBusy(true);
    try {
      const response = await writeApi(
        `/api/v1/imports/${encodeURIComponent(preview.id)}/commit`,
        "POST",
        request,
        csvImportCommitResponseSchema,
        { idempotencyKey: `csv-commit:${crypto.randomUUID()}` },
      );
      const counts = response.data.importBatch.counts;
      setNotice(
        t("csv.committed", {
          auto: counts.autoMerged,
          new: counts.importedNew,
          owner: counts.ownerMerged,
        }),
      );
      setPreview(null);
    } catch {
      setNotice(t("csv.commitFailed"));
    } finally {
      setBusy(false);
    }
  }

  const mappingFields = [
    ["postedDate", t("csv.header.postedDate")],
    ["description", t("csv.header.description")],
    ["amount", t("csv.header.amount")],
    ["direction", t("csv.header.direction")],
    ["currency", t("csv.header.currency")],
    ["accountLabel", t("csv.header.accountLabel")],
    ["merchant", t("csv.header.merchant")],
    ["category", t("csv.header.category")],
  ] as const;
  return (
    <div className="settings-csv">
      <h3>{t("csv.title")}</h3>
      <p>{t("csv.lead")}</p>
      <form className="settings-form" onSubmit={(event) => void createPreview(event)}>
        <label className="settings-file-field">
          {t("csv.file")}
          <input
            accept=".csv,text/csv"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            required
            type="file"
          />
        </label>
        {mappingFields.map(([name, label], index) => (
          <label key={name}>
            {label}
            <input defaultValue={name} name={name} required={index < 6} />
          </label>
        ))}
        <button className="primary-action" disabled={busy || file === null} type="submit">
          {t("csv.previewOnly")}
        </button>
      </form>
      {preview ? (
        <div className="settings-preview">
          <h4>{t("csv.previewOf", { fileName: preview.fileName })}</h4>
          <p>
            {t("csv.adapter", {
              adapter:
                preview.adapter === "RBC_CA_V1" ? t("csv.adapter.rbc") : t("csv.adapter.custom"),
            })}
          </p>
          <p>
            {t("csv.counts", {
              duplicate: preview.counts.duplicate,
              invalid: preview.counts.invalid,
              total: preview.counts.total,
              valid: preview.counts.valid,
            })}
          </p>
          {preview.reviewRows.length > 0 ? <p>{t("csv.truncationNote")}</p> : null}
          <div className="analysis-table-wrap">
            <table aria-label={t("csv.tableLabel")}>
              <thead>
                <tr>
                  <th>{t("csv.column.row")}</th>
                  <th>{t("csv.column.date")}</th>
                  <th>{t("csv.column.description")}</th>
                  <th>{t("csv.column.decision")}</th>
                </tr>
              </thead>
              <tbody>
                {[...preview.rows, ...preview.reviewRows].map((row) => (
                  <tr key={row.rowNumber}>
                    <th scope="row">{row.rowNumber}</th>
                    <td>{row.raw.postedDate}</td>
                    <td>{row.raw.description}</td>
                    <td>
                      {row.existingMatch?.disposition === "AUTO_MERGE_EXISTING" ? (
                        <span>
                          {t("csv.highConfidence")}
                          {row.existingMatch.candidates[0]!.description}（
                          {row.existingMatch.candidates[0]!.postedDate}）
                        </span>
                      ) : row.duplicateEvidence === "SUSPECTED_SAME_FILE" ||
                        row.existingMatch?.disposition === "SUSPECTED_EXISTING" ? (
                        <select
                          aria-label={t("csv.rowDecision", { row: row.rowNumber })}
                          onChange={(event) =>
                            setDecisions((current) => ({
                              ...current,
                              [row.rowNumber]: event.target.value as ReviewDecisionValue,
                            }))
                          }
                          value={decisions[row.rowNumber] ?? ""}
                        >
                          <option value="">{t("csv.chooseDecision")}</option>
                          {row.existingMatch?.candidates.map((candidate, candidateIndex) => (
                            <option key={candidate.transactionId} value={`MERGE:${candidateIndex}`}>
                              {t("csv.mergeInto", {
                                date: candidate.postedDate,
                                description: candidate.description,
                              })}
                            </option>
                          ))}
                          <option value="IMPORT_NEW">{t("csv.importNew")}</option>
                          <option value="SKIP">{t("csv.skip")}</option>
                        </select>
                      ) : row.status === "INVALID" ? (
                        t("csv.invalid", { codes: row.errors.map(({ code }) => code).join(", ") })
                      ) : (
                        t("csv.validWillImport")
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            className="primary-action"
            disabled={busy}
            onClick={() => void commit()}
            type="button"
          >
            {t("csv.commit")}
          </button>
          {confirmDiscard ? (
            <div className="destructive-confirmation" role="alert">
              <strong>{t("csv.discardTitle")}</strong>
              <p>{t("csv.discardBody")}</p>
              <div>
                <button onClick={() => setConfirmDiscard(false)} type="button">
                  {t("csv.cancel")}
                </button>
                <button
                  onClick={() => {
                    setPreview(null);
                    setDecisions({});
                    setConfirmDiscard(false);
                    setNotice(t("csv.discarded"));
                  }}
                  type="button"
                >
                  {t("csv.confirmDiscard")}
                </button>
              </div>
            </div>
          ) : (
            <button className="danger-action" onClick={() => setConfirmDiscard(true)} type="button">
              {t("csv.discard")}
            </button>
          )}
        </div>
      ) : null}
      {notice ? (
        <p className="detail-notice" role="status">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
