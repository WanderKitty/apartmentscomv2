import { expect, test } from "@playwright/test";

// The admin dashboard was removed from the public app (user ruling
// 2026-08-28): the route must 404, while the health endpoint stays for
// deploy checks and the e2e web server's readiness probe.
test("admin route is gone", async ({ request }) => {
  const res = await request.get("/admin");
  expect(res.status()).toBe(404);
});

test("health endpoint reports database up", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ ok: true, db: "up" });
});
