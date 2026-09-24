import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { prisma } from "../../src/lib/prisma.js";
import { syncSystemRoles } from "../../src/modules/organizations/role.seed.js";
import {
  setQuantumClientForTesting,
  type QuantumClient,
} from "../../src/modules/quantum/quantum.client.js";
import type {
  SolverName,
  QuantumProblem,
} from "../../src/modules/quantum/quantum.schemas.js";
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

describe.skipIf(!dbUp)("quantum optimization API (integration)", () => {
  let app: FastifyInstance;

  const emails: string[] = [];
  const orgIds: string[] = [];

  const now = Date.now();
  const uniqueEmail = (prefix: string): string => {
    const email = `it.qo.${prefix}.${now}.${emails.length}@example.com`;
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
      payload: { name: `QO Test Org ${uniqueEmail("org").split("@")[0]}` },
    });
    expect(res.statusCode).toBe(201);
    const orgId = res.json().organization.id as string;
    orgIds.push(orgId);
    return orgId;
  }

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

  async function invitedParticipant(dealId: string, actor: Session): Promise<void> {
    const invite = await app.inject({
      method: "POST",
      url: `/api/v1/deals/${dealId}/invitations`,
      headers: { cookie: actor.jar, "x-csrf-token": actor.csrf },
      payload: { organizationId: orgB, email: bob.email, participantType: "COUNTERPARTY" },
    });
    expect(invite.statusCode).toBe(201);
  }

  const auth = (sess: Session): Record<string, string> => ({
    cookie: sess.jar,
    "x-csrf-token": sess.csrf,
  });

  const optimizeUrl = (dId: string): string =>
    `/api/v1/deals/${dId}/optimization/optimize`;
  const compareUrl = (dId: string): string =>
    `/api/v1/deals/${dId}/optimization/compare`;
  const listUrl = (dId: string): string => `/api/v1/deals/${dId}/optimization`;
  const runUrl = (dId: string, runId: string): string =>
    `/api/v1/deals/${dId}/optimization/${runId}`;

  function validOptimizeBody(): Record<string, unknown> {
    return {
      routes: [
        { id: "route-a", cost: 1, risk: 0.1, liquidity: 100, capacity: 100, available: true },
        { id: "route-b", cost: 2, risk: 0.3, liquidity: 50, capacity: 50, available: true },
      ],
      constraints: { minSelectedRoutes: 1, maxRisk: 0.8 },
      objectiveWeights: { cost: 1, risk: 1, selection: 0 },
      solver: "simulator",
    };
  }

  // -------------------------------------------------------------------------
  // Fake provider
  // -------------------------------------------------------------------------

  function makeFormulation() {
    return {
      formulation_type: "QUBO",
      num_binary_variables: 2,
      num_route_variables: 2,
      num_slack_variables: 0,
      num_constraints: 1,
      precision_scale: 6,
      penalty_coefficient: "100",
      constraint_encoding: "bounded binary slack registers",
    };
  }

  function makeExecution(overrides: Record<string, unknown> = {}) {
    return {
      backend: "qiskit",
      algorithm: "qaoa",
      deterministic: true,
      shots: 2048,
      ...overrides,
    };
  }

  function makeSolverResult(
    problem: QuantumProblem,
    solverType: SolverName,
    overrides: Record<string, unknown> = {},
  ) {
    const allocated = problem.transaction_amount;
    return {
      problem_id: "problem-9000",
      solver_type: solverType,
      feasible: true,
      selected_variables: { x0: 1 },
      selected_routes: [problem.routes[0].id],
      allocations: [{ route_id: problem.routes[0].id, amount: allocated }],
      objective_value: "98.5",
      energy: -12.3,
      constraint_violations: [],
      formulation_metadata: makeFormulation(),
      execution_metadata: makeExecution(),
      confidence: 0.9,
      ...overrides,
    };
  }

  function makeComparison(problem: QuantumProblem) {
    return {
      problem_id: "problem-9000",
      classical: makeSolverResult(problem, "classical"),
      quantum: makeSolverResult(problem, "simulator"),
      objective_delta: null,
      better_solver: "tie",
      same_feasibility: true,
      claim: "Both solvers returned the same observed objective; no quantum advantage claimed.",
    };
  }

  interface FakeClient {
    calls: { optimize: number; compare: number };
    client: QuantumClient;
  }

  function installFake(
    actions: {
      optimize?: (payload: { problem: QuantumProblem; solver?: SolverName }) => Promise<unknown>;
      compare?: (payload: { problem: QuantumProblem; quantumSolver?: SolverName }) => Promise<unknown>;
    } = {},
  ): FakeClient {
    const calls = { optimize: 0, compare: 0 };
    const client: QuantumClient = {
      name: "fake-quantum",
      async optimize(payload) {
        calls.optimize += 1;
        if (actions.optimize) return actions.optimize(payload);
        return {
          result: makeSolverResult(payload.problem, "simulator"),
          problemId: "problem-9000",
        };
      },
      async compare(payload) {
        calls.compare += 1;
        if (actions.compare) return actions.compare(payload);
        return {
          result: makeComparison(payload.problem),
          problemId: "problem-9000",
        };
      },
    };
    setQuantumClientForTesting(client);
    return { calls, client };
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
    const token = listDevMailbox()
      .filter(
        (m) => m.kind === "DEAL_PARTICIPANT_INVITATION" && m.toNormalized === bob.email,
      )
      .at(-1);
    expect(token).toBeDefined();
    const accept = await app.inject({
      method: "POST",
      url: `/api/v1/deal-invitations/${token!.token}/accept`,
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
    setQuantumClientForTesting(null);
  });

  // -------------------------------------------------------------------------
  // Confidentiality & permissions
  // -------------------------------------------------------------------------

  it("returns 404 to non-participants across every endpoint", async () => {
    installFake();
    const optimize = await app.inject({
      method: "POST",
      url: optimizeUrl(dealId),
      headers: auth(stranger),
      payload: validOptimizeBody(),
    });
    expect(optimize.statusCode).toBe(404);

    const compare = await app.inject({
      method: "POST",
      url: compareUrl(dealId),
      headers: auth(stranger),
      payload: { ...validOptimizeBody(), quantumSolver: "simulator" },
    });
    expect(compare.statusCode).toBe(404);

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
    const deniedOptimize = await app.inject({
      method: "POST",
      url: optimizeUrl(dealId),
      headers: auth(member),
      payload: validOptimizeBody(),
    });
    expect(deniedOptimize.statusCode).toBe(403);
    expect(deniedOptimize.json().error.code).toBe("FORBIDDEN");

    const deniedCompare = await app.inject({
      method: "POST",
      url: compareUrl(dealId),
      headers: auth(member),
      payload: { ...validOptimizeBody(), quantumSolver: "simulator" },
    });
    expect(deniedCompare.statusCode).toBe(403);

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
      url: optimizeUrl(dealId),
      headers: { cookie: alice.jar },
      payload: validOptimizeBody(),
    });
    expect(res.statusCode).toBe(403);
  });

  // -------------------------------------------------------------------------
  // Optimize lifecycle
  // -------------------------------------------------------------------------

  it("optimizes once and replays the same COMPLETED run", async () => {
    const { calls } = installFake();
    const first = await app.inject({
      method: "POST",
      url: optimizeUrl(dealId),
      headers: auth(alice),
      payload: validOptimizeBody(),
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json();
    expect(firstBody.replayed).toBe(false);
    expect(firstBody.note).toContain("advisory");

    const run = firstBody.run;
    expect(run.status).toBe("COMPLETED");
    expect(run.operation).toBe("OPTIMIZE");
    expect(run.organizationId).toBe(orgA);
    expect(run.dealId).toBe(dealId);
    expect(run.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(run.optimizationVersion).toBe("1.0");
    expect(run.solver).toBe("simulator");
    expect(run.result.problem_id).toBe("problem-9000");
    expect(run.metrics).toEqual({
      feasible: true,
      selectedRoutes: 1,
      solverType: "simulator",
      problemId: "problem-9000",
      objectiveValue: "98.5",
    });
    expect(run.requestedByUserId).toMatch(/^[0-9a-f]{8}-/);
    expect(calls.optimize).toBe(1);
    aliceRunId = run.id;

    const second = await app.inject({
      method: "POST",
      url: optimizeUrl(dealId),
      headers: auth(alice),
      payload: validOptimizeBody(),
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().replayed).toBe(true);
    expect(second.json().run.id).toBe(aliceRunId);
    expect(calls.optimize).toBe(1);

    const fetched = await app.inject({
      method: "GET",
      url: runUrl(dealId, aliceRunId),
      headers: { cookie: alice.jar },
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().run.result.formulation_metadata.formulation_type).toBe("QUBO");

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

  it("runs compares independently and keeps operations separate", async () => {
    const { calls } = installFake();

    const compare = await app.inject({
      method: "POST",
      url: compareUrl(dealId),
      headers: auth(alice),
      payload: { ...validOptimizeBody(), quantumSolver: "simulator" },
    });
    expect(compare.statusCode).toBe(200);
    expect(compare.json().replayed).toBe(false);
    expect(compare.json().run.operation).toBe("COMPARE");
    expect(compare.json().run.solver).toBe("simulator");
    expect(compare.json().run.result.better_solver).toBe("tie");
    expect(calls.compare).toBe(1);
    const compareRunId = compare.json().run.id;

    const compareAgain = await app.inject({
      method: "POST",
      url: compareUrl(dealId),
      headers: auth(alice),
      payload: { ...validOptimizeBody(), quantumSolver: "simulator" },
    });
    expect(compareAgain.json().replayed).toBe(true);
    expect(compareAgain.json().run.id).toBe(compareRunId);
    expect(calls.compare).toBe(1);

    // The earlier optimize still replays: operation is part of the hash.
    const optimizeReplay = await app.inject({
      method: "POST",
      url: optimizeUrl(dealId),
      headers: auth(alice),
      payload: validOptimizeBody(),
    });
    expect(optimizeReplay.json().replayed).toBe(true);
    expect(optimizeReplay.json().run.id).toBe(aliceRunId);
    // This suite's fresh fake was never asked to optimize: the replay is
    // served entirely from the COMPLETED row created in the previous test.
    expect(calls.optimize).toBe(0);

    const list = await app.inject({
      method: "GET",
      url: listUrl(dealId),
      headers: { cookie: alice.jar },
    });
    expect(list.json().total).toBe(2);

    const onlyOptimize = await app.inject({
      method: "GET",
      url: `${listUrl(dealId)}?operation=OPTIMIZE`,
      headers: { cookie: alice.jar },
    });
    expect(onlyOptimize.json().total).toBe(1);
    expect(onlyOptimize.json().runs[0].operation).toBe("OPTIMIZE");
  });

  it("keeps run histories isolated per organization", async () => {
    const { calls } = installFake();
    const bobOptimize = await app.inject({
      method: "POST",
      url: optimizeUrl(dealId),
      headers: auth(bob),
      payload: validOptimizeBody(),
    });
    expect(bobOptimize.statusCode).toBe(200);
    expect(bobOptimize.json().replayed).toBe(false);
    expect(bobOptimize.json().run.organizationId).toBe(orgB);
    expect(calls.optimize).toBe(1);

    // Alice's identical call still replays her own run — no provider call.
    const aliceReplay = await app.inject({
      method: "POST",
      url: optimizeUrl(dealId),
      headers: auth(alice),
      payload: validOptimizeBody(),
    });
    expect(aliceReplay.json().replayed).toBe(true);
    expect(aliceReplay.json().run.id).toBe(aliceRunId);
    expect(calls.optimize).toBe(1);

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
    expect(crossRead.json().error.code).toBe("QUANTUM_OPTIMIZATION_NOT_FOUND");
  });

  it("persists FAILED runs and retries on the next optimize", async () => {
    installFake({
      optimize: async () => {
        throw AppError.quantumOptimizationFailed();
      },
    });
    const failed = await app.inject({
      method: "POST",
      url: optimizeUrl(dealId2),
      headers: auth(alice),
      payload: validOptimizeBody(),
    });
    expect(failed.statusCode).toBe(502);
    expect(failed.json().error.code).toBe("QUANTUM_OPTIMIZATION_FAILED");

    const failedList = await app.inject({
      method: "GET",
      url: `${listUrl(dealId2)}?status=FAILED`,
      headers: { cookie: alice.jar },
    });
    expect(failedList.json().total).toBe(1);
    const failedRun = failedList.json().runs[0];
    expect(failedRun.status).toBe("FAILED");
    expect(failedRun.errorCode).toBe("QUANTUM_OPTIMIZATION_FAILED");
    expect(failedRun.result).toBeNull();

    // A working provider retries into a brand new COMPLETED run.
    installFake();
    const retry = await app.inject({
      method: "POST",
      url: optimizeUrl(dealId2),
      headers: auth(alice),
      payload: validOptimizeBody(),
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json().replayed).toBe(false);
    expect(retry.json().run.status).toBe("COMPLETED");
  });

  it("fails runs when the provider answers without a problem id", async () => {
    installFake({
      optimize: async () => ({ result: makeSolverResult(validOptimizeBody() as unknown as QuantumProblem, "simulator"), problemId: "" }),
    });
    const res = await app.inject({
      method: "POST",
      url: optimizeUrl(dealId3),
      headers: auth(alice),
      payload: validOptimizeBody(),
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe("QUANTUM_INVALID_RESPONSE");

    const failedList = await app.inject({
      method: "GET",
      url: `${listUrl(dealId3)}?status=FAILED`,
      headers: { cookie: alice.jar },
    });
    expect(failedList.json().runs[0].errorCode).toBe("QUANTUM_INVALID_RESPONSE");
  });

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------

  it("rejects malformed bodies, filters, and unknown runs", async () => {
    installFake();

    const noRoutes = await app.inject({
      method: "POST",
      url: optimizeUrl(dealId),
      headers: auth(alice),
      payload: { routes: [] },
    });
    expect(noRoutes.statusCode).toBe(400);

    const badRisk = await app.inject({
      method: "POST",
      url: compareUrl(dealId),
      headers: auth(alice),
      payload: { ...validOptimizeBody(), routes: [{ id: "a", cost: 1, risk: 2, liquidity: 100, capacity: 100, available: true }] },
    });
    expect(badRisk.statusCode).toBe(400);

    const duplicateRoutes = await app.inject({
      method: "POST",
      url: optimizeUrl(dealId),
      headers: auth(alice),
      payload: {
        routes: [
          { id: "a", cost: 1, risk: 0.1, liquidity: 100, capacity: 100, available: true },
          { id: "a", cost: 2, risk: 0.2, liquidity: 50, capacity: 50, available: true },
        ],
      },
    });
    expect(duplicateRoutes.statusCode).toBe(400);

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

    const badOperation = await app.inject({
      method: "GET",
      url: `${listUrl(dealId)}?operation=SOLVE`,
      headers: { cookie: alice.jar },
    });
    expect(badOperation.statusCode).toBe(400);

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
    expect(missing.json().error.code).toBe("QUANTUM_OPTIMIZATION_NOT_FOUND");
  });
});