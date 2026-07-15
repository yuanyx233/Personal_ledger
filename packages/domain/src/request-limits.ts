import { API_PREFIX } from "./index";
import { calendarDateSchema } from "./api-contracts";

export const REQUEST_LIMITS = {
  DEFAULT_JSON_BYTES: 64 * 1024,
  IMPORT_COLUMNS: 32,
  IMPORT_PREVIEW_BYTES: 5 * 1024 * 1024,
  IMPORT_ROWS: 10_000,
  MAX_DATE_RANGE_DAYS: 730,
  PAGE_SIZE: 100,
  PLAID_WEBHOOK_BYTES: 256 * 1024,
} as const;

export interface RequestPolicy {
  bodyBytes?: number;
  columnLimit?: number;
  dateRangeDays?: number;
  pageSize?: number;
  routeId: string;
  rowLimit?: number;
}

export type RequestLimitErrorCode = "PAYLOAD_TOO_LARGE" | "VALIDATION_ERROR";

export class RequestLimitError extends Error {
  constructor(
    readonly code: RequestLimitErrorCode,
    readonly status: 413 | 422,
  ) {
    super(code);
    this.name = "RequestLimitError";
  }
}

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const QUERY_LIMITED_ROUTES = new Set(["exports", "reports", "transactions"]);
const KNOWN_ROUTE_IDS = new Set([
  "accounts",
  "categories",
  "connections",
  "exports",
  "imports",
  "merchant-rules",
  "plaid",
  "reports",
  "review-queue",
  "session",
  "sync-runs",
  "transactions",
]);

function routeIdFromUrl(url: URL): string {
  const segment = url.pathname.slice(API_PREFIX.length + 1).split("/", 1)[0];
  return segment && KNOWN_ROUTE_IDS.has(segment) ? segment : "other-api";
}

export function resolveAppRequestPolicy(request: Request): RequestPolicy {
  const url = new URL(request.url);
  const routeId = routeIdFromUrl(url);
  const policy: RequestPolicy = { routeId };

  if (WRITE_METHODS.has(request.method)) {
    policy.bodyBytes =
      routeId === "imports"
        ? REQUEST_LIMITS.IMPORT_PREVIEW_BYTES
        : REQUEST_LIMITS.DEFAULT_JSON_BYTES;
  }

  if (routeId === "imports") {
    policy.columnLimit = REQUEST_LIMITS.IMPORT_COLUMNS;
    policy.rowLimit = REQUEST_LIMITS.IMPORT_ROWS;
  }

  if (QUERY_LIMITED_ROUTES.has(routeId)) {
    policy.dateRangeDays = REQUEST_LIMITS.MAX_DATE_RANGE_DAYS;
    policy.pageSize = REQUEST_LIMITS.PAGE_SIZE;
  }

  return policy;
}

function validationError(): RequestLimitError {
  return new RequestLimitError("VALIDATION_ERROR", 422);
}

function validateQuery(url: URL, policy: RequestPolicy): void {
  const pageSize = url.searchParams.get("pageSize");
  if (
    pageSize !== null &&
    (policy.pageSize === undefined ||
      !/^[1-9][0-9]*$/.test(pageSize) ||
      Number(pageSize) > policy.pageSize)
  ) {
    throw validationError();
  }

  const dateFrom = url.searchParams.get("dateFrom");
  const dateTo = url.searchParams.get("dateTo");
  if (dateFrom !== null && !calendarDateSchema.safeParse(dateFrom).success) {
    throw validationError();
  }
  if (dateTo !== null && !calendarDateSchema.safeParse(dateTo).success) {
    throw validationError();
  }
  if ((dateFrom !== null || dateTo !== null) && policy.dateRangeDays === undefined) {
    throw validationError();
  }
  if (dateFrom !== null && dateTo !== null) {
    const fromTime = Date.parse(`${dateFrom}T00:00:00.000Z`);
    const toTime = Date.parse(`${dateTo}T00:00:00.000Z`);
    const inclusiveDays = Math.floor((toTime - fromTime) / 86_400_000) + 1;
    if (inclusiveDays < 1 || inclusiveDays > policy.dateRangeDays!) {
      throw validationError();
    }
  }
}

async function readBoundedBody(
  request: Request,
  maximumBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const contentLength = request.headers.get("Content-Length");
  if (contentLength !== null) {
    if (!/^(0|[1-9][0-9]*)$/.test(contentLength)) throw validationError();
    if (Number(contentLength) > maximumBytes) {
      throw new RequestLimitError("PAYLOAD_TOO_LARGE", 413);
    }
  }

  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        throw new RequestLimitError("PAYLOAD_TOO_LARGE", 413);
      }
      const chunk = new Uint8Array(value.byteLength);
      chunk.set(value);
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function enforceRequestLimits(
  request: Request,
  policy: RequestPolicy,
): Promise<Uint8Array<ArrayBuffer>> {
  validateQuery(new URL(request.url), policy);
  return policy.bodyBytes === undefined
    ? new Uint8Array(0)
    : readBoundedBody(request, policy.bodyBytes);
}

export function assertImportShapeWithinLimits(
  shape: { columns: number; rows: number },
  policy: RequestPolicy,
): void {
  if (
    !Number.isInteger(shape.columns) ||
    shape.columns < 0 ||
    policy.columnLimit === undefined ||
    shape.columns > policy.columnLimit ||
    !Number.isInteger(shape.rows) ||
    shape.rows < 0 ||
    policy.rowLimit === undefined ||
    shape.rows > policy.rowLimit
  ) {
    throw validationError();
  }
}
