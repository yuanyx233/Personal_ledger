import { sessionResponseSchema } from "@ledger/domain/api-contracts";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { beforeAll, describe, expect, it } from "vitest";

import { createAppWorker, type AppEnv } from "../worker/index";
import { createAccessVerifier, createRemoteAccessVerifier } from "../worker/security/access";

const ACCESS_AUDIENCE = "test-access-audience";
const ACCESS_TEAM_DOMAIN = "https://example.cloudflareaccess.com";
const KEY_ID = "test-access-key";
const OWNER_EMAIL = "owner@example.invalid";
const CSRF_HMAC_KEY = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=";

let signingKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
let forgedSigningKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
let appWorker: ReturnType<typeof createAppWorker>;

beforeAll(async () => {
  const validPair = await generateKeyPair("RS256", { extractable: true });
  const forgedPair = await generateKeyPair("RS256", { extractable: true });
  signingKey = validPair.privateKey;
  forgedSigningKey = forgedPair.privateKey;
  const publicJwk = {
    ...(await exportJWK(validPair.publicKey)),
    alg: "RS256",
    kid: KEY_ID,
    use: "sig",
  };

  const verifyAccess = createAccessVerifier(
    {
      audience: ACCESS_AUDIENCE,
      ownerEmail: OWNER_EMAIL,
      teamDomain: ACCESS_TEAM_DOMAIN,
    },
    createLocalJWKSet({ keys: [publicJwk] }),
  );
  appWorker = createAppWorker((request) => verifyAccess(request));
});

async function createAssertion({
  audience = ACCESS_AUDIENCE,
  email = OWNER_EMAIL,
  expiresAt = Math.floor(Date.now() / 1000) + 300,
  issuer = ACCESS_TEAM_DOMAIN,
  key = signingKey,
  subject,
}: {
  audience?: string;
  email?: string | null;
  expiresAt?: number;
  issuer?: string;
  key?: typeof signingKey;
  subject?: string;
} = {}): Promise<string> {
  let token = new SignJWT(email === null ? {} : { email })
    .setProtectedHeader({ alg: "RS256", kid: KEY_ID, typ: "JWT" })
    .setIssuer(issuer)
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(expiresAt);
  if (subject) token = token.setSubject(subject);
  return token.sign(key);
}

async function fetchWithAssertion(path: string, assertion?: string): Promise<Response> {
  const headers = new Headers();
  if (assertion) headers.set("Cf-Access-Jwt-Assertion", assertion);
  return appWorker.fetch(new Request(`https://ledger.example${path}`, { headers }), {
    API_RATE_LIMITER: { limit: () => Promise.resolve({ success: true }) },
    APP_TIMEZONE: "America/Toronto",
    ASSETS: {
      fetch: () => Promise.resolve(new Response("workspace asset")),
    },
    CSRF_HMAC_KEY,
  } as unknown as AppEnv);
}

async function expectAccessDenied(response: Response, code: string): Promise<void> {
  expect(response.status).toBe(403);
  await expect(response.json()).resolves.toEqual({
    error: {
      code,
      message: "Access denied.",
    },
  });
}

describe("Cloudflare Access request boundary", () => {
  it("rejects a missing assertion", async () => {
    await expectAccessDenied(await fetchWithAssertion("/"), "ACCESS_ASSERTION_MISSING");
  });

  it("rejects a forged signature", async () => {
    await expectAccessDenied(
      await fetchWithAssertion("/", await createAssertion({ key: forgedSigningKey })),
      "ACCESS_ASSERTION_INVALID",
    );
  });

  it("rejects an expired assertion", async () => {
    await expectAccessDenied(
      await fetchWithAssertion(
        "/",
        await createAssertion({ expiresAt: Math.floor(Date.now() / 1000) - 60 }),
      ),
      "ACCESS_ASSERTION_INVALID",
    );
  });

  it("rejects the wrong issuer", async () => {
    await expectAccessDenied(
      await fetchWithAssertion(
        "/",
        await createAssertion({ issuer: "https://other.cloudflareaccess.com" }),
      ),
      "ACCESS_ASSERTION_INVALID",
    );
  });

  it("rejects the wrong audience", async () => {
    await expectAccessDenied(
      await fetchWithAssertion("/", await createAssertion({ audience: "other-audience" })),
      "ACCESS_ASSERTION_INVALID",
    );
  });

  it("rejects a valid token for a different email", async () => {
    await expectAccessDenied(
      await fetchWithAssertion("/", await createAssertion({ email: "other@example.invalid" })),
      "ACCESS_OWNER_MISMATCH",
    );
  });

  it("rejects a signed assertion without an email claim", async () => {
    await expectAccessDenied(
      await fetchWithAssertion("/", await createAssertion({ email: null })),
      "ACCESS_ASSERTION_INVALID",
    );
  });

  it("constructs the production remote-JWKS verifier without fetching eagerly", () => {
    expect(
      createRemoteAccessVerifier({
        audience: ACCESS_AUDIENCE,
        ownerEmail: OWNER_EMAIL,
        teamDomain: ACCESS_TEAM_DOMAIN,
      }),
    ).toEqual(expect.any(Function));
  });

  it("allows the configured owner through to static and API routing", async () => {
    const assertion = await createAssertion({ subject: "owner-subject" });
    const staticResponse = await fetchWithAssertion("/", assertion);
    const apiResponse = await fetchWithAssertion("/api/v1/session", assertion);

    expect(staticResponse.status).toBe(200);
    await expect(staticResponse.text()).resolves.toBe("workspace asset");
    expect(apiResponse.status).toBe(200);
    const rawBody: unknown = await apiResponse.json();
    const body = sessionResponseSchema.parse(rawBody);
    expect(body).toMatchObject({
      data: {
        identity: { email: OWNER_EMAIL },
        timezone: "America/Toronto",
      },
      meta: {},
    });
    expect(body.data.csrfToken.length).toBeGreaterThan(0);
  });
});
