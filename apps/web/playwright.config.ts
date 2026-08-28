import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";

config({ path: path.resolve(__dirname, "../../.env") });

// E2E runs against a real `next start` over a dedicated aptv2_e2e database
// seeded with the 26-listing demo corpus (e2e/prepare-db.mts). No
// ANTHROPIC_API_KEY is provided, so query parsing deterministically uses the
// keyword fallback rung — the same degradation path production relies on.
const PORT = 3111;
const baseDb =
  process.env.TEST_DATABASE_URL ??
  "postgres://postgres:postgres@localhost:5432/aptv2_test";
const e2eDb = new URL(baseDb);
e2eDb.pathname = "/aptv2_e2e";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm run e2e:server",
    url: `http://localhost:${PORT}/api/health`,
    timeout: 240_000,
    reuseExistingServer: !process.env.CI,
    env: {
      TEST_DATABASE_URL: baseDb,
      DATABASE_URL: e2eDb.toString(),
      ANTHROPIC_API_KEY: "",
    },
  },
});
