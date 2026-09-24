import { Permissions, type PermissionName } from "./permissions.js";

/**
 * System roles. Authorization always flows through the role -> permission
 * mapping; role-name string checks are confined to this module (e.g. the
 * special OWNER rules) and never scattered through the codebase.
 */
export const SystemRole = {
  Owner: "OWNER",
  Admin: "ADMIN",
  Member: "MEMBER",
  Viewer: "VIEWER",
} as const;

export type SystemRoleName = (typeof SystemRole)[keyof typeof SystemRole];

export const SYSTEM_ROLES: ReadonlyArray<{
  name: SystemRoleName;
  description: string;
  permissions: readonly PermissionName[];
}> = [
  {
    name: SystemRole.Owner,
    description: "Full control over the organization, including ownership.",
    permissions: Object.values(Permissions),
  },
  {
    name: SystemRole.Admin,
    description: "Manages organization settings, members, and invitations.",
    permissions: [
      Permissions.OrganizationRead,
      Permissions.OrganizationUpdate,
      Permissions.MembersRead,
      Permissions.MembersInvite,
      Permissions.MembersUpdate,
      Permissions.MembersSuspend,
      Permissions.MembersRemove,
      Permissions.AuditRead,
      Permissions.AuditExport,
      // Deal intelligence (Phase 9): ADMIN may view stored runs and trigger
      // provable provider work (analyze/Q&A).
      Permissions.DealIntelligenceRead,
      Permissions.DealIntelligenceAnalyze,
      // Quantum optimization (Phase 10): ADMIN may view stored runs and
      // trigger solver work (optimize/compare) against the quantum service.
      Permissions.OptimizationRead,
      Permissions.OptimizationRun,
      // Approval + settlement operations: an approval policy may name ADMIN as
      // an approver, so ADMIN must be able to read/decide approvals or the
      // workflow deadlocks. Settlement execution is likewise an operations
      // action ADMIN is expected to perform.
      Permissions.ApprovalsRead,
      Permissions.ApprovalsDecide,
      Permissions.SettlementRead,
      Permissions.SettlementExecute,
    ],
  },
  {
    name: SystemRole.Member,
    description: "Participates in the organization's business.",
    permissions: [
      Permissions.OrganizationRead,
      Permissions.MembersRead,
      // Members may READ stored intelligence results but cannot trigger the
      // external provider (cost/privilege boundary — analyze stays OWNER/ADMIN).
      Permissions.DealIntelligenceRead,
      // Quantum optimization (Phase 10): same boundary — MEMBER may read
      // stored runs only; running the solver stays OWNER/ADMIN.
      Permissions.OptimizationRead,
    ],
  },
  {
    name: SystemRole.Viewer,
    description: "Read-only access to the organization.",
    permissions: [Permissions.OrganizationRead],
  },
];

/** Relative authority used by ownership and role-assignment rules. */
export const ROLE_LEVEL: Record<string, number> = {
  [SystemRole.Owner]: 4,
  [SystemRole.Admin]: 3,
  [SystemRole.Member]: 2,
  [SystemRole.Viewer]: 1,
};

/**
 * Whether an actor (at `actorLevel`) may move a target member (at their
 * current level) into a new role (at `targetNewLevel`).
 *
 *   - You cannot touch members whose current level is above yours.
 *   - You cannot assign a level above your own (no self-empowerment past your
 *     peers). OWNER is additionally unreachable here (see
 *     `isDirectlyAssignableRole`/ownership transfer).
 */
export function canChangeRoleOf(
  actorLevel: number,
  targetCurrentLevel: number,
  targetNewLevel: number,
): boolean {
  if (targetCurrentLevel > actorLevel) return false;
  if (targetNewLevel > actorLevel) return false;
  return true;
}

/**
 * Roles the generic role-change endpoint may assign. The OWNER role is
 * excluded: ownership is only reachable through the explicit (audited)
 * ownership-transfer flow, never through a free-form role change.
 */
export function isDirectlyAssignableRole(role: string): boolean {
  return (
    role === SystemRole.Admin ||
    role === SystemRole.Member ||
    role === SystemRole.Viewer
  );
}
