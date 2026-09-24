// Standalone system-role seed. Run via `npm run db:seed` (or automatically by
// `prisma migrate dev`). Idempotent — safe to run against any environment.
import { prisma } from "../src/lib/prisma.js";
import { syncSystemRoles } from "../src/modules/organizations/role.seed.js";

async function main(): Promise<void> {
  await syncSystemRoles(prisma);
  const roles = await prisma.role.findMany({
    where: { isSystem: true },
    orderBy: { name: "asc" },
    include: { permissions: { include: { permission: true } } },
  });
  // eslint-disable-next-line no-console
  console.log(
    "System roles synced:",
    roles.map((r) => `${r.name}(${r.permissions.length} perms)`).join(", "),
  );
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });