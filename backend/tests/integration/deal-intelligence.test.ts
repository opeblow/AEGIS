import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { prisma } from "../../src/lib/prisma.js";
import { syncSystemRoles } from "../../src/modules/organizations/role.seed.js";
import {
  setAiClientForTesting,
  type AiClient,
} from "../../src/modules/ai/ai.client.js";
import type {
  DealIntelligenceContext,
  DealIntelligenceQuery,
} from "../../src/modules/ai/ai.schemas.js";
import { AppError } from "../../src/lib/errors/index.js";
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

describe.skipIf(!dbUp)("deal intelligence API (integration)", () => {
  let app: FastifyInstance;

  const emails: string[] = [];
  const orgIds: string[] = [];

  const now = Date.now();
  const uniqueEmail = (prefix: string): string => {
    const email = `it.di.${prefix}.${now}.${emails.length}@example.com`;
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
    await syncSystemRoles(prisma);
    app = await buildApp({ logger: false });
  });

  afterAll(async () => {
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
      payload: { name: `DI Test Org ${uniqueEmail("org").split("@")[0]}` },
    });
    expect(res.statusCode).toBe(201);
    const orgId = res.json().organization.id as string;
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
        m.kind === "ORGANIZATION_INVITATION" && m.toNormalized === invitee.email,
    );
    expect(inviteMail).toBeDefined();

    const accept = await app.inject({
      method: "POST",
      url: `/api/v1/invitations/${inviteMail!.token}/accept`,
      headers: { cookie: invitee.jar, "x-csrf-token": invitee.csrf },
    });
    expect(accept.statusCode).toBe(201);
  }

  async function createDeal(actor: Session, orgId: string): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/organizations/${orgId}/deals`,
      headers: { cookie: actor.jar, "x-csrf-token": actor.csrf },
      payload: {
        type: "RWA_PURCHASE",
        name: "Residential portfolio",
        currency: "USD",
        notionalAmount: "1250000.50",
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json().deal.id as string;
  }

  /** Returns the most recent deal-participant invitation for an email. */
  function lastDealInvitationTokenFor(email: string): string {
    const messages = listDevMailbox().filter(
      (m) =>
        m.kind === "DEAL_PARTICIPANT_INVITATION" && m.toNormalized === email,
    );
    expect(messages.length).toBeGreaterThan(0);
    return messages[messages.length - 1].token;
  }

  async function invitedParticipant(dealId: string, actor: Session): Promise<void> {
    const invite = await app.inject({
      method: "POST",
      url: `/api/v1/deals/${dealId}/invitations`,
      headers: { cookie: actor.jar, "x-csrf-token": actor.csrf },
      payload: {
        organizationId: orgB,
        email: bob.email,
        participantType: "COUNTERPARTY",
      },
    });
    expect(invite.statusCode).toBe(201);
  }

  const auth = (sess: Session): Record<string, string> => ({
    cookie: sess.jar,
    "x-csrf-token": sess.csrf,
  });

  const analyzeUrl = (dId: string): string =>
    `/api/v1/deals/${dId}/intelligence/analyze`;
  const queryUrl = (dId: string): string =>
    `/api/v1/deals/${dId}/intelligence/query`;
  const listUrl = (dId: string): string => `/api/v1/deals/${dId}/intelligence`;
  const runUrl = (dId: string, runId: string): string =>
    `/api/v1/deals/${dId}/intelligence/${runId}`;

  // -------------------------------------------------------------------------
  // Fake provider
  // -------------------------------------------------------------------------

  function makeResult(dealId: string, overrides: Record<string, unknown> = {}) {
    return {
      deal_id: dealId,
      summary: {
        summary: "All deterministic checks passed.",
        key_facts: [],
        model_summary: false,
      },
      offer_comparison: null,
      changes: [],
      risk_flags: [],
      blockers: [],
      document_findings: [],
      readiness_explanation: null,
      negotiation: null,
      confidence: 0.71,
      generated_at: "2026-09-20T10:00:00.000Z",
      model: { provider: "deterministic", version: "1.0" },
      version: "1.0",
      input_hash: "ab".repeat(24),
      ai_warning: "Advisory only.",
      ...overrides,
    };
  }

  function makeAnswer(dealId: string) {
    return {
      deal_id: dealId,
      question: "Is anything blocking?",
      answer: "No.",
      evidence: ["no failing requirements"],
      within_scope: true,
      confidence: 0.9,
      generated_at: "2026-09-20T10:00:00.000Z",
      model: { provider: "deterministic", version: "1.0" },
      version: "1.0",
      ai_warning: "Advisory only.",
    };
  }

  interface FakeActions {
    analyze?: (
      context: DealIntelligenceContext,
    ) => Promise<{ result: unknown; inputHash: string }>;
    query?: (
      input: DealIntelligenceQuery,
    ) => Promise<{ answer: unknown; inputHash: string }>;
  }

  /** Installs a fake AI client and returns providers call counters. */
  function installFake(actions: FakeActions = {}) {
    const calls = { analyze: 0, query: 0 };
    const client: AiClient = {
      name: "fake-ai",
      async analyze(context) {
        calls.analyze += 1;
        if (actions.analyze) return actions.analyze(context);
        return { result: makeResult(context.deal_id), inputHash: "ab".repeat(24) };
      },
      async query(input) {
        calls.query += 1;
        if (actions.query) return actions.query(input);
        return { answer: makeAnswer(input.deal_id), inputHash: "ab".repeat(24) };
      },
    };
    setAiClientForTesting(client);
    return { calls };
  }

  // Shared participants created once for the whole suite.
  let alice: Session;
  let bob: Session;
  let member: Session;
  let stranger: Session;
  let orgA: string;
  let orgB: string;
  let dealId: string;
  let dealId2: string;
  let dealId3: string;
  let aliceRunId: string;

  beforeAll(async () => {
    [alice, bob, member, stranger] = await Promise.all([
      session("alice"),
      session("bob"),
      session("member"),
      session("stranger"),
    ]);
    const createdOrgs = await Promise.all([
      createOrg(alice),
      createOrg(bob),
      createOrg(stranger),
    ]);
    orgA = createdOrgs[0];
    orgB = createdOrgs[1];
    await inviteMember(alice, orgA, member, "MEMBER");

    dealId = await createDeal(alice, orgA);
    await invitedParticipant(dealId, alice);
    const token = lastDealInvitationTokenFor(bob.email);
    const accept = await app.inject({
      method: "POST",
      url: `/api/v1/deal-invitations/${token}/accept`,
      headers: auth(bob),
    });
    expect(accept.statusCode).toBe(201);

    // Fresh owner-only deals for the failure-path tests: they must have no
    // prior COMPLETED run, or the replay rule would short-circuit before the
    // provider is called.
    dealId2 = await createDeal(alice, orgA);
    dealId3 = await createDeal(alice, orgA);
  });

  beforeEach(() => {
    setAiClientForTesting(null);
  });

  // -------------------------------------------------------------------------
  // Confidentiality & permissions
  // -------------------------------------------------------------------------

  it("returns 404 to non-participants across every endpoint", async () => {
    installFake();
    const analyze = await app.inject({
      method: "POST",
      url: analyzeUrl(dealId),
      headers: auth(stranger),
      payload: {},
    });
    expect(analyze.statusCode).toBe(404);

    const query = await app.inject({
      method: "POST",
      url: queryUrl(dealId),
      headers: auth(stranger),
      payload: { question: "Is ready?" },
    });
    expect(query.statusCode).toBe(404);

    const list = await app.inject({
      method: "GET",
      url: listUrl(dealId),
      headers: { cookie: stranger.jar },
    });
    expect(list.statusCode).toBe(404);

    const run = await app.inject({
      method: "GET",
      url: runUrl(dealId, "99999999-9999-4999-8999-999999999999"),
      headers: { cookie: stranger.jar },
    });
    expect(run.statusCode).toBe(404);
  });

  it("allows MEMBER read access but not provider invocation", async () => {
    installFake();
    const denied = await app.inject({
      method: "POST",
      url: analyzeUrl(dealId),
      headers: auth(member),
      payload: {},
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe("FORBIDDEN");

    const deniedQuery = await app.inject({
      method: "POST",
      url: queryUrl(dealId),
      headers: auth(member),
      payload: { question: "Is ready?" },
    });
    expect(deniedQuery.statusCode).toBe(403);

    const list = await app.inject({
      method: "GET",
      url: listUrl(dealId),
      headers: { cookie: member.jar },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().total).toBe(0);
  });

  it("requires CSRF to invoke the provider", async () => {
    installFake();
    const res = await app.inject({
      method: "POST",
      url: analyzeUrl(dealId),
      headers: { cookie: alice.jar },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
  });

  // -------------------------------------------------------------------------
  // Analyze lifecycle
  // -------------------------------------------------------------------------

  it("analyzes once and replays the same COMPLETED run", async () => {
    const { calls } = installFake();
    const first = await app.inject({
      method: "POST",
      url: analyzeUrl(dealId),
      headers: auth(alice),
      payload: {},
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json();
    expect(firstBody.replayed).toBe(false);
    expect(firstBody.note).toContain("advisory");

    const run = firstBody.run;
    expect(run.status).toBe("COMPLETED");
    expect(run.organizationId).toBe(orgA);
    expect(run.dealId).toBe(dealId);
    expect(run.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(run.provider).toBe("deterministic");
    expect(run.modelVersion).toBe("1.0");
    expect(run.result.deal_id).toBe(dealId);
    expect(run.confidenceSummary).toEqual({
      confidence: 0.71,
      riskFlags: 0,
      blockers: 0,
      documentFindings: 0,
      modelSummary: false,
    });
    expect(calls.analyze).toBe(1);
    aliceRunId = run.id;

    const second = await app.inject({
      method: "POST",
      url: analyzeUrl(dealId),
      headers: auth(alice),
      payload: {},
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().replayed).toBe(true);
    expect(second.json().run.id).toBe(aliceRunId);
    expect(calls.analyze).toBe(1);

    const fetched = await app.inject({
      method: "GET",
      url: runUrl(dealId, aliceRunId),
      headers: { cookie: alice.jar },
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().run.result.summary.summary).toBe(
      "All deterministic checks passed.",
    );

    const list = await app.inject({
      method: "GET",
      url: listUrl(dealId),
      headers: { cookie: alice.jar },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().runs).toHaveLength(1);
    expect(list.json().total).toBe(1);
    expect(list.json().limit).toBe(20);
    expect(list.json().offset).toBe(0);
  });

  it("keeps run histories isolated per organization", async () => {
    const { calls } = installFake();
    const bobAnalyze = await app.inject({
      method: "POST",
      url: analyzeUrl(dealId),
      headers: auth(bob),
      payload: {},
    });
    expect(bobAnalyze.statusCode).toBe(200);
    expect(bobAnalyze.json().replayed).toBe(false);
    const bobRun = bobAnalyze.json().run;
    expect(bobRun.organizationId).toBe(orgB);
    expect(calls.analyze).toBe(1);

    // Alice's identical second call still replays her own run — no provider call.
    const aliceReplay = await app.inject({
      method: "POST",
      url: analyzeUrl(dealId),
      headers: auth(alice),
      payload: {},
    });
    expect(aliceReplay.statusCode).toBe(200);
    expect(aliceReplay.json().replayed).toBe(true);
    expect(aliceReplay.json().run.id).toBe(aliceRunId);
    expect(calls.analyze).toBe(1);

    const bobList = await app.inject({
      method: "GET",
      url: listUrl(dealId),
      headers: { cookie: bob.jar },
    });
    expect(bobList.json().total).toBe(1);
    expect(bobList.json().runs[0].organizationId).toBe(orgB);

    // Bob cannot read Alice's run even though both are on the same deal.
    const crossRead = await app.inject({
      method: "GET",
      url: runUrl(dealId, aliceRunId),
      headers: { cookie: bob.jar },
    });
    expect(crossRead.statusCode).toBe(404);
  });

  it("persists FAILED runs and retries on the next analyze", async () => {
    installFake({
      analyze: async () => {
        throw AppError.aiServiceUnavailable();
      },
    });
    const failed = await app.inject({
      method: "POST",
      url: analyzeUrl(dealId2),
      headers: auth(alice),
      payload: {},
    });
    expect(failed.statusCode).toBe(503);
    expect(failed.json().error.code).toBe("AI_SERVICE_UNAVAILABLE");

    const failedList = await app.inject({
      method: "GET",
      url: `${listUrl(dealId2)}?status=FAILED`,
      headers: { cookie: alice.jar },
    });
    expect(failedList.json().total).toBe(1);
    const failedRun = failedList.json().runs[0];
    expect(failedRun.status).toBe("FAILED");
    expect(failedRun.errorCode).toBe("AI_SERVICE_UNAVAILABLE");
    expect(failedRun.result).toBeNull();

    // A working provider retries into a brand new COMPLETED run.
    installFake();
    const retry = await app.inject({
      method: "POST",
      url: analyzeUrl(dealId2),
      headers: auth(alice),
      payload: {},
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().replayed).toBe(false);
    expect(retry.json().run.status).toBe("COMPLETED");
  });

  it("fails runs when the provider answers for a different deal", async () => {
    installFake({
      analyze: async () => ({
        result: makeResult("99999999-9999-4999-8999-999999999999"),
        inputHash: "ab".repeat(24),
      }),
    });
    const res = await app.inject({
      method: "POST",
      url: analyzeUrl(dealId3),
      headers: auth(alice),
      payload: {},
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe("AI_INVALID_RESPONSE");

    const failedList = await app.inject({
      method: "GET",
      url: `${listUrl(dealId3)}?status=FAILED`,
      headers: { cookie: alice.jar },
    });
    expect(failedList.json().runs[0].errorCode).toBe("AI_INVALID_RESPONSE");
  });

  // -------------------------------------------------------------------------
  // Query & validation
  // -------------------------------------------------------------------------

  it("answers in-scope questions without persisting a run", async () => {
    const { calls } = installFake();
    const before = await app.inject({
      method: "GET",
      url: listUrl(dealId),
      headers: { cookie: alice.jar },
    });
    const res = await app.inject({
      method: "POST",
      url: queryUrl(dealId),
      headers: auth(alice),
      payload: { question: "Is anything blocking?" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().answer.deal_id).toBe(dealId);
    expect(res.json().answer.within_scope).toBe(true);
    expect(res.json().note).toContain("advisory");
    expect(calls.query).toBe(1);

    const after = await app.inject({
      method: "GET",
      url: listUrl(dealId),
      headers: { cookie: alice.jar },
    });
    expect(after.json().total).toBe(before.json().total);
  });

  it("rejects malformed queries, list filters, and unknown runs", async () => {
    installFake();

    const emptyQuestion = await app.inject({
      method: "POST",
      url: queryUrl(dealId),
      headers: auth(alice),
      payload: { question: "" },
    });
    expect(emptyQuestion.statusCode).toBe(400);

    const longQuestion = await app.inject({
      method: "POST",
      url: queryUrl(dealId),
      headers: auth(alice),
      payload: { question: "x".repeat(513) },
    });
    expect(longQuestion.statusCode).toBe(400);

    const badLimit = await app.inject({
      method: "GET",
      url: `${listUrl(dealId)}?limit=0`,
      headers: { cookie: alice.jar },
    });
    expect(badLimit.statusCode).toBe(400);

    const badStatus = await app.inject({
      method: "GET",
      url: `${listUrl(dealId)}?status=NOPE`,
      headers: { cookie: alice.jar },
    });
    expect(badStatus.statusCode).toBe(400);

    const badRunId = await app.inject({
      method: "GET",
      url: runUrl(dealId, "not-a-uuid"),
      headers: { cookie: alice.jar },
    });
    expect(badRunId.statusCode).toBe(400);

    const missing = await app.inject({
      method: "GET",
      url: runUrl(dealId, "99999999-9999-4999-8999-999999999999"),
      headers: { cookie: alice.jar },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("AI_ANALYSIS_NOT_FOUND");
  });
});