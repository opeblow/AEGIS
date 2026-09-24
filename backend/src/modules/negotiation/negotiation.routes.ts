import type { FastifyInstance, FastifyPluginCallback } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors/index.js";
import { validate } from "../../lib/validation.js";
import {
  systemAuthContext,
  requestMeta,
} from "../organizations/route-helpers.js";
import {
  authorize,
  actorUserId,
} from "../organizations/authorization.service.js";
import { Permissions } from "../organizations/permissions.js";
import { resolveDealViewer, requireOwnerViewer } from "./participant-policy.js";
import {
  createCounterparty,
  listCounterparties,
  getCounterparty,
  updateCounterparty,
  revokeCounterparty,
} from "./counterparty.service.js";
import {
  inviteToDeal,
  listInvitations,
  revokeInvitation,
  acceptDealInvitation,
  declineDealInvitation,
  getDealInvitationByToken,
  updateParticipantStatus,
  listParticipants,
} from "./participant.service.js";
import {
  createOffer,
  submitOffer,
  counterOffer,
  acceptOffer,
  rejectOffer,
  withdrawOffer,
  listOffers,
  getOffer,
  getNegotiation,
} from "./offer.service.js";
import {
  counterpartyCreateBodySchema,
  counterpartyUpdateBodySchema,
  counterpartyQuerySchema,
  inviteParticipantBodySchema,
  participantStatusBodySchema,
  createOfferBodySchema,
  counterOfferBodySchema,
  submitOfferBodySchema,
  acceptOfferBodySchema,
  rejectOfferBodySchema,
  withdrawOfferBodySchema,
  offerQuerySchema,
  negotiationQuerySchema,
  dealIdParamsSchema,
  offerIdParamsSchema,
  participantIdParamsSchema,
  invitationIdParamsSchema,
  dealInvitationTokenParamsSchema,
  organizationCounterpartyIdParamsSchema,
  counterpartyIdParamsSchema,
} from "./negotiation.schemas.js";
import {
  toPublicDealInvitation,
  toPublicDealParticipant,
  toPublicRoomDeal,
} from "./negotiation.types.js";

/**
 * Phase 5 negotiation endpoints.
 *
 * Two authorization models sit under /api/v1:
 *   - counterparty endpoints are org-scoped (`authorize` + a counterparties
 *     permission on the actor's role);
 *   - deal endpoints are PARTICIPANT-scoped: `resolveDealViewer` resolves the
 *     actor's org inside the deal, so confidentiality holds even before any
 *     permission check (strangers see the same 404 as a bad deal id).
 */
const negotiationRoutes: FastifyPluginCallback = (
  app: FastifyInstance,
  _opts,
  done,
): void => {
  const limits = {
    counterpartyCreate: { max: 30, timeWindow: "1 minute" },
    counterpartyUpdate: { max: 60, timeWindow: "1 minute" },
    invite: { max: 20, timeWindow: "1 minute" },
    invitationLookup: { max: 30, timeWindow: "1 minute" },
    invitationAccept: { max: 20, timeWindow: "1 minute" },
    offerCreate: { max: 30, timeWindow: "1 minute" },
    offerAction: { max: 60, timeWindow: "1 minute" },
  } as const;

  // -------------------------------------------------------------------------
  // Counterparties (org-scoped)
  // -------------------------------------------------------------------------

  app.get(
    "/organizations/:organizationId/counterparties",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { organizationId } = validate(
        organizationCounterpartyIdParamsSchema,
        request.params,
        "params",
      );
      const query = validate(counterpartyQuerySchema, request.query, "query");
      await authorize(request, organizationId, Permissions.CounterpartiesRead);
      return listCounterparties(organizationId, query);
    },
  );

  app.post(
    "/organizations/:organizationId/counterparties",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.counterpartyCreate },
    },
    async (request, reply) => {
      const { organizationId } = validate(
        organizationCounterpartyIdParamsSchema,
        request.params,
        "params",
      );
      const body = validate(counterpartyCreateBodySchema, request.body, "body");
      const access = await authorize(
        request,
        organizationId,
        Permissions.CounterpartiesManage,
      );
      const counterparty = await createCounterparty(
        access,
        organizationId,
        body,
        actorUserId(request),
        requestMeta(request),
      );
      return reply.status(201).send({ counterparty });
    },
  );

  app.get(
    "/organizations/:organizationId/counterparties/:counterpartyId",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { organizationId, counterpartyId } = validate(
        counterpartyIdParamsSchema,
        request.params,
        "params",
      );
      await authorize(request, organizationId, Permissions.CounterpartiesRead);
      const counterparty = await getCounterparty(
        organizationId,
        counterpartyId,
      );
      return { counterparty };
    },
  );

  app.patch(
    "/organizations/:organizationId/counterparties/:counterpartyId",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.counterpartyUpdate },
    },
    async (request) => {
      const { organizationId, counterpartyId } = validate(
        counterpartyIdParamsSchema,
        request.params,
        "params",
      );
      const body = validate(counterpartyUpdateBodySchema, request.body, "body");
      await authorize(
        request,
        organizationId,
        Permissions.CounterpartiesManage,
      );
      const counterparty = await updateCounterparty(
        organizationId,
        counterpartyId,
        body,
        actorUserId(request),
        requestMeta(request),
      );
      return { counterparty };
    },
  );

  app.delete(
    "/organizations/:organizationId/counterparties/:counterpartyId",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.counterpartyUpdate },
    },
    async (request) => {
      const { organizationId, counterpartyId } = validate(
        counterpartyIdParamsSchema,
        request.params,
        "params",
      );
      await authorize(
        request,
        organizationId,
        Permissions.CounterpartiesManage,
      );
      const counterparty = await revokeCounterparty(
        organizationId,
        counterpartyId,
        actorUserId(request),
        requestMeta(request),
      );
      return { counterparty };
    },
  );

  // -------------------------------------------------------------------------
  // Deal participants & invitations (owner-gated; participant-level authz)
  // -------------------------------------------------------------------------

  app.get(
    "/deals/:dealId/participants",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { dealId } = validate(dealIdParamsSchema, request.params, "params");
      const viewer = await resolveDealViewer(dealId, actorUserId(request));
      const page = await listParticipants(viewer, dealId);
      return page;
    },
  );

  app.get(
    "/deals/:dealId/participants/:participantId",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { dealId, participantId } = validate(
        participantIdParamsSchema,
        request.params,
        "params",
      );
      const viewer = await resolveDealViewer(dealId, actorUserId(request));
      const participant = await prisma.dealParticipant.findFirst({
        where: { id: participantId, dealId },
        include: { organization: true },
      });
      if (!participant) throw AppError.dealParticipantNotFound();
      if (!viewer.isOwner && participant.id !== viewer.participant.id) {
        throw AppError.dealParticipantNotFound();
      }
      return { participant: toPublicDealParticipant(participant) };
    },
  );

  app.patch(
    "/deals/:dealId/participants/:participantId/status",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.invite },
    },
    async (request) => {
      const { dealId, participantId } = validate(
        participantIdParamsSchema,
        request.params,
        "params",
      );
      const body = validate(participantStatusBodySchema, request.body, "body");
      const viewer = requireOwnerViewer(
        await resolveDealViewer(dealId, actorUserId(request)),
      );
      const participant = await updateParticipantStatus(
        viewer,
        dealId,
        participantId,
        body,
        actorUserId(request),
        requestMeta(request),
      );
      return { participant };
    },
  );

  app.get(
    "/deals/:dealId/invitations",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { dealId } = validate(dealIdParamsSchema, request.params, "params");
      const viewer = requireOwnerViewer(
        await resolveDealViewer(dealId, actorUserId(request)),
      );
      const invitations = await listInvitations(viewer, dealId);
      return { invitations };
    },
  );

  app.get(
    "/deals/:dealId/invitations/:invitationId",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { dealId, invitationId } = validate(
        invitationIdParamsSchema,
        request.params,
        "params",
      );
      void requireOwnerViewer(
        await resolveDealViewer(dealId, actorUserId(request)),
      );
      const invitation = await prisma.dealParticipantInvitation.findFirst({
        where: { id: invitationId, dealId },
        include: { organization: true, deal: true },
      });
      if (!invitation) throw AppError.dealParticipantNotFound();
      return { invitation: toPublicDealInvitation(invitation) };
    },
  );

  app.post(
    "/deals/:dealId/invitations",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.invite },
    },
    async (request, reply) => {
      const { dealId } = validate(dealIdParamsSchema, request.params, "params");
      const body = validate(inviteParticipantBodySchema, request.body, "body");
      const viewer = requireOwnerViewer(
        await resolveDealViewer(dealId, actorUserId(request)),
      );
      const invitation = await inviteToDeal(
        viewer,
        dealId,
        body,
        actorUserId(request),
        requestMeta(request),
      );
      return reply.status(201).send({
        invitation,
        note: "The invitation token is delivered by email only.",
      });
    },
  );

  app.post(
    "/deals/:dealId/invitations/:invitationId/revoke",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.invite },
    },
    async (request) => {
      const { dealId, invitationId } = validate(
        invitationIdParamsSchema,
        request.params,
        "params",
      );
      const viewer = requireOwnerViewer(
        await resolveDealViewer(dealId, actorUserId(request)),
      );
      const invitation = await revokeInvitation(
        viewer,
        dealId,
        invitationId,
        actorUserId(request),
        requestMeta(request),
      );
      return { invitation };
    },
  );

  // -------------------------------------------------------------------------
  // Deal room
  // -------------------------------------------------------------------------

  app.get(
    "/deals/:dealId/room",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { dealId } = validate(dealIdParamsSchema, request.params, "params");
      const viewer = await resolveDealViewer(dealId, actorUserId(request));
      const deal = toPublicRoomDeal(viewer.deal, viewer.isOwner);
      const { participants, total } = await listParticipants(viewer, dealId);
      return { deal, participants, total };
    },
  );

  // -------------------------------------------------------------------------
  // Offers & negotiation history
  // -------------------------------------------------------------------------

  app.get(
    "/deals/:dealId/offers",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { dealId } = validate(dealIdParamsSchema, request.params, "params");
      const query = validate(offerQuerySchema, request.query, "query");
      const viewer = await resolveDealViewer(dealId, actorUserId(request));
      return listOffers(viewer, dealId, query);
    },
  );

  app.post(
    "/deals/:dealId/offers",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.offerCreate },
    },
    async (request, reply) => {
      const { dealId } = validate(dealIdParamsSchema, request.params, "params");
      const body = validate(createOfferBodySchema, request.body, "body");
      const viewer = await resolveDealViewer(dealId, actorUserId(request));
      const offer = await createOffer(
        viewer,
        dealId,
        body,
        actorUserId(request),
        requestMeta(request),
      );
      return reply.status(201).send({ offer });
    },
  );

  app.get(
    "/deals/:dealId/offers/:offerId",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { dealId, offerId } = validate(
        offerIdParamsSchema,
        request.params,
        "params",
      );
      const viewer = await resolveDealViewer(dealId, actorUserId(request));
      const offer = await getOffer(viewer, dealId, offerId);
      return { offer };
    },
  );

  app.post(
    "/deals/:dealId/offers/:offerId/submit",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.offerAction },
    },
    async (request) => {
      const { dealId, offerId } = validate(
        offerIdParamsSchema,
        request.params,
        "params",
      );
      const body = validate(submitOfferBodySchema, request.body, "body");
      const viewer = await resolveDealViewer(dealId, actorUserId(request));
      const result = await submitOffer(
        viewer,
        dealId,
        offerId,
        body,
        actorUserId(request),
        requestMeta(request),
      );
      return result;
    },
  );

  app.post(
    "/deals/:dealId/offers/:offerId/counter",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.offerAction },
    },
    async (request) => {
      const { dealId, offerId } = validate(
        offerIdParamsSchema,
        request.params,
        "params",
      );
      const body = validate(counterOfferBodySchema, request.body, "body");
      const viewer = await resolveDealViewer(dealId, actorUserId(request));
      const result = await counterOffer(
        viewer,
        dealId,
        offerId,
        body,
        actorUserId(request),
        requestMeta(request),
      );
      return result;
    },
  );

  app.post(
    "/deals/:dealId/offers/:offerId/accept",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.offerAction },
    },
    async (request) => {
      const { dealId, offerId } = validate(
        offerIdParamsSchema,
        request.params,
        "params",
      );
      const body = validate(acceptOfferBodySchema, request.body, "body");
      const viewer = await resolveDealViewer(dealId, actorUserId(request));
      const result = await acceptOffer(
        viewer,
        dealId,
        offerId,
        body,
        actorUserId(request),
        requestMeta(request),
      );
      return result;
    },
  );

  app.post(
    "/deals/:dealId/offers/:offerId/reject",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.offerAction },
    },
    async (request) => {
      const { dealId, offerId } = validate(
        offerIdParamsSchema,
        request.params,
        "params",
      );
      const body = validate(rejectOfferBodySchema, request.body, "body");
      const viewer = await resolveDealViewer(dealId, actorUserId(request));
      const result = await rejectOffer(
        viewer,
        dealId,
        offerId,
        body,
        actorUserId(request),
        requestMeta(request),
      );
      return result;
    },
  );

  app.post(
    "/deals/:dealId/offers/:offerId/withdraw",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.offerAction },
    },
    async (request) => {
      const { dealId, offerId } = validate(
        offerIdParamsSchema,
        request.params,
        "params",
      );
      const body = validate(withdrawOfferBodySchema, request.body, "body");
      const viewer = await resolveDealViewer(dealId, actorUserId(request));
      const result = await withdrawOffer(
        viewer,
        dealId,
        offerId,
        body,
        actorUserId(request),
        requestMeta(request),
      );
      return result;
    },
  );

  app.get(
    "/deals/:dealId/negotiation",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { dealId } = validate(dealIdParamsSchema, request.params, "params");
      const query = validate(negotiationQuerySchema, request.query, "query");
      const viewer = await resolveDealViewer(dealId, actorUserId(request));
      return getNegotiation(viewer, dealId, query);
    },
  );

  // -------------------------------------------------------------------------
  // Token-gated deal invitations (public lookup; accept/decline as the user)
  // -------------------------------------------------------------------------

  app.get(
    "/deal-invitations/:token",
    { config: { rateLimit: limits.invitationLookup } },
    async (request) => {
      const { token } = validate(
        dealInvitationTokenParamsSchema,
        request.params,
        "params",
      );
      const lookup = await getDealInvitationByToken(token);
      if (!lookup) {
        throw AppError.validation("Invalid or expired invitation.");
      }
      return { invitation: toPublicDealInvitation(lookup.invitation) };
    },
  );

  app.post(
    "/deal-invitations/:token/accept",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.invitationAccept },
    },
    async (request, reply) => {
      const { token } = validate(
        dealInvitationTokenParamsSchema,
        request.params,
        "params",
      );
      const auth = systemAuthContext(request);
      const result = await acceptDealInvitation(
        token,
        {
          userId: auth.user.id,
          email: auth.user.email,
          emailVerified: auth.user.emailVerified,
        },
        requestMeta(request),
      );
      return reply.status(201).send(result);
    },
  );

  app.post(
    "/deal-invitations/:token/decline",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.invitationAccept },
    },
    async (request) => {
      const { token } = validate(
        dealInvitationTokenParamsSchema,
        request.params,
        "params",
      );
      const auth = systemAuthContext(request);
      const result = await declineDealInvitation(
        token,
        {
          userId: auth.user.id,
          email: auth.user.email,
          emailVerified: auth.user.emailVerified,
        },
        requestMeta(request),
      );
      return result;
    },
  );

  done();
};

export default negotiationRoutes;
