import { defineConfig, devices } from "@playwright/test";

// Read-only post-deploy smoke checks against the live deployment. Loose
// assertions only: the production corpus changes with every scrape, so
// nothing here depends on counts or specific listings.
const baseURL =
  process.env.PROD_URL || "https://apartmentscomv2-tagg2.vercel.app";

export default defineConfig({
  testDir: "./e2e/smoke",
  timeout: 30_000,
  retries: 2,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
