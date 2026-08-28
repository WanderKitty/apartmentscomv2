import { expect, test } from "@playwright/test";

test("scrape health dashboard renders", async ({ page }) => {
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "Scrape health" })).toBeVisible();
  await expect(page.getByText(/0 sources · \d+ active listings/)).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Source" })).toBeVisible();
});

test("health endpoint reports database up", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ ok: true, db: "up" });
});
