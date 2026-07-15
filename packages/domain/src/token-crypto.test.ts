import { describe, expect, it } from "vitest";

import {
  PlaidTokenCryptoError,
  decryptPlaidAccessToken,
  encryptPlaidAccessToken,
  rotatePlaidAccessToken,
} from "./token-crypto";

const ACCESS_TOKEN = "access-sandbox-fixture-token-that-must-never-leak";
const CONTEXT = { connectionId: "connection-1", plaidItemId: "item-1" };
const VERSION_1_KEY = {
  encodedKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  version: 1,
};
const VERSION_2_KEY = {
  encodedKey: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=",
  version: 2,
};

function bytesFromHex(value: string): Uint8Array<ArrayBuffer> {
  const octets = value.match(/.{2}/g);
  if (!octets) throw new Error("Invalid test vector.");
  return Uint8Array.from(octets.map((octet) => Number.parseInt(octet, 16)));
}

const VERSION_1_VECTOR = {
  ciphertext: bytesFromHex(
    "afc423583e13461d6620a1b1d58bb07e1b1877bf45c30700bec990e058725def" +
      "a967dc5d3e3ecc15249e3c566a6053962c74ac97fee9f7f6a48c3d1f7abfcd11e5",
  ),
  iv: new Uint8Array(12),
  keyVersion: 1,
};

describe("Plaid access-token encryption", () => {
  it("uses AES-256-GCM with a fresh 96-bit IV for every encryption", async () => {
    const first = await encryptPlaidAccessToken(ACCESS_TOKEN, CONTEXT, VERSION_1_KEY);
    const second = await encryptPlaidAccessToken(ACCESS_TOKEN, CONTEXT, VERSION_1_KEY);

    expect(first.keyVersion).toBe(1);
    expect(first.iv).toHaveLength(12);
    expect(first.ciphertext.byteLength).toBeGreaterThan(ACCESS_TOKEN.length);
    expect(first.iv).not.toEqual(second.iv);
    expect(first.ciphertext).not.toEqual(second.ciphertext);
    await expect(decryptPlaidAccessToken(first, CONTEXT, [VERSION_1_KEY])).resolves.toBe(
      ACCESS_TOKEN,
    );
  });

  it("authenticates the record context, IV, and ciphertext", async () => {
    const encrypted = await encryptPlaidAccessToken(ACCESS_TOKEN, CONTEXT, VERSION_1_KEY);
    const changedCiphertext = encrypted.ciphertext.slice();
    changedCiphertext[0] = changedCiphertext[0]! ^ 1;
    const changedIv = encrypted.iv.slice();
    changedIv[0] = changedIv[0]! ^ 1;

    for (const attempt of [
      decryptPlaidAccessToken(encrypted, { ...CONTEXT, connectionId: "connection-2" }, [
        VERSION_1_KEY,
      ]),
      decryptPlaidAccessToken(encrypted, { ...CONTEXT, plaidItemId: "item-2" }, [VERSION_1_KEY]),
      decryptPlaidAccessToken({ ...encrypted, ciphertext: changedCiphertext }, CONTEXT, [
        VERSION_1_KEY,
      ]),
      decryptPlaidAccessToken({ ...encrypted, iv: changedIv }, CONTEXT, [VERSION_1_KEY]),
    ]) {
      await expect(attempt).rejects.toMatchObject({ code: "TOKEN_DECRYPTION_FAILED" });
    }
  });

  it("decrypts an old key version and rotates to the active version", async () => {
    await expect(decryptPlaidAccessToken(VERSION_1_VECTOR, CONTEXT, [VERSION_1_KEY])).resolves.toBe(
      ACCESS_TOKEN,
    );
    const version2Record = await rotatePlaidAccessToken(
      VERSION_1_VECTOR,
      CONTEXT,
      [VERSION_1_KEY, VERSION_2_KEY],
      VERSION_2_KEY,
    );

    expect(version2Record.keyVersion).toBe(2);
    expect(version2Record.iv).not.toEqual(VERSION_1_VECTOR.iv);
    await expect(
      decryptPlaidAccessToken(version2Record, CONTEXT, [VERSION_1_KEY, VERSION_2_KEY]),
    ).resolves.toBe(ACCESS_TOKEN);
    await expect(
      decryptPlaidAccessToken(version2Record, CONTEXT, [VERSION_1_KEY]),
    ).rejects.toMatchObject({ code: "TOKEN_KEY_UNAVAILABLE" });
  });

  it("rejects invalid keys, records, and plaintext without leaking their values", async () => {
    const failures = [
      encryptPlaidAccessToken("", CONTEXT, VERSION_1_KEY),
      encryptPlaidAccessToken(ACCESS_TOKEN, CONTEXT, { encodedKey: "not-a-key", version: 1 }),
      decryptPlaidAccessToken(
        { ciphertext: new Uint8Array(16), iv: new Uint8Array(11), keyVersion: 1 },
        CONTEXT,
        [VERSION_1_KEY],
      ),
    ];

    for (const failure of failures) {
      const error = await failure.catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(PlaidTokenCryptoError);
      expect(String(error)).not.toContain(ACCESS_TOKEN);
      expect(String(error)).not.toContain(VERSION_1_KEY.encodedKey);
    }
  });
});
