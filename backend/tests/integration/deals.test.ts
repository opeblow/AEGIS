import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { prisma } from "../../src/lib/prisma.js";
import { expireEligibleDeals } from "../../src/modules/deals/deal.service.js";
import { syncSystemRoles } from "../../src/modules/organizations/role.seed.js";
import type { PublicDeal } from "../../src/modules/deals/deal.types.js";
import {
  listDevMailbox,
  clearDevMailbox,
} from "../../src/modules/auth/email.service.js";

async function isDatabaseReachable(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

const dbUp = await isDatabaseReachable();

describe.skipIf(!dbUp)("deals API (integration)", () => {
  let app: FastifyInstance;

  const emails: string[] = [];
  const orgIds: string[] = [];

  const now = Date.now();
  const uniqueEmail = (prefix: string): string => {
    const email = `it.deal.${prefix}.${now}.${emails.length}@example.com`;
    emails.push(email);
    return email;
  };

  const PASSWORD = "Correct-Horse-2017-Staple!";

  function cookieHeader(res: {
    cookies: Array<{ name: string; value: string }>;
  }): string {
    return res.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  }

  beforeEach(() => clearDevMailbox());

  beforeAll(async () => {
    // The deals suite depends on the org membership pipeline, which requires
    // the system roles. syncSystemRoles is idempotent, so a fresh test database
    // self-heals here instead of failing silently.
    await syncSystemRoles(prisma);
    app = await buildApp({ logger: false });
  });

  afterAll(async () => {
    // Organization deletion cascades memberships, deals, transitions, invitations,
    // and org-scoped security events (schema onDelete: Cascade). Only then are
    // the users free of Restrict FKs (deal.createdBy, transition.actor).
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await app?.close();
    await prisma.$disconnect();
  });

  // -------------------------------------------------------------------------
  // Fixtures
  // -------------------------------------------------------------------------

  interface Session {
    email: string;
    jar: string;
    csrf: string;
  }

  async function register(email: string): Promise<void> {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/register",
      payload: { email, password: PASSWORD },
    });
    expect(res.statusCode).toBe(201);
  }

  async function verificationTokenFor(email: string): Promise<string> {
    const message = listDevMailbox().find(
      (m) => m.kind === "EMAIL_VERIFICATION" && m.toNormalized === email,
    );
    expect(message).toBeDefined();
    return message!.token;
  }

  /** Registers, verifies, logs in, and returns session cookies + CSRF token. */
  async function session(prefix: string): Promise<Session> {
    const email = uniqueEmail(prefix);
    await register(email);
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/verify-email",
      payload: { token: await verificationTokenFor(email) },
    });
    const loginRes = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password: PASSWORD },
    });
    expect(loginRes.statusCode).toBe(200);
    return {
      email,
      jar: cookieHeader(loginRes),
      csrf: loginRes.json().csrfToken,
    };
  }

  async function createOrg(owner: Session): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/organizations",
      headers: { cookie: owner.jar, "x-csrf-token": owner.csrf },
      payload: { name: `Deal Test Org ${uniqueEmail("org").split("@")[0]}` },
    });
    expect(res.statusCode).toBe(201);
    const orgId = res.json().organization.id;
    orgIds.push(orgId);
    return orgId;
  }

  /** Adds `invitee` to `orgId` with the given system role, via invite+accept. */
  async function inviteMember(
    owner: Session,
    orgId: string,
    invitee: Session,
    role: string,
  ): Promise<void> {
    const invite = await app.inject({
      method: "POST",
      url: `/api/v1/organizations/${orgId}/invitations`,
      headers: { cookie: owner.jar, "x-csrf-token": owner.csrf },
      payload: { email: invitee.email, role },
    });
    expect(invite.statusCode).toBe(201);

    const inviteMail = listDevMailbox().find(
      (m) =>
        m.kind === "ORGANIZATION_INVITATION" &&
        m.toNormalized === invitee.email,
    );
    expect(inviteMail).toBeDefined();

    const accept = await app.inject({
      method: "POST",
      url: `/api/v1/invitations/${inviteMail!.token}/accept`,
      headers: { cookie: invitee.jar, "x-csrf-token": invitee.csrf },
    });
    expect(accept.statusCode).toBe(201);
  }

  function dealPayload(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      type: "RWA_PURCHASE",
      name: "Residential portfolio",
      currency: "USD",
      notionalAmount: "1250000.50",
      ...overrides,
    };
  }

  const createDealUrl = (orgId: string): string =>
    `/api/v1/organizations/${orgId}/deals`;

  async function createDeal(
    actor: Session,
    orgId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<PublicDeal> {
    const payload = dealPayload(overrides);
    const res = await app.inject({
      method: "POST",
      url: createDealUrl(orgId),
      headers: { cookie: actor.jar, "x-csrf-token": actor.csrf },
      payload,
    });
    expect(res.statusCode).toBe(201);
    return res.json().deal as PublicDeal;
  }

  async function transition(
    actor: Session,
    orgId: string,
    dealId: string,
    toStatus: string,
    version: number,
    requestId: string,
    reason?: string,
  ) {
    return app.inject({
      method: "POST",
      url: `${createDealUrl(orgId)}/${dealId}/transitions`,
      headers: { cookie: actor.jar, "x-csrf-token": actor.csrf },
      payload: { toStatus, version, requestId, ...(reason ? { reason } : {}) },
    });
  }

  async function patchDeal(
    actor: Session,
    orgId: string,
    dealId: string,
    payload: Record<string, unknown>,
  ) {
    return app.inject({
      method: "PATCH",
      url: `${createDealUrl(orgId)}/${dealId}`,
      headers: { cookie: actor.jar, "x-csrf-token": actor.csrf },
      payload,
    });
  }

  // -------------------------------------------------------------------------
  // Create & read
  // -------------------------------------------------------------------------

  describe("creation", () => {
    it("creates a DRAFT deal with a server-generated reference and history", async () => {
      const owner = await session("owner");
      const orgId = await createOrg(owner);

      const deal = await createDeal(owner, orgId, {
        description: "Warehouse in Lekki",
        settlementDate: "2026-12-01T00:00:00.000Z",
        expiresAt: "2026-11-01T00:00:00.000Z",
        metadata: { sector: "industrial" },
      });

      expect(deal.status).toBe("DRAFT");
      expect(deal.version).toBe(1);
      expect(deal.reference).toMatch(/^AEG-\d{4}-\d{6}$/);
      expect(deal.currency).toBe("USD");
      expect(deal.notionalAmount).toBe("1250000.50");
      expect(deal.createdByUserId).toMatch(/^[0-9a-f-]{36}$/);
      expect(typeof deal.expiresAt).toBe("string");
      expect(deal.metadata).toEqual({ sector: "industrial" });

      const history = await app.inject({
        method: "GET",
        url: `${createDealUrl(orgId)}/${deal.id}/history`,
        headers: { cookie: owner.jar },
      });
      expect(history.statusCode).toBe(200);
      const { transitions } = history.json();
      expect(transitions).toHaveLength(1);
      expect(transitions[0]).toMatchObject({
        transitionType: "DEAL_CREATED",
        fromStatus: "DRAFT",
        toStatus: "DRAFT",
        requestId: null,
      });
      expect(transitions[0].actorUserId).toBeTypeOf("string");
    });

    it("rejects malformed money and deadlines with validation errors", async () => {
      const owner = await session("vowner");
      const orgId = await createOrg(owner);

      const cases: Array<[string, Record<string, unknown>]> = [
        ["unknown currency", { currency: "USDT" }],
        ["too much precision for USD", { notionalAmount: "1.234" }],
        ["zero amount", { notionalAmount: "0" }],
        ["negative amount", { notionalAmount: "-50" }],
        ["float amount", { notionalAmount: 1.5e6 }],
        ["garbage amount", { notionalAmount: "abc" }],
        [
          "JPY sub-integer precision",
          { currency: "JPY", notionalAmount: "1000.5" },
        ],
        ["expired deadline", { expiresAt: "2020-01-01T00:00:00.000Z" }],
        [
          "expiry after settlement",
          {
            settlementDate: "2026-12-01T00:00:00.000Z",
            expiresAt: "2026-12-02T00:00:00.000Z",
          },
        ],
        ["rogue organizationId in body", { organizationId: orgId }],
      ];

      for (const [, patch] of cases) {
        const res = await app.inject({
          method: "POST",
          url: createDealUrl(orgId),
          headers: { cookie: owner.jar, "x-csrf-token": owner.csrf },
          payload: dealPayload(patch),
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().error.code).toBe("VALIDATION_ERROR");
      }
    });

    it("rejects a duplicate client reference with 409", async () => {
      const owner = await session("refowner");
      const orgId = await createOrg(owner);
      const reference = "ACME-2026-001";

      await createDeal(owner, orgId, { reference });

      const dup = await app.inject({
        method: "POST",
        url: createDealUrl(orgId),
        headers: { cookie: owner.jar, "x-csrf-token": owner.csrf },
        payload: dealPayload({ reference }),
      });
      expect(dup.statusCode).toBe(409);
      expect(dup.json().error.code).toBe("CONFLICT");
    });

    it("is idempotent per key and isolates keys across organizations", async () => {
      const owner = await session("idem");
      const orgId = await createOrg(owner);
      const otherOrg = await createOrg(owner);

      const payload = dealPayload({ idempotencyKey: "idem-key-aaa-0001" });

      const first = await app.inject({
        method: "POST",
        url: createDealUrl(orgId),
        headers: { cookie: owner.jar, "x-csrf-token": owner.csrf },
        payload,
      });
      expect(first.statusCode).toBe(201);

      const second = await app.inject({
        method: "POST",
        url: createDealUrl(orgId),
        headers: { cookie: owner.jar, "x-csrf-token": owner.csrf },
        payload,
      });
      expect(second.statusCode).toBe(201);
      expect(second.json().deal.id).toBe(first.json().deal.id);

      // Same key, materially different body -> 409.
      const mutated = await app.inject({
        method: "POST",
        url: createDealUrl(orgId),
        headers: { cookie: owner.jar, "x-csrf-token": owner.csrf },
        payload: { ...payload, name: "Different portfolio" },
      });
      expect(mutated.statusCode).toBe(409);
      expect(mutated.json().error.code).toBe("DEAL_IDEMPOTENCY_CONFLICT");

      // The same key in a different organization creates its own deal.
      const elsewhere = await app.inject({
        method: "POST",
        url: createDealUrl(otherOrg),
        headers: { cookie: owner.jar, "x-csrf-token": owner.csrf },
        payload,
      });
      expect(elsewhere.statusCode).toBe(201);
      expect(elsewhere.json().deal.id).not.toBe(first.json().deal.id);
    });

    it("guards reads and writes with CSRF and authentication", async () => {
      const owner = await session("csrfowner");
      const orgId = await createOrg(owner);

      const withoutCsrf = await app.inject({
        method: "POST",
        url: createDealUrl(orgId),
        headers: { cookie: owner.jar },
        payload: dealPayload(),
      });
      expect(withoutCsrf.statusCode).toBe(403);

      const withoutSession = await app.inject({
        method: "GET",
        url: createDealUrl(orgId),
      });
      expect(withoutSession.statusCode).toBe(401);
    });
  });

  describe("listing", () => {
    it("paginates, filters, and searches within the organization", async () => {
      const owner = await session("listowner");
      const orgId = await createOrg(owner);

      const a = await createDeal(owner, orgId, {
        type: "RWA_PURCHASE",
        name: "Legos warehouse",
        currency: "USD",
        notionalAmount: "500000",
      });
      await createDeal(owner, orgId, {
        type: "RWA_SALE",
        name: "Boge jet",
        currency: "JPY",
        notionalAmount: "90000000",
      });

      const list = await app.inject({
        method: "GET",
        url: `${createDealUrl(orgId)}?limit=1&page=1&search=warehouse`,
        headers: { cookie: owner.jar },
      });
      expect(list.statusCode).toBe(200);
      const body = list.json();
      expect(body.total).toBe(1);
      expect(body.limit).toBe(1);
      expect(body.deals[0].id).toBe(a.id);

      // Filters combine: type + status.
      const byType = await app.inject({
        method: "GET",
        url: `${createDealUrl(orgId)}?type=RWA_SALE&status=DRAFT`,
        headers: { cookie: owner.jar },
      });
      expect(byType.statusCode).toBe(200);
      expect(byType.json().total).toBe(1);
      expect(byType.json().deals[0].type).toBe("RWA_SALE");

      // Unknown query keys are rejected (strict schema).
      const rogueKey = await app.inject({
        method: "GET",
        url: `${createDealUrl(orgId)}?admin_query=1`,
        headers: { cookie: owner.jar },
      });
      expect(rogueKey.statusCode).toBe(400);

      // Bad pagination is rejected, not clamped.
      const badPage = await app.inject({
        method: "GET",
        url: `${createDealUrl(orgId)}?page=0`,
        headers: { cookie: owner.jar },
      });
      expect(badPage.statusCode).toBe(400);
    });
  });

  describe("update", () => {
    it("edits fields with a matching version and bumps it", async () => {
      const owner = await session("upowner");
      const orgId = await createOrg(owner);
      const deal = await createDeal(owner, orgId);

      const res = await patchDeal(owner, orgId, deal.id, {
        version: deal.version,
        name: "Renamed portfolio",
        description: null,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().deal.name).toBe("Renamed portfolio");
      expect(res.json().deal.description).toBeNull();
      expect(res.json().deal.version).toBe(2);
    });

    it("rejects stale writes with DEAL_VERSION_CONFLICT", async () => {
      const owner = await session("conflict");
      const orgId = await createOrg(owner);
      const deal = await createDeal(owner, orgId);

      const [first, second] = await Promise.all([
        patchDeal(owner, orgId, deal.id, { version: 1, name: "First rename" }),
        patchDeal(owner, orgId, deal.id, { version: 1, name: "Second rename" }),
      ]);

      expect([first.statusCode, second.statusCode].sort()).toEqual([200, 409]);
      const failed = first.statusCode === 409 ? first : second;
      expect(failed.json().error.code).toBe("DEAL_VERSION_CONFLICT");
    });

    it("validates a currency swap against the existing notional amount", async () => {
      const owner = await session("swap");
      const orgId = await createOrg(owner);
      const deal = await createDeal(owner, orgId, {
        notionalAmount: "1000.50",
      });

      // USD -> JPY leaves a sub-integer fraction -> rejected service-side.
      const badSwap = await patchDeal(owner, orgId, deal.id, {
        version: 1,
        currency: "JPY",
      });
      expect(badSwap.statusCode).toBe(400);
      expect(badSwap.json().error.code).toBe("INVALID_MONEY_AMOUNT");

      const badCurrency = await patchDeal(owner, orgId, deal.id, {
        version: 1,
        currency: "USDT",
      });
      expect(badCurrency.statusCode).toBe(400);
      expect(badCurrency.json().error.code).toBe("VALIDATION_ERROR");

      const twice = await patchDeal(owner, orgId, deal.id, {
        version: 1,
        currency: "JPY",
        notionalAmount: "100050",
      });
      expect(twice.statusCode).toBe(200);
    });

    it("rejects edits to terminal deals and term edits after NEGOTIATING", async () => {
      const owner = await session("frozen");
      const orgId = await createOrg(owner);

      const terminal = await createDeal(owner, orgId);
      const cancel = await transition(
        owner,
        orgId,
        terminal.id,
        "CANCELLED",
        terminal.version,
        "cancel-request-0001",
        "Counterparty walked away.",
      );
      expect(cancel.statusCode).toBe(200);
      expect(cancel.json().deal.status).toBe("CANCELLED");

      const editTerminal = await patchDeal(owner, orgId, terminal.id, {
        version: 2,
        name: "Nope",
      });
      expect(editTerminal.statusCode).toBe(409);
      expect(editTerminal.json().error.code).toBe("INVALID_DEAL_STATE");

      const deal = await createDeal(owner, orgId);
      const open = await transition(
        owner,
        orgId,
        deal.id,
        "OPEN",
        deal.version,
        "open-request-0001",
      );
      expect(open.statusCode).toBe(200);
      const negotiating = await transition(
        owner,
        orgId,
        deal.id,
        "NEGOTIATING",
        open.json().deal.version,
        "nego-request-0001",
      );
      expect(negotiating.statusCode).toBe(200);

      // Presentation edits still fine after NEGOTIATING...
      const rename = await patchDeal(owner, orgId, deal.id, {
        version: negotiating.json().deal.version,
        name: "Still editable",
      });
      expect(rename.statusCode).toBe(200);

      const agreed = await transition(
        owner,
        orgId,
        deal.id,
        "AGREED",
        rename.json().deal.version,
        "agreed-request-0001",
      );
      expect(agreed.statusCode).toBe(200);

      // ...but financial terms are frozen past NEGOTIATING.
      const termEdit = await patchDeal(owner, orgId, deal.id, {
        version: agreed.json().deal.version,
        type: "RWA_SALE",
      });
      expect(termEdit.statusCode).toBe(409);
      expect(termEdit.json().error.code).toBe("INVALID_DEAL_STATE");
    });
  });

  describe("state machine transitions", () => {
    it("walks the happy path and rejects illegal jumps", async () => {
      const owner = await session("machine");
      const orgId = await createOrg(owner);
      const deal = await createDeal(owner, orgId);

      const illegal = await transition(
        owner,
        orgId,
        deal.id,
        "NEGOTIATING",
        deal.version,
        "jump-request-0001",
      );
      expect(illegal.statusCode).toBe(409);
      expect(illegal.json().error.code).toBe("INVALID_DEAL_TRANSITION");

      const open = await transition(
        owner,
        orgId,
        deal.id,
        "OPEN",
        deal.version,
        "op-request-0001",
      );
      expect(open.statusCode).toBe(200);
      expect(open.json().deal.status).toBe("OPEN");

      // Replaying the same requestId returns the same transition.
      const replay = await transition(
        owner,
        orgId,
        deal.id,
        "OPEN",
        1,
        "op-request-0001",
      );
      expect(replay.statusCode).toBe(200);
      expect(replay.json().transition.requestId).toBe("op-request-0001");
      expect(replay.json().transition.toStatus).toBe("OPEN");

      // Same requestId with a different target is an idempotency conflict.
      const reuse = await transition(
        owner,
        orgId,
        deal.id,
        "NEGOTIATING",
        open.json().deal.version,
        "op-request-0001",
      );
      expect(reuse.statusCode).toBe(409);
      expect(reuse.json().error.code).toBe("DEAL_IDEMPOTENCY_CONFLICT");

      const nego = await transition(
        owner,
        orgId,
        deal.id,
        "NEGOTIATING",
        open.json().deal.version,
        "neg-request-0001",
      );
      expect(nego.statusCode).toBe(200);
      expect(nego.json().deal.version).toBe(3);

      const agreed = await transition(
        owner,
        orgId,
        deal.id,
        "AGREED",
        nego.json().deal.version,
        "agr-request-0001",
      );
      expect(agreed.statusCode).toBe(200);

      const pending = await transition(
        owner,
        orgId,
        deal.id,
        "APPROVAL_PENDING",
        agreed.json().deal.version,
        "ap-request-0001",
      );
      expect(pending.statusCode).toBe(200);

      const approved = await transition(
        owner,
        orgId,
        deal.id,
        "APPROVED",
        pending.json().deal.version,
        "appr-request-0001",
      );
      expect(approved.statusCode).toBe(200);

      const settlement = await transition(
        owner,
        orgId,
        deal.id,
        "SETTLEMENT_PENDING",
        approved.json().deal.version,
        "sp-request-0001",
      );
      expect(settlement.statusCode).toBe(200);

      const settled = await transition(
        owner,
        orgId,
        deal.id,
        "SETTLED",
        settlement.json().deal.version,
        "settled-request-0001",
      );
      expect(settled.statusCode).toBe(200);

      const reconciling = await transition(
        owner,
        orgId,
        deal.id,
        "RECONCILING",
        settled.json().deal.version,
        "rec-request-0001",
      );
      expect(reconciling.statusCode).toBe(200);

      const completed = await transition(
        owner,
        orgId,
        deal.id,
        "COMPLETED",
        reconciling.json().deal.version,
        "done-request-0001",
      );
      expect(completed.statusCode).toBe(200);
      expect(completed.json().deal.status).toBe("COMPLETED");

      // Terminal: no way out. PENDING needs no reason, so a schema-valid but
      // machine-illegal jump surfaces INVALID_DEAL_TRANSITION, not validation.
      // Terminal: no way out. OPEN needs no reason, so a schema-valid but
      // machine-illegal jump surfaces INVALID_DEAL_TRANSITION, not validation.
      const after = await transition(
        owner,
        orgId,
        deal.id,
        "OPEN",
        completed.json().deal.version,
        "post-request-0001",
      );
      expect(after.statusCode).toBe(409);
      expect(after.json().error.code).toBe("INVALID_DEAL_TRANSITION");
    });

    it("requires a reason to cancel and moves the deal out of the machine", async () => {
      const owner = await session("cancel");
      const orgId = await createOrg(owner);
      const deal = await createDeal(owner, orgId);

      const noReason = await transition(
        owner,
        orgId,
        deal.id,
        "CANCELLED",
        deal.version,
        "cancel-no-reason",
      );
      expect(noReason.statusCode).toBe(400);
      expect(noReason.json().error.code).toBe("VALIDATION_ERROR");

      const cancelled = await transition(
        owner,
        orgId,
        deal.id,
        "CANCELLED",
        deal.version,
        "cancel-reasoned",
        "Counterparty is no longer reachable.",
      );
      expect(cancelled.statusCode).toBe(200);
      expect(cancelled.json().deal.status).toBe("CANCELLED");
      expect(cancelled.json().transition.reason).toContain(
        "no longer reachable",
      );

      const events = await prisma.securityEvent.findMany({
        where: { organizationId: orgId, type: "DEAL_CANCELLED" },
      });
      expect(events).toHaveLength(1);

      // History is immutable: DEAL_CREATED then DEAL_CANCELLED.
      const history = await app.inject({
        method: "GET",
        url: `${createDealUrl(orgId)}/${deal.id}/history?limit=100`,
        headers: { cookie: owner.jar },
      });
      const types = history
        .json()
        .transitions.map((t: { transitionType: string }) => t.transitionType);
      expect(types).toEqual(["DEAL_CREATED", "DEAL_CANCELLED"]);
    });

    it("rejects a stale version during transitions with 409", async () => {
      const owner = await session("verowner");
      const orgId = await createOrg(owner);
      const deal = await createDeal(owner, orgId);

      const first = await transition(
        owner,
        orgId,
        deal.id,
        "OPEN",
        1,
        "ver-open-0001",
      );
      expect(first.statusCode).toBe(200);

      // version 1 is now stale.
      const stale = await transition(
        owner,
        orgId,
        deal.id,
        "NEGOTIATING",
        1,
        "ver-nego-0001",
      );
      expect(stale.statusCode).toBe(409);
      expect(stale.json().error.code).toBe("DEAL_VERSION_CONFLICT");
    });
  });

  describe("multi-tenant isolation", () => {
    it("hides deals from non-members and denies members without permissions", async () => {
      const owner = await session("isoowner");
      const orgId = await createOrg(owner);
      const deal = await createDeal(owner, orgId);

      // A user with their own org owns nothing in orgId.
      const outsider = await session("outsider");
      const otherOrg = await createOrg(outsider);
      await createDeal(outsider, otherOrg, {
        type: "RWA_SALE",
        name: "Outsider asset",
        currency: "EUR",
        notionalAmount: "75000",
      });

      const read = await app.inject({
        method: "GET",
        url: `${createDealUrl(orgId)}/${deal.id}`,
        headers: { cookie: outsider.jar },
      });
      expect(read.statusCode).toBe(404);
      expect(read.json().error.code).toBe("NOT_FOUND");

      const list = await app.inject({
        method: "GET",
        url: createDealUrl(orgId),
        headers: { cookie: outsider.jar },
      });
      expect(list.statusCode).toBe(404);

      const write = await app.inject({
        method: "PATCH",
        url: `${createDealUrl(orgId)}/${deal.id}`,
        headers: { cookie: outsider.jar, "x-csrf-token": outsider.csrf },
        payload: { version: 1, name: "Intrusion" },
      });
      expect(write.statusCode).toBe(404);

      // A MEMBER of orgId has no deals permissions (only OWNER carries them).
      const member = await session("memberiso");
      await inviteMember(owner, orgId, member, "MEMBER");

      const denied = await app.inject({
        method: "GET",
        url: `${createDealUrl(orgId)}/${deal.id}`,
        headers: { cookie: member.jar },
      });
      expect(denied.statusCode).toBe(403);
      expect(denied.json().error.code).toBe("FORBIDDEN");

      const deniedCreate = await app.inject({
        method: "POST",
        url: createDealUrl(orgId),
        headers: { cookie: member.jar, "x-csrf-token": member.csrf },
        payload: dealPayload(),
      });
      expect(deniedCreate.statusCode).toBe(403);
    });

    it("never returns another tenant's deal by id", async () => {
      const owner = await session("isoowner2");
      const orgId = await createOrg(owner);
      const deal = await createDeal(owner, orgId);

      const stranger = await session("stranger");
      const res = await app.inject({
        method: "GET",
        url: `${createDealUrl(orgId)}/${deal.id}`,
        headers: { cookie: stranger.jar },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("NOT_FOUND");
    });
  });

  describe("deadline expiry worker", () => {
    it("expires deals whose deadline passed, through the state machine", async () => {
      const owner = await session("expowner");
      const orgId = await createOrg(owner);

      const due = await createDeal(owner, orgId, {
        expiresAt: "2099-01-01T00:00:00.000Z",
      });
      const safe = await createDeal(owner, orgId, {
        type: "RWA_SALE",
        name: "Not expiring",
        currency: "EUR",
        notionalAmount: "3000",
      });

      // Backdate the deadline (schema forbids past expiresAt at the boundary).
      await prisma.deal.update({
        where: { id: due.id },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      });

      const expired = await expireEligibleDeals(new Date());
      expect(expired).toBeGreaterThanOrEqual(1);

      const dueAfter = await app.inject({
        method: "GET",
        url: `${createDealUrl(orgId)}/${due.id}`,
        headers: { cookie: owner.jar },
      });
      expect(dueAfter.statusCode).toBe(200);
      expect(dueAfter.json().deal.status).toBe("EXPIRED");

      const safeAfter = await app.inject({
        method: "GET",
        url: `${createDealUrl(orgId)}/${safe.id}`,
        headers: { cookie: owner.jar },
      });
      expect(safeAfter.json().deal.status).toBe("DRAFT");

      const sysEvents = await prisma.securityEvent.findMany({
        where: { organizationId: orgId, type: "DEAL_EXPIRED" },
      });
      expect(sysEvents.length).toBeGreaterThanOrEqual(1);
      expect(sysEvents[0].userId).toBeNull();

      const history = await app.inject({
        method: "GET",
        url: `${createDealUrl(orgId)}/${due.id}/history`,
        headers: { cookie: owner.jar },
      });
      const expiryTransition = history
        .json()
        .transitions.find(
          (t: { toStatus: string }) => t.toStatus === "EXPIRED",
        );
      expect(expiryTransition).toBeDefined();
      expect(expiryTransition.actorUserId).toBeNull();
      expect(expiryTransition.reason).toContain("System expiry");
    });
  });
});
