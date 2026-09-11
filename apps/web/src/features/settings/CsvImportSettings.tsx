import {
  csvImportCommitResponseSchema,
  csvImportPreviewResponseSchema,
  type CsvImportCommitRequest,
} from "@ledger/domain";
import { useState, type FormEvent } from "react";

import { writeApi } from "../../lib/browser-api";

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
      setNotice("CSV 预览失败；请检查 UTF-8 文件、表头和映射。");
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
      setNotice("请先逐行决定所有疑似重复记录。");
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
        `CSV 已提交：新增 ${counts.importedNew} 笔，自动合并 ${counts.autoMerged} 笔，人工合并 ${counts.ownerMerged} 笔。`,
      );
      setPreview(null);
    } catch {
      setNotice("CSV 提交失败；预览可能已过期，请重新预览。");
    } finally {
      setBusy(false);
    }
  }

  const mappingFields = [
    ["postedDate", "日期表头"],
    ["description", "描述表头"],
    ["amount", "金额表头"],
    ["direction", "方向表头"],
    ["currency", "币种表头"],
    ["accountLabel", "账户表头"],
    ["merchant", "商户表头（可选）"],
    ["category", "类别表头（可选）"],
  ] as const;
  return (
    <div className="settings-csv">
      <h3>CSV 两阶段导入</h3>
      <p>提交时自动分类，优先沿用你的商户规则；无法识别或规则冲突的交易进入待分类列表。</p>
      <form className="settings-form" onSubmit={(event) => void createPreview(event)}>
        <label className="settings-file-field">
          CSV 文件
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
          只预览，不写账本
        </button>
      </form>
      {preview ? (
        <div className="settings-preview">
          <h4>预览 {preview.fileName}</h4>
          <p>识别方式：{preview.adapter === "RBC_CA_V1" ? "RBC 加拿大流水" : "自定义 CSV 映射"}</p>
          <p>
            共 {preview.counts.total} 行 · 有效 {preview.counts.valid} · 无效{" "}
            {preview.counts.invalid} · 重复 {preview.counts.duplicate}
          </p>
          {preview.reviewRows.length > 0 ? (
            <p>以下列表包含前 100 行，以及其后所有需要你决定的记录。</p>
          ) : null}
          <div className="analysis-table-wrap">
            <table aria-label="CSV 导入预览">
              <thead>
                <tr>
                  <th>行</th>
                  <th>日期</th>
                  <th>描述</th>
                  <th>状态/决定</th>
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
                          高置信度，将合并到：
                          {row.existingMatch.candidates[0]!.description}（
                          {row.existingMatch.candidates[0]!.postedDate}）
                        </span>
                      ) : row.duplicateEvidence === "SUSPECTED_SAME_FILE" ||
                        row.existingMatch?.disposition === "SUSPECTED_EXISTING" ? (
                        <select
                          aria-label={`第 ${row.rowNumber} 行决定`}
                          onChange={(event) =>
                            setDecisions((current) => ({
                              ...current,
                              [row.rowNumber]: event.target.value as ReviewDecisionValue,
                            }))
                          }
                          value={decisions[row.rowNumber] ?? ""}
                        >
                          <option value="">请选择</option>
                          {row.existingMatch?.candidates.map((candidate, candidateIndex) => (
                            <option key={candidate.transactionId} value={`MERGE:${candidateIndex}`}>
                              合并到 {candidate.description}（{candidate.postedDate}）
                            </option>
                          ))}
                          <option value="IMPORT_NEW">作为新交易导入</option>
                          <option value="SKIP">跳过</option>
                        </select>
                      ) : row.status === "INVALID" ? (
                        `无效：${row.errors.map(({ code }) => code).join("、")}`
                      ) : (
                        "有效，将导入"
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
            提交已确认行
          </button>
          {confirmDiscard ? (
            <div className="destructive-confirmation" role="alert">
              <strong>丢弃当前 CSV 预览？</strong>
              <p>只清除浏览器中的预览和逐行决定；当前预览尚未写入任何账本交易。</p>
              <div>
                <button onClick={() => setConfirmDiscard(false)} type="button">
                  取消
                </button>
                <button
                  onClick={() => {
                    setPreview(null);
                    setDecisions({});
                    setConfirmDiscard(false);
                    setNotice("CSV 预览已丢弃；账本没有改变。");
                  }}
                  type="button"
                >
                  确认丢弃
                </button>
              </div>
            </div>
          ) : (
            <button className="danger-action" onClick={() => setConfirmDiscard(true)} type="button">
              丢弃预览
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
