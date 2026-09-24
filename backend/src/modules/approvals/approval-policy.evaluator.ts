import { type PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "../../lib/prisma.js";
import { AppError } from "../../lib/errors/index.js";
import type {
  ApprovalAssignment,
  ApprovalRuleType,
  PolicySnapshot,
} from "./approval.types.js";
import { validateAllRules } from "./approval.schemas.js";

export async function evaluatePolicy(
  snapshot: PolicySnapshot,
  organizationId: string,
  deal: { type: string; currency: string; notionalAmount: string },
  db: PrismaClient = defaultPrisma,
): Promise<ApprovalAssignment[]> {
  validateAllRules(snapshot.rules);

  const roleUsers = await resolveRoleUsers(db, organizationId);

  const seen = new Set<string>();
  const assignments: ApprovalAssignment[] = [];
  let nextSequence = 0;

  const getPriority = (config: Record<string, unknown>): number => {
    const p = Number(config.priority);
    return Number.isNaN(p) ? 0 : p;
  };

  const sortedRules = [...snapshot.rules].sort(
    (a, b) => getPriority(a.config) - getPriority(b.config),
  );

  for (const rule of sortedRules) {
    const ruleAssignments = evaluateRule(
      rule.ruleType as ApprovalRuleType,
      rule.config as Record<string, unknown>,
      deal,
      roleUsers,
      () => nextSequence++,
    );
    for (const assignment of ruleAssignments) {
      if (!seen.has(assignment.userId)) {
        seen.add(assignment.userId);
        assignments.push(assignment);
      }
    }
  }

  return assignments;
}

async function resolveRoleUsers(
  db: PrismaClient,
  organizationId: string,
): Promise<Map<string, string[]>> {
  const members = await db.organizationMember.findMany({
    where: {
      organizationId,
      status: "ACTIVE",
      organization: { status: "ACTIVE" },
    },
    select: {
      userId: true,
      role: { select: { name: true } },
    },
  });

  const map = new Map<string, string[]>();
  for (const member of members) {
    const roleName = member.role?.name ?? "";
    if (!map.has(roleName)) {
      map.set(roleName, []);
    }
    map.get(roleName)!.push(member.userId);
  }

  return map;
}

export function evaluateRule(
  ruleType: ApprovalRuleType,
  config: Record<string, unknown>,
  deal: { type: string; currency: string; notionalAmount: string },
  roleUsers: Map<string, string[]>,
  nextSequence: () => number,
): ApprovalAssignment[] {
  switch (ruleType) {
    case "ROLE_APPROVAL": {
      const roles = (config.roles ?? []) as string[];
      const result: ApprovalAssignment[] = [];
      for (const role of roles) {
        const users = roleUsers.get(role) ?? [];
        for (const userId of users) {
          result.push({
            userId,
            roleName: role,
            sequence: nextSequence(),
            required: true,
          });
        }
      }
      return result;
    }
    case "NOTIONAL_THRESHOLD": {
      const threshold = parseFloat(config.threshold as string);
      const comparator = (config.comparator ?? ">=") as string;
      const roles = (config.roles ?? []) as string[];
      const amount = parseFloat(deal.notionalAmount);
      if (isNaN(amount)) return [];

      let matches = false;
      switch (comparator) {
        case ">=":
          matches = amount >= threshold;
          break;
        case "=":
          matches = amount === threshold;
          break;
        case "<=":
          matches = amount <= threshold;
          break;
      }
      if (!matches) return [];

      const result: ApprovalAssignment[] = [];
      for (const role of roles) {
        const users = roleUsers.get(role) ?? [];
        for (const userId of users) {
          result.push({
            userId,
            roleName: role,
            sequence: nextSequence(),
            required: true,
          });
        }
      }
      return result;
    }
    case "DEAL_TYPE": {
      const types = (config.types ?? []) as string[];
      const roles = (config.roles ?? []) as string[];
      if (!types.includes(deal.type)) return [];

      const result: ApprovalAssignment[] = [];
      for (const role of roles) {
        const users = roleUsers.get(role) ?? [];
        for (const userId of users) {
          result.push({
            userId,
            roleName: role,
            sequence: nextSequence(),
            required: true,
          });
        }
      }
      return result;
    }
    case "CURRENCY": {
      const currencies = (config.currencies ?? []) as string[];
      const roles = (config.roles ?? []) as string[];
      if (!currencies.includes(deal.currency)) return [];

      const result: ApprovalAssignment[] = [];
      for (const role of roles) {
        const users = roleUsers.get(role) ?? [];
        for (const userId of users) {
          result.push({
            userId,
            roleName: role,
            sequence: nextSequence(),
            required: true,
          });
        }
      }
      return result;
    }
    case "MULTI_APPROVER": {
      const threshold = (config.threshold ?? 1) as number;
      const roles = (config.roles ?? []) as string[];
      const allUsers: Array<{ userId: string; roleName: string }> = [];
      for (const role of roles) {
        const users = roleUsers.get(role) ?? [];
        for (const userId of users) {
          allUsers.push({ userId, roleName: role });
        }
      }
      const unique = Array.from(
        new Map(allUsers.map((u) => [u.userId, u])).values(),
      );
      const picked = unique.slice(0, threshold);
      return picked.map((u) => ({
        userId: u.userId,
        roleName: u.roleName,
        sequence: nextSequence(),
        required: true,
      }));
    }
    case "SEQUENTIAL_APPROVAL": {
      const roles = (config.roles ?? []) as string[];
      const result: ApprovalAssignment[] = [];
      for (const role of roles) {
        const users = roleUsers.get(role) ?? [];
        for (const userId of users) {
          result.push({
            userId,
            roleName: role,
            sequence: nextSequence(),
            required: true,
          });
        }
      }
      return result;
    }
    case "PARALLEL_APPROVAL": {
      const roles = (config.roles ?? []) as string[];
      const baseSequence = nextSequence();
      const result: ApprovalAssignment[] = [];
      for (const role of roles) {
        const users = roleUsers.get(role) ?? [];
        for (const userId of users) {
          result.push({
            userId,
            roleName: role,
            sequence: baseSequence,
            required: true,
          });
        }
      }
      return result;
    }
    case "REQUIRED_DOCUMENTS":
    case "REQUIRED_REQUIREMENTS": {
      return [];
    }
    default:
      throw AppError.approvalPolicyEvaluationFailed(`Unknown rule type: ${ruleType}`);
  }
}

export async function evaluatePolicyWithUsers(
  snapshot: PolicySnapshot,
  organizationId: string,
  deal: { type: string; currency: string; notionalAmount: string },
): Promise<ApprovalAssignment[]> {
  return evaluatePolicy(snapshot, organizationId, deal);
}
