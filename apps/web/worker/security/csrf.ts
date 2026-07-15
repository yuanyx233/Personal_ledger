import { base64url } from "jose";

import type { AccessIdentity } from "./access";

const MAX_CSRF_TTL_SECONDS = 60 * 60;
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

interface CsrfClaims {
  exp: number;
  iat: number;
  nonce: string;
  sid: string;
  v: 1;
}

export interface IssueCsrfOptions {
  nowSeconds?: number;
  ttlSeconds?: number;
}

let cachedHmacKey: { encodedSecret: string; key: CryptoKey } | undefined;

function sessionId(identity: AccessIdentity): string {
  return identity.sessionBinding;
}

function decodeStandardBase64(encoded: string): Uint8Array {
  const decoded = atob(encoded);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

async function importHmacKey(encodedSecret: string): Promise<CryptoKey> {
  if (cachedHmacKey?.encodedSecret === encodedSecret) return cachedHmacKey.key;

  const rawKey = decodeStandardBase64(encodedSecret);
  if (rawKey.byteLength !== 32) throw new RangeError("CSRF HMAC key must contain 32 bytes.");
  const key = await crypto.subtle.importKey(
    "raw",
    rawKey,
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign", "verify"],
  );
  cachedHmacKey = { encodedSecret, key };
  return key;
}

export async function issueCsrfToken(
  identity: AccessIdentity,
  encodedSecret: string,
  {
    nowSeconds = Math.floor(Date.now() / 1000),
    ttlSeconds = MAX_CSRF_TTL_SECONDS,
  }: IssueCsrfOptions = {},
): Promise<string> {
  if (!Number.isInteger(nowSeconds)) throw new RangeError("CSRF issue time must be an integer.");
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > MAX_CSRF_TTL_SECONDS) {
    throw new RangeError("CSRF lifetime must be between 1 and 3600 seconds.");
  }

  const nonce = new Uint8Array(16);
  crypto.getRandomValues(nonce);
  const claims: CsrfClaims = {
    exp: nowSeconds + ttlSeconds,
    iat: nowSeconds,
    nonce: base64url.encode(nonce),
    sid: sessionId(identity),
    v: 1,
  };
  const encodedClaims = base64url.encode(JSON.stringify(claims));
  const key = await importHmacKey(encodedSecret);
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(encodedClaims));
  return `${encodedClaims}.${base64url.encode(new Uint8Array(signature))}`;
}

function isCsrfClaims(value: unknown): value is CsrfClaims {
  if (typeof value !== "object" || value === null) return false;
  const claims = value as Partial<CsrfClaims>;
  return (
    claims.v === 1 &&
    typeof claims.sid === "string" &&
    typeof claims.nonce === "string" &&
    Number.isInteger(claims.iat) &&
    Number.isInteger(claims.exp)
  );
}

export async function verifyCsrfToken(
  token: string,
  identity: AccessIdentity,
  encodedSecret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  try {
    const parts = token.split(".");
    if (parts.length !== 2) return false;
    const [encodedClaims, encodedSignature] = parts;
    if (!encodedClaims || !encodedSignature) return false;

    const key = await importHmacKey(encodedSecret);
    const validSignature = await crypto.subtle.verify(
      "HMAC",
      key,
      base64url.decode(encodedSignature),
      textEncoder.encode(encodedClaims),
    );
    if (!validSignature) return false;

    const claims: unknown = JSON.parse(textDecoder.decode(base64url.decode(encodedClaims)));
    if (!isCsrfClaims(claims)) return false;
    if (claims.sid !== sessionId(identity)) return false;
    if (claims.iat > nowSeconds || claims.exp <= nowSeconds) return false;
    if (claims.exp - claims.iat > MAX_CSRF_TTL_SECONDS) return false;
    return true;
  } catch {
    return false;
  }
}
