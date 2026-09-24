import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../../src/app.js";
import { prisma } from "../../../src/lib/prisma.js";
import { syncSystemRoles } from "../../../src/modules/organizations/role.seed.js";
import {
  listDevMailbox,
  clearDevMailbox,
} from "../../../src/modules/auth/email.service.js";

async function isDatabaseReachable(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

const dbUp = await isDatabaseReachable();

describe.skipIf(!dbUp)("approval engine (integration)", () => {
  let app: FastifyInstance;

  const emails: string[] = [];
  const orgIds: string[] = [];

  const now = Date.now();
  const uniqueEmail = (prefix: string): string => {
    const email = `it.approval.${prefix}.${now}.${emails.length}@example.com`;
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
    await prisma.approvalRequest.deleteMany();
    await prisma.approvalDecision.deleteMany();
    await prisma.approvalWorkflow.deleteMany();
    await prisma.approvalPolicy.deleteMany();
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await prisma.user.deleteMany({ where: { email: { in: emails } } });
    await app?.close();
    await prisma.$disconnect();
  });

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
      (m: { kind: string; toNormalized: string }) =>
        m.kind === "EMAIL_VERIFICATION" && m.toNormalized === email,
    );
    expect(message).toBeDefined();
    return (message as { token: string }).token;
  }

  async function session(prefix: string): Promise<{
    email: string;
    jar: string;
    csrf: string;
  }> {
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

  async function createOrg(owner: {
    jar: string;
    csrf: string;
  }): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/organizations",
      headers: { cookie: owner.jar, "x-csrf-token": owner.csrf },
      payload: { name: `Approval Test Org ${uniqueEmail("org").split("@")[0]}` },
    });
    expect(res.statusCode).toBe(201);
    const orgId = res.json().organization.id;
    orgIds.push(orgId);
    return orgId;
  }

  describe("approval policies", () => {
    it("creates a policy with valid rules", async () => {
      const owner = await session("owner");
      const orgId = await createOrg(owner);

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/organizations/${orgId}/approval-policies`,
        headers: { cookie: owner.jar, "x-csrf-token": owner.csrf },
        payload: {
          name: "High Value Approval",
          description: "For large deals",
          rules: [
            {
              ruleType: "NOTIONAL_THRESHOLD",
              config: {
                threshold: "100000",
                comparator: ">=",
                roles: ["CFO"],
              },
            },
          ],
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.policy.name).toBe("High Value Approval");
      expect(body.policy.status).toBe("DRAFT");
      expect(body.policy.rules).toHaveLength(1);
      expect(body.policy.rules[0].ruleType).toBe("NOTIONAL_THRESHOLD");
    });

    it("rejects policy creation with missing name", async () => {
      const owner = await session("owner2");
      const orgId = await createOrg(owner);

      const res = await app.inject({
        method: "POST",
        url: `/api/v1/organizations/${orgId}/approval-policies`,
        headers: { cookie: owner.jar, "x-csrf-token": owner.csrf },
        payload: {
          rules: [
            {
              ruleType: "ROLE_APPROVAL",
              config: { roles: ["CFO"] },
            },
          ],
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
    });

    it("lists policies", async () => {
      const owner = await session("owner3");
      const orgId = await createOrg(owner);

      await app.inject({
        method: "POST",
        url: `/api/v1/organizations/${orgId}/approval-policies`,
        headers: { cookie: owner.jar, "x-csrf-token": owner.csrf },
        payload: {
          name: "Policy A",
          rules: [
            {
              ruleType: "ROLE_APPROVAL",
              config: { roles: ["CFO"] },
            },
          ],
        },
      });

      const res = await app.inject({
        method: "GET",
        url: `/api/v1/organizations/${orgId}/approval-policies`,
        headers: { cookie: owner.jar },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.policies).toHaveLength(1);
      expect(body.policies[0].name).toBe("Policy A");
    });

    it("returns 404 for non-existent policy", async () => {
      const owner = await session("owner4");
      const orgId = await createOrg(owner);

      const res = await app.inject({
        method: "GET",
        url: `/api/v1/organizations/${orgId}/approval-policies/00000000-0000-4000-8000-000000000000`,
        headers: { cookie: owner.jar },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("APPROVAL_POLICY_NOT_FOUND");
    });
  });
});
