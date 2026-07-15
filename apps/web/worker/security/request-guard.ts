import type { AccessIdentity } from "./access";
import { verifyCsrfToken } from "./csrf";

export type RequestGuardErrorCode =
  "CSRF_INVALID" | "FETCH_METADATA_DENIED" | "ORIGIN_DENIED" | "UNSUPPORTED_MEDIA_TYPE";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export class RequestGuardError extends Error {
  constructor(
    readonly code: RequestGuardErrorCode,
    readonly status: 403 | 415,
  ) {
    super(code);
    this.name = "RequestGuardError";
  }
}

export async function validateApiRequest(
  request: Request,
  identity: AccessIdentity,
  csrfHmacKey: string,
): Promise<void> {
  const expectedOrigin = new URL(request.url).origin;
  const origin = request.headers.get("Origin");
  if (origin && origin !== expectedOrigin) {
    throw new RequestGuardError("ORIGIN_DENIED", 403);
  }

  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (fetchSite && fetchSite !== "same-origin") {
    throw new RequestGuardError("FETCH_METADATA_DENIED", 403);
  }

  if (!WRITE_METHODS.has(request.method)) return;
  if (origin !== expectedOrigin) throw new RequestGuardError("ORIGIN_DENIED", 403);
  const fetchMode = request.headers.get("Sec-Fetch-Mode");
  if (fetchSite !== "same-origin" || (fetchMode !== "cors" && fetchMode !== "same-origin")) {
    throw new RequestGuardError("FETCH_METADATA_DENIED", 403);
  }

  const contentType = request.headers.get("Content-Type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    throw new RequestGuardError("UNSUPPORTED_MEDIA_TYPE", 415);
  }

  const csrfToken = request.headers.get("X-CSRF-Token");
  if (!csrfToken || !(await verifyCsrfToken(csrfToken, identity, csrfHmacKey))) {
    throw new RequestGuardError("CSRF_INVALID", 403);
  }
}
