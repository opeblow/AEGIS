import type { FastifyInstance, FastifyPluginCallback } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors/index.js";
import { validate } from "../../lib/validation.js";
import { systemAuthContext, requestMeta } from "./route-helpers.js";
import {
  authorize,
  authorizeOwner,
  actorUserId,
} from "./authorization.service.js";
import {
  createOrganization,
  updateOrganization,
  listOrganizationsForUser,
} from "./organization.service.js";
import {
  toPublicMembership,
  toPublicRoleDetail,
  toPublicInvitation,
} from "./organization.types.js";
import {
  listMembers,
  setMemberStatus,
  changeMemberRole,
  removeMember,
  transferOwnership,
} from "./membership.service.js";
import {
  createInvitation,
  getInvitationByToken,
  acceptInvitation,
  revokeInvitation,
} from "./invitation.service.js";
import {
  uuidParamSchema,
  memberUuidParamSchema,
  invitationUuidParamSchema,
  invitationTokenParamSchema,
  createOrganizationBodySchema,
  updateOrganizationBodySchema,
  createInvitationBodySchema,
  updateMemberStatusBodySchema,
  changeMemberRoleBodySchema,
  transferOwnershipBodySchema,
  securityEventsQuerySchema,
} from "./organization.schemas.js";
import { Permissions } from "./permissions.js";

const organizationsRoutes: FastifyPluginCallback = (
  app: FastifyInstance,
  _opts,
  done,
): void => {
  const limits = {
    orgCreate: { max: 20, timeWindow: "1 minute" },
    invite: { max: 20, timeWindow: "1 minute" },
    inviteLookup: { max: 30, timeWindow: "1 minute" },
    inviteAccept: { max: 20, timeWindow: "1 minute" },
    memberModify: { max: 60, timeWindow: "1 minute" },
    ownershipTransfer: { max: 10, timeWindow: "1 minute" },
  } as const;

  // -------------------------------------------------------------------------
  // Organization lifecycle
  // -------------------------------------------------------------------------

  /** Create an organization (creator becomes the OWNER, atomically). */
  app.post(
    "/organizations",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.orgCreate },
    },
    async (request, reply) => {
      const body = validate(createOrganizationBodySchema, request.body, "body");
      const userId = actorUserId(request);
      const created = await createOrganization(
        userId,
        body,
        requestMeta(request),
      );
      return reply.status(201).send({
        organization: created.organization,
        membership: created.membership,
        ownerRole: created.membership.role.name,
      });
    },
  );

  /** List organizations the authenticated user is an ACTIVE member of. */
  app.get(
    "/organizations",
    { preHandler: [app.authenticate] },
    async (request) => {
      const userId = actorUserId(request);
      const organizations = await listOrganizationsForUser(userId);
      return { organizations };
    },
  );

  /** Organization details (active membership + organization:read required). */
  app.get(
    "/organizations/:organizationId",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { organizationId } = validate(
        uuidParamSchema,
        request.params,
        "params",
      );
      const access = await authorize(
        request,
        organizationId,
        Permissions.OrganizationRead,
      );
      return { organization: access.organization };
    },
  );

  /** Update organization metadata (organization:update). */
  app.patch(
    "/organizations/:organizationId",
    { preHandler: [app.authenticate, app.requireCsrf] },
    async (request) => {
      const { organizationId } = validate(
        uuidParamSchema,
        request.params,
        "params",
      );
      const body = validate(updateOrganizationBodySchema, request.body, "body");
      const access = await authorize(
        request,
        organizationId,
        Permissions.OrganizationUpdate,
      );
      const actorId = actorUserId(request);
      const updated = await updateOrganization(
        access,
        body,
        actorId,
        requestMeta(request),
      );
      return { organization: updated };
    },
  );

  // -------------------------------------------------------------------------
  // Memberships
  // -------------------------------------------------------------------------

  /** List members (members:read). */
  app.get(
    "/organizations/:organizationId/members",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { organizationId } = validate(
        uuidParamSchema,
        request.params,
        "params",
      );
      await authorize(request, organizationId, Permissions.MembersRead);
      const members = await listMembers(organizationId);
      return { members: members.map(toPublicMembership) };
    },
  );

  /** Suspend / reactivate a member (members:suspend). */
  app.patch(
    "/organizations/:organizationId/members/:memberId",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.memberModify },
    },
    async (request) => {
      const { organizationId, memberId } = validate(
        memberUuidParamSchema,
        request.params,
        "params",
      );
      const body = validate(updateMemberStatusBodySchema, request.body, "body");
      const access = await authorize(
        request,
        organizationId,
        Permissions.MembersSuspend,
      );
      const actorId = actorUserId(request);
      const member = await setMemberStatus(
        access,
        organizationId,
        memberId,
        body.status,
        actorId,
        requestMeta(request),
      );
      return { membership: toPublicMembership(member) };
    },
  );

  /** Change a member's role (members:update; never assigns OWNER). */
  app.patch(
    "/organizations/:organizationId/members/:memberId/role",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.memberModify },
    },
    async (request) => {
      const { organizationId, memberId } = validate(
        memberUuidParamSchema,
        request.params,
        "params",
      );
      const body = validate(changeMemberRoleBodySchema, request.body, "body");
      const access = await authorize(
        request,
        organizationId,
        Permissions.MembersUpdate,
      );
      const actorId = actorUserId(request);
      const member = await changeMemberRole(
        access,
        organizationId,
        memberId,
        body.role,
        actorId,
        access.roleName,
        requestMeta(request),
      );
      return { membership: toPublicMembership(member) };
    },
  );

  /** Explicit, audited ownership transfer (owner-only). */
  app.post(
    "/organizations/:organizationId/ownership/transfer",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.ownershipTransfer },
    },
    async (request) => {
      const { organizationId } = validate(
        uuidParamSchema,
        request.params,
        "params",
      );
      const body = validate(transferOwnershipBodySchema, request.body, "body");
      const access = await authorizeOwner(request, organizationId);
      const actorId = actorUserId(request);
      const { oldOwner, newOwner } = await transferOwnership(
        access,
        organizationId,
        body.memberId,
        actorId,
        requestMeta(request),
      );
      return {
        message: "Ownership transferred.",
        previousOwner: toPublicMembership(oldOwner),
        newOwner: toPublicMembership(newOwner),
      };
    },
  );

  /** Remove a member (members:remove). Soft lifecycle state, not deletion. */
  app.delete(
    "/organizations/:organizationId/members/:memberId",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.memberModify },
    },
    async (request) => {
      const { organizationId, memberId } = validate(
        memberUuidParamSchema,
        request.params,
        "params",
      );
      const access = await authorize(
        request,
        organizationId,
        Permissions.MembersRemove,
      );
      const actorId = actorUserId(request);
      const member = await removeMember(
        access,
        organizationId,
        memberId,
        actorId,
        requestMeta(request),
      );
      return {
        message: "Member removed.",
        membership: toPublicMembership(member),
      };
    },
  );

  // -------------------------------------------------------------------------
  // Invitations
  // -------------------------------------------------------------------------

  /** Create an organization invitation (members:invite). */
  app.post(
    "/organizations/:organizationId/invitations",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.invite },
    },
    async (request, reply) => {
      const { organizationId } = validate(
        uuidParamSchema,
        request.params,
        "params",
      );
      const body = validate(createInvitationBodySchema, request.body, "body");
      const access = await authorize(
        request,
        organizationId,
        Permissions.MembersInvite,
      );
      const actorId = actorUserId(request);
      const invitation = await createInvitation(
        access,
        organizationId,
        body,
        actorId,
        requestMeta(request),
      );
      return reply.status(201).send({
        invitation: toPublicInvitation(invitation),
        note: "The invitation token is delivered by email only.",
      });
    },
  );

  /** Revoke an invitation (members:invite). */
  app.post(
    "/organizations/:organizationId/invitations/:invitationId/revoke",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.invite },
    },
    async (request) => {
      const { organizationId, invitationId } = validate(
        invitationUuidParamSchema,
        request.params,
        "params",
      );
      const access = await authorize(
        request,
        organizationId,
        Permissions.MembersInvite,
      );
      const actorId = actorUserId(request);
      const invitation = await revokeInvitation(
        access,
        organizationId,
        invitationId,
        actorId,
        requestMeta(request),
      );
      return { invitation: toPublicInvitation(invitation) };
    },
  );

  /**
   * Public invitation lookup. The raw token is the credential, so this is
   * unauthenticated (recipient may not have an account yet). Only the state
   * and org/role are returned — never the token or an unknown-account hint.
   */
  app.get(
    "/invitations/:token",
    { config: { rateLimit: limits.inviteLookup } },
    async (request) => {
      const { token } = validate(
        invitationTokenParamSchema,
        request.params,
        "params",
      );
      const lookup = await getInvitationByToken(token);
      if (!lookup) {
        throw AppError.validation("Invalid or expired invitation.");
      }
      return { invitation: toPublicInvitation(lookup.invitation) };
    },
  );

  /** Accept an invitation with the current (verified) account. */
  app.post(
    "/invitations/:token/accept",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.inviteAccept },
    },
    async (request, reply) => {
      const { token } = validate(
        invitationTokenParamSchema,
        request.params,
        "params",
      );
      const auth = systemAuthContext(request);
      const result = await acceptInvitation(
        token,
        {
          userId: auth.user.id,
          email: auth.user.email,
          emailVerified: auth.user.emailVerified,
        },
        requestMeta(request),
      );
      return reply.status(201).send({
        membership: result.membership,
        organization: result.organization,
      });
    },
  );

  // -------------------------------------------------------------------------
  // Roles & audit surface
  // -------------------------------------------------------------------------

  /** Roles available in an organization, with their resolved permissions. */
  app.get(
    "/organizations/:organizationId/roles",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { organizationId } = validate(
        uuidParamSchema,
        request.params,
        "params",
      );
      const access = await authorize(
        request,
        organizationId,
        Permissions.MembersRead,
      );
      void access;
      const roles = await prisma.role.findMany({
        where: { isSystem: true },
        include: { permissions: { include: { permission: true } } },
        orderBy: { name: "asc" },
      });
      return {
        roles: roles.map((role) => ({
          ...toPublicRoleDetail(role),
          permissions: role.permissions.map((rp) => rp.permission.name).sort(),
        })),
      };
    },
  );

  /** Organization security events (audit:read). */
  app.get(
    "/organizations/:organizationId/security-events",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { organizationId } = validate(
        uuidParamSchema,
        request.params,
        "params",
      );
      const query = validate(securityEventsQuerySchema, request.query, "query");
      await authorize(request, organizationId, Permissions.AuditRead);
      const events = await prisma.securityEvent.findMany({
        where: { organizationId },
        orderBy: { createdAt: "desc" },
        take: query.limit,
        skip: query.offset,
        include: { user: { select: { id: true, email: true } } },
      });
      return {
        events: events.map((event) => ({
          id: event.id,
          type: event.type,
          createdAt: event.createdAt,
          organizationId: event.organizationId,
          actor: event.user
            ? { id: event.user.id, email: event.user.email }
            : null,
          metadata: event.metadata,
        })),
        limit: query.limit,
        offset: query.offset,
      };
    },
  );

  done();
};

export default organizationsRoutes;
