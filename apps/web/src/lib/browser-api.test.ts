import { afterEach, describe, expect, it, vi } from "vitest";

import { BrowserApiError, readApi } from "./browser-api";

const passthrough = { parse: (value: unknown) => value };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browser API Access recovery", () => {
  it("marks every API fetch as XMLHttpRequest for Cloudflare Access", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({ data: { ok: true }, meta: {} }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await readApi("/api/v1/categories", passthrough);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        Accept: "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
    });
  });

  it("exposes an expired Access response as a recognizable login-required error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 403 })));

    await expect(readApi("/api/v1/session", passthrough)).rejects.toMatchObject({
      requiresLogin: true,
      status: 403,
    } satisfies Partial<BrowserApiError>);
  });
});
