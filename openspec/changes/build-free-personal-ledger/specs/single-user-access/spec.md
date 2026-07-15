## ADDED Requirements

### Requirement: Single authorized identity

The system SHALL permit application and API access only to the one email address configured as the owner.

#### Scenario: Configured owner opens the app

- **WHEN** a request carries a valid Cloudflare Access assertion for the configured owner email
- **THEN** the system SHALL serve the protected application or requested API resource

#### Scenario: A different authenticated email opens the app

- **WHEN** a request carries an otherwise valid Access assertion for an email other than the configured owner
- **THEN** the system SHALL return 403 and SHALL NOT reveal ledger data

### Requirement: Origin verification of Access assertions

The application Worker MUST validate every Access JWT's signature, issuer, audience, expiry, and email claim instead of trusting the presence of proxy headers alone.

#### Scenario: Forged identity header without a JWT

- **WHEN** a request includes an owner-like email header but no valid `Cf-Access-Jwt-Assertion`
- **THEN** the system SHALL return 403

#### Scenario: Expired or wrong-audience JWT

- **WHEN** an Access JWT is expired or its audience does not match the application
- **THEN** the system SHALL return 403 and SHALL NOT create an application session

### Requirement: Protected application surface

All HTML, static app entry points, exports, and `/api/v1/*` routes SHALL be protected; the Plaid webhook SHALL run on a separate Worker that exposes no ledger UI or general-purpose API.

#### Scenario: Anonymous API request

- **WHEN** an unauthenticated client requests a ledger API route or export route
- **THEN** the request SHALL be denied before transaction data is read

#### Scenario: Request to the webhook Worker on an unknown path

- **WHEN** any client requests a path other than the supported Plaid webhook route on the sync Worker
- **THEN** the Worker SHALL return 404 without disclosing available internal routes

### Requirement: Same-origin write protection

The system MUST restrict the browser API to same-origin use and MUST validate the request origin, JSON content type, and a session-bound CSRF token for every state-changing browser request.

#### Scenario: Valid owner performs a write

- **WHEN** the owner sends a write request from the application origin with the current CSRF token and expected content type
- **THEN** the system SHALL evaluate the operation normally

#### Scenario: Cross-site write attempt

- **WHEN** a request has a missing or foreign Origin, invalid CSRF token, or unsupported content type
- **THEN** the system SHALL reject it without changing data

### Requirement: Secret and financial-data isolation

Bank credentials SHALL be handled only by Plaid Link; Plaid access tokens SHALL be encrypted before persistence, and no token, secret, full transaction description, account mask, CSV content, or webhook body SHALL be emitted to client bundles or production logs.

#### Scenario: Plaid Link completes

- **WHEN** the browser receives a short-lived Plaid public token
- **THEN** it SHALL send the token only to the protected exchange endpoint, and the resulting access token SHALL never be returned to the browser

#### Scenario: An internal operation fails

- **WHEN** Plaid, database, import, or report processing raises an exception
- **THEN** logs SHALL contain a stable error code and internal identifiers only, while the client receives a sanitized error response

### Requirement: Browser security and safe rendering

The system SHALL render all bank-, merchant-, import-, and user-provided strings as untrusted text and SHALL apply restrictive content, framing, MIME-sniffing, transport, and referrer policies.

#### Scenario: Merchant text contains markup

- **WHEN** a transaction description contains HTML or script-like content
- **THEN** the UI SHALL display it as text and SHALL NOT execute it

#### Scenario: Another site attempts to frame the ledger

- **WHEN** a third-party origin tries to embed the application
- **THEN** browser policy SHALL prevent framing

### Requirement: No offline financial-data cache

The installable PWA MAY cache versioned static assets but MUST NOT persist authenticated API responses, exports, or ledger snapshots in a Service Worker cache.

#### Scenario: Device goes offline after prior use

- **WHEN** the owner opens the installed app without network access
- **THEN** the app SHALL show an offline state and SHALL NOT display a cached transaction history as though it were current
