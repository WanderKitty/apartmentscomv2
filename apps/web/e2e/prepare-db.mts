// Prepare the dedicated e2e database named by DATABASE_URL (set in
// playwright.config.ts webServer.env): create if missing, reset + migrate,
// then load the 26-listing seed corpus through the normal seed CLI. Run by
// the e2e:server script before `next start`.
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ensureDatabase, resetDatabaseAtUrl } from "@aptv2/db/test-helpers";

const target = process.env.DATABASE_URL;
if (!target) throw new Error("DATABASE_URL must point at the e2e database");
const dbName = new URL(target).pathname.slice(1);
// The target database may not exist yet — administer via the always-present
// default `postgres` database on the same server.
const admin = new URL(target);
admin.pathname = "/postgres";
const url = await ensureDatabase(admin.toString(), dbName);
await resetDatabaseAtUrl(url);

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
execSync("pnpm --filter @aptv2/pipeline seed", {
  cwd: repoRoot,
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: url },
});
console.log("[e2e] database ready");
