import { randomUUID } from "node:crypto";
import {
  unlinkSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import path from "node:path";
import { getEnv } from "../../config/env.js";

export type AuthEmailKind =
  | "EMAIL_VERIFICATION"
  | "PASSWORD_RESET"
  | "ORGANIZATION_INVITATION"
  | "DEAL_PARTICIPANT_INVITATION";

export interface AuthEmailPayload {
  to: string;
  subject: string;
  body: string;
}

export interface DevMailMessage extends AuthEmailPayload {
  id: string;
  kind: AuthEmailKind;
  toNormalized: string;
  token: string;
  sentAt: string;
}

export interface AuthEmailService {
  sendVerification(email: string, rawToken: string): Promise<void>;
  sendPasswordReset(email: string, rawToken: string): Promise<void>;
  sendOrganizationInvitation(
    email: string,
    rawToken: string,
    organizationName: string,
    roleName: string,
  ): Promise<void>;
  sendDealParticipantInvitation(
    email: string,
    rawToken: string,
    dealName: string,
    dealReference: string,
    participantType: string,
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// Development mailbox.
//
// Phase 2 implements no real email-provider integration. For local
// development, outbound auth emails are captured to an in-process mailbox and
// mirrored to `.dev-mailbox/` on disk so the verification/reset flow can be
// exercised without pretending an email was delivered. Production providers
// plug into the same interface in a later phase.
// ---------------------------------------------------------------------------

const messages: DevMailMessage[] = [];

function mailboxDir(): string {
  return path.resolve(process.cwd(), ".dev-mailbox");
}

function appendToDisk(message: DevMailMessage): void {
  const dir = mailboxDir();
  try {
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${message.id}.json`);
    writeFileSync(file, JSON.stringify(message, null, 2), "utf8");
  } catch {
    // mailbox persistence is best-effort only
  }
}

export function listDevMailbox(): DevMailMessage[] {
  return [...messages];
}

export function clearDevMailbox(): void {
  messages.length = 0;
  const dir = mailboxDir();
  if (existsSync(dir)) {
    for (const file of readdirSync(dir)) {
      if (file.endsWith(".json")) unlinkSync(path.join(dir, file));
    }
  }
}

export function replayDevMailboxFromDisk(): void {
  const dir = mailboxDir();
  if (!existsSync(dir)) return;
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    try {
      const parsed = JSON.parse(
        readFileSync(path.join(dir, file), "utf8"),
      ) as DevMailMessage;
      if (!messages.some((m) => m.id === parsed.id)) messages.push(parsed);
    } catch {
      // skip corrupt file
    }
  }
}

function push(
  kind: AuthEmailKind,
  to: string,
  rawToken: string,
  subject: string,
  body: string,
): void {
  const env = getEnv();
  const message: DevMailMessage = {
    id: randomUUID(),
    kind,
    to,
    toNormalized: to.trim().toLowerCase(),
    subject,
    body,
    token: rawToken,
    sentAt: new Date().toISOString(),
  };
  messages.push(message);
  appendToDisk(message);

  if (env.NODE_ENV === "development") {
    // Mirrors the provider integration that will exist in a later phase.
    // eslint-disable-next-line no-console
    console.log(`[dev-mail] ${subject} -> ${to}`);
  }
}

/**
 * Development email service. Captures messages in the in-process mailbox and
 * on disk; tokens are retrievable through the dev endpoint (see README).
 */
export const devEmailService: AuthEmailService = {
  async sendVerification(email, rawToken) {
    const subject = "Verify your Aegis email";
    const body = [
      `Hello,`,
      ``,
      `Thank you for creating your Aegis account.`,
      ``,
      `Verification token (single-use, expires in 24h):`,
      `${rawToken}`,
      ``,
      `Submit it via POST /api/v1/auth/verify-email.`,
      ``,
      `If you did not create this account, you can ignore this email.`,
    ].join("\n");
    push("EMAIL_VERIFICATION", email, rawToken, subject, body);
  },

  async sendPasswordReset(email, rawToken) {
    const subject = "Reset your Aegis password";
    const body = [
      `Hello,`,
      ``,
      `A password reset was requested for this account.`,
      ``,
      `Reset token (single-use, expires in 60 minutes):`,
      `${rawToken}`,
      ``,
      `Submit it via POST /api/v1/auth/reset-password.`,
      ``,
      `If you did not request this, you can safely ignore this email.`,
    ].join("\n");
    push("PASSWORD_RESET", email, rawToken, subject, body);
  },

  async sendOrganizationInvitation(
    email,
    rawToken,
    organizationName,
    roleName,
  ) {
    const subject = `You are invited to join ${organizationName} on Aegis`;
    const body = [
      `Hello,`,
      ``,
      `You have been invited to join the organization "${organizationName}" on Aegis.`,
      ``, // start building the email body
      `Upon accepting you will be granted the "${roleName}" role.`,
      ``,
      `Invitation token (single-use, time-limited):`,
      `${rawToken}`,
      ``,
      `Accept it via POST /api/v1/invitations/:token/accept while signed in with`,
      `the account ${email}.`,
      ``,
      `If you were not expecting this invitation, you can ignore this email.`,
    ].join("\n");
    push("ORGANIZATION_INVITATION", email, rawToken, subject, body);
  },

  async sendDealParticipantInvitation(
    email,
    rawToken,
    dealName,
    dealReference,
    participantType,
  ) {
    const subject = `You are invited to negotiate deal ${dealReference} on Aegis`;
    const body = [
      `Hello,`,
      ``,
      `Your organization has been invited to participate in the deal`,
      `"${dealName}" (${dealReference}) on Aegis.`,
      ``, // start building the email body
      `You will join as a "${participantType}" participant.`,
      ``,
      `Invitation token (single-use, time-limited):`,
      `${rawToken}`,
      ``,
      `Accept it via POST /api/v1/deal-invitations/:token/accept while signed in`,
      `with the account ${email}.`,
      ``,
      `If you were not expecting this invitation, you can ignore this email.`,
    ].join("\n");
    push("DEAL_PARTICIPANT_INVITATION", email, rawToken, subject, body);
  },
};
