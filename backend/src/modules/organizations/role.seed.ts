import { Prisma, type PrismaClient } from "@prisma/client";
import { PERMISSION_CATALOG } from "./permissions.js";
import { SYSTEM_ROLES } from "./roles.js";
import { prisma as defaultPrisma } from "../../lib/prisma.js";

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Idempotently seeds the permission catalog, the system roles, and the
 * role -> permission mapping. Safe to run at any time and as often as needed
 * (no-op on the second run).
 *
 * System roles are globally seeded (isSystem = true, organizationId = null)
 * so every organization references the same OWNER/ADMIN/MEMBER/VIEWER roles.
 * Clients can never modify this mapping — it is server-owned data.
 */
export async function syncSystemRoles(db: Db = defaultPrisma): Promise<void> {
  const permissions = new Map<string, string>(); // name -> id

  for (const def of PERMISSION_CATALOG) {
    const upserted = await db.permission.upsert({
      where: { name: def.name },
      update: { description: def.description, category: def.category },
      create: {
        name: def.name,
        description: def.description,
        category: def.category,
      },
    });
    permissions.set(def.name, upserted.id);
  }

  for (const role of SYSTEM_ROLES) {
    const upserted = await db.role.upsert({
      where: { name: role.name },
      update: { description: role.description, isSystem: true },
      create: {
        name: role.name,
        description: role.description,
        isSystem: true,
        organizationId: null,
      },
    });

    for (const permissionName of role.permissions) {
      const permissionId = permissions.get(permissionName);
      if (!permissionId) {
        throw new Error(`Unknown permission in seed: ${permissionName}`);
      }
      await db.rolePermission.upsert({
        where: {
          roleId_permissionId: { roleId: upserted.id, permissionId },
        },
        update: {},
        create: { roleId: upserted.id, permissionId },
      });
    }
  }
}

/** Returns the database id of a system role by name. */
export async function systemRoleId(
  roleName: string,
  db: Db = defaultPrisma,
): Promise<string | null> {
  const role = await db.role.findUnique({ where: { name: roleName } });
  return role ? role.id : null;
}

/**
 * Resolves the ids of every system role (name -> id). Used to seed memberships
 * and to build OWNER-count queries.
 */
export async function allSystemRoleIds(
  db: Db = defaultPrisma,
): Promise<Map<string, string>> {
  const roles = await db.role.findMany({
    where: { isSystem: true },
    select: { id: true, name: true },
  });
  return new Map(roles.map((r) => [r.name, r.id]));
}
