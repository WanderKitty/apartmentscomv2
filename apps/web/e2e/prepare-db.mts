// Prepare the dedicated e2e database: create if missing, reset + migrate,
// then load the 26-listing seed corpus through the normal seed CLI. Run by
// the e2e:server script before `next start`; DATABASE_URL and
// TEST_DATABASE_URL come from playwright.config.ts webServer.env.
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ensureDatabase, resetDatabaseAtUrl } from "@aptv2/db/test-helpers";

const base =
  process.env.TEST_DATABASE_URL ??
  "postgres://postgres:postgres@localhost:5432/aptv2_test";
const url = await ensureDatabase(base, "aptv2_e2e");
await resetDatabaseAtUrl(url);

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
execSync("pnpm --filter @aptv2/pipeline seed", {
  cwd: repoRoot,
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: url },
});
console.log("[e2e] database ready");
