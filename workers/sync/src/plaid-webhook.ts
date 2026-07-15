import type { PlaidWebhookVerificationKey } from "@ledger/plaid";
import { decodeProtectedHeader, importJWK, jwtVerify } from "jose";

const MAXIMUM_VERIFICATION_HEADER_LENGTH = 4096;
const MAXIMUM_WEBHOOK_AGE_SECONDS = 300;
const MAXIMUM_FUTURE_CLOCK_SKEW_SECONDS = 30;

export type PlaidWebhookVerificationErrorCode = "INVALID" | "KEY_UNAVAILABLE";

export class PlaidWebhookVerificationError extends Error {
  constructor(readonly code: PlaidWebhookVerificationErrorCode) {
    super(code);
    this.name = "PlaidWebhookVerificationError";
  }
}

export interface VerifyPlaidWebhookInput {
  getVerificationKey: (keyId: string) => Promise<PlaidWebhookVerificationKey>;
  now: Date;
  rawBody: Uint8Array<ArrayBuffer>;
  verificationHeader: string | null;
}

function bytesToHex(bytes: Uint8Array): string {
  let result = "";
  for (const byte of bytes) result += byte.toString(16).padStart(2, "0");
  return result;
}

async function sha256Hex(body: Uint8Array<ArrayBuffer>): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", body)));
}

function constantTimeEqual(left: string, right: string): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

function isValidVerificationKey(key: PlaidWebhookVerificationKey, expectedKeyId: string): boolean {
  return (
    key.jwk.alg === "ES256" &&
    key.jwk.crv === "P-256" &&
    key.jwk.kid === expectedKeyId &&
    key.jwk.kty === "EC" &&
    key.jwk.use === "sig" &&
    /^[A-Za-z0-9_-]{43}$/.test(key.jwk.x) &&
    /^[A-Za-z0-9_-]{43}$/.test(key.jwk.y) &&
    Number.isInteger(key.createdAt) &&
    key.createdAt >= 0 &&
    (key.expiredAt === null || (Number.isInteger(key.expiredAt) && key.expiredAt >= 0))
  );
}

export async function verifyPlaidWebhook({
  getVerificationKey,
  now,
  rawBody,
  verificationHeader,
}: VerifyPlaidWebhookInput): Promise<{ bodyHash: string; keyId: string }> {
  if (
    verificationHeader === null ||
    verificationHeader.length === 0 ||
    verificationHeader.length > MAXIMUM_VERIFICATION_HEADER_LENGTH
  ) {
    throw new PlaidWebhookVerificationError("INVALID");
  }

  let keyId: string;
  try {
    const header = decodeProtectedHeader(verificationHeader);
    if (
      header.alg !== "ES256" ||
      typeof header.kid !== "string" ||
      header.kid.length === 0 ||
      header.kid.length > 256
    ) {
      throw new PlaidWebhookVerificationError("INVALID");
    }
    keyId = header.kid;
  } catch (error) {
    if (error instanceof PlaidWebhookVerificationError) throw error;
    throw new PlaidWebhookVerificationError("INVALID");
  }

  let verificationKey: PlaidWebhookVerificationKey;
  try {
    verificationKey = await getVerificationKey(keyId);
  } catch {
    throw new PlaidWebhookVerificationError("KEY_UNAVAILABLE");
  }
  if (!isValidVerificationKey(verificationKey, keyId)) {
    throw new PlaidWebhookVerificationError("INVALID");
  }

  try {
    const key = await importJWK(verificationKey.jwk, "ES256");
    const { payload } = await jwtVerify(verificationHeader, key, {
      algorithms: ["ES256"],
      currentDate: now,
      maxTokenAge: `${MAXIMUM_WEBHOOK_AGE_SECONDS} seconds`,
    });
    const nowSeconds = Math.floor(now.getTime() / 1000);
    if (
      !Number.isInteger(payload.iat) ||
      payload.iat! < nowSeconds - MAXIMUM_WEBHOOK_AGE_SECONDS ||
      payload.iat! > nowSeconds + MAXIMUM_FUTURE_CLOCK_SKEW_SECONDS ||
      payload.iat! < verificationKey.createdAt ||
      (verificationKey.expiredAt !== null && payload.iat! > verificationKey.expiredAt) ||
      typeof payload.request_body_sha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(payload.request_body_sha256)
    ) {
      throw new PlaidWebhookVerificationError("INVALID");
    }

    const bodyHash = await sha256Hex(rawBody);
    if (!constantTimeEqual(bodyHash, payload.request_body_sha256)) {
      throw new PlaidWebhookVerificationError("INVALID");
    }
    return { bodyHash, keyId };
  } catch (error) {
    if (error instanceof PlaidWebhookVerificationError) throw error;
    throw new PlaidWebhookVerificationError("INVALID");
  }
}
