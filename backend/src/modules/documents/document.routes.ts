import type { FastifyInstance, FastifyPluginCallback } from "fastify";
import { AppError } from "../../lib/errors/index.js";
import { validate } from "../../lib/validation.js";
import { getEnv } from "../../config/env.js";
import { requestMeta } from "../organizations/route-helpers.js";
import { actorUserId } from "../organizations/authorization.service.js";
import { resolveDealViewer } from "../negotiation/participant-policy.js";
import {
  createDocument,
  uploadDocumentBytes,
  completeDocument,
  submitDocument,
  withdrawDocument,
  reviewDocument,
  replaceDocument,
  getDocument,
  listDocuments,
  listVersions,
  downloadDocument,
} from "./document.service.js";
import {
  createDocumentBodySchema,
  replaceDocumentBodySchema,
  submitDocumentBodySchema,
  withdrawDocumentBodySchema,
  completeDocumentBodySchema,
  reviewDocumentBodySchema,
  documentQuerySchema,
  dealIdParamsSchema,
  documentIdParamsSchema,
} from "./document.schemas.js";
import { z } from "zod";

const uploadHeadersSchema = z
  .object({
    "x-original-filename": z
      .string()
      .trim()
      .min(1, "x-original-filename is required.")
      .max(255, "x-original-filename must be at most 255 characters."),
    "x-mime-type": z.string().trim().max(255).optional(),
  })
  .passthrough();

function sanitizeContentDisposition(filename: string): string {
  return filename.replace(/["\\\r\n]/g, "_");
}

/**
 * Phase 6 document endpoints (deal-participant scoped).
 *
 * Every route resolves the actor's organization inside the deal first, so a
 * stranger learns nothing about the deal (the same deal 404 is returned for a
 * document they cannot see). Bytes travel only on UPLOAD and DOWNLOAD; the
 * database stores metadata + a server-generated storage key.
 */
const documentRoutes: FastifyPluginCallback = (
  app: FastifyInstance,
  _opts,
  done,
): void => {
  const limits = {
    documentCreate: { max: 30, timeWindow: "1 minute" },
    documentAction: { max: 60, timeWindow: "1 minute" },
    documentUpload: { max: 30, timeWindow: "1 minute" },
    documentDownload: { max: 120, timeWindow: "1 minute" },
  } as const;

  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer", bodyLimit: getEnv().DOCUMENT_MAX_SIZE_BYTES + 65536 },
    (_request, body, done) => {
      const buffer = body as Buffer;
      if (buffer.length > getEnv().DOCUMENT_MAX_SIZE_BYTES) {
        done(AppError.documentTooLarge());
        return;
      }
      done(null, buffer);
    },
  );

  app.get(
    "/deals/:dealId/documents",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { dealId } = validate(dealIdParamsSchema, request.params, "params");
      const query = validate(documentQuerySchema, request.query, "query");
      const viewer = await resolveDealViewer(dealId, actorUserId(request));
      return listDocuments(viewer, dealId, query);
    },
  );

  app.post(
    "/deals/:dealId/documents",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.documentCreate },
    },
    async (request, reply) => {
      const { dealId } = validate(dealIdParamsSchema, request.params, "params");
      const body = validate(createDocumentBodySchema, request.body, "body");
      const viewer = await resolveDealViewer(dealId, actorUserId(request));
      const document = await createDocument(
        viewer,
        dealId,
        body,
        actorUserId(request),
        requestMeta(request),
      );
      return reply.status(201).send({ document });
    },
  );

  app.get(
    "/deals/:dealId/documents/:documentId",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { dealId, documentId } = validate(
        documentIdParamsSchema,
        request.params,
        "params",
      );
      const viewer = await resolveDealViewer(dealId, actorUserId(request));
      const document = await getDocument(viewer, dealId, documentId);
      return { document };
    },
  );

  app.get(
    "/deals/:dealId/documents/:documentId/versions",
    { preHandler: [app.authenticate] },
    async (request) => {
      const { dealId, documentId } = validate(
        documentIdParamsSchema,
        request.params,
        "params",
      );
      const viewer = await resolveDealViewer(dealId, actorUserId(request));
      return listVersions(viewer, dealId, documentId);
    },
  );

  app.put(
    "/deals/:dealId/documents/:documentId/upload",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.documentUpload },
    },
    async (request) => {
      const { dealId, documentId } = validate(
        documentIdParamsSchema,
        request.params,
        "params",
      );
      const headers = validate(uploadHeadersSchema, request.headers, "headers");
      const bytes = request.body as Buffer;
      if (!Buffer.isBuffer(bytes)) {
        throw AppError.validation("Expected a raw octet-stream body.");
      }
      const viewer = await resolveDealViewer(dealId, actorUserId(request));
      const document = await uploadDocumentBytes(
        viewer,
        dealId,
        documentId,
        {
          bytes,
          originalFilename: headers["x-original-filename"],
          declaredContentType: headers["x-mime-type"] ?? null,
        },
        actorUserId(request),
        requestMeta(request),
      );
      return { document };
    },
  );

  app.post(
    "/deals/:dealId/documents/:documentId/complete",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.documentAction },
    },
    async (request) => {
      const { dealId, documentId } = validate(
        documentIdParamsSchema,
        request.params,
        "params",
      );
      const body = validate(completeDocumentBodySchema, request.body, "body");
      const viewer = await resolveDealViewer(dealId, actorUserId(request));
      const result = await completeDocument(
        viewer,
        dealId,
        documentId,
        body,
        actorUserId(request),
        requestMeta(request),
      );
      return result;
    },
  );

  app.post(
    "/deals/:dealId/documents/:documentId/submit",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.documentAction },
    },
    async (request) => {
      const { dealId, documentId } = validate(
        documentIdParamsSchema,
        request.params,
        "params",
      );
      const body = validate(submitDocumentBodySchema, request.body, "body");
      const viewer = await resolveDealViewer(dealId, actorUserId(request));
      const result = await submitDocument(
        viewer,
        dealId,
        documentId,
        body,
        actorUserId(request),
        requestMeta(request),
      );
      return result;
    },
  );

  app.post(
    "/deals/:dealId/documents/:documentId/withdraw",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.documentAction },
    },
    async (request) => {
      const { dealId, documentId } = validate(
        documentIdParamsSchema,
        request.params,
        "params",
      );
      const body = validate(withdrawDocumentBodySchema, request.body, "body");
      const viewer = await resolveDealViewer(dealId, actorUserId(request));
      const result = await withdrawDocument(
        viewer,
        dealId,
        documentId,
        body,
        actorUserId(request),
        requestMeta(request),
      );
      return result;
    },
  );

  app.post(
    "/deals/:dealId/documents/:documentId/review",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.documentAction },
    },
    async (request) => {
      const { dealId, documentId } = validate(
        documentIdParamsSchema,
        request.params,
        "params",
      );
      const body = validate(reviewDocumentBodySchema, request.body, "body");
      const viewer = await resolveDealViewer(dealId, actorUserId(request));
      const result = await reviewDocument(
        viewer,
        dealId,
        documentId,
        body,
        actorUserId(request),
        requestMeta(request),
      );
      return result;
    },
  );

  app.post(
    "/deals/:dealId/documents/:documentId/replace",
    {
      preHandler: [app.authenticate, app.requireCsrf],
      config: { rateLimit: limits.documentCreate },
    },
    async (request, reply) => {
      const { dealId, documentId } = validate(
        documentIdParamsSchema,
        request.params,
        "params",
      );
      const body = validate(replaceDocumentBodySchema, request.body, "body");
      const viewer = await resolveDealViewer(dealId, actorUserId(request));
      const document = await replaceDocument(
        viewer,
        dealId,
        documentId,
        body,
        actorUserId(request),
        requestMeta(request),
      );
      return reply.status(201).send({ document });
    },
  );

  app.get(
    "/deals/:dealId/documents/:documentId/download",
    {
      preHandler: [app.authenticate],
      config: { rateLimit: limits.documentDownload },
    },
    async (request, reply) => {
      const { dealId, documentId } = validate(
        documentIdParamsSchema,
        request.params,
        "params",
      );
      const viewer = await resolveDealViewer(dealId, actorUserId(request));
      const download = await downloadDocument(
        viewer,
        dealId,
        documentId,
        requestMeta(request),
      );
      return reply
        .type(download.contentType)
        .header(
          "Content-Disposition",
          `attachment; filename="${sanitizeContentDisposition(
            download.originalFilename,
          )}"`,
        )
        .send(download.bytes);
    },
  );

  done();
};

export default documentRoutes;
