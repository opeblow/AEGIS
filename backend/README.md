# Aegis Backend

Private infrastructure for high-value transactions. Aegis is being built as an
institutional transaction engine: create transactions, work with verified
counterparties, exchange private offers, negotiate terms, obtain approvals,
settle, reconcile, and keep an auditable history.

This repository contains the **backend** service only. The platform will
eventually also have `frontend/` and `ai-ml/` siblings.

> **Current scope (Phases 1–6):** this codebase contains the **production
> foundation, production-grade authentication, multi-tenant organizations, the
> deals/transaction state engine, private negotiation, and secure document
> exchange with deal requirements**. Phase 1 established bootstrapping,
> configuration, error handling, request IDs, structured logging, security
> defaults, validation, and database wiring. Phase 2 adds Argon2id password
> hashing, opaque server-side sessions, email verification, password
> reset/change, session management, CSRF protection, auth rate limiting, and a
> security-event trail. Phase 3 adds organizations with role-based membership.
> Phase 4 adds organization-scoped **deals** (institutional transactions) with a
> validated state machine, money-in/money-out as decimal strings, optimistic
> concurrency, idempotent transitions, an immutable audit trail, and a deadline
> expiry worker. Phase 5 adds verified **counterparties** (the org↔org trust
> graph), confidential **deal rooms** with token-based participant invitations,
> a participant-level offer machine (submit/counter/accept/reject/withdraw +
> deadline expiry), and a side-relative negotiation history. Phase 6 adds
> **documents & deal requirements**: an authenticated, participant-scoped
> document store (bytes never in PostgreSQL), magic-byte + extension
> validation, a versioned document lifecycle (upload/complete/submit/review/
> withdraw/replace → supersede), privacy visibility windows, and **requirements**
> that drive owner-only **readiness** (required, waivable, satisfiable against
> accepted evidence, reopen after rejection) with deadline expiry. There is
> intentionally **no** settlement, Canton integration, or
> AI/ML code here yet. Approval engine (Phase 7) is now implemented:
> approval policies with deterministic rule evaluation, approval workflows
> with state machine (NOT_STARTED → PENDING → APPROVED/REJECTED/EXPIRED/CANCELLED),
> request-level decisions with sequential ordering, audit events, and
> compliance gates (required documents/requirements).

## Requirements

- **Node.js** ≥ 20 (built and tested on Node 24)
- **PostgreSQL** ≥ 15 (tested on PostgreSQL 17)
- npm ≥ 10

## Installation

```bash
npm install
```

Prisma generates its client during `postinstall`; you can also run it manually
with `npm run db:generate`.

## Environment

Copy the template and fill in real values:

```bash
cp .env.example .env
```

```env
NODE_ENV=development
PORT=4000
HOST=0.0.0.0
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/aegis?schema=public
CORS_ORIGIN=http://localhost:3000,http://localhost:5173
LOG_LEVEL=info

# Authentication (Phase 2) — all optional except as documented
# AUTH_SESSION_TTL_MS=604800000          # absolute lifetime (7 days)
# AUTH_SESSION_IDLE_MS=1800000           # idle timeout (30 min)
# AUTH_VERIFICATION_TOKEN_TTL_MS=86400000   # verify-email validity (24 h)
# AUTH_PASSWORD_RESET_TOKEN_TTL_MS=3600000  # reset-token validity (60 min)
# AUTH_LOGIN_MAX_ATTEMPTS=5              # failed logins before throttle
# AUTH_LOGIN_THROTTLE_MS=900000          # throttle window (15 min)
# PASSWORD_PEPPER=                       # optional Argon2 secret (max 32 chars)
# AUTH_PASSWORD_MIN_LENGTH=12
# AUTH_PASSWORD_MAX_LENGTH=1024
# AUTH_COOKIE_SECURE=false               # force Secure cookies (e.g. HTTPS dev)
```

- `DATABASE_URL` is **required** and must be a `postgresql://` connection
  string. The app fails fast at startup if it is missing or malformed.
- `CORS_ORIGIN` is a comma-separated list. `*` is rejected in `production`.
- `PASSWORD_PEPPER` is an optional server-side secret fed through Argon2id's
  `secret` parameter (spec-limited to 32 bytes). Store it out of band (secret
  management), never in PostgreSQL.
- Secrets must never be committed. `.env` is git-ignored.

## Database

The Prisma schema models authentication (Phase 2): `User`, opaque server-side
`Session`, single-use `EmailVerification` and `PasswordReset` challenges, and
`SecurityEvent` (the seed of the future audit pipeline). Password hashes are
Argon2id; session/verification/reset/CSRF tokens are stored **only** as
SHA-256 hashes — raw tokens exist solely in client cookies.

Phase 3 additions: `Organization`, `OrganizationMembership`,
`OrganizationInvitation`, and the system `Role`/`Permission` tables (ADMIN,
MEMBER, OWNER, VIEWER) seeded by `npm run db:seed`.

Phase 4 additions: `Deal` (the transaction) and `DealStateTransition` (an
immutable audit row appended on every status move). Money lives in
`DECIMAL(28,8)` columns and is only ever read/written as strings on the wire.
`reference` is unique per organization (client-supplied or server-allocated
under a retry loop) and `idempotencyKeyHash` (create) / `requestId`
(transitions) drive safe retries.

Phase 5 additions: `Counterparty` (an org↔org trust edge with a
PENDING→ACTIVE/REVOKED lifecycle), `DealParticipant` (which organization is
in a deal room, with `createdByParticipantId` marking the immutable owner),
`DealParticipantTransition` (status moves + version guard),
`DealInvitation` (email-bound, single-use, expiring join tokens delivering a
raw token **by email only**), `Offer` (the negotiation artifact — a chain via
`parentOfferId`, DRAFT→SUBMITTED→COUNTERED/ACCEPTED/…, `version` guarded,
`idempotencyKeyHash` for create and `requestId` for every action), and
`OfferTransition` (the immutable negotiation history). `SecurityEvent` rows
now also carry negotiation audit types.

```bash
# Create the databases first, e.g.
createdb aegis
createdb aegis_test

# Generate the client (after schema changes)
npm run db:generate

# Create and apply a migration in development
npm run db:migrate

# Sync the TEST database schema to the current Prisma schema
npm run db:test:setup

# Inspect the database
npm run db:studio
```

In production use `npm run db:migrate:prod` (`prisma migrate deploy`).

## Development

```bash
npm run dev        # tsx watch, boots src/server.ts
```

## Testing

```bash
npm test           # vitest run
npm run test:watch
npm run test:coverage
```

Unit tests (`tests/unit/**`) are self-contained and always run. The
integration suites (`tests/integration/auth.test.ts`,
`tests/integration/errors.test.ts`, `tests/integration/deals.test.ts`,
`tests/integration/negotiation.test.ts`) exercise the full HTTP surface
against the **real** `aegis_test` PostgreSQL database; they skip themselves
silently when that database is unreachable, so `npm test` stays safe anywhere.
The orgs/deals suites self-heal the system roles on a fresh test database
(idempotent `syncSystemRoles`).

```bash
npm run db:test:setup   # (re)create the test schema before running the suite
```

## API

### Health

| Endpoint                | Method | Description                                     |
| ----------------------- | ------ | ----------------------------------------------- |
| `/api/v1/health`        | GET    | Liveness — always 200 `{ "status": "ok" }`    |
| `/api/v1/health/ready`  | GET    | Readiness — checks the database; 503 on degrade |

### Authentication (`/api/v1/auth`)

| Endpoint                    | Method   | Auth | CSRF | Description                                    |
| --------------------------- | -------- | ---- | ---- | ---------------------------------------------- |
| `/auth/register`            | POST     | —    | —    | Create account, emails a verification token    |
| `/auth/login`               | POST     | —    | —    | Sets session + CSRF cookies, returns `csrfToken` |
| `/auth/logout`              | POST     | ✔    | ✔    | Revokes current session, clears cookies        |
| `/auth/logout-all`          | POST     | ✔    | ✔    | Revokes every other session                    |
| `/auth/verify-email`        | POST     | —    | —    | Confirm email with a single-use token          |
| `/auth/resend-verification` | POST     | —    | —    | Re-sends a verification email (uninformative)  |
| `/auth/forgot-password`     | POST     | —    | —    | Requests a password reset (uninformative)      |
| `/auth/reset-password`      | POST     | —    | —    | Completes a reset; invalidates all sessions    |
| `/auth/change-password`     | POST     | ✔    | ✔    | Requires current password; revokes other sessions |
| `/auth/me`                  | GET      | ✔    | —    | Current user + session                         |
| `/auth/sessions`            | GET      | ✔    | —    | List the user's sessions (recency order)       |

> CSRF column refers to the synchronizer-token header requirement
> (`x-csrf-token`). Login/register/verify/reset/forgot rely on the Origin check
> + `SameSite=Lax` + per-route rate limits instead. State-changing endpoints
> **not** on this list (e.g. registering) still pass the global Origin check.

#### Cookies

- `aegis_session` — HttpOnly, `SameSite=Lax`, `Path=/`; holds the opaque
  session token. `__Host-aegis_session` when `Secure`.
- `aegis_csrf` — readable by JavaScript (must be echoed back in
  `x-csrf-token`); its hash is stored on the session row.
- `AUTH_COOKIE_SECURE=true` (or running in `production`) switches to the
  `__Host-` prefix and `Secure`.

#### Development mailbox (dev/test only)

There is no real email provider yet. Auth emails are captured in an in-process
mailbox and mirrored to `.dev-mailbox/`:

| Endpoint                       | Method | Description                        |
| ------------------------------ | ------ | ---------------------------------- |
| `/api/v1/auth/dev/mailbox`     | GET    | List captured messages (no tokens) |
| `/api/v1/auth/dev/mailbox/tokens` | GET | List messages **with** tokens    |
| `/api/v1/auth/dev/mailbox`     | DELETE | Clear the mailbox                  |

These routes return `403` in `production`.

### Organizations & members (`/api/v1/organizations`)

Onboarded in Phase 3. A user's first organization makes them **OWNER**; invites
vouchers become **MEMBER** membership. Every deals endpoint below scopes to the
`organizationId` in the URL, and membership is checked before any deal row is
touched — a non-member gets `404`, never a hint that the resource exists.
System role permissions (e.g. `deals:create`) gate each route.

### Deals (`/api/v1/organizations/:organizationId/deals`)

Phase 4 — the transaction state engine. A *deal* is a term sheet/instrument
record being negotiated within an organization.

| Endpoint                                            | Method | Auth | CSRF | Perm        | Rate limit | Description                              |
| --------------------------------------------------- | ------ | ---- | ---- | ----------- | ---------- | ---------------------------------------- |
| `/organizations/:organizationId/deals`              | POST   | ✔    | ✔    | deals:create | 30/min     | Create a `DRAFT` deal                     |
| `/organizations/:organizationId/deals`              | GET    | ✔    | —    | deals:read  | —          | List (paginated, recency order)          |
| `/organizations/:organizationId/deals/:dealId`      | GET    | ✔    | —    | deals:read  | —          | Get one deal                              |
| `/organizations/:organizationId/deals/:dealId/history` | GET | ✔   | —    | deals:read  | —          | Immutable transition audit trail         |
| `/organizations/:organizationId/deals/:dealId`      | PATCH  | ✔    | ✔    | deals:update | 60/min     | Edit draft fields (version-guarded)     |
| `/organizations/:organizationId/deals/:dealId/transitions` | POST | ✔ | ✔ | deals:transition | 60/min | Advance the state machine ONLY |

Status can **only** change through the transitions endpoint — the state machine
in `deal-state.ts` is the single source of truth; `PATCH` can never touch
`status`. Cancellation is a transition to `CANCELLED` and requires a `reason`
(as do `FAILED`, `DISPUTED`, and `EXPIRED`).

#### Example flow

```bash
# create (201) — money is a string, idempotencyKey makes retries safe
curl.exe -X POST "http://localhost:4000/api/v1/organizations/$ORG/deals" \
  -H "x-csrf-token: $CSRF" -b aegis.cookies -H "Content-Type: application/json" \
  -d '{"type":"RWA_PURCHASE","name":"Lekki warehouse","currency":"USD",
       "notionalAmount":"1250000.50","idempotencyKey":"supplier-contract-001"}'

# advance (200) — requestId is the idempotency key; version guards concurrency
curl.exe -X POST ".../deals/$DEAL/transitions" -H "x-csrf-token: $CSRF" \
  -b aegis.cookies -H "Content-Type: application/json" \
  -d '{"toStatus":"NEGOTIATING","version":1,"requestId":"move-0001"}'

# audit trail (deals:read)
curl.exe ".../deals/$DEAL/history" -b aegis.cookies
```

#### Deal lifecycle

States: `DRAFT → OPEN → NEGOTIATING → AGREED → APPROVAL_PENDING → APPROVED →
SETTLEMENT_PENDING → SETTLED → RECONCILING → COMPLETED`, with `EXPIRED`,
`CANCELLED`, `FAILED`, and `DISPUTED` as exits. The editor decides the exact
permissible arcs (`deal-state.ts`); every move appends a
`DealStateTransition` row and bumps `version`.

#### Concurrency, idempotency, and money

- **Optimistic concurrency:** every update/transition carries the deal's
  `version`; a stale write fails the conditional SQL update and returns `409
  DEAL_VERSION_CONFLICT` instead of silently clobbering.
- **Idempotent transitions:** `transitionDeal` checks `requestId` *before* the
  legality check, so a retried request returns the original result with
  `replay` semantics even if the deal has since moved on. Same `requestId` with
  a different target → `409 DEAL_IDEMPOTENCY_CONFLICT`.
- **Money policy:** amounts are ISO 4217 strings limited to the currency's
  minor-unit precision (reject, never round); zero/negative/`NaN`/exponent
  forms are rejected. Serialization is canonical (`1250000.50`, never
  `1250000.50000000`), so client rounding can't silently shift value.
- **Expiry worker:** `expireEligibleDeals` runs on the server's maintenance
  interval (also fired at boot) and drives `EXPIRED` through the state machine
  with a `DEAL_EXPIRED` security event, never by leaking a direct status write.

#### Error envelope

All errors use a standardized envelope:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Route not found.",
    "requestId": "265ad25b-9190-4d79-98b1-08df84b6f03b"
  }
}
```

Stable codes: `VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`,
`CONFLICT`, `RATE_LIMITED`, `DATABASE_ERROR`, `INTERNAL_SERVER_ERROR`, plus
deal-specific `DEAL_NOT_FOUND`, `DEAL_VERSION_CONFLICT`,
`DEAL_IDEMPOTENCY_CONFLICT`, `INVALID_DEAL_STATE`, and
`INVALID_DEAL_TRANSITION`.

Every response carries `x-request-id` (honored from the client when safe,
otherwise generated), which is also present in logs and error bodies.

### Negotiation (`/api/v1`)

Phase 5 — verified counterparties and private deal rooms. Two authorization
models coexist here. **Counterparty endpoints are org-scoped** (a
`counterparties:read` / `counterparties:manage` role permission, same 404
non-membership policy as deals). **Deal endpoints are participant-scoped**:
`resolveDealViewer` resolves the actor's organization *inside* the deal before
any permission check, so a stranger hitting a deal id sees the same `404
DEAL_NOT_FOUND` as a bad id — confidentiality holds even pre-join.

Counterparty lifecycle (`UNVERIFIED → PENDING → ACTIVE`, with `REVOKED` and
`SUSPENDED` as exits; `REJECTED` on verification):

| Endpoint                                                        | Method | Auth | CSRF | Perm | Description                          |
| --------------------------------------------------------------- | ------ | ---- | ---- | ---- | ------------------------------------ |
| `/organizations/:organizationId/counterparties`                 | GET    | ✔    | —    | counterparties:read | List (paginated)         |
| `/organizations/:organizationId/counterparties`                 | POST   | ✔    | ✔    | counterparties:manage | Create a PENDING edge  |
| `/organizations/:organizationId/counterparties/:counterpartyId` | GET    | ✔    | —    | counterparties:read | Get one (your side only) |
| `/organizations/:organizationId/counterparties/:counterpartyId` | PATCH  | ✔    | ✔    | counterparties:manage | Verify/activate/suspend  |
| `/organizations/:organizationId/counterparties/:counterpartyId` | DELETE | ✔    | ✔    | counterparties:manage | Revoke (soft, items kept) |

Deal rooms and participants:

| Endpoint                                        | Method | Auth | CSRF | Description                                             |
| ----------------------------------------------- | ------ | ---- | ---- | ------------------------------------------------------- |
| `/deals/:dealId/room`                           | GET    | ✔    | —    | The room: deal + participant roster (participants only) |
| `/deals/:dealId/participants`                   | GET    | ✔    | —    | Roster (side-relative: outsiders read `UNVERIFIED`)     |
| `/deals/:dealId/participants/:participantId`    | GET    | ✔    | —    | One participant                                        |
| `/deals/:dealId/participants/:participantId/status` | PATCH | ✔   | ✔    | Owner: suspend/reactivate/remove (version-guarded)      |
| `/deals/:dealId/invitations`                    | GET    | ✔    | —    | Owner: outstanding invitations                          |
| `/deals/:dealId/invitations`                    | POST   | ✔    | ✔    | Owner: invite an org by email (owner-only)              |
| `/deals/:dealId/invitations/:invitationId`      | GET    | ✔    | —    | Owner: one invitation                                   |
| `/deals/:dealId/invitations/:invitationId/revoke` | POST | ✔   | ✔    | Owner: revoke a PENDING invitation                      |
| `/deal-invitations/:token`                      | GET    | —    | —    | Resolve a join token (emails bear the token, not APIs)  |
| `/deal-invitations/:token/accept`               | POST   | —    | —    | Join the room (single-use, idempotent replay)           |
| `/deal-invitations/:token/decline`              | POST   | —    | —    | Decline (single-use, idempotent replay)                 |

Invitation tokens are high-entropy, delivered **by email only**, and stored
hashed. Accept/decline are unauthenticated on purpose (the token *is* the
credential) and dispute an account — the email must be a verified member of
the invited organization. After a decline the owner can re-invite the same
org. The first participant is the immutable **owner** (auto-joined at deal
creation); member status transitions (`SUSPENDED`/`REACTIVATED`/`REMOVED`)
are version-guarded against the roster and leave a transition audit row.

Offers and negotiation (`OFFER_TRANSITIONS` follow the machine in
`offer-state.ts`):

| Endpoint                                      | Method | Auth | CSRF | Description                           |
| --------------------------------------------- | ------ | ---- | ---- | ------------------------------------- |
| `/deals/:dealId/offers`                       | GET    | ✔    | —    | List offers (participants only)       |
| `/deals/:dealId/offers`                       | POST   | ✔    | ✔    | Create a DRAFT offer to a participant |
| `/deals/:dealId/offers/:offerId`              | GET    | ✔    | —    | Get one offer + its chain id          |
| `/deals/:dealId/offers/:offerId/submit`       | POST   | ✔    | ✔    | DRAFT → SUBMITTED                     |
| `/deals/:dealId/offers/:offerId/counter`      | POST   | ✔    | ✔    | Submit a child counteroffer           |
| `/deals/:dealId/offers/:offerId/accept`       | POST   | ✔    | ✔    | ACCEPTED (supersedes the chain)       |
| `/deals/:dealId/offers/:offerId/reject`       | POST   | ✔    | ✔    | REJECTED (revives the parent)         |
| `/deals/:dealId/offers/:offerId/withdraw`     | POST   | ✔    | ✔    | WITHDRAWN (own DRAFT/SUBMITTED)       |
| `/deals/:dealId/negotiation`                  | GET    | ✔    | —    | Immutable history (side-relative)     |

Offer concurrency/idempotency mirrors deal semantics: every action carries the
offer's `version` (stale → `409 OFFER_CONCURRENCY_CONFLICT`), every
action/creates carries `requestId` / `idempotencyKey` (replay returns the
original result with `replay: true`; a reused id → `OFFER_IDEMPOTENCY_CONFLICT`),
money is an ISO 4217 decimal string, and a `SUBMITTED` offer whose
`expiresAt` passes is driven to `EXPIRED` by the expiry worker with an
`OFFER_EXPIRED` security event. Accepting a child offer supersedes the whole
parent chain (`SUPERSEDED`); rejecting a counteroffer revives its parent as
`SUBMITTED`. Negotiation history and offers are only ever visible to deal
participants (confidential).

### Documents (`/api/v1/deals/:dealId`)

| Endpoint                          | Method | Auth | CSRF | Description                                      |
| --------------------------------- | ------ | ---- | ---- | ------------------------------------------------ |
| `/documents`                      | GET    | ✔    | —    | List documents the viewer may see (window-scoped)|
| `/documents`                      | POST   | ✔    | ✔    | Create a `UPLOADING` document (`idempotencyKey` optional) |
| `/documents/:documentId`          | GET    | ✔    | —    | Get one document (hidden → identical 404)        |
| `/documents/:documentId/versions` | GET    | ✔    | —    | Every revision of the document's `chainId`       |
| `/documents/:documentId/upload`   | PUT    | ✔    | ✔    | Raw bytes; extension **and** magic bytes checked |
| `/documents/:documentId/complete` | POST   | ✔    | ✔    | `UPLOADING → COMPLETE` (client confirms bytes)   |
| `/documents/:documentId/submit`   | POST   | ✔    | ✔    | `COMPLETE → SUBMITTED`                           |
| `/documents/:documentId/withdraw` | POST   | ✔    | ✔    | Submitter pulls a `SUBMITTED` doc back           |
| `/documents/:documentId/review`   | POST   | ✔    | ✔    | Owner `ACCEPT`/`REJECT` with comment             |
| `/documents/:documentId/replace`  | POST   | ✔    | ✔    | Open a child version; supersedes parent on completion |
| `/documents/:documentId/download` | GET    | ✔    | —    | Stored bytes; only for live, visible documents   |

Upload body is raw (not multipart) with `content-type` from
`application/pdf`, `image/png`, `application/zip`, `image/gif`; payloads
over `DOCUMENT_MAX_SIZE_BYTES` (default 25 MB) return `413 DOCUMENT_TOO_LARGE`.
Hidden documents return identical `404 DOCUMENT_NOT_FOUND` for reads and
downloads (no existence oracle).

### Requirements & readiness (`/api/v1/deals/:dealId`)

| Endpoint                          | Method | Auth | CSRF | Description                                      |
| --------------------------------- | ------ | ---- | ---- | ------------------------------------------------ |
| `/requirements`                   | GET    | ✔    | —    | List requirements (owner: all; others: their own)|
| `/requirements`                   | POST   | ✔    | ✔    | Owner mints a requirement (`requestId`, deadline)|
| `/requirements/:requirementId`    | GET    | ✔    | —    | Get one requirement                              |
| `/requirements/:requirementId/submit` | POST | ✔  | ✔    | Assignee submits (attach + evidence optional)    |
| `/requirements/:requirementId/reject` | POST | ✔  | ✔    | Owner rejects back to assignee                   |
| `/requirements/:requirementId/waive`  | POST | ✔  | ✔    | Owner marks `WAIVED`                             |
| `/requirements/:requirementId/reopen` | POST | ✔  | ✔    | Owner reopens a `REJECTED` requirement           |
| `/requirements/:requirementId/satisfy`| POST | ✔  | ✔    | Owner satisfies after evidence checks            |
| `/requirements/:requirementId/attach` | POST | ✔  | ✔    | Reference a document group as evidence (idempotent) |
| `/readiness`                       | GET    | ✔    | —    | Owner-only readiness snapshot                    |

Every transition carries `requestId` (replay returns the original result with
`replay: true`), `satisfy` verifies the requirement is `REQUIRED`/`WAIVED` and
its referenced evidence is `ACCEPTED` and unexpired, and the deadline expiry
worker drives missed `OPEN`/`SUBMITTED` requirements to `EXPIRED`. Readiness
returns `{ dealId, required, satisfied, outstanding, blocked, requirements }`;
`blocked` is true whenever any required requirement is not satisfied.

Additions to the stable error codes: `DEAL_PARTICIPANT_VERSION_CONFLICT`,
`DEAL_PARTICIPANT_IDEMPOTENCY_CONFLICT`, `DEAL_INVITATION_REVOKED`,
`DEAL_INVITATION_EXPIRED`, `DEAL_INVITATION_ALREADY_USED`,
`OFFER_CONCURRENCY_CONFLICT`, `OFFER_IDEMPOTENCY_CONFLICT`,
`OFFER_INVALID_STATE`, `OFFER_INVALID_TRANSITION`, `OFFER_EXPIRED`,
`COUNTERPARTY_ALREADY_EXISTS`, `COUNTERPARTY_INVALID_TRANSITION`,
`DOCUMENT_ACCESS_DENIED`, `DOCUMENT_ALREADY_SUBMITTED`,
`DOCUMENT_EXPIRED`, `DOCUMENT_INVALID_STATE`, `DOCUMENT_NOT_FOUND`,
`DOCUMENT_NOT_READY`, `DOCUMENT_STORAGE_ERROR`, `DOCUMENT_TOO_LARGE`,
`DOCUMENT_UPLOAD_INVALID`, `DOCUMENT_VERSION_CONFLICT`,
`REQUIREMENT_DOCUMENT_INVALID`, `REQUIREMENT_INVALID_STATE`,
`REQUIREMENT_NOT_ASSIGNED`, and `REQUIREMENT_NOT_FOUND`. Cross-module
idempotency-key reuse (documents and requirements included) surfaces as the
shared `DEAL_IDEMPOTENCY_CONFLICT`.

## Scripts

| Script                  | Purpose                                   |
| ----------------------- | ----------------------------------------- |
| `npm run dev`           | Start with hot reload                     |
| `npm run build`         | Compile TypeScript to `dist/`             |
| `npm start`             | Run the compiled server                   |
| `npm test` / `test:watch` | Run Vitest                              |
| `npm run lint`          | ESLint over `src/` and `tests/`           |
| `npm run format`        | Prettier write                            |
| `npm run format:check`  | Prettier check                            |
| `npm run typecheck`     | Type-check `src/` and `tests/`            |
| `npm run db:generate`   | Prisma generate                           |
| `npm run db:migrate`    | Prisma migrate dev                        |
| `npm run db:migrate:prod` | Prisma migrate deploy                   |
| `npm run db:studio`     | Prisma Studio                             |
| `npm run db:test:setup` | Recreate the test database schema         |
| `npm run db:seed`       | Seed system roles + permissions           |

## Architecture

```
src/
├── app.ts                Fastify application factory (no socket binding)
├── server.ts             Boots the app, binds HTTP, graceful shutdown, auth cleanup job
├── config/               Zod-validated environment configuration
├── plugins/              Cross-cutting Fastify plugins
│   ├── request-id        Echoes the correlation id into responses
│   ├── security          Helmet headers, CORS + credentials, CSRF origin check, rate limiting
│   └── error-handling    Centralized, standardized error serialization
├── modules/
│   ├── auth/             Phase 2 authentication
│   │   ├── auth.plugin.ts    Registers @fastify/cookie, `authenticate` + `requireCsrf` middleware
│   │   ├── auth.routes.ts    All /api/v1/auth endpoints
│   │   ├── auth.service.ts   Login/logout/register/verify/reset/change orchestration
│   │   ├── user.service.ts   Accounts (Argon2id hashing, email normalization)
│   │   ├── session.service.ts Opaque sessions (hash-only tokens, CSRF pairing)
│   │   ├── verification.service.ts  Single-use email-verification challenges
│   │   ├── password-reset.service.ts Single-use reset challenges
│   │   ├── passwords.ts     Argon2id policy, pepper, timing-equalized verification
│   │   ├── tokens.ts        High-entropy token generation + SHA-256 hashing
│   │   ├── csrf.ts          Synchronizer-token issuance/verification
│   │   ├── cookies.ts       Session/CSRF cookie flags (__Host- in production)
│   │   ├── email.service.ts Dev mailbox (in-process + .dev-mailbox/ mirror)
│   │   ├── security-events.ts Audit trail for the future pipeline
│   │   └── schemas.ts       Zod request schemas
│   ├── organizations/    Phase 3 multi-tenancy
│   │   ├── organizations.routes.ts   Membership & org lifecycle
│   │   ├── organizations.service.ts  Org-scoped operations + role guards
│   │   ├── role.seed.ts / roles.ts   System roles + permission catalog
│   │   └── route-helpers.ts          authorize(request, orgId, permission)
│   └── deals/            Phase 4 transaction state engine
│       ├── deal.routes.ts        6 HTTP endpoints (/api/v1/organizations/:orgId/deals…)
│       ├── deal.service.ts       create/list/get/history/update/transition/expire
│       ├── deal-state.ts         Single source of truth: states, arcs, types
│       ├── deal.schemas.ts       ISO 4217 money policy + Zod request schemas
│       └── deal.types.ts         PublicDeal / PublicDealTransition wire serialization
│   └── negotiation/      Phase 5 private negotiation
│       ├── negotiation.routes.ts Counterparties, rooms, invitations, offers, history
│       ├── counterparty.service.ts Org↔org trust edges + verification lifecycle
│       ├── participant.service.ts Room roster, invitations, accept/decline, status moves
│       ├── offer.service.ts       Offer machine + chain + history + expiry worker
│       ├── offer-state.ts         Single source of truth: offer states & arcs
│       ├── participant-policy.ts  resolveDealViewer / requireOwnerViewer (confidentiality)
│       ├── negotiation.schemas.ts Zod request schemas (money + token policies)
│       └── negotiation.types.ts   Public* wire serialization (side-relative views)
├── routes/
│   └── health/           GET /api/v1/health and /api/v1/health/ready
├── lib/
│   ├── errors/           AppError and stable error codes
│   ├── validation.ts     Reusable Zod request/response validation helpers
│   ├── logger.ts         Structured logging (Pino) with redaction
│   ├── prisma.ts         Prisma singleton + connectivity probe
│   └── request-id.ts     Safe `x-request-id` parsing / generation
└── types/                Shared API types
prisma/
└── schema.prisma         Data model (auth + organizations + deals + negotiation)
tests/
├── unit/                 Auth + deals + negotiation primitives (tokens, passwords, csrf, cookies, email, schemas, state machines, money)
├── integration/          Full auth + orgs + deals + negotiation HTTP lifecycles against the real test database
│                         (auto-skips when aegis_test is unreachable)
├── health/               Liveness + readiness behavior
└── config/               Environment validation (fail-fast)
```

The `app.ts` / `server.ts` split means the entire application can be exercised
in tests via `app.inject()` without opening a real HTTP port.

## Authentication design (Phase 2)

- **Sessions** are opaque: a 256-bit random token lives only in the HttpOnly
  cookie; the database stores its SHA-256 hash plus a hashed CSRF proof.
  Absolute and idle timeouts are enforced server-side (defaults 7d / 30m).
- **Passwords** use Argon2id (`memoryCost` 65536 KiB, `timeCost` 3,
  `parallelism` 4) with an optional env-only pepper; login failures against
  unknown accounts pay a dummy verification to equalize timing.
- **No account enumeration**: `register` emails nothing on duplicates,
  `login` says `Invalid email or password.` for every failure, and
  `forgot-password` / `resend-verification` return heat-independent
  responses. Duplicate registration is a 409 only because the DB UNIQUE
  constraint is the source of truth.
- **CSRF**: SameSite=Lax cookies + a global Origin allowlist check (dev/test
  exempt) + synchronizer tokens (header vs. readable cookie vs. session hash)
  on authenticated state changes.
- **Brute-force**: per-route IP throttling (`@fastify/rate-limit`) plus a
  per-account throttle derived from `LOGIN_FAILED` security events
  (`AUTH_LOGIN_MAX_ATTEMPTS` in `AUTH_LOGIN_THROTTLE_MS`).
- **Re-auth on password change**: `change-password` requires the current
  password and revokes all other sessions; `reset-password` revokes every
  session.
- **Security events** (`SecurityEvent`) record every auth lifecycle
  transition without ever storing passwords or raw tokens.

## Phase 4 scope

Phase 4 ships: organizations-scoped deals with a validated state machine
(`DRAFT → … → COMPLETED` plus `EXPIRED`/`CANCELLED`/`FAILED`/`DISPUTED` exits),
ISO 4217 money as decimal strings with reject-don't-round precision policy,
optimistic `version` concurrency, idempotent create (`idempotencyKey`) and
transitions (`requestId`), an immutable `DealStateTransition` audit trail, a
deadline expiry worker through the machine, `securityEvent` hooks, the
`deals:transition` permission, unit tests for the machine/money/schemas, and
an integration suite covering creation, listing, updates, the happy path,
illegal jumps, version conflicts, idempotent replays, cross-tenant isolation,
and expiry.

## Phase 5 scope

Phase 5 ships the private negotiation layer on top: an org↔org
`Counterparty` trust graph (`UNVERIFIED → PENDING → ACTIVE` with verification,
suspend/revoke), confidential **deal rooms** keyed by `DealParticipant` with a
single immutable owner, single-use **email-delivered invitation tokens**
(stored hashed, declinable and re-invitable), a participant offer machine
(`DRAFT → SUBMITTED → COUNTERED/ACCEPTED/REJECTED/WITHDRAWN/EXPIRED` with
parent-chain supersede/revive), side-relative immutable negotiation history,
the `counterparties:read` / `counterparties:manage` permissions, and an
integration suite (19 new tests) covering counterparty lifecycles, invites/
accepts/declines with replay and version guards, owner-only transitions,
offer chains, idempotent offer replays, deadline expiry, audit events, and
confidentiality across non-participants.

Still deliberately **deferred** to later phases: settlement/payment
rails, reconciliation sources, Canton integration, AI/ML, notifications,
analytics, and billing. `SecurityEvent` + `DealStateTransition`
+ `OfferTransition` are the seeds of the future audit pipeline. The AI/ML
service lives in a separate `ai-ml/` tree and stays out of this backend.

## Phase 6 scope

Phase 6 ships secure **documents** and **deal requirements** on top of the deal
rooms:

- **Document store** — bytes live in a pluggable storage adapter (a
  local-disk adapter ships first; `DOCUMENT_STORAGE_ROOT`,
  `DOCUMENT_MAX_SIZE_BYTES`, `DOCUMENT_MAX_FILES_PER_DEAL`,
  `DOCUMENT_DEFAULT_RETENTION_DAYS`), never in PostgreSQL. Uploads validate the
  declared extension **and** magic bytes; a status mismatch (`UPLOADING`)
  blocks download until the client confirms `complete`.
- **Versioned lifecycle** — `UPLOADING → COMPLETE → SUBMITTED` with an
  owner-side review (`ACCEPT`/`REJECT`) and a submitter-side `withdraw`;
  `replace` opens a child version that **supersedes** its parent on completion
  and chains every revision to a shared `chainId`.
- **Privacy windows** — every document is `PRIVATE` (author + owner),
  `PARTICIPANTS` (all orgs in the room), `DEAL_OWNER` (owner only), or
  `SPECIFIC_PARTICIPANTS` (explicit org list). The owner sees everything;
  everyone else sees only what the window grants, and hidden reads/downloads
  return identical `DOCUMENT_NOT_FOUND` 404s.
- **Requirements & readiness** — owners mint requirements that are
  `REQUIRED`, `OPTIONAL`, or `WAIVED` on a deadline; assignees `submit`
  requirements (optionally attaching + referencing accepted evidence
  documents), the owner `rejects`/`satisfies`, a rejected requirement can
  `reopen`, and `satisfy` verifies the requirement's required/waived state and
  its referenced evidence is `ACCEPTED` and not expired. `GET
  /deals/:dealId/readiness` (owner-only) snapshots
  `{ required, satisfied, outstanding, blocked, requirements }`.
- **Operations** — transition `requestId` idempotency/replay guards, magic-byte
  mismatch rejection, per-route rate limits, `securityEvent` hooks for every
  document/requirement/readiness action, and deadline expiry workers for
  documents and requirements wired into the server scheduler (they run on a
  leader-less timer; in-flight state changes are guarded by `version` checks).
- **Test coverage** — an integration suite (17 new tests) covering the full
  lifecycle, visibility windows, supersede chains, idempotency-key replays,
  magic-byte gatekeeping, anonymous/stranger rejection, retention/upload
  expiry (lazy + worker), readiness gating and waiver/expiry, and audit
  events for both subsystems.

Layout: `src/modules/documents/` (services, routes, schemas, types, the
storage adapter), migration `..._phase6_documents_requirements`, and
`tests/integration/documents.test.ts`.

## Phase 7 scope

Phase 7 ships the **approval engine**: explicit, authenticated, attributable,
timestamped, auditable approval workflows tied to a deal + policy, with
state machine protection, sequential ordering enforcement, and compliance
gates.

- **Approval policies** — organization-owned policy templates with
  deterministic rule evaluation. Status lifecycle: `DRAFT → ACTIVE →
  INACTIVE → ARCHIVED`. Only ACTIVE policies can start workflows.
- **Policy rules** — rule types: `NOTIONAL_THRESHOLD`, `DEAL_TYPE`,
  `CURRENCY`, `ROLE_APPROVAL`, `MULTI_APPROVER`, `SEQUENTIAL_APPROVAL`,
  `PARALLEL_APPROVAL`, `REQUIRED_DOCUMENTS`, `REQUIRED_REQUIREMENTS`.
- **Policy snapshot** — an immutable JSON snapshot stored on each
  workflow so a running workflow is immune to later policy edits.
- **Approval workflows** — state machine: `NOT_STARTED → PENDING →
  APPROVED | REJECTED | EXPIRED | CANCELLED`. `expiresInMinutes` enables
  auto-expiration; `expireApprovalWorkflows()` runs the worker.
- **Approval requests** — per-user assignments within a workflow.
  Decisions (APPROVE/REJECT) enforce sequential ordering: all previous
  required approvals must be APPROVED first. Optimistic concurrency via
  re-read PENDING check.
- **Compliance gates** — `REQUIRED_DOCUMENTS` and `REQUIRED_REQUIREMENTS`
  rules drive `GET /deals/:dealId/approval-readiness` which blocks workflow
  start when gates are unsatisfied.
- **Audit events** — every policy CRUD, workflow start/cancel/expire,
  request assign/escalate/cancel/decide writes a `SecurityEvent`.
- **Test coverage** — 49 unit tests (evaluator, schemas, error codes)
  and 4 integration tests (policy CRUD via HTTP).

Layout: `src/modules/approvals/` (types, schemas, policy.service,
request.service, evaluator, routes, index), and
`tests/unit/approvals/`.

Still deliberately **deferred** to later phases: settlement/payment
rails, reconciliation sources, Canton integration, AI/ML, notifications,
analytics, and billing.

Still deliberately **deferred** to later phases: settlement/payment
rails, reconciliation sources, Canton integration, AI/ML, notifications,
analytics, and billing. `SecurityEvent` + `DealStateTransition`
+ `OfferTransition` are the seeds of the future audit pipeline. The AI/ML
service lives in a separate `ai-ml/` tree and stays out of this backend.