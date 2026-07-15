import { base64url, createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export const ACCESS_ASSERTION_HEADER = "Cf-Access-Jwt-Assertion";

export type AccessErrorCode =
  "ACCESS_ASSERTION_MISSING" | "ACCESS_ASSERTION_INVALID" | "ACCESS_OWNER_MISMATCH";

export interface AccessVerifierConfig {
  audience: string;
  ownerEmail: string;
  teamDomain: string;
}

export interface AccessIdentity {
  email: string;
  sessionBinding: string;
  subject: string | null;
}

export type AccessRequestVerifier = (request: Request) => Promise<AccessIdentity>;

export class AccessDeniedError extends Error {
  constructor(readonly code: AccessErrorCode) {
    super(code);
    this.name = "AccessDeniedError";
  }
}

export function createAccessVerifier(
  config: AccessVerifierConfig,
  jwks: JWTVerifyGetKey,
): AccessRequestVerifier {
  const ownerEmail = config.ownerEmail.trim().toLowerCase();

  return async (request) => {
    const assertion = request.headers.get(ACCESS_ASSERTION_HEADER);
    if (!assertion) {
      throw new AccessDeniedError("ACCESS_ASSERTION_MISSING");
    }

    try {
      const { payload } = await jwtVerify(assertion, jwks, {
        algorithms: ["RS256"],
        audience: config.audience,
        issuer: config.teamDomain,
      });
      if (typeof payload.email !== "string" || payload.email.length === 0) {
        throw new AccessDeniedError("ACCESS_ASSERTION_INVALID");
      }
      if (payload.email.trim().toLowerCase() !== ownerEmail) {
        throw new AccessDeniedError("ACCESS_OWNER_MISMATCH");
      }

      const assertionDigest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(assertion),
      );

      return {
        email: payload.email,
        sessionBinding: base64url.encode(new Uint8Array(assertionDigest)),
        subject: typeof payload.sub === "string" ? payload.sub : null,
      };
    } catch (error) {
      if (error instanceof AccessDeniedError) throw error;
      throw new AccessDeniedError("ACCESS_ASSERTION_INVALID");
    }
  };
}

export function createRemoteAccessVerifier(config: AccessVerifierConfig): AccessRequestVerifier {
  return createAccessVerifier(
    config,
    createRemoteJWKSet(new URL("/cdn-cgi/access/certs", config.teamDomain)),
  );
}
