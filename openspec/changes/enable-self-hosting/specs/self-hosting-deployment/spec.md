## ADDED Requirements

### Requirement: Open-source licence
The repository SHALL carry a licence file at its root that permits any recipient to use, modify, and deploy the software for their own purposes. The licence MUST be an OSI-approved licence and MUST be declared in `package.json`.

#### Scenario: Recipient inspects licensing
- **WHEN** someone opens the repository root
- **THEN** a `LICENSE` file states the granted rights and the warranty disclaimer, and `package.json` names the same licence identifier.

### Requirement: Self-hosting installation guide
A dedicated self-hosting guide SHALL document the complete path from an empty Cloudflare account to a first successful owner login, without reference to the original owner's account, resources, or release history. It MUST cover D1 creation, migration application, Zero Trust Access application setup, where each of `ACCESS_AUD`, `ACCESS_TEAM_DOMAIN`, `OWNER_EMAIL` and `CSRF_HMAC_KEY` is obtained or generated, the Cron Trigger, and the regional configuration values. It MUST state that secrets are never committed.

#### Scenario: Newcomer deploys their own instance
- **WHEN** a reader with no prior knowledge of this project follows the guide in order
- **THEN** every required value has a documented source, no step depends on the original owner's resources, and the final step verifies that the owner can log in and that anonymous requests are denied.

#### Scenario: Guide states its own limits
- **WHEN** the reader reaches the configuration section
- **THEN** the guide states the supported currency and timezone constraints, and names Cloudflare Access as a required prerequisite rather than an optional one.

### Requirement: Owner operations records stay separate from public documentation
Deployment version identifiers, release evidence, rollback versions, and owner-authorization wording SHALL NOT appear in documentation addressed to self-hosters. The existing deployment runbook MUST remain available to the owner as an operations record, distinct from the installation guide.

#### Scenario: Self-hoster reads deployment documentation
- **WHEN** a self-hoster reads the installation guide
- **THEN** it contains no production version identifiers, asset hashes, or authorization clauses that only apply to the original deployment.

### Requirement: Deployment configuration carries no owner-specific resource identifiers
Configuration committed to the repository SHALL NOT contain the original owner's D1 database identifier or any other account-scoped resource identifier. Placeholders MUST be recognizable as placeholders, and the guide MUST instruct the self-hoster to replace them.

#### Scenario: Fork attempts deployment without editing configuration
- **WHEN** a self-hoster deploys before replacing the database identifier placeholder
- **THEN** the deployment fails with an error that points at the unreplaced placeholder rather than silently targeting another account's resource.
