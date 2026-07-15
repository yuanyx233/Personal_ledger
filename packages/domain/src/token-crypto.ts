import * as z from "zod";

const AES_GCM_IV_BYTES = 12;
const AES_GCM_TAG_BITS = 128;
const TOKEN_AAD_PURPOSE = "personal-ledger/plaid-access-token/v1";
const textDecoder = new TextDecoder("utf-8", { fatal: true });
const textEncoder = new TextEncoder();

const contextSchema = z.strictObject({
  connectionId: z.string().min(1).max(160),
  plaidItemId: z.string().min(1).max(160),
});

const keyConfigSchema = z.strictObject({
  encodedKey: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
  version: z.int().positive(),
});

const accessTokenSchema = z.string().min(1).max(2048);

export interface PlaidTokenContext {
  connectionId: string;
  plaidItemId: string;
}

export interface PlaidTokenKey {
  encodedKey: string;
  version: number;
}

export interface EncryptedPlaidAccessToken {
  ciphertext: Uint8Array<ArrayBuffer>;
  iv: Uint8Array<ArrayBuffer>;
  keyVersion: number;
}

export type PlaidTokenCryptoErrorCode =
  | "TOKEN_DECRYPTION_FAILED"
  | "TOKEN_ENCRYPTION_FAILED"
  | "TOKEN_INPUT_INVALID"
  | "TOKEN_KEY_INVALID"
  | "TOKEN_KEY_UNAVAILABLE";

export class PlaidTokenCryptoError extends Error {
  constructor(readonly code: PlaidTokenCryptoErrorCode) {
    super(code);
    this.name = "PlaidTokenCryptoError";
  }
}

function parseContext(context: PlaidTokenContext): z.infer<typeof contextSchema> {
  const parsed = contextSchema.safeParse(context);
  if (!parsed.success) throw new PlaidTokenCryptoError("TOKEN_INPUT_INVALID");
  return parsed.data;
}

function parseKey(key: PlaidTokenKey): z.infer<typeof keyConfigSchema> {
  const parsed = keyConfigSchema.safeParse(key);
  if (!parsed.success) throw new PlaidTokenCryptoError("TOKEN_KEY_INVALID");
  return parsed.data;
}

function decodeKey(encodedKey: string): Uint8Array<ArrayBuffer> {
  try {
    const decoded = atob(encodedKey);
    const rawKey = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
    if (rawKey.byteLength !== 32) throw new Error("invalid key length");
    return rawKey;
  } catch {
    throw new PlaidTokenCryptoError("TOKEN_KEY_INVALID");
  }
}

async function importKey(key: PlaidTokenKey): Promise<CryptoKey> {
  const parsedKey = parseKey(key);
  const rawKey = decodeKey(parsedKey.encodedKey);
  try {
    return await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt", "decrypt"]);
  } catch {
    throw new PlaidTokenCryptoError("TOKEN_KEY_INVALID");
  } finally {
    rawKey.fill(0);
  }
}

function additionalData(
  context: z.infer<typeof contextSchema>,
  keyVersion: number,
): Uint8Array<ArrayBuffer> {
  return textEncoder.encode(
    JSON.stringify([TOKEN_AAD_PURPOSE, context.connectionId, context.plaidItemId, keyVersion]),
  );
}

function aesGcmParameters(
  context: z.infer<typeof contextSchema>,
  keyVersion: number,
  iv: Uint8Array<ArrayBuffer>,
): AesGcmParams {
  return {
    additionalData: additionalData(context, keyVersion),
    iv,
    name: "AES-GCM",
    tagLength: AES_GCM_TAG_BITS,
  };
}

function findVersionedKey(keys: readonly PlaidTokenKey[], version: number): PlaidTokenKey {
  const matches = keys.filter((key) => key.version === version);
  if (matches.length === 0) throw new PlaidTokenCryptoError("TOKEN_KEY_UNAVAILABLE");
  if (matches.length !== 1) throw new PlaidTokenCryptoError("TOKEN_KEY_INVALID");
  return parseKey(matches[0]!);
}

function validateEncryptedRecord(record: EncryptedPlaidAccessToken): void {
  if (
    !(record.ciphertext instanceof Uint8Array) ||
    record.ciphertext.byteLength <= AES_GCM_TAG_BITS / 8 ||
    !(record.iv instanceof Uint8Array) ||
    record.iv.byteLength !== AES_GCM_IV_BYTES ||
    !Number.isInteger(record.keyVersion) ||
    record.keyVersion < 1
  ) {
    throw new PlaidTokenCryptoError("TOKEN_INPUT_INVALID");
  }
}

export async function encryptPlaidAccessToken(
  accessToken: string,
  context: PlaidTokenContext,
  key: PlaidTokenKey,
): Promise<EncryptedPlaidAccessToken> {
  const parsedToken = accessTokenSchema.safeParse(accessToken);
  if (!parsedToken.success) throw new PlaidTokenCryptoError("TOKEN_INPUT_INVALID");
  const parsedContext = parseContext(context);
  const parsedKey = parseKey(key);
  const cryptoKey = await importKey(parsedKey);
  const plaintext = textEncoder.encode(parsedToken.data);
  try {
    const iv = crypto.getRandomValues(new Uint8Array(AES_GCM_IV_BYTES));
    const ciphertext = await crypto.subtle.encrypt(
      aesGcmParameters(parsedContext, parsedKey.version, iv),
      cryptoKey,
      plaintext,
    );

    return {
      ciphertext: new Uint8Array(ciphertext),
      iv,
      keyVersion: parsedKey.version,
    };
  } catch {
    throw new PlaidTokenCryptoError("TOKEN_ENCRYPTION_FAILED");
  } finally {
    plaintext.fill(0);
  }
}

export async function decryptPlaidAccessToken(
  record: EncryptedPlaidAccessToken,
  context: PlaidTokenContext,
  keys: readonly PlaidTokenKey[],
): Promise<string> {
  validateEncryptedRecord(record);
  const parsedContext = parseContext(context);
  const key = findVersionedKey(keys, record.keyVersion);
  const cryptoKey = await importKey(key);

  let plaintext: Uint8Array<ArrayBuffer> | undefined;
  try {
    plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        aesGcmParameters(parsedContext, record.keyVersion, record.iv),
        cryptoKey,
        record.ciphertext,
      ),
    );
    const accessToken = textDecoder.decode(plaintext);
    if (!accessTokenSchema.safeParse(accessToken).success) {
      throw new PlaidTokenCryptoError("TOKEN_DECRYPTION_FAILED");
    }
    return accessToken;
  } catch (error) {
    if (error instanceof PlaidTokenCryptoError) throw error;
    throw new PlaidTokenCryptoError("TOKEN_DECRYPTION_FAILED");
  } finally {
    plaintext?.fill(0);
  }
}

export async function rotatePlaidAccessToken(
  record: EncryptedPlaidAccessToken,
  context: PlaidTokenContext,
  availableKeys: readonly PlaidTokenKey[],
  activeKey: PlaidTokenKey,
): Promise<EncryptedPlaidAccessToken> {
  const accessToken = await decryptPlaidAccessToken(record, context, availableKeys);
  return encryptPlaidAccessToken(accessToken, context, activeKey);
}
