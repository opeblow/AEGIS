import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

// Matches the DATABASE_URL pinned in vitest.config.ts.
const TEST_DATABASE_URL =
  process.env.AEGIS_TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/aegis_test?schema=public";

console.log(`Syncing test schema to ${TEST_DATABASE_URL}`);
const result = spawnSync(
  "npx",
  ["prisma", "db", "push", "--skip-generate", "--force-reset"],
  {
    cwd: repoRoot,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  },
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log("Seeding system roles + permissions");
const seed = spawnSync(
  process.execPath,
  [path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs"), "prisma/seed.ts"],
  {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  },
);

process.exit(seed.status ?? 0);
