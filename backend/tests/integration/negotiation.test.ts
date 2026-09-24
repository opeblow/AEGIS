import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.js";
import { prisma } from "../../src/lib/prisma.js";
import { expireEligibleOffers } from "../../src/modules/negotiation/offer.service.js";
import { syncSystemRoles } from "../../src/modules/organizations/role.seed.js";
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

describe.skipIf(!dbUp)("negotiation API (integration)", () => {
  let app: FastifyInstance;

  const emails: string[] = [];
  const orgIds: string[] = [];

  const now = Date.now();
  const uniqueEmail = (prefix: string): string => {
    const email = `it.neg.${prefix}.${now}.${emails.length}@example.com`;
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

  interface TestDeal {
    id: string;
    version: number;
    status: string;
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
      payload: { name: `Neg Test Org ${uniqueEmail("org").split("@")[0]}` },
    });
    expect(res.statusCode).toBe(201);
    const orgId = res.json().organization.id as string;
    orgIds.push(orgId);
    return orgId;
  }

  async function createDeal(actor: Session, orgId: string): Promise<TestDeal> {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/organizations/${orgId}/deals`,
      headers: { cookie: actor.jar, "x-csrf-token": actor.csrf },
      payload: {
        type: "RWA_PURCHASE",
        name: "Phase 5 commercial terms",
        currency: "USD",
        notionalAmount: "1250000.50",
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json().deal as TestDeal;
  }

  async function transitionDeal(
    actor: Session,
    orgId: string,
    dealId: string,
    toStatus: string,
    version: number,
  ): Promise<void> {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/organizations/${orgId}/deals/${dealId}/transitions`,
      headers: { cookie: actor.jar, "x-csrf-token": actor.csrf },
      payload: {
        toStatus,
        version,
        requestId: `neg-deal-${toStatus}-${dealId}`,
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().deal.status).toBe(toStatus);
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

  async function inviteDealParticipant(
    owner: Session,
    dealId: string,
    organizationId: string,
    email: string,
    participantType = "COUNTERPARTY",
  ): Promise<{ invitationId: string; token: string }> {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/deals/${dealId}/invitations`,
      headers: { cookie: owner.jar, "x-csrf-token": owner.csrf },
      payload: { organizationId, email, participantType },
    });
    expect(res.statusCode).toBe(201);
    const invitation = res.json().invitation as { id: string };
    return {
      invitationId: invitation.id,
      token: lastDealInvitationTokenFor(email),
    };
  }

  async function acceptDealInvitation(
    actor: Session,
    token: string,
  ): Promise<{ participant: Record<string, unknown> }> {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/deal-invitations/${token}/accept`,
      headers: { cookie: actor.jar, "x-csrf-token": actor.csrf },
    });
    expect(res.statusCode).toBe(201);
    return res.json();
  }

  async function declineDealInvitation(
    actor: Session,
    token: string,
  ): Promise<{ participant: Record<string, unknown> }> {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/deal-invitations/${token}/decline`,
      headers: { cookie: actor.jar, "x-csrf-token": actor.csrf },
    });
    expect(res.statusCode).toBe(200);
    return res.json();
  }

  function offerTerm(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return { currency: "USD", amount: "1000000.00", ...overrides };
  }

  function offerAction(
    actor: Session,
    dealId: string,
    offerId: string,
    action: string,
    payload: Record<string, unknown>,
  ) {
    return app.inject({
      method: "POST",
      url: `/api/v1/deals/${dealId}/offers/${offerId}/${action}`,
      headers: { cookie: actor.jar, "x-csrf-token": actor.csrf },
      payload,
    });
  }

  // -------------------------------------------------------------------------
  // Counterparty relationships
  // -------------------------------------------------------------------------

  describe("counterparty relationships", () => {
    let alice: Session;
    let bob: Session;
    let carol: Session;
    let orgA: string;
    let orgB: string;
    let orgC: string;

    beforeAll(async () => {
      [alice, bob, carol] = await Promise.all([
        session("cp-alice"),
        session("cp-bob"),
        session("cp-carol"),
      ]);
      [orgA, orgB, orgC] = await Promise.all([
        createOrg(alice),
        createOrg(bob),
        createOrg(carol),
      ]);
    });

    it("creates a PENDING/UNVERIFIED relationship and rejects duplicates, swaps, and self", async () => {
      const created = await app.inject({
        method: "POST",
        url: `/api/v1/organizations/${orgA}/counterparties`,
        headers: { cookie: alice.jar, "x-csrf-token": alice.csrf },
        payload: { counterpartyOrganizationId: orgB },
      });
      expect(created.statusCode).toBe(201);
      const createdCp = created.json().counterparty;
      expect(createdCp.relationshipDirection).toBe("outgoing");
      expect(createdCp.status).toBe("PENDING");
      expect(createdCp.verificationStatus).toBe("UNVERIFIED");
      expect(createdCp.counterparty.id).toBe(orgB);

      const dup = await app.inject({
        method: "POST",
        url: `/api/v1/organizations/${orgA}/counterparties`,
        headers: { cookie: alice.jar, "x-csrf-token": alice.csrf },
        payload: { counterpartyOrganizationId: orgB },
      });
      expect(dup.statusCode).toBe(409);
      expect(dup.json().error.code).toBe("COUNTERPARTY_ALREADY_EXISTS");

      const swapped = await app.inject({
        method: "POST",
        url: `/api/v1/organizations/${orgB}/counterparties`,
        headers: { cookie: bob.jar, "x-csrf-token": bob.csrf },
        payload: { counterpartyOrganizationId: orgA },
      });
      expect(swapped.statusCode).toBe(409);
      expect(swapped.json().error.code).toBe("COUNTERPARTY_ALREADY_EXISTS");

      const self = await app.inject({
        method: "POST",
        url: `/api/v1/organizations/${orgA}/counterparties`,
        headers: { cookie: alice.jar, "x-csrf-token": alice.csrf },
        payload: { counterpartyOrganizationId: orgA },
      });
      expect(self.statusCode).toBe(400);
      expect(self.json().error.code).toBe("COUNTERPARTY_SELF");
    });

    it("is bidirectional: the other side sees the same single row as incoming", async () => {
      const listB = await app.inject({
        method: "GET",
        url: `/api/v1/organizations/${orgB}/counterparties`,
        headers: { cookie: bob.jar },
      });
      expect(listB.statusCode).toBe(200);
      const page = listB.json();
      expect(page.total).toBe(1);
      expect(page.counterparties[0].relationshipDirection).toBe("incoming");
      expect(page.counterparties[0].counterparty.id).toBe(orgA);
    });

    it("filters by direction, status, verification, and search", async () => {
      const out = await app.inject({
        method: "GET",
        url: `/api/v1/organizations/${orgA}/counterparties?direction=outgoing&status=PENDING&verificationStatus=UNVERIFIED&search=Neg%20Test`,
        headers: { cookie: alice.jar },
      });
      expect(out.statusCode).toBe(200);
      expect(out.json().total).toBe(1);

      const none = await app.inject({
        method: "GET",
        url: `/api/v1/organizations/${orgA}/counterparties?direction=incoming`,
        headers: { cookie: alice.jar },
      });
      expect(none.json().total).toBe(0);
    });

    it("enforces status and verification transition tables, and revoke is terminal", async () => {
      const [cp] = (
        await app.inject({
          method: "GET",
          url: `/api/v1/organizations/${orgA}/counterparties`,
          headers: { cookie: alice.jar },
        })
      ).json().counterparties;

      const illegal = await app.inject({
        method: "PATCH",
        url: `/api/v1/organizations/${orgA}/counterparties/${cp.id}`,
        headers: { cookie: alice.jar, "x-csrf-token": alice.csrf },
        payload: { status: "SUSPENDED" },
      });
      expect(illegal.statusCode).toBe(409);
      expect(illegal.json().error.code).toBe("COUNTERPARTY_INVALID_TRANSITION");

      const active = await app.inject({
        method: "PATCH",
        url: `/api/v1/organizations/${orgA}/counterparties/${cp.id}`,
        headers: { cookie: alice.jar, "x-csrf-token": alice.csrf },
        payload: { status: "ACTIVE", verificationStatus: "VERIFIED" },
      });
      expect(active.statusCode).toBe(200);
      expect(active.json().counterparty.status).toBe("ACTIVE");
      expect(active.json().counterparty.verificationStatus).toBe("VERIFIED");

      const suspended = await app.inject({
        method: "PATCH",
        url: `/api/v1/organizations/${orgA}/counterparties/${cp.id}`,
        headers: { cookie: alice.jar, "x-csrf-token": alice.csrf },
        payload: { status: "SUSPENDED" },
      });
      expect(suspended.json().counterparty.status).toBe("SUSPENDED");

      const revoked = await app.inject({
        method: "DELETE",
        url: `/api/v1/organizations/${orgA}/counterparties/${cp.id}`,
        headers: { cookie: alice.jar, "x-csrf-token": alice.csrf },
      });
      expect(revoked.statusCode).toBe(200);
      expect(revoked.json().counterparty.status).toBe("REVOKED");

      const deleteAgain = await app.inject({
        method: "DELETE",
        url: `/api/v1/organizations/${orgA}/counterparties/${cp.id}`,
        headers: { cookie: alice.jar, "x-csrf-token": alice.csrf },
      });
      expect(deleteAgain.statusCode).toBe(200);
      expect(deleteAgain.json().counterparty.status).toBe("REVOKED");

      const events = await prisma.securityEvent.findMany({
        where: { organizationId: orgA, type: "COUNTERPARTY_REVOKED" },
      });
      expect(events).toHaveLength(1);
    });

    it("hides counterparty data from non-members", async () => {
      const poked = await app.inject({
        method: "GET",
        url: `/api/v1/organizations/${orgA}/counterparties`,
        headers: { cookie: carol.jar },
      });
      expect(poked.statusCode).toBe(404);

      const own = await app.inject({
        method: "GET",
        url: `/api/v1/organizations/${orgC}/counterparties`,
        headers: { cookie: carol.jar },
      });
      expect(own.json().total).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Deal participants & invitations
  // -------------------------------------------------------------------------

  describe("deal participants & invitations", () => {
    let alice: Session;
    let bob: Session;
    let carol: Session;
    let dave: Session;
    let eve: Session;
    let orgA: string;
    let orgB: string;
    let orgC: string;
    let orgD: string;
    let deal: TestDeal;

    beforeAll(async () => {
      [alice, bob, carol, dave, eve] = await Promise.all([
        session("dp-alice"),
        session("dp-bob"),
        session("dp-carol"),
        session("dp-dave"),
        session("dp-eve"),
      ]);
      [orgA, orgB, orgC, orgD] = await Promise.all([
        createOrg(alice),
        createOrg(bob),
        createOrg(carol),
        createOrg(dave),
      ]);
      deal = await createDeal(alice, orgA);
    });

    it("auto-joins the owner org and keeps the room confidential to strangers", async () => {
      // A stranger gets the same 404 as a bad deal id, before any membership
      // knowledge leaks.
      const stranger = await app.inject({
        method: "GET",
        url: `/api/v1/deals/${deal.id}/room`,
        headers: { cookie: carol.jar },
      });
      expect(stranger.statusCode).toBe(404);
      expect(stranger.json().error.code).toBe("DEAL_PARTICIPANT_NOT_FOUND");

      const anonymous = await app.inject({
        method: "GET",
        url: `/api/v1/deals/${deal.id}/room`,
      });
      expect(anonymous.statusCode).toBe(401);

      const ownerRoom = await app.inject({
        method: "GET",
        url: `/api/v1/deals/${deal.id}/room`,
        headers: { cookie: alice.jar },
      });
      expect(ownerRoom.statusCode).toBe(200);
      const owner = ownerRoom.json();
      expect(owner.deal.notionalAmount).toBe("1250000.50");
      expect(owner.total).toBe(1);
      expect(owner.participants[0]).toMatchObject({
        participantType: "OWNER",
        status: "ACTIVE",
      });
    });

    it("invites an org, delivers the token by email, and the invitee accepts", async () => {
      const invited = await inviteDealParticipant(
        alice,
        deal.id,
        orgB,
        bob.email,
      );
      expect(invited.invitationId).toBeTruthy();

      const mailing = listDevMailbox().find(
        (m) =>
          m.kind === "DEAL_PARTICIPANT_INVITATION" &&
          m.toNormalized === bob.email,
      );
      expect(mailing).toBeDefined();
      expect(mailing!.token).toBe(invited.token);

      // An INVITED participant cannot browse the deal yet.
      const pendingRoom = await app.inject({
        method: "GET",
        url: `/api/v1/deals/${deal.id}/room`,
        headers: { cookie: bob.jar },
      });
      expect(pendingRoom.statusCode).toBe(403);
      expect(pendingRoom.json().error.code).toBe("DEAL_PARTICIPANT_NOT_ACTIVE");

      // Public token lookup exposes state + deal + org, never the token.
      const lookup = await app.inject({
        method: "GET",
        url: `/api/v1/deal-invitations/${invited.token}`,
      });
      expect(lookup.statusCode).toBe(200);
      expect(lookup.json().invitation.state).toBe("PENDING");
      expect(lookup.json().invitation.email).toBe(bob.email);
      expect(lookup.json().invitation.deal.id).toBe(deal.id);
      expect(lookup.json().invitation.organization.id).toBe(orgB);
      expect(JSON.stringify(lookup.json())).not.toContain(invited.token);

      const accepted = await acceptDealInvitation(bob, invited.token);
      expect(accepted.participant.status).toBe("ACTIVE");
      expect(accepted.participant.organization.id).toBe(orgB);

      // Accept is idempotent on replay.
      const replay = await acceptDealInvitation(bob, invited.token);
      expect(replay.participant.status).toBe("ACTIVE");
      expect(replay.participant.id).toBe(accepted.participant.id);

      // Bob now sees the deal redacted and only his own participant row.
      const bobRoom = await app.inject({
        method: "GET",
        url: `/api/v1/deals/${deal.id}/room`,
        headers: { cookie: bob.jar },
      });
      expect(bobRoom.statusCode).toBe(200);
      expect(bobRoom.json().deal.notionalAmount).toBeUndefined();
      expect(bobRoom.json().deal.currency).toBe("USD");
      expect(bobRoom.json().total).toBe(1);
      expect(bobRoom.json().participants[0].status).toBe("ACTIVE");
      expect(bobRoom.json().participants[0].id).toBe(accepted.participant.id);

      // Owner sees the full roster.
      const roster = await app.inject({
        method: "GET",
        url: `/api/v1/deals/${deal.id}/participants`,
        headers: { cookie: alice.jar },
      });
      expect(roster.json().total).toBe(2);
      const bRow = roster
        .json()
        .participants.find(
          (p: { participantType: string }) =>
            p.participantType === "COUNTERPARTY",
        );
      expect(bRow.status).toBe("ACTIVE");

      // A non-owner cannot invite.
      const blocked = await app.inject({
        method: "POST",
        url: `/api/v1/deals/${deal.id}/invitations`,
        headers: { cookie: bob.jar, "x-csrf-token": bob.csrf },
        payload: { organizationId: orgC, email: carol.email },
      });
      expect(blocked.statusCode).toBe(403);

      // Inviting an already ACTIVE org again is a conflict.
      const again = await app.inject({
        method: "POST",
        url: `/api/v1/deals/${deal.id}/invitations`,
        headers: { cookie: alice.jar, "x-csrf-token": alice.csrf },
        payload: { organizationId: orgB, email: bob.email },
      });
      expect(again.statusCode).toBe(409);
      expect(again.json().error.code).toBe("DEAL_PARTICIPANT_ALREADY_EXISTS");

      // The owner org cannot invite itself.
      const selfInvite = await app.inject({
        method: "POST",
        url: `/api/v1/deals/${deal.id}/invitations`,
        headers: { cookie: alice.jar, "x-csrf-token": alice.csrf },
        payload: { organizationId: orgA, email: alice.email },
      });
      expect(selfInvite.statusCode).toBe(409);
      expect(selfInvite.json().error.code).toBe(
        "DEAL_PARTICIPANT_ALREADY_EXISTS",
      );
    });

    it("lets the invitee decline, then the owner re-invites the same org", async () => {
      const invited = await inviteDealParticipant(
        alice,
        deal.id,
        orgC,
        carol.email,
      );
      const declined = await declineDealInvitation(carol, invited.token);
      expect(declined.participant.status).toBe("DECLINED");

      // Decline is single-use; replays resolve to the current participant.
      const replay = await declineDealInvitation(carol, invited.token);
      expect(replay.participant.status).toBe("DECLINED");

      // Re-invite reactivates the DECLINED row and issues a new token.
      const reinvited = await inviteDealParticipant(
        alice,
        deal.id,
        orgC,
        carol.email,
      );
      expect(reinvited.invitationId).not.toBe(invited.invitationId);
      const accepted = await acceptDealInvitation(carol, reinvited.token);
      expect(accepted.participant.status).toBe("ACTIVE");
      expect(accepted.participant.organization.id).toBe(orgC);
    });

    it("revokes a pending invitation and blocks its use", async () => {
      const invited = await inviteDealParticipant(
        alice,
        deal.id,
        orgD,
        dave.email,
      );

      const revoke = await app.inject({
        method: "POST",
        url: `/api/v1/deals/${deal.id}/invitations/${invited.invitationId}/revoke`,
        headers: { cookie: alice.jar, "x-csrf-token": alice.csrf },
      });
      expect(revoke.statusCode).toBe(200);
      expect(revoke.json().invitation.state).toBe("REVOKED");

      // Revoke is idempotent.
      const revokeAgain = await app.inject({
        method: "POST",
        url: `/api/v1/deals/${deal.id}/invitations/${invited.invitationId}/revoke`,
        headers: { cookie: alice.jar, "x-csrf-token": alice.csrf },
      });
      expect(revokeAgain.json().invitation.state).toBe("REVOKED");

      const accept = await app.inject({
        method: "POST",
        url: `/api/v1/deal-invitations/${invited.token}/accept`,
        headers: { cookie: dave.jar, "x-csrf-token": dave.csrf },
      });
      expect(accept.statusCode).toBe(409);
      expect(accept.json().error.code).toBe("DEAL_INVITATION_REVOKED");
    });

    it("requires the invitee's email and an active membership to accept", async () => {
      const invited = await inviteDealParticipant(
        alice,
        deal.id,
        orgD,
        eve.email,
      );

      // Someone else's account cannot consume the token.
      const mismatched = await app.inject({
        method: "POST",
        url: `/api/v1/deal-invitations/${invited.token}/accept`,
        headers: { cookie: bob.jar, "x-csrf-token": bob.csrf },
      });
      expect(mismatched.statusCode).toBe(403);

      // eve has no (ACTIVE) membership in orgD yet.
      const notMember = await app.inject({
        method: "POST",
        url: `/api/v1/deal-invitations/${invited.token}/accept`,
        headers: { cookie: eve.jar, "x-csrf-token": eve.csrf },
      });
      expect(notMember.statusCode).toBe(403);

      // Missing CSRF is rejected.
      const noCsrf = await app.inject({
        method: "POST",
        url: `/api/v1/deal-invitations/${invited.token}/accept`,
        headers: { cookie: eve.jar },
      });
      expect(noCsrf.statusCode).toBe(403);

      await app.inject({
        method: "POST",
        url: `/api/v1/deals/${deal.id}/invitations/${invited.invitationId}/revoke`,
        headers: { cookie: alice.jar, "x-csrf-token": alice.csrf },
      });
    });

    it("owner suspends, reactivates, and immutable-owner transitions at a version", async () => {
      const roster = await app.inject({
        method: "GET",
        url: `/api/v1/deals/${deal.id}/participants`,
        headers: { cookie: alice.jar },
      });
      const bobRow = roster
        .json()
        .participants.find(
          (p: { organization: { id: string } }) => p.organization.id === orgB,
        );
      const ownerRow = roster
        .json()
        .participants.find(
          (p: { participantType: string }) => p.participantType === "OWNER",
        );
      expect(bobRow).toBeDefined();

      const suspend = await app.inject({
        method: "PATCH",
        url: `/api/v1/deals/${deal.id}/participants/${bobRow.id}/status`,
        headers: { cookie: alice.jar, "x-csrf-token": alice.csrf },
        payload: { status: "SUSPENDED", version: bobRow.version },
      });
      expect(suspend.statusCode).toBe(200);
      expect(suspend.json().participant.status).toBe("SUSPENDED");
      expect(suspend.json().participant.version).toBe(bobRow.version + 1);

      // A SUSPENDED participant is blocked from deal APIs.
      const blocked = await app.inject({
        method: "GET",
        url: `/api/v1/deals/${deal.id}/room`,
        headers: { cookie: bob.jar },
      });
      expect(blocked.statusCode).toBe(403);
      expect(blocked.json().error.code).toBe("DEAL_PARTICIPANT_NOT_ACTIVE");

      // A stale version is a concurrency conflict.
      const stale = await app.inject({
        method: "PATCH",
        url: `/api/v1/deals/${deal.id}/participants/${bobRow.id}/status`,
        headers: { cookie: alice.jar, "x-csrf-token": alice.csrf },
        payload: { status: "REACTIVATED", version: bobRow.version },
      });
      expect(stale.statusCode).toBe(409);
      expect(stale.json().error.code).toBe("DEAL_PARTICIPANT_VERSION_CONFLICT");

      // Reactivate (wire "REACTIVATED") with the current version + requestId.
      const reactivate = await app.inject({
        method: "PATCH",
        url: `/api/v1/deals/${deal.id}/participants/${bobRow.id}/status`,
        headers: { cookie: alice.jar, "x-csrf-token": alice.csrf },
        payload: {
          status: "REACTIVATED",
          version: bobRow.version + 1,
          requestId: "neg-participant-reactivate-0001",
        },
      });
      expect(reactivate.statusCode).toBe(200);
      expect(reactivate.json().participant.status).toBe("ACTIVE");

      // Same requestId replays idempotently.
      const replay = await app.inject({
        method: "PATCH",
        url: `/api/v1/deals/${deal.id}/participants/${bobRow.id}/status`,
        headers: { cookie: alice.jar, "x-csrf-token": alice.csrf },
        payload: {
          status: "REACTIVATED",
          version: bobRow.version + 1,
          requestId: "neg-participant-reactivate-0001",
        },
      });
      expect(replay.statusCode).toBe(200);
      expect(replay.json().participant.status).toBe("ACTIVE");

      // The owner participant is immutable.
      const ownerSuspend = await app.inject({
        method: "PATCH",
        url: `/api/v1/deals/${deal.id}/participants/${ownerRow.id}/status`,
        headers: { cookie: alice.jar, "x-csrf-token": alice.csrf },
        payload: { status: "REMOVED", version: ownerRow.version },
      });
      expect(ownerSuspend.statusCode).toBe(409);
      expect(ownerSuspend.json().error.code).toBe(
        "DEAL_PARTICIPANT_OWNER_IMMUTABLE",
      );
    });
  });

  // -------------------------------------------------------------------------
  // Offers & negotiation history
  // -------------------------------------------------------------------------

  describe("offers & negotiation", () => {
    let alice: Session;
    let bob: Session;
    let carol: Session;
    let orgA: string;
    let orgB: string;
    let deal: TestDeal;
    let aliceParticipantId: string;
    let bobParticipantId: string;
    let childOfferId: string;

    beforeAll(async () => {
      [alice, bob, carol] = await Promise.all([
        session("of-alice"),
        session("of-bob"),
        session("of-carol"),
      ]);
      [orgA, orgB] = await Promise.all([createOrg(alice), createOrg(bob)]);
      deal = await createDeal(alice, orgA);
      await transitionDeal(alice, orgA, deal.id, "OPEN", deal.version);

      const invited = await inviteDealParticipant(
        alice,
        deal.id,
        orgB,
        bob.email,
      );
      const accepted = await acceptDealInvitation(bob, invited.token);
      bobParticipantId = accepted.participant.id as string;

      const roster = await app.inject({
        method: "GET",
        url: `/api/v1/deals/${deal.id}/participants`,
        headers: { cookie: alice.jar },
      });
      aliceParticipantId = roster
        .json()
        .participants.find(
          (p: { participantType: string }) => p.participantType === "OWNER",
        ).id;
      expect(aliceParticipantId).toBeTruthy();
      expect(bobParticipantId).toBeTruthy();
    });

    function createOffer(actor: Session, payload: Record<string, unknown>) {
      return app.inject({
        method: "POST",
        url: `/api/v1/deals/${deal.id}/offers`,
        headers: { cookie: actor.jar, "x-csrf-token": actor.csrf },
        payload,
      });
    }

    it("creates a DRAFT offer, submits it, and the recipient sees it as received", async () => {
      const created = await createOffer(alice, {
        ...offerTerm({ amount: "1000000.00" }),
        recipientParticipantId: bobParticipantId,
        idempotencyKey: "neg-offer-idem-aaa-0001",
      });
      expect(created.statusCode).toBe(201);
      const offer = created.json().offer;
      expect(offer.status).toBe("DRAFT");
      expect(offer.version).toBe(1);
      expect(offer.direction).toBe("sent");
      expect(offer.amount).toBe("1000000.00");
      expect(offer.recipientOrganizationId).toBe(orgB);

      const submitted = await offerAction(alice, deal.id, offer.id, "submit", {
        version: 1,
        requestId: "neg-submit-aaa-0001",
      });
      expect(submitted.statusCode).toBe(200);
      expect(submitted.json().offer.status).toBe("SUBMITTED");
      expect(submitted.json().offer.version).toBe(2);
      expect(submitted.json().transition.transitionType).toBe(
        "OFFER_SUBMITTED",
      );
      expect(submitted.json().replay).toBe(false);

      // The recipient sees the same offer from its side.
      const bobList = await app.inject({
        method: "GET",
        url: `/api/v1/deals/${deal.id}/offers`,
        headers: { cookie: bob.jar },
      });
      expect(bobList.statusCode).toBe(200);
      expect(bobList.json().total).toBe(1);
      expect(bobList.json().offers[0].direction).toBe("received");
      expect(bobList.json().offers[0].amount).toBe("1000000.00");

      // Sender-side list.
      const aliceList = await app.inject({
        method: "GET",
        url: `/api/v1/deals/${deal.id}/offers`,
        headers: { cookie: alice.jar },
      });
      expect(aliceList.json().total).toBe(1);
      expect(aliceList.json().offers[0].direction).toBe("sent");

      // A stranger to the deal cannot enumerate anything.
      const carolList = await app.inject({
        method: "GET",
        url: `/api/v1/deals/${deal.id}/offers`,
        headers: { cookie: carol.jar },
      });
      expect(carolList.statusCode).toBe(404);
      expect(carolList.json().error.code).toBe("DEAL_PARTICIPANT_NOT_FOUND");

      // Same idempotencyKey + payload returns the same offer.
      const replayed = await createOffer(alice, {
        ...offerTerm({ amount: "1000000.00" }),
        recipientParticipantId: bobParticipantId,
        idempotencyKey: "neg-offer-idem-aaa-0001",
      });
      expect(replayed.statusCode).toBe(201);
      expect(replayed.json().offer.id).toBe(offer.id);
    });

    it("counters, accepts the child, and supersedes every countered ancestor", async () => {
      const parentId = (
        await app.inject({
          method: "GET",
          url: `/api/v1/deals/${deal.id}/offers`,
          headers: { cookie: alice.jar },
        })
      ).json().offers[0].id;

      const parent = (
        await app.inject({
          method: "GET",
          url: `/api/v1/deals/${deal.id}/offers/${parentId}`,
          headers: { cookie: bob.jar },
        })
      ).json().offer;
      expect(parent.status).toBe("SUBMITTED");
      expect(parent.version).toBe(2);

      const countered = await offerAction(bob, deal.id, parentId, "counter", {
        ...offerTerm({ amount: "975000.50" }),
        version: 2,
        requestId: "neg-counter-aaa-0001",
      });
      expect(countered.statusCode).toBe(200);
      expect(countered.json().offer.status).toBe("SUBMITTED");
      expect(countered.json().offer.parentOfferId).toBe(parentId);
      expect(countered.json().parent.status).toBe("COUNTERED");
      expect(countered.json().parent.version).toBe(3);
      expect(countered.json().replay).toBe(false);
      childOfferId = countered.json().offer.id;

      const accepted = await offerAction(
        alice,
        deal.id,
        childOfferId,
        "accept",
        { version: 1, requestId: "neg-accept-aaa-0001" },
      );
      expect(accepted.statusCode).toBe(200);
      expect(accepted.json().offer.status).toBe("ACCEPTED");
      expect(accepted.json().replay).toBe(false);

      // The accepted child advances its parent chain to SUPERSEDED.
      const parentAfter = await app.inject({
        method: "GET",
        url: `/api/v1/deals/${deal.id}/offers/${parentId}`,
        headers: { cookie: bob.jar },
      });
      expect(parentAfter.json().offer.status).toBe("SUPERSEDED");
      expect(parentAfter.json().offer.version).toBe(4);

      // Accept replay is idempotent for the same requestId.
      const replay = await offerAction(alice, deal.id, childOfferId, "accept", {
        version: 1,
        requestId: "neg-accept-aaa-0001",
      });
      expect(replay.statusCode).toBe(200);
      expect(replay.json().replay).toBe(true);
      expect(replay.json().offer.status).toBe("ACCEPTED");

      // A different requestId against a terminal offer is refused.
      const terminal = await offerAction(
        alice,
        deal.id,
        childOfferId,
        "accept",
        { version: 2, requestId: "neg-accept-aaa-0002" },
      );
      expect(terminal.statusCode).toBe(409);
      expect(terminal.json().error.code).toBe("OFFER_INVALID_TRANSITION");
    });

    it("records an immutable negotiation history only for the parties", async () => {
      const history = await app.inject({
        method: "GET",
        url: `/api/v1/deals/${deal.id}/negotiation?limit=100`,
        headers: { cookie: alice.jar },
      });
      expect(history.statusCode).toBe(200);
      const types = history
        .json()
        .events.map((e: { transitionType: string }) => e.transitionType);
      const expected = [
        "OFFER_CREATED",
        "OFFER_SUBMITTED",
        "OFFER_COUNTERED",
        "OFFER_SUPERSEDED",
        "OFFER_ACCEPTED",
      ];
      for (const t of expected) expect(types).toContain(t);

      // Bob's history mirrors Alice's (same ledger, side-relative direction).
      const bobHistory = await app.inject({
        method: "GET",
        url: `/api/v1/deals/${deal.id}/negotiation?limit=100`,
        headers: { cookie: bob.jar },
      });
      expect(bobHistory.statusCode).toBe(200);
      expect(bobHistory.json().total).toBe(history.json().total);
      const counters = bobHistory
        .json()
        .events.filter(
          (e: { transitionType: string }) =>
            e.transitionType === "OFFER_COUNTERED",
        );
      expect(counters.length).toBeGreaterThanOrEqual(1);
    });

    it("rejecting a counteroffer revives the parent offer", async () => {
      const created = await createOffer(alice, {
        ...offerTerm({ amount: "1100000.00" }),
        recipientParticipantId: bobParticipantId,
        idempotencyKey: "neg-offer-idem-bbb-0002",
      });
      const offerId = created.json().offer.id;
      await offerAction(alice, deal.id, offerId, "submit", {
        version: 1,
        requestId: "neg-submit-bbb-0002",
      });

      const countered = await offerAction(bob, deal.id, offerId, "counter", {
        ...offerTerm({ amount: "1050000.00" }),
        version: 2,
        requestId: "neg-counter-bbb-0002",
      });
      const childId = countered.json().offer.id;
      expect(countered.json().parent.status).toBe("COUNTERED");

      const rejected = await offerAction(alice, deal.id, childId, "reject", {
        version: 1,
        requestId: "neg-reject-bbb-0002",
        reason: "Counterpart is asking too much.",
      });
      expect(rejected.statusCode).toBe(200);
      expect(rejected.json().offer.status).toBe("REJECTED");
      expect(rejected.json().transition.reason).toContain("asking too much");

      // The parent lives again as SUBMITTED.
      const revived = await app.inject({
        method: "GET",
        url: `/api/v1/deals/${deal.id}/offers/${offerId}`,
        headers: { cookie: bob.jar },
      });
      expect(revived.json().offer.status).toBe("SUBMITTED");
      expect(revived.json().offer.version).toBe(4);
    });

    it("withdraws DRAFT and SUBMITTED offers with an optimistic version", async () => {
      const draft = await createOffer(alice, {
        ...offerTerm({ amount: "500000.00" }),
        recipientParticipantId: bobParticipantId,
        idempotencyKey: "neg-offer-idem-ccc-0003",
      });
      const draftId = draft.json().offer.id;
      const withdrawn = await offerAction(alice, deal.id, draftId, "withdraw", {
        version: 1,
        requestId: "neg-withdraw-ccc-0003",
      });
      expect(withdrawn.statusCode).toBe(200);
      expect(withdrawn.json().offer.status).toBe("WITHDRAWN");

      const submitted = await createOffer(alice, {
        ...offerTerm({ amount: "250000.00" }),
        recipientParticipantId: bobParticipantId,
        idempotencyKey: "neg-offer-idem-ddd-0004",
      });
      const submittedId = submitted.json().offer.id;
      await offerAction(alice, deal.id, submittedId, "submit", {
        version: 1,
        requestId: "neg-submit-ddd-0004",
      });
      const withdrawnSubmitted = await offerAction(
        alice,
        deal.id,
        submittedId,
        "withdraw",
        { version: 2, requestId: "neg-withdraw-ddd-0004" },
      );
      expect(withdrawnSubmitted.statusCode).toBe(200);
      expect(withdrawnSubmitted.json().offer.status).toBe("WITHDRAWN");

      const stale = await offerAction(alice, deal.id, draftId, "withdraw", {
        version: 1,
        requestId: "neg-withdraw-ccc-0004",
      });
      expect(stale.statusCode).toBe(409);
      expect(stale.json().error.code).toBe("OFFER_INVALID_TRANSITION");
    });

    it("rejects self-sends, OBSERVER roles, and currency mismatches", async () => {
      // Send to yourself.
      const selfLost = await createOffer(alice, {
        ...offerTerm(),
        recipientParticipantId: aliceParticipantId,
        idempotencyKey: "neg-offer-idem-eee-0005",
      });
      expect(selfLost.statusCode).toBe(400);
      expect(selfLost.json().error.code).toBe("OFFER_RECIPIENT_INVALID");

      // Currency must match the deal.
      const badCurrency = await createOffer(alice, {
        ...offerTerm({ currency: "EUR", amount: "1000000.00" }),
        recipientParticipantId: bobParticipantId,
        idempotencyKey: "neg-offer-idem-fff-0006",
      });
      expect(badCurrency.statusCode).toBe(400);
      expect(badCurrency.json().error.code).toBe("INVALID_CURRENCY");

      // Add an OBSERVER participant: can neither send nor receive.
      const orgC = await createOrg(carol);
      const observed = await inviteDealParticipant(
        alice,
        deal.id,
        orgC,
        carol.email,
        "OBSERVER",
      );
      const accepted = await acceptDealInvitation(carol, observed.token);
      const carolParticipantId = accepted.participant.id as string;

      const toObserver = await createOffer(alice, {
        ...offerTerm(),
        recipientParticipantId: carolParticipantId,
        idempotencyKey: "neg-offer-idem-ggg-0007",
      });
      expect(toObserver.statusCode).toBe(400);
      expect(toObserver.json().error.code).toBe("OFFER_RECIPIENT_INVALID");

      const fromObserver = await createOffer(carol, {
        ...offerTerm(),
        recipientParticipantId: bobParticipantId,
        idempotencyKey: "neg-offer-idem-hhh-0008",
      });
      expect(fromObserver.statusCode).toBe(400);
      expect(fromObserver.json().error.code).toBe("OFFER_RECIPIENT_INVALID");
    });

    it("expires SUBMITTED offers whose deadline passed and blocks their use", async () => {
      const twoHours = new Date(Date.now() + 2 * 60 * 60 * 1000);
      const created = await createOffer(alice, {
        ...offerTerm({
          amount: "750000.00",
          expiresAt: twoHours.toISOString(),
        }),
        recipientParticipantId: bobParticipantId,
        idempotencyKey: "neg-offer-idem-iii-0009",
      });
      expect(created.statusCode).toBe(201);
      const offerId = created.json().offer.id;
      await offerAction(alice, deal.id, offerId, "submit", {
        version: 1,
        requestId: "neg-submit-iii-0009",
      });

      // Simulate the system worker three hours from now.
      const running = await expireEligibleOffers(
        new Date(Date.now() + 3 * 60 * 60 * 1000),
      );
      expect(running).toBeGreaterThan(0);

      const after = await app.inject({
        method: "GET",
        url: `/api/v1/deals/${deal.id}/offers/${offerId}`,
        headers: { cookie: bob.jar },
      });
      expect(after.json().offer.status).toBe("EXPIRED");

      const history = await app.inject({
        method: "GET",
        url: `/api/v1/deals/${deal.id}/negotiation?limit=100`,
        headers: { cookie: alice.jar },
      });
      const expiry = history
        .json()
        .events.find(
          (e: { offer: { id: string }; transitionType: string }) =>
            e.offer.id === offerId && e.transitionType === "OFFER_EXPIRED",
        );
      expect(expiry).toBeDefined();
      expect(expiry.actorUserId).toBeNull();

      const sysEvents = await prisma.securityEvent.findMany({
        where: { organizationId: orgA, type: "OFFER_EXPIRED" },
        take: 1,
      });
      expect(sysEvents.length).toBeGreaterThanOrEqual(1);
      expect(sysEvents[0].userId).toBeNull();

      // The expired offer is terminal: further moves are refused.
      const refused = await offerAction(bob, deal.id, offerId, "accept", {
        version: 2,
        requestId: "neg-accept-iii-0009",
      });
      expect(refused.statusCode).toBe(409);
    });

    it("writes an audit trail for every negotiation action", async () => {
      const orgATypes = [
        "OFFER_CREATED",
        "OFFER_SUBMITTED",
        "OFFER_ACCEPTED",
        "OFFER_SUPERSEDED",
      ] as const;
      for (const type of orgATypes) {
        const events = await prisma.securityEvent.findMany({
          where: { organizationId: orgA, type },
        });
        expect(events.length).toBeGreaterThanOrEqual(
          1,
          `${type} missing for ${orgA}`,
        );
      }
      // The counteroffer is bob's action, so it is audited against orgB.
      const counters = await prisma.securityEvent.findMany({
        where: { organizationId: orgB, type: "OFFER_COUNTERED" },
      });
      expect(counters.length).toBeGreaterThanOrEqual(
        1,
        "OFFER_COUNTERED missing for orgB",
      );
      const joins = await prisma.securityEvent.findMany({
        where: { organizationId: orgB, type: "DEAL_PARTICIPANT_JOINED" },
      });
      expect(joins).toHaveLength(1);
    });
  });
});
