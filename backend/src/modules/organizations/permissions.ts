/**
 * Stable permission identifiers. These strings are the single source of truth
 * for permission checks and for the system-role seed. Do not scatter raw
 * permission strings across the codebase — reference `Permissions.*`.
 *
 * Only the identifiers needed by the current phase are wired into the system
 * roles. Future identifiers are listed here (and seeded inertly) so the
 * catalog stays stable across phases without granting extra capability.
 */
export const Permissions = {
  // Organization / membership (current phase)
  OrganizationRead: "organization:read",
  OrganizationUpdate: "organization:update",

  MembersRead: "members:read",
  MembersInvite: "members:invite",
  MembersUpdate: "members:update",
  MembersSuspend: "members:suspend",
  MembersRemove: "members:remove",

  AuditRead: "audit:read",
  AuditExport: "audit:export",

  // Counterparties (Phase 5) — governing the org<->org trust graph. Only the
  // OWNER role carries them today.
  CounterpartiesRead: "counterparties:read",
  CounterpartiesManage: "counterparties:manage",

  // Future capability identifiers (seeded for stability; only OWNER carries
  // them today — the object model that grants them is a later phase).
  DealsRead: "deals:read",
  DealsCreate: "deals:create",
  DealsUpdate: "deals:update",
  DealsTransition: "deals:transition",
  DealsApprove: "deals:approve",
  DealsSettle: "deals:settle",

  DocumentsRead: "documents:read",
  DocumentsUpload: "documents:upload",
  DocumentsDelete: "documents:delete",

  ApprovalsRead: "approvals:read",
  ApprovalsDecide: "approvals:decide",

  SettlementRead: "settlement:read",
  SettlementExecute: "settlement:execute",

  // Deal Intelligence (Phase 9). Split into read vs analyze so triggering
  // external provider work stays a privileged act while viewing stored runs
  // stays cheap. Both are seeded now; only OWNER/ADMIN (and MEMBER for read)
  // carry them.
  DealIntelligenceRead: "intelligence:read",
  DealIntelligenceAnalyze: "intelligence:analyze",

  // Quantum Optimization (Phase 10). Same read/run split as deal
  // intelligence: viewing stored optimization runs is cheap (granted to
  // MEMBER), triggering a solver run invokes the external quantum service and
  // stays OWNER/ADMIN-only.
  OptimizationRead: "optimization:read",
  OptimizationRun: "optimization:run",

  // OneSwap Integration (Phase 11). Read = view quotes + pool info;
  // Execute = initiate swaps / manage liquidity (calls external provider).
  OneSwapRead: "oneswap:read",
  OneSwapExecute: "oneswap:execute",
} as const;

export type PermissionName = (typeof Permissions)[keyof typeof Permissions];

export interface PermissionDefinition {
  name: PermissionName;
  description: string;
  category: string;
}

/** The complete seeded permission catalog. */
export const PERMISSION_CATALOG: PermissionDefinition[] = [
  {
    name: Permissions.OrganizationRead,
    description: "Read organization details and roles.",
    category: "organization",
  },
  {
    name: Permissions.OrganizationUpdate,
    description: "Update organization metadata (name, slug, legal details).",
    category: "organization",
  },
  {
    name: Permissions.MembersRead,
    description: "List organization members.",
    category: "members",
  },
  {
    name: Permissions.MembersInvite,
    description: "Invite new members to the organization.",
    category: "members",
  },
  {
    name: Permissions.MembersUpdate,
    description: "Change another member's role.",
    category: "members",
  },
  {
    name: Permissions.MembersSuspend,
    description: "Suspend or reactivate members.",
    category: "members",
  },
  {
    name: Permissions.MembersRemove,
    description: "Remove members from the organization.",
    category: "members",
  },
  {
    name: Permissions.AuditRead,
    description: "Read organization security events.",
    category: "audit",
  },
  {
    name: Permissions.AuditExport,
    description: "Export organization security events.",
    category: "audit",
  },
  {
    name: Permissions.CounterpartiesRead,
    description: "Read counterparty relationships. (Phase 5.)",
    category: "counterparties",
  },
  {
    name: Permissions.CounterpartiesManage,
    description:
      "Create, update, and revoke counterparty relationships. (Phase 5.)",
    category: "counterparties",
  },
  {
    name: Permissions.DealsRead,
    description: "Read deals. (Phase 4.)",
    category: "deals",
  },
  {
    name: Permissions.DealsCreate,
    description: "Create deals. (Phase 4.)",
    category: "deals",
  },
  {
    name: Permissions.DealsUpdate,
    description: "Update deals. (Phase 4.)",
    category: "deals",
  },
  {
    name: Permissions.DealsTransition,
    description: "Move deals through their state machine. (Phase 4.)",
    category: "deals",
  },
  {
    name: Permissions.DealsApprove,
    description: "Approve deals. (Reserved for a later phase.)",
    category: "deals",
  },
  {
    name: Permissions.DealsSettle,
    description: "Settle deals. (Reserved for a later phase.)",
    category: "deals",
  },
  {
    name: Permissions.DocumentsRead,
    description: "Read documents. (Reserved for a later phase.)",
    category: "documents",
  },
  {
    name: Permissions.DocumentsUpload,
    description: "Upload documents. (Reserved for a later phase.)",
    category: "documents",
  },
  {
    name: Permissions.DocumentsDelete,
    description: "Delete documents. (Reserved for a later phase.)",
    category: "documents",
  },
  {
    name: Permissions.ApprovalsRead,
    description: "Read approvals. (Reserved for a later phase.)",
    category: "approvals",
  },
  {
    name: Permissions.ApprovalsDecide,
    description: "Decide approvals. (Reserved for a later phase.)",
    category: "approvals",
  },
  {
    name: Permissions.SettlementRead,
    description: "Read settlement data. (Reserved for a later phase.)",
    category: "settlement",
  },
  {
    name: Permissions.SettlementExecute,
    description: "Execute settlement. (Reserved for a later phase.)",
    category: "settlement",
  },
  {
    name: Permissions.DealIntelligenceRead,
    description:
      "Read stored deal-intelligence runs. Members may view results their " +
      "organization already paid for.",
    category: "intelligence",
  },
  {
    name: Permissions.DealIntelligenceAnalyze,
    description:
      "Trigger a new deal analysis or Q&A against the AI/ML service " +
      "(invokes the external provider).",
    category: "intelligence",
  },
  {
    name: Permissions.OptimizationRead,
    description:
      "Read stored deal route-optimization runs. Members may view results " +
      "their organization already paid for.",
    category: "optimization",
  },
  {
    name: Permissions.OptimizationRun,
    description:
      "Trigger a route optimization or solver comparison against the " +
      "quantum service (invokes the external provider).",
    category: "optimization",
  },
  {
    name: Permissions.OneSwapRead,
    description:
      "Fetch swap quotes and pool information from OneSwap (read-only, no transaction).",
    category: "oneswap",
  },
  {
    name: Permissions.OneSwapExecute,
    description:
      "Initiate swaps and manage liquidity positions via OneSwap (invokes external provider).",
    category: "oneswap",
  },
];
