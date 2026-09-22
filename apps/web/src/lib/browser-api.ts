import { sessionResponseSchema } from "@ledger/domain/api-contracts";

interface Parser<T> {
  parse(value: unknown): T;
}

export class BrowserApiError extends Error {
  readonly requiresLogin: boolean;

  constructor(readonly status: number) {
    super(`API request failed with status ${status}`);
    this.name = "BrowserApiError";
    this.requiresLogin = status === 401 || status === 403;
  }
}

async function parsedResponse<T>(response: Response, schema: Parser<T>): Promise<T> {
  if (!response.ok) throw new BrowserApiError(response.status);
  return schema.parse(await response.json());
}

export async function readApi<T>(path: string, schema: Parser<T>, signal?: AbortSignal) {
  return parsedResponse(
    await fetch(path, {
      cache: "no-store",
      headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" },
      ...(signal ? { signal } : {}),
    }),
    schema,
  );
}

export async function writeApi<T>(
  path: string,
  method: "DELETE" | "PATCH" | "POST" | "PUT",
  body: unknown,
  schema: Parser<T>,
  options: { idempotencyKey?: string } = {},
) {
  const session = await readApi("/api/v1/session", sessionResponseSchema);
  return parsedResponse(
    await fetch(path, {
      body: JSON.stringify(body),
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-CSRF-Token": session.data.csrfToken,
        "X-Requested-With": "XMLHttpRequest",
        ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
      },
      method,
    }),
    schema,
  );
}
